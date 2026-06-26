// Optional MANUAL live smoke-test (not run in CI, never uses committed secrets).
//
// Proves the real Chronodrive login AND the silent refresh — the latter was never exercised live
// when the contract was reverse-engineered (a known Phase 2 risk). Run it yourself:
//
//   1. Create packages/backend/.env from .env.example with your Chronodrive email + password.
//   2. From packages/backend:  npm run auth:smoke
//
// It runs ONE full login + ONE refresh, keeping live calls minimal (CGU risk, contract.md §8).
// Secrets are never printed — only token length and expiry are logged.

import { HttpClient } from '../dist/http/client.js';
import { DEFAULT_APP_CONFIG } from '../dist/config/defaults.js';
import { performFullLogin, performSilentRefresh } from '../dist/auth/login.js';

const email = process.env.BCG_CHRONODRIVE_EMAIL;
const password = process.env.BCG_CHRONODRIVE_PASSWORD;

if (!email || !password) {
  console.error('Missing BCG_CHRONODRIVE_EMAIL / BCG_CHRONODRIVE_PASSWORD (see .env.example).');
  process.exit(2);
}

const config = {
  identityBaseUrl: DEFAULT_APP_CONFIG.identityBaseUrl,
  clientId: DEFAULT_APP_CONFIG.clientId,
  redirectUri: DEFAULT_APP_CONFIG.redirectUri,
  scope: DEFAULT_APP_CONFIG.scope,
};

const http = new HttpClient();

console.log('Step 1+2+3 — full login…');
const session = await performFullLogin(http, config, { email, password });
console.log(
  `  ok: access token (${session.accessToken.length} chars), exp ${new Date(session.expiresAtMs).toISOString()}`,
);

console.log('Step 2+3 — silent refresh (reusing the session cookie, no password)…');
const refreshed = await performSilentRefresh(http, config, session.cookieHeader);
console.log(
  `  ok: refreshed token (${refreshed.accessToken.length} chars), exp ${new Date(refreshed.expiresAtMs).toISOString()}`,
);

console.log('\nSMOKE PASS — full login and silent refresh both succeeded.');
