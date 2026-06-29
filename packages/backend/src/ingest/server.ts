/**
 * Fastify HTTP server (DECISION-009). Routes:
 *  - `POST /api/v1/scan` — the scanner ingestion (BL-013/DECISION-028): validate the EAN, run the
 *    {@link IngestPipeline}, answer synchronously with a rich {@link ScanResponse} (the firmware drives
 *    its LED from `status`). It lives in the key-guarded local API ({@link localApiRoutes}); the HTTP
 *    code is secondary (200 business outcomes, 400 malformed, 502 upstream failure).
 *  - `GET /health` — the read-only self-test (contract.md §7.1), reused from Phase 2; `GET /livez` the
 *    container liveness probe.
 *
 * The local API is guarded by `X-API-Key`; the UI `/api/*` and `/health`/`/livez` are local-only behind a
 * Cloudflare Tunnel (PROJECT_CONTEXT). Fastify's default logging never logs bodies.
 */

import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ScanResponse } from '@barclaudegateway/shared';
import { runHealthSelfTest } from '../health/selfTest.js';
import { redactLogObject } from '../logging/redact.js';
import { apiRoutes } from '../http/apiRoutes.js';
import type { ApiDeps } from '../http/apiRoutes.js';
import { localApiRoutes } from '../http/localApiRoutes.js';
import type { IngestPipeline } from './pipeline.js';

export interface ServerDeps extends ApiDeps {
  pipeline: IngestPipeline;
  /**
   * Absolute path to the built frontend (`packages/frontend/dist`). When set and present, Fastify
   * serves the SPA from it with a history-fallback; when absent (dev/CI without a build), static
   * serving is skipped and only the API/scan routes are mounted.
   */
  uiDir?: string;
}

export interface ServerOptions {
  /** Enable Fastify's request logger (off by default — tests stay quiet, the scan journal is canonical). */
  logger?: boolean;
}

export function buildServer(deps: ServerDeps, options: ServerOptions = {}): FastifyInstance {
  // Defense in depth (contract.md §8): every log record is deep-redacted via `redactLogObject`, so a
  // secret in any logged structure (headers, bodies, serialized errors) is masked even if a caller
  // forgets. Today nothing logs secrets — Fastify's defaults log only method/url/status — but this
  // keeps that guarantee from depending on never logging the wrong object.
  const app = Fastify({
    logger: (options.logger ?? false) ? { formatters: { log: redactLogObject } } : false,
  });

  // Tolerate an EMPTY JSON body. Fastify's default `application/json` parser rejects an empty body sent
  // with `content-type: application/json` ("Body cannot be empty…"), which broke bodyless POSTs (e.g.
  // regenerating the local API key, "connect", "check-now") from clients that always set the header.
  // An empty body parses to `undefined`; a non-empty body is parsed as JSON (malformed → 400 as before).
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      if (body === undefined || body === null || body.trim() === '') {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch {
        const err = new Error('Invalid JSON body') as Error & { statusCode?: number };
        err.statusCode = 400;
        done(err, undefined);
      }
    },
  );

  // Error shaping is endpoint-specific: the scan endpoint always gets a parseable ScanResponse (the
  // firmware drives its LED from `status`), while every other `/api` route gets plain JSON. The scan is
  // now `POST /api/v1/scan` (BL-013/DECISION-028), so it must be matched BEFORE the generic `/api` branch.
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? 500;
    if (request.url.startsWith('/api/v1/scan')) {
      // Malformed JSON never reaches the scan handler — normalise it to `invalid_ean` so the firmware
      // always receives a ScanResponse it can parse.
      const body: ScanResponse =
        statusCode >= 400 && statusCode < 500
          ? {
              status: 'invalid_ean',
              ean: '',
              message: 'Malformed request body (expected JSON { "ean": "..." })',
            }
          : { status: 'error', ean: '', category: 'unknown', message: 'Internal error' };
      reply.code(statusCode >= 400 && statusCode < 500 ? 400 : 502).send(body);
      return;
    }
    reply.code(statusCode >= 400 ? statusCode : 500).send({ error: error.message });
  });

  // Phase 4 local-UI API (reuses the Phase 3 stores). Registered before static so `/api/*` always
  // resolves to a handler, never to the SPA fallback.
  void app.register(apiRoutes, {
    prefix: '/api',
    deps: {
      chronodrive: deps.chronodrive,
      auth: deps.auth,
      configStore: deps.configStore,
      destinations: deps.destinations,
      credentialStore: deps.credentialStore,
      scanLog: deps.scanLog,
      events: deps.events,
      eventLog: deps.eventLog,
      eventBus: deps.eventBus,
      emit: deps.emit,
      errorMonitor: deps.errorMonitor,
      haWebhook: deps.haWebhook,
      priceTracking: deps.priceTracking,
      priceScheduler: deps.priceScheduler,
    },
  });

  // Local "Layer B" API (BL-008). Its own versioned prefix + encapsulated X-API-Key guard; mounted
  // before static so `/api/v1/*` resolves to a handler, never the SPA fallback. The guard hook lives
  // inside this plugin, so the UI `/api/*` routes are unaffected. The scanner ingestion now lives here
  // too — `POST /api/v1/scan`, key-guarded (BL-013/DECISION-028) — so it takes the `pipeline`.
  void app.register(localApiRoutes, {
    prefix: '/api/v1',
    deps: {
      configStore: deps.configStore,
      emit: deps.emit,
      chronodrive: deps.chronodrive,
      priceTracking: deps.priceTracking,
      priceScheduler: deps.priceScheduler,
      pipeline: deps.pipeline,
    },
  });

  app.get('/health', async (_request, reply) => {
    // Same passive policy as GET /api/health: in lazy mode, gate on a live session so this readiness
    // probe never forces a login while idle (BL-006).
    const lazy = deps.configStore.readAppConfig().authMode === 'lazy';
    const report = await runHealthSelfTest(deps.chronodrive, {
      isConfigured: () => deps.credentialStore.has(),
      ...(lazy ? { hasSession: () => deps.auth.hasLiveSession() } : {}),
    });
    // 503 only on a real failure. "Not configured" and lazy-"idle" are informational → 200.
    const healthy = report.ok || report.configured === false || report.idle === true;
    reply.code(healthy ? 200 : 503).send(report);
  });

  // Liveness probe for the container healthcheck: confirms the HTTP server is up, WITHOUT touching
  // Chronodrive. Stays 200 even when the upstream is down/unconfigured, so an alive container is
  // never killed. (/health remains the Chronodrive readiness self-test.)
  app.get('/livez', async (_request, reply) => {
    reply.code(200).send({ status: 'ok' });
  });

  // Serve the built React SPA in production. `wildcard: false` lets unmatched GETs fall through to the
  // not-found handler, which returns index.html so client-side routes (/config, /dashboard, /logs)
  // resolve. Skipped when the bundle is absent (dev runs Vite; CI has no build).
  if (deps.uiDir !== undefined && existsSync(deps.uiDir)) {
    const uiDir = deps.uiDir;
    void app.register(fastifyStatic, { root: uiDir, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      // Unknown API/scan paths are genuine 404s, not SPA routes.
      if (
        request.method !== 'GET' ||
        request.url.startsWith('/api') ||
        request.url.startsWith('/v1')
      ) {
        reply.code(404).send({ error: 'Not found' });
        return;
      }
      reply.sendFile('index.html');
    });
  }

  return app;
}
