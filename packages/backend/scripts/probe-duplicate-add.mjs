// THROWAWAY manual probe for BL-005 — what does Chronodrive return when you PATCH objectsToAdd for a
// product that is ALREADY in the list? Decides CHEAP (interpret the response) vs PRECHECK (membership
// pre-check). Not run in CI, never prints secrets.
//
// It is self-cleaning: it uses an EAN that is NOT in the target list, adds it twice (fresh, then
// duplicate), records both raw responses + the resulting quantity, then REMOVES it to restore state.
//
// Run from packages/backend:  node --env-file=.env scripts/probe-duplicate-add.mjs
//   Optional: BCG_PROBE_EAN=<ean>  BCG_PROBE_LIST_ID=<uuid>

import { HttpClient } from '../dist/http/client.js';
import { DEFAULT_APP_CONFIG } from '../dist/config/defaults.js';
import { performFullLogin } from '../dist/auth/login.js';
import { ChronodriveClient } from '../dist/chronodrive/client.js';

const email = process.env.BCG_CHRONODRIVE_EMAIL;
const password = process.env.BCG_CHRONODRIVE_PASSWORD;
if (!email || !password) {
  console.error('Missing BCG_CHRONODRIVE_EMAIL / BCG_CHRONODRIVE_PASSWORD (see .env.example).');
  process.exit(2);
}

// EAN-B from the backlog: a product in NEITHER cart nor list, so add#1 is genuinely fresh.
const ean = process.env.BCG_PROBE_EAN || '3495562466000';
const forcedListId = process.env.BCG_PROBE_LIST_ID || '';

const cfg = DEFAULT_APP_CONFIG;
const http = new HttpClient();

console.log('Login (Steps 1+2+3)…');
const session = await performFullLogin(
  http,
  {
    identityBaseUrl: cfg.identityBaseUrl,
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    scope: cfg.scope,
  },
  { email, password },
);
console.log(`  ok (access token ${session.accessToken.length} chars).`);

const client = new ChronodriveClient({
  http,
  config: cfg,
  getToken: async () => session.accessToken,
});
const siteId = await client.getSiteId();
const origin = new URL(cfg.redirectUri).origin;

// Pick the smallest list (cheapest baseline scan) unless one is forced.
let listId = forcedListId;
let listName = '(forced)';
if (!listId) {
  const lists = await client.getShoppingLists();
  if (!lists.length) {
    console.error('No shopping lists on this account — cannot probe.');
    process.exit(2);
  }
  const smallest = [...lists].sort((a, b) => (a.nbItems ?? 0) - (b.nbItems ?? 0))[0];
  listId = smallest.id;
  listName = smallest.name;
}
console.log(`Target list: "${listName}" (${listId})`);

// Resolve the EAN → productId.
const product = await client.resolveEan(ean);
if (!product) {
  console.error(`EAN ${ean} not found in catalogue — pick another via BCG_PROBE_EAN.`);
  process.exit(2);
}
const productId = product.id;
console.log(`Product: "${product.labels?.productLabel ?? productId}" (id=${productId})`);

// ---- helpers -------------------------------------------------------------------------------------
const listUrl = `${cfg.apiBaseUrl}/shopping-lists/${listId}`;
const headers = {
  authorization: `Bearer ${session.accessToken}`,
  'x-device-type': 'WEB',
  'x-api-key': cfg.apiKeys.shoppingLists,
  origin,
  referer: `${origin}/`,
  'x-chronodrive-site-id': siteId,
  'x-chronodrive-site-mode': cfg.siteMode,
};

async function rawAdd() {
  // Direct PATCH so we see the RAW status/body even on a non-2xx (the client would throw on those).
  const res = await http.requestJson(listUrl, {
    method: 'PATCH',
    endpoint: 'PATCH /shopping-lists/{listId} (probe add)',
    headers,
    body: { objectsToAdd: [{ productId, quantity: 1 }] },
  });
  return { status: res.status, apiVersion: res.apiVersion, body: res.data };
}

async function quantityInList() {
  // Page contents until we find the product (or run out), to read its current quantity.
  for (let page = 1; page <= 50; page += 1) {
    const contents = await client.getListContents(listId, page, 50);
    const hit = contents.content?.find((e) => e.product?.id === productId);
    if (hit) return hit.quantity ?? null;
    if (!contents.page?.hasNext) break;
  }
  return null; // not present
}

// ---- baseline ------------------------------------------------------------------------------------
const baselineQty = await quantityInList();
console.log(
  `\nBaseline: product ${baselineQty === null ? 'NOT present' : `present (qty=${baselineQty})`} in the list.`,
);
if (baselineQty !== null) {
  console.warn(
    '  ! Chosen EAN is already in the list — add#1 will itself be a duplicate. Results below are both duplicates.',
  );
}

// ---- probe ---------------------------------------------------------------------------------------
console.log('\n--- ADD #1 (expected: FRESH add) ---');
const add1 = await rawAdd();
console.log(JSON.stringify(add1, null, 2));
const qtyAfter1 = await quantityInList();
console.log(`  quantity after add#1: ${qtyAfter1}`);

console.log('\n--- ADD #2 (expected: DUPLICATE add) ---');
const add2 = await rawAdd();
console.log(JSON.stringify(add2, null, 2));
const qtyAfter2 = await quantityInList();
console.log(`  quantity after add#2: ${qtyAfter2}`);

// ---- verdict -------------------------------------------------------------------------------------
console.log('\n=== VERDICT ===');
const distinguishable =
  add1.status !== add2.status || JSON.stringify(add1.body) !== JSON.stringify(add2.body);
console.log(`add#1 status=${add1.status}  add#2 status=${add2.status}`);
console.log(
  `quantity: baseline=${baselineQty} → afterFresh=${qtyAfter1} → afterDuplicate=${qtyAfter2}`,
);
console.log(
  distinguishable
    ? '→ CHEAP possible: the duplicate response DIFFERS from the fresh one (interpret it in the client).'
    : '→ PRECHECK required: duplicate response is INDISTINGUISHABLE from a fresh add (membership pre-check needed).',
);
console.log(
  qtyAfter2 === qtyAfter1
    ? '  list re-add is IDEMPOTENT on quantity (stays the same).'
    : '  list re-add INCREMENTS the quantity.',
);

// ---- cleanup -------------------------------------------------------------------------------------
if (baselineQty === null) {
  console.log('\nRestoring state: removing the probe product from the list…');
  await client.removeFromList(listId, [productId]);
  const qtyAfterRemove = await quantityInList();
  console.log(`  done (quantity now: ${qtyAfterRemove === null ? 'absent' : qtyAfterRemove}).`);
} else {
  console.log('\nNOTE: product pre-existed; left as-is (state NOT auto-restored).');
}
console.log('\nPROBE DONE.');
