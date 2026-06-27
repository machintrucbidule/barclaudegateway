/**
 * Runnable entry point (Phase 3).
 *
 * Boots the real services (encrypted storage + auth + Chronodrive client), wires the ingestion
 * pipeline, and starts the Fastify server. No network call happens until the first scan (login is
 * lazy). The scan journal is pruned on startup and daily (DECISION-003 retention).
 *
 * `index.ts` stays the importable library barrel; this module is the only thing that listens, so
 * importing the package never opens a socket. Run via `npm start` (`node dist/main.js`).
 */

import { fileURLToPath } from 'node:url';
import { createServices } from './bootstrap.js';
import { loadEnv } from './config/env.js';
import { buildServer } from './ingest/server.js';
import { IngestPipeline } from './ingest/pipeline.js';
import { ScanEventBus } from './ingest/scanEvents.js';
import { DestinationsStore } from './storage/destinations.js';
import { ErrorMonitor } from './health/errorMonitor.js';
import { HaWebhookNotifier } from './health/haWebhook.js';
import { runHealthSelfTest } from './health/selfTest.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
/** How often the background health self-test probes Chronodrive (contract.md §7.1 suggests ~6h). */
const HEALTH_SELF_TEST_MS = 6 * 60 * 60 * 1_000;

/** Built React bundle served by Fastify in production; overridable via `BCG_UI_DIR`. */
function resolveUiDir(): string {
  return process.env.BCG_UI_DIR ?? fileURLToPath(new URL('../../frontend/dist', import.meta.url));
}

export async function main(): Promise<void> {
  const env = loadEnv();
  const services = createServices(env);

  // Both bounded journals are pruned on startup and daily (DECISION-003 + BL-003 retention).
  services.scanLog.prune();
  services.eventLog.prune();
  const dailyPrune = setInterval(() => {
    services.scanLog.prune();
    services.eventLog.prune();
  }, ONE_DAY_MS);
  dailyPrune.unref();

  services.emit({
    category: 'other',
    type: 'startup',
    level: 'info',
    message: 'BarclaudeGateway started',
  });

  // One bus, shared by the pipeline (publisher) and the SSE route (subscriber).
  const events = new ScanEventBus();
  const destinations = new DestinationsStore(services.configStore);

  // Phase 5: the critical-error surface. The monitor is fed by both live scan failures and the
  // periodic self-test; on a new critical incident it fires the Home Assistant webhook (if configured).
  const errorMonitor = new ErrorMonitor();
  const haWebhook = new HaWebhookNotifier({
    getUrl: () => services.configStore.readAppConfig().haWebhookUrl,
    emit: services.emit,
  });
  events.subscribe((event) => {
    errorMonitor.ingestScan(event);
  });
  errorMonitor.subscribe((state) => {
    if (state.active && state.error) void haWebhook.notify(state.error);
  });

  // Background health self-test: detect a breakage even with no scans (the user chose "both"). Run once
  // at startup, then every 6h. Failures are swallowed — a self-test crash must not take the server down.
  const runSelfTest = (): void => {
    void runHealthSelfTest(services.chronodrive, {
      isConfigured: () => services.credentialStore.has(),
    })
      .then((report) => {
        errorMonitor.ingestHealthReport(report);
        const failing = report.checks
          .filter((c) => c.status === 'error')
          .map((c) => ({ endpoint: c.endpoint, category: c.category }));
        services.emit({
          category: 'other',
          type: 'self_test',
          level: report.configured === false || report.ok ? 'info' : 'error',
          message:
            report.configured === false
              ? 'Health self-test skipped (not configured)'
              : report.ok
                ? 'Health self-test passed'
                : 'Health self-test failed',
          detail: { configured: report.configured, ok: report.ok, failing },
        });
      })
      .catch(() => {
        // A self-test that throws outright is itself a signal, but never fatal to the server.
      });
  };
  runSelfTest();
  const healthTimer = setInterval(runSelfTest, HEALTH_SELF_TEST_MS);
  healthTimer.unref();

  const pipeline = new IngestPipeline({
    chronodrive: services.chronodrive,
    scanLog: services.scanLog,
    destinations,
    events,
    emit: services.emit,
  });

  const app = buildServer(
    {
      pipeline,
      chronodrive: services.chronodrive,
      configStore: services.configStore,
      destinations,
      credentialStore: services.credentialStore,
      scanLog: services.scanLog,
      events,
      eventLog: services.eventLog,
      eventBus: services.eventBus,
      emit: services.emit,
      errorMonitor,
      haWebhook,
      uiDir: resolveUiDir(),
    },
    { logger: true },
  );
  await app.listen({ host: env.host, port: env.port });
}

main().catch((error: unknown) => {
  console.error('Fatal: BarclaudeGateway failed to start');
  console.error(error);
  process.exit(1);
});
