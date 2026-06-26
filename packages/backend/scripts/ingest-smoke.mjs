// Optional MANUAL live smoke-test for the ingestion path (not run in CI, never uses committed secrets).
//
// Exercises the real chain end-to-end through the actual Fastify route + pipeline:
//   login → POST /v1/scan → resolveEan → (optional) writes → ScanResponse.
//
// SAFE BY DEFAULT: with no write flag it resolves a known EAN only (read-only), which confirms auth,
// the search endpoint, and the §3 Origin/Referer requirement on api.chronodrive.com — and mutates
// nothing. To also test the write path (which DOES add to your real cart/list), set
// BCG_SMOKE_WRITE=true plus BCG_SMOKE_CART=true and/or BCG_SMOKE_LIST_ID=<uuid>.
//
// Run it yourself:
//   1. Create packages/backend/.env from .env.example with your Chronodrive email + password.
//   2. From packages/backend:  npm run ingest:smoke
//
// Live calls are kept minimal (CGU risk, contract.md §8). Secrets are never printed.

import { HttpClient } from '../dist/http/client.js';
import { DEFAULT_APP_CONFIG } from '../dist/config/defaults.js';
import { performFullLogin } from '../dist/auth/login.js';
import { ChronodriveClient } from '../dist/chronodrive/client.js';
import { openDatabase } from '../dist/storage/db.js';
import { ConfigStore } from '../dist/storage/config.js';
import { ScanLog } from '../dist/storage/scanLog.js';
import { DestinationsStore } from '../dist/storage/destinations.js';
import { IngestPipeline } from '../dist/ingest/pipeline.js';
import { buildServer } from '../dist/ingest/server.js';

const email = process.env.BCG_CHRONODRIVE_EMAIL;
const password = process.env.BCG_CHRONODRIVE_PASSWORD;
if (!email || !password) {
  console.error('Missing BCG_CHRONODRIVE_EMAIL / BCG_CHRONODRIVE_PASSWORD (see .env.example).');
  process.exit(2);
}

const ean = process.env.BCG_SMOKE_EAN || '3183280000933';
const doWrite = process.env.BCG_SMOKE_WRITE === 'true';
const cart = process.env.BCG_SMOKE_CART === 'true';
const listId = process.env.BCG_SMOKE_LIST_ID || '';

const config = {
  identityBaseUrl: DEFAULT_APP_CONFIG.identityBaseUrl,
  clientId: DEFAULT_APP_CONFIG.clientId,
  redirectUri: DEFAULT_APP_CONFIG.redirectUri,
  scope: DEFAULT_APP_CONFIG.scope,
};

const http = new HttpClient();

console.log('Login (Steps 1+2+3)…');
const session = await performFullLogin(http, config, { email, password });
console.log(`  ok: access token (${session.accessToken.length} chars).`);

const chronodrive = new ChronodriveClient({
  http,
  config: DEFAULT_APP_CONFIG,
  getToken: async () => session.accessToken,
});

if (!doWrite) {
  console.log(`\nRead-only resolve of EAN ${ean} (no destination written)…`);
  const product = await chronodrive.resolveEan(ean);
  if (!product) {
    console.log('  not_found: the catalogue returned no product for this EAN.');
  } else {
    console.log(
      `  found: "${product.labels?.productLabel ?? product.id}" (stock=${product.stock ?? '?'}, eligible=${product.isEligible ?? '?'})`,
    );
  }
  console.log('\nSMOKE PASS (read-only) — auth + search + §3 Origin/Referer confirmed live.');
  console.log(
    'Set BCG_SMOKE_WRITE=true (+ BCG_SMOKE_CART / BCG_SMOKE_LIST_ID) to test the write path.',
  );
  process.exit(0);
}

console.warn('\n!! BCG_SMOKE_WRITE=true — this WILL mutate your real Chronodrive account.');
const db = openDatabase(':memory:');
const configStore = new ConfigStore(db);
configStore.seedDefaults();
const destinations = new DestinationsStore(configStore);
destinations.write({ cart, lists: listId ? [{ id: listId, name: 'smoke-test list' }] : [] });

const pipeline = new IngestPipeline({ chronodrive, scanLog: new ScanLog(db), destinations });
const app = buildServer({ pipeline, chronodrive });

console.log(`POST /v1/scan { ean: "${ean}" }…`);
const res = await app.inject({ method: 'POST', url: '/v1/scan', payload: { ean } });
console.log(`  HTTP ${res.statusCode}`);
console.log(JSON.stringify(res.json(), null, 2));

await app.close();
db.close();
console.log('\nSMOKE DONE — full ingestion path exercised.');
