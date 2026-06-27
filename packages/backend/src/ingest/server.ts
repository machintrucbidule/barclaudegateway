/**
 * Fastify HTTP server exposing the ingestion endpoint to the ESP32/ESPHome scanner (DECISION-009).
 *
 * Two routes:
 *  - `POST /v1/scan` — validate the EAN, run the {@link IngestPipeline}, answer synchronously with a
 *    rich {@link ScanResponse}. The firmware drives its LED + buzzer from `status` first; the HTTP
 *    code is secondary (200 for business outcomes, 400 for a malformed barcode, 502 for an upstream
 *    Chronodrive failure).
 *  - `GET /health` — the read-only self-test (contract.md §7.1), reused from Phase 2.
 *
 * No application auth: the service is local-only behind a Cloudflare Tunnel (PROJECT_CONTEXT). Request
 * bodies carry only an EAN (not a secret); Fastify's default logging never logs bodies.
 */

import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ScanResponse, ScanStatus } from '@barclaudegateway/shared';
import { runHealthSelfTest } from '../health/selfTest.js';
import { redactLogObject } from '../logging/redact.js';
import { apiRoutes } from '../http/apiRoutes.js';
import type { ApiDeps } from '../http/apiRoutes.js';
import { validateEan } from './ean.js';
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

/** Map a scan status to its HTTP code. Business outcomes are 200; only failures break out of 2xx. */
function statusToHttp(status: ScanStatus): number {
  switch (status) {
    case 'invalid_ean':
      return 400;
    case 'error':
      return 502;
    default:
      return 200;
  }
}

export function buildServer(deps: ServerDeps, options: ServerOptions = {}): FastifyInstance {
  // Defense in depth (contract.md §8): every log record is deep-redacted via `redactLogObject`, so a
  // secret in any logged structure (headers, bodies, serialized errors) is masked even if a caller
  // forgets. Today nothing logs secrets — Fastify's defaults log only method/url/status — but this
  // keeps that guarantee from depending on never logging the wrong object.
  const app = Fastify({
    logger: (options.logger ?? false) ? { formatters: { log: redactLogObject } } : false,
  });

  // Error shaping is endpoint-specific: the scanner endpoints always get a parseable ScanResponse
  // (the firmware drives its LED/buzzer from `status`), while the `/api` UI routes get plain JSON.
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? 500;
    if (request.url.startsWith('/api')) {
      reply.code(statusCode >= 400 ? statusCode : 500).send({ error: error.message });
      return;
    }
    // Malformed JSON / unsupported content-type never reaches the scan handler — normalise it to our
    // own `invalid_ean` shape so the firmware always receives a ScanResponse it can parse.
    if (statusCode >= 400 && statusCode < 500) {
      const body: ScanResponse = {
        status: 'invalid_ean',
        ean: '',
        message: 'Malformed request body (expected JSON { "ean": "..." })',
      };
      reply.code(400).send(body);
      return;
    }
    const body: ScanResponse = {
      status: 'error',
      ean: '',
      category: 'unknown',
      message: 'Internal error',
    };
    reply.code(500).send(body);
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
    },
  });

  app.post('/v1/scan', async (request, reply) => {
    const body = request.body as { ean?: unknown } | undefined;
    const rawEan = typeof body?.ean === 'string' ? body.ean : '';

    const validation = validateEan(body?.ean);
    if (!validation.ok || validation.normalized === undefined) {
      const response: ScanResponse = {
        status: 'invalid_ean',
        ean: rawEan,
        message: validation.error,
      };
      reply.code(400).send(response);
      return;
    }

    const response = await deps.pipeline.handle(validation.normalized);
    reply.code(statusToHttp(response.status)).send(response);
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
