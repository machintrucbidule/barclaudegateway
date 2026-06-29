# BarclaudeGateway — Backlog Archive

> Append-only history of **shipped** backlog items, for reference. An item moves here from
> [`BACKLOG.md`](./BACKLOG.md) when its batch is completed (loop prompt 2), keeping its full entry
> plus **what was actually done**, the **date shipped**, and the **commit/PR reference**.
>
> Newest entries on top. Nothing here is active work — the active backlog is [`BACKLOG.md`](./BACKLOG.md).
>
> Last updated: 2026-06-29 (BATCH-12 — BL-014 single-owner LED race fix + BL-015 bounded search payload;
> firmware + a small additive backend/contract change. Shipped in the **`0.3.1`** patch release (the
> Layer-B epic itself shipped earlier the same day as **`0.3.0`**); both GHCR builds succeeded.)

---

## BATCH-12 — Scanner / firmware fixes (P2) — shipped 2026-06-29

> Developed via loop prompt 2. Two independent scanner defects found in everyday use after the BATCH-11
> firmware rebase, grouped so the firmware is built and **re-flashed once**. BL-014 is firmware-only;
> BL-015 is firmware + a small additive backend tweak (no breaking change — DECISION-027). Neither blocks
> the pending user-triggered 0.3.0 release.

### [BL-014] Fix intermittent wrong LED colours caused by concurrent LED writes (firmware)

- Type: Bug · Priority: P2 · Batch: BATCH-12 · Source: user remark (2026-06-29)
- **Date shipped**: 2026-06-29
- **Description (root cause)**: the WS2812 intermittently showed the wrong colour — yellow instead of white
  in-flight, cyan/blue instead of green "ok". A **software race**, not hardware: two owners drove the LED
  — `send_scan` wrote white inline (`light.turn_on`) AND the `set_led` script wrote the result colour then
  auto-off. `send_scan` is `mode: restart`, fired from several sources, so writes/clears overlapped and
  channels blended (white−blue = yellow; green + leftover blue = cyan).
- **What was actually done** (`firmware/esphome/barclaude-scanner.yaml`):
  - Made **`set_led` the sole LED writer**, parameterised for every state. It now takes
    `off_after_ms: int`: `light.turn_on` full R/G/B at `brightness: ${led_brightness}` instantly, then
    `if off_after_ms > 0` → `delay <off_after_ms>` + `light.turn_off`. `mode: restart` means a new call
    cancels the previous sequence (incl. a pending turn-off) → **last call wins**, no overlap, no ghost
    turn-off. Every write sets the full R/G/B (no partial-channel writes).
  - **Removed the second LED owner** in `send_scan`: deleted the `script.stop: set_led` + the inline white
    `light.turn_on` block; the in-flight white is now `set_led(255,255,255, 0)` (stays on until the result
    call). Kept the one `${white_flush_ms}` yield so the strip flushes white before the blocking POST.
  - Result calls (and the no-response branch) pass `${feedback_ms}` as the 4th arg: green
    `set_led(0,180,0, ${feedback_ms})`, orange `(255,185,10, …)`, red `(200,0,0, …)`.
  - Added a **`led_brightness`** substitution (default `'50%'`) — single source of truth for LED brightness
    (was hard-coded `brightness: 50%` in two places). `feedback_ms` is now a plain int of ms (`'1500'`),
    consumed by `set_led`'s int param.
  - **No** optional local debounce (user's choice): the GM861S reg 0x0013 same-barcode delay already covers
    double-reads; the single-owner refactor alone removes the artefacts.
  - Docs: `docs/esphome-contract.md` gained a "Single-owner LED (BL-014)" note. A **refinement of
    DECISION-020** (no new decision number).
- **Acceptance criteria — met (pending on-hardware confirmation by the user after flashing)**: repeated
  back-to-back scans show white in-flight then the correct mapped colour (green/orange/red) with no
  yellow/cyan; the result holds `feedback_ms` then turns off; manual-EAN + resend paths show the correct
  colour; no regression in the scan→cart/list outcome. (Firmware is not unit-tested; validation is the
  DECISION-020-style hardware check.)

### [BL-015] Fix the ESP "Search" field: bound the search payload so the result parses

- Type: Bug · Priority: P2 · Batch: BATCH-12 · Source: user remark (2026-06-29)
- **Date shipped**: 2026-06-29
- **Description (root cause)**: typing a keyword in the HA "Search" field returned "aucun résultat" though
  the backend answered correctly. `GET /api/v1/search` returned the default page of 20 `ProductSummary`
  items (~8 KB); the ESP `http_request` could not capture/parse a body that large → ArduinoJson
  `IncompleteInput`. The firmware only ever displays the first result, so it was requesting ~20× more than
  it needed.
- **What was actually done**:
  - **Backend** (`packages/backend/src/http/localApiRoutes.ts`, `GET /search`): reads optional `size`
    (clamped 1..50, default **20** unchanged for other callers) and `page` (≥1, default 1) query params via
    a new `clampInt` helper + `SEARCH_SIZE_MAX = 50`, and passes them to the existing
    `deps.chronodrive.searchProducts(term, page, size)`. Response shape/journalling/mapping unchanged.
  - **Firmware** (`barclaude-scanner.yaml`, `search_query`): the URL is now
    `…/api/v1/search?q=<enc>&size=1` so the body is ~1 result and parses reliably (avoids the ESP buffer
    limit entirely). First-result extraction lambda unchanged.
  - **Contract** (`api/local/contract.md` §5.1): documented `size` + `page` (a params table); bumped the
    doc to **0.4.1** with a §6 version-history row (additive, backward-compatible — DECISION-027).
- **Acceptance criteria — met**: `GET /api/v1/search?q=…&size=1` returns a single summary; the default (no
  `size`) still returns 20 for other callers; a backend test covers the `size`/`page` clamping; §5.1
  documents the params. (HA-side "Search result" populating + no `IncompleteInput` in ESP logs is the
  user's on-hardware confirmation after flashing.)
- **Tests** (all green: **226** backend, 5 new in `localApiRoutes.test.ts`): `/search` forwards
  `size=1` → `searchProducts('carottes',1,1)`; no params → `(…,1,20)`; `size=999&page=3` → clamped
  `(…,3,50)`; non-numeric → defaults; empty `q` → `400` and upstream not called. Lint/typecheck/format green.

- **Commit/PR**: branch `fix/batch-12-scanner-firmware` → `main` (merge `67bd30e`, loop prompt 2,
  2026-06-29); shipped in the **`0.3.1`** patch release (tag `v0.3.1` → GHCR, build succeeded — the Layer-B
  epic itself shipped earlier the same day as `0.3.0`, DECISION-027).

---

## BATCH-11 — Wiring, ops, ESPHome/HA YAML, docs & full tests (P2) — shipped 2026-06-29

> Developed via loop prompt 2 on branch `feature/batch-7-local-api-foundation` (part of the single
> user-triggered **0.3.0** release, DECISION-027). The **final** batch of the DECISION-022 Layer-B epic:
> make the surface usable + documented, rebase the reference firmware on Ivan's actual YAML, and prove
> lazy/keepalive. Recorded as **DECISION-028**. With it, the backlog is empty.

### [BL-013] Surface config (key), consolidate the scan onto the local API, update ESPHome/HA YAML, docs, full tests

- Type: Evolution · Priority: P2 · Batch: BATCH-11 · Source: user remark (2026-06-28)
- **Date shipped**: 2026-06-29
- **Approved design decisions (DECISION-028, user's choices)**: the **scan moves onto the local API**
  (`POST /api/v1/scan`, key-guarded — *"le scan doit fonctionner comme les autres endpoints, … api key"*);
  the config-page key gets a **read-only display + a Régénérer button**; the two new HA functions are
  **product-info-on-scan** + **keyword search**.
- **What was actually done**:
  - **Scan consolidation** (the one intentional breaking change, DECISION-027-compliant): moved the scan
    handler from `ingest/server.ts` into `localApiRoutes` as `POST /api/v1/scan` (behind the `X-API-Key`
    guard); **removed the keyless `POST /v1/scan`** (now 404). Self-contained handler (validation +
    `pipeline.handle` always return a `ScanResponse`); the error handler maps a malformed scan body to
    `invalid_ean`. `LocalApiDeps` gained `pipeline`. The `ScanResponse` shape is **unchanged**.
  - **Key surface**: additive `GET /api/local-api-key` + `POST /api/local-api-key/regenerate`
    (`bootstrap.generateLocalApiKey` factored out); a Config-page **"API locale"** card (read-only key +
    base URL `window.location.origin + /api/v1` + copy + a guarded **Régénérer**). The key stays out of
    `GET/PUT /api/config` (DECISION-023).
  - **Firmware** (`firmware/esphome/barclaude-scanner.yaml`): **rebased on Ivan's actual YAML** (white-flush
    timing fix, GM861S config exposed as HA numbers, `logger` buffer); scan URL → `/api/v1/scan` + the
    `X-API-Key` header (`local_api_key` substitution); new `last_product`/`last_price` sensors from
    `ScanResponse.product`; a **Search** text → `GET /api/v1/search?q=` → `search_result` sensor;
    `"aaa"` placeholders replaced with `!secret …`.
  - **Docs**: `docs/esphome-contract.md` (URL + `X-API-Key` + the new HA functions), `README.md` (Local
    API section + status refresh), `docs/deployment.md` (Local API integration), `api/local/contract.md`
    (§5.0b `POST /api/v1/scan`).
  - **lazy/keepalive verified**: the `/api/v1/*` endpoints log in on demand (no lazy gate, no background
    poll); a gated-timer test confirms the price scheduler stays off by default.
- **Acceptance criteria — met**: the Config page exposes the key (read-only) + base URL + regenerate; the
  firmware (from Ivan's) calls the local API for scan + search with the key and adds the HA functions; both
  APIs communicate; the full suite is green; docs current; lazy/keep-alive behave per DECISION-021.
- **Tests** (all green: **245** total — 220 backend + 25 frontend; ~7 new): `server.test.ts` (scan via
  `/api/v1/scan` + key, 401 without key, old `/v1/scan` → 404); `apiRoutes.test.ts` (key get/regenerate);
  `priceScheduler.test.ts` (gated timer); `ConfigPage.test.tsx` (Local API card + regenerate).
  Lint/typecheck/format/build green.
- **Docs/specs**: `decisions.md` (DECISION-028), `PROJECT_CONTEXT.md`. **No app-version bump** — part of the
  single 0.3.0 epic (DECISION-027). Upstream `contract.md` unchanged.
- **Commit/PR**: branch `feature/batch-7-local-api-foundation` (loop prompt 2, 2026-06-29).

---

## BATCH-10 — In-gateway price tracking & alerts + a UI page (P2) — shipped 2026-06-28

> Developed via loop prompt 2 on branch `feature/batch-7-local-api-foundation` (part of the single
> user-triggered **0.3.0** release, DECISION-027). UC7: the
> alert logic lives in the gateway — historise tracked-product prices, alert on a drop via a Home
> Assistant webhook — plus, at the user's request, a **"Suivi des prix"** UI page. Recorded as
> **DECISION-026**. Completes the DECISION-022 Layer-B **data** surface; only BATCH-11 (wiring/ops) remains.

### [BL-012] Price-history store, per-product thresholds, scheduler, and HA webhook alert

- Type: Evolution · Priority: P2 · Batch: BATCH-10 · Source: user remark (2026-06-28)
- **Date shipped**: 2026-06-28
- **Approved design decisions (DECISION-026)**: CRUD on **both** surfaces (user: *"les deux"*) — internal
  `/api/price-tracking/*` (no key, the page) + local `/api/v1/price-tracking/*` (key-guarded, external);
  **a UI page** (user's explicit request); gated **opt-in** scheduler (default off); **re-arm** alert
  (one per crossing).
- **What was actually done**:
  - **Storage** (`storage/db.ts` + new `storage/priceTracking.ts`): `tracked_products` + `price_history`
    tables; `PriceTrackingStore` (add/get/list/remove/updateThreshold/recordPrice/history/setArmed/
    markAlerted/prune) modelled on the scan/event journals; price-history prune added to the daily prune.
  - **Config** (`config/defaults.ts`): `priceTrackingEnabled` (default false) + `priceTrackingIntervalHours`
    (default 12) — backend-managed, NOT in the shared `ApiConfig`, **excluded from `appConfigToEntries`** so
    `PUT /api/config` can't clobber the page-managed settings (same rule as `localApiKey`).
  - **Scheduler** (new `price/priceScheduler.ts`): `PriceScheduler` (`runOnce`/`start`/`stop`/`applyConfig`/
    `trigger`), `unref()` timer like `TokenLifecycle`, gated on the enabled flag (the epic's sanctioned
    background exception). Per cycle: `getProduct` → `prices.defaultPrice` → `recordPrice` + `price_check`
    log; on `price ≤ threshold && armed` → `notifyPriceDrop` + disarm; re-arm when the price recovers.
  - **HA alert** (`health/haWebhook.ts`): added `notifyPriceDrop` posting a secret-free
    `{ kind: 'price_drop', severity: 'info', productId, label?, price, threshold, at }` (additive; the
    critical-error path unchanged). No cooldown — the re-arm flag is the dedup.
  - **Routes** (new `http/priceTrackingRoutes.ts`): one sub-plugin (GET list, POST add by ean/productId →
    resolve via `getProductByEan`/`getProduct`, PUT threshold, DELETE, GET history, GET/PUT settings →
    `scheduler.applyConfig()`, POST check-now → `scheduler.trigger()`) registered on **both** `apiRoutes`
    (`/api/price-tracking`, no key) and `localApiRoutes` (`/api/v1/price-tracking`, key-guarded). `ApiDeps`
    + `LocalApiDeps` gained `priceTracking` + `priceScheduler`; wired in `server.ts`/`main.ts`/`bootstrap.ts`.
  - **Shared DTOs** (`api/contract.ts`): `TrackedProduct`/`TrackedProductsResponse`/`AddTrackedProductInput`/
    `PricePoint`/`PriceHistoryResponse`/`PriceTrackingSettings`/`CheckNowResult`.
  - **Frontend** (new `pages/PriceTrackingPage.tsx` + `App.tsx` nav/route + `api/client.ts`): the **"Suivi
    des prix"** page (`/prices`) — settings (Switch + interval + "Vérifier maintenant"), an add-by-EAN form,
    and a table (label, EAN, prix actuel, seuil inline-edit, dernier contrôle, état armé/alerté, Supprimer).
  - **No new `LogEventType`** (reuses `price_check`/`ha_alert`/`config_change`).
- **Acceptance criteria — met**: adding a tracked product records prices over time; a price at/below the
  threshold fires exactly one HA alert (re-arm dedup); the scheduler is opt-in (default off) and `unref()`d
  (no unbounded calls); CRUD + history are visible in the UI and on `/logs`; the local surface is
  key-guarded.
- **Tests** (all green: **240** total — 216 backend + 24 frontend; ~16 new): `storage/priceTracking.test.ts`;
  `price/priceScheduler.test.ts` (drop→alert→disarm→re-arm, no-price skip); `health/haWebhook.test.ts`
  (`notifyPriceDrop` payload); `http/apiRoutes.test.ts` (internal CRUD + local key-guard);
  `pages/PriceTrackingPage.test.tsx` (list/add/remove/settings). Lint/typecheck/format/build green.
- **Docs/specs**: `api/local/contract.md` spec-revision → 0.4.0 (§5.10 `IMPLEMENTED`); `decisions.md`
  (DECISION-026). **No app-version bump** — part of the single 0.3.0 epic (DECISION-027). `PROJECT_CONTEXT.md`
  updated. Upstream `contract.md` unchanged.
- **Commit/PR**: branch `feature/batch-7-local-api-foundation` (loop prompt 2, 2026-06-28).

---

## BATCH-9 — Cart & lists via the local API (P1) — shipped 2026-06-28

> Developed via loop prompt 2 on branch `feature/batch-7-local-api-foundation` (part of the single
> user-triggered **0.3.0** release, DECISION-027). The
> read/write cart + lists surface on the local "Layer B" API, a recipe-fill composite, and a
> budget+nutrition aggregate (UC1/5/6/9/10 — the rest of the macronome cluster). Recorded as
> **DECISION-025**. Heavy reuse of the existing cart/list client methods; upstream `contract.md`
> unchanged; `api/local/contract.md` → v0.3.0.

### [BL-011] Expose cart read/write, lists CRUD, recipe-fill, and a budget/nutrition aggregate

- Type: Evolution · Priority: P1 · Batch: BATCH-9 · Source: user remark (2026-06-28)
- **Date shipped**: 2026-06-28
- **Approved design decision (DECISION-025, user's choice)**: write items accept **`id` / `ean` / `name`**
  ("les 2 doivent être possibles") with a per-item resolution report.
- **What was actually done**:
  - **Endpoints** (`http/localApiRoutes.ts`, behind the `X-API-Key` guard): `GET /api/v1/cart`
    (`NormalizedCart` — lines + totals), `GET /api/v1/cart/nutrition` (budget + summed macros),
    `POST /api/v1/cart/items` (batch, signed delta), `DELETE /api/v1/cart/items/{id}` (read-then-zero),
    `GET /api/v1/lists`, `GET /api/v1/lists/{id}` (summary + contents), `POST/DELETE /api/v1/lists/{id}/items`
    (idempotent add per DECISION-019), `POST /api/v1/recipe-fill` (→ cart or list). A `resolveItemRef`
    helper resolves `id` (as-is) / `ean` (search) / `name` (first search hit) and every write returns a
    `resolutions[]` report; unresolved items are reported, not applied.
  - **Upstream** (`chronodrive/client.ts`): new batch `updateCartItems(cartId, items[])` (one `content[]`
    POST); the single-item `updateCartItem` now delegates to it. Cart types extended (`CartLineItem` with the
    full per-line `product`, `CartAmounts`, `ProductPrices.totalAmount`) — additive/optional, scan path
    untouched. All other cart/list methods (`getActiveCart`, `getShoppingLists`, `getListContents`,
    `addToList`, `removeFromList`) reused as-is.
  - **Mapping** (`chronodrive/cartMapper.ts`, pure): `toNormalizedCart` (lines + totals) and
    `aggregateCartNutrition` (`totalPrice` from `amounts`; macros summed as `per-100g × weightKg × 10 × qty`;
    `incompleteLines` for a line missing weight/nutrition), reusing `toProductSummary`/`mapNutrition`. New
    shared DTOs in `api/local.ts` (`NormalizedCart`/`Line`/`CartTotals`, `CartNutritionAggregate`, `ItemRef`,
    `ItemResolution`, list + recipe-fill shapes).
  - **No new `LogEventType`**: the local API emits the existing `cart_read`/`list_read`/`recipe_fill`/
    `cart_write`/`list_write` types under the `chronodrive` category; the inbound request stays `api_local`.
- **Acceptance criteria — met**: cart read returns items + totals; add/remove mutate the real cart (signed
  delta); lists CRUD works; recipe-fill resolves a mixed id/ean/name set and adds it in one call; the
  aggregate returns total € + summed macros (with `incompleteLines`); all exchanges logged as **API
  Chronodrive** / **API interne**; lazy/keep-alive preserved (every call via `getToken`, no background poll).
- **Tests** (all green: **224** total — 204 backend + 20 frontend; ~8 new backend): `cartMapper.test.ts`
  (normalized cart + aggregate with an incomplete line); `chronodrive/client.test.ts` (`updateCartItems`
  batches); `http/apiRoutes.test.ts` (cart read + nutrition, cart write by id/ean/name + `not_found` report,
  lists read + add + recipe-fill → cart, key-guard 401, `chronodrive` events). Lint/typecheck/format/build green.
- **Docs/specs**: `api/local/contract.md` → v0.3.0 (§5.3–§5.9 `IMPLEMENTED` + the `ItemRef` model);
  `decisions.md` (DECISION-025); `PROJECT_CONTEXT.md`. **No app-version bump** — part of the single 0.3.0
  epic (DECISION-027). Upstream
  `contract.md` unchanged.
- **Commit/PR**: branch `feature/batch-7-local-api-foundation` (loop prompt 2, 2026-06-28).

---

## BATCH-8 — Products & nutrition via the local API (P1, Macronome cluster) — shipped 2026-06-28

> Developed via loop prompt 2 on branch `feature/batch-7-local-api-foundation` (part of the single
> user-triggered **0.3.0** release, DECISION-027). First
> data endpoints on the local "Layer B" API: search + the full product sheet with mapped nutrition,
> weight, price and absolute image URLs, backed by the upstream Chronodrive **Products** service.
> Recorded as **DECISION-024**. Upstream `contract.md` unchanged (already documents these at 1.5.0);
> `api/local/contract.md` → v0.2.0.

### [BL-010] Expose search + product sheet (with nutrition, weight, price, image)

- Type: Evolution · Priority: P1 · Batch: BATCH-8 · Source: user remark (2026-06-28)
- **Date shipped**: 2026-06-28
- **What was actually done**:
  - **Products `x-api-key`** added as a fifth per-service key (`apiKeys.products`, `x_api_key_products`,
    seed `34bfe4e1…`) across `config/defaults.ts` (incl. `appConfigFromMap` defaulting it, never
    `need()`), the shared `ApiConfig`, `parseConfigBody`/`toApiConfig`, the `XApiKeyService` union +
    `apiKeyFor`, and a config-page input (rotation recovery, contract.md §3.1). The ~6 test `apiKeys`
    literals were updated.
  - **Chronodrive client methods** (`chronodrive/client.ts`): `getProduct(id)` (§5.12),
    `searchProducts(term,page,size)` (§5.13), `getProductByEan(ean)` (one-call EAN→product), and
    `getProductsByIds(ids)` (§5.14, builds the repeated `?ids=` query manually since the HTTP client's
    `query` is single-valued) — all on the Products key + site headers. Upstream `Product` was extended
    **additively** (prices/packaging/images/characteristics) + `ProductsSearchResponse` added.
  - **Mappers** (`chronodrive/productMapper.ts`, pure): `mapNutrition` (essential §5.12.1 codes →
    `ProductNutrition`, undeclared fields omitted), `STATIC_MEDIA_BASE` + `toAbsoluteImages`,
    `toNormalizedProduct`, `toProductSummary`. New shared DTOs `ProductNutrition`/`NormalizedProduct`/
    `ProductSummary`/`ProductSearchResponse` in `api/local.ts`.
  - **Local endpoints** (`http/localApiRoutes.ts`, behind the BATCH-7 `X-API-Key` guard):
    `GET /api/v1/search?q=` → a page of `ProductSummary` (400 on empty `q`); `GET /api/v1/products/{eanOrId}`
    → a `NormalizedProduct`, disambiguating EAN (via `validateEan` → §5.13 search) vs product id (§5.12).
    Each upstream call is journalled as a `chronodrive` event (`product_search`/`product_lookup`); the
    inbound request is the existing `api_local` line. Not found → 404 `not_found`; upstream failure → 502
    `upstream_error`. `LocalApiDeps` gained `chronodrive`; wired in `ingest/server.ts`.
- **Acceptance criteria — met**: a known EAN returns a normalized product with mapped nutrition + weight +
  absolute image URL; a keyword returns a page of summaries; an unknown EAN → clean 404; the exchange is
  logged as **API Chronodrive** (upstream) and the inbound call as **API interne**; the mapper is tested
  against the two captured samples (`91574`, `572811`). Lazy/keep-alive preserved (on-demand login only).
- **Tests** (all green: **216** total — 196 backend + 20 frontend; ~24 new backend): `productMapper.test.ts`
  (two samples, fibre-absent case, image URLs, summary vs sheet); `chronodrive/client.test.ts` (the four
  product methods + Products-key/site-header assertions + empty-input short-circuit); `apiRoutes.test.ts`
  (search 200/400, product by EAN 200 with nutrition, by id 200, unknown → 404, 401 without key,
  `chronodrive` events filterable). Lint/typecheck/format/build green.
- **Docs/specs**: `api/local/contract.md` spec-revision → 0.2.0 (§5.1/§5.2 `IMPLEMENTED` with shapes);
  `decisions.md` (DECISION-024); `PROJECT_CONTEXT.md` (endpoints, Products key, decision-table row). **No
  app-version bump** — part of the single 0.3.0 epic (DECISION-027). Upstream `contract.md` unchanged.
- **Commit/PR**: branch `feature/batch-7-local-api-foundation` (loop prompt 2, 2026-06-28).

---

## BATCH-7 — Local API foundation + logging taxonomy (P1) — shipped 2026-06-28

> Developed via loop prompt 2 on branch `feature/batch-7-local-api-foundation` (app **v0.3.0**). First
> build under the DECISION-022 scope expansion: stands up the local "Layer B" API and splits the
> operational-log taxonomy to identify upstream-Chronodrive vs inbound-local exchanges. Recorded as
> **DECISION-023**. Middleware + shared types + UI filters + a new local contract doc; upstream
> `contract.md` unchanged.

### [BL-008] Stand up the local API (Layer B): contract, versioned prefix, `X-API-Key`, route skeleton

- Type: Evolution · Priority: P1 · Batch: BATCH-7 · Source: user remark (2026-06-28)
- **Date shipped**: 2026-06-28
- **Approved design decisions (DECISION-023, user's choices)**: empty key → **auto-generate at boot**;
  the key is **app-managed, not editable in the config page** (*"c'est nous qui la gérons"*).
- **What was actually done**:
  - **Contract doc**: new `specifications/api/local/contract.md` (v0.1.0) — the "output contract": the
    `/api/v1` prefix, the `X-API-Key` header + auto-managed-key model, the `LocalApiError` error model,
    `GET /api/v1/ping` (`IMPLEMENTED`), and every BATCH-8..10 endpoint catalogued as `PLANNED`. Referenced
    from `PROJECT_CONTEXT.md`.
  - **Versioned prefix `/api/v1`** (separate from the UI `/api/*` and the ESP `POST /v1/scan`).
  - **Skeleton router + guard** (`packages/backend/src/http/localApiRoutes.ts`): an encapsulated
    `onRequest` hook reads `local_api_key` fresh per request and compares it constant-time
    (`timingSafeEqual`) to `X-API-Key` → 401 on missing/wrong/empty; an `onResponse` hook journals every
    served request as an `api_local` event; a prefix-scoped JSON 404; a `GET /ping` stub
    (`{ status: 'ok', version: 1 }`). Registered in `ingest/server.ts` before static.
  - **App-managed key**: `bootstrap.ensureLocalApiKey` generates one (`randomBytes(24).base64url`) on
    first boot when empty, persists it via `ConfigStore.set`, and surfaces it once (a
    `local_api_key_generated` log event carrying the key + a stdout line). The key is kept out of the
    shared `ApiConfig` and out of `appConfigToEntries`, so `GET/PUT /api/config` can never expose, accept,
    or clobber it. New backend config field `localApiKey` (`CONFIG_KEYS.localApiKey = 'local_api_key'`,
    optional, default `''`).
  - **Shared types**: new `packages/shared/src/api/local.ts` (`LOCAL_API_PREFIX`, `LOCAL_API_KEY_HEADER`,
    `LocalApiError`, `LocalApiStatus`), barrel-exported.
- **Acceptance criteria — met**: no/wrong key → 401; right key → 200 stub; `POST /v1/scan` and `/api/*`
  unaffected (no key required, key never exposed); `PUT /api/config` never drops/exposes the key; types
  compile; the Layer-B contract doc exists and is referenced from PROJECT_CONTEXT.md.

### [BL-009] Extend the event-logging taxonomy to identify Chronodrive vs internal-API exchanges

- Type: Evolution · Priority: P1 · Batch: BATCH-7 · Source: user remark (2026-06-28)
- **Date shipped**: 2026-06-28
- **What was actually done**:
  - **Shared** (`packages/shared/src/logging/contract.ts`): `LogCategory` gained `chronodrive` ("API
    Chronodrive", upstream) and `api_local` ("API interne", inbound); `LogEventType` gained
    `product_lookup`/`product_search`/`cart_read`/`list_read`/`price_check` (chronodrive),
    `local_api_request`/`recipe_fill` (api_local), and `local_api_key_generated` (other).
  - **Backend** (`packages/backend/src/http/apiRoutes.ts`): `LOG_CATEGORIES` (the `GET /api/events`
    filter) accepts the two new categories.
  - **Frontend**: `components/logEvent.tsx` `CATEGORY` map gained both (orange "API Chronodrive", teal
    "API interne"); `pages/LogsPage.tsx` `FILTERS` gained both controls.
  - The **api_local** path is exercised live now (the ping's `onResponse` emits one event per served
    request); the **chronodrive** category is shipped + unit-tested now and gets real call sites in
    BATCH-8. Redaction (DECISION-018) intact.
- **Acceptance criteria — met**: an inbound local-API call appears on `/logs` as **API interne**; the
  filter isolates **API Chronodrive** vs **API interne**; the new categories are accepted by
  `GET /api/events`; existing auth/scan/other logs + redaction tests still pass.

### Tests & gates (both items)

- **Tests** (all green: **204** total — 184 backend + 20 frontend; 12 new backend tests):
  new `localApiRoutes.test.ts` (401 no/wrong key, 200 ping, locked-when-empty, `api_local` journalling,
  JSON 404); `bootstrap.test.ts` (auto-gen on first boot + `ensureLocalApiKey` idempotence); extended
  `apiRoutes.test.ts` (ping guard + no-regression on `/api/*`+`/v1/scan`, key never exposed/clobbered,
  `chronodrive` filter); extended `eventLog.test.ts` (new-category filtering).
- **Gates**: lint, typecheck, full build — all green.
- **Docs/specs**: `decisions.md` (DECISION-023), `PROJECT_CONTEXT.md`, new `api/local/contract.md`. Root
  `package.json` bumped **0.2.2 → 0.3.0**. Upstream `contract.md` unchanged.

- **Commit/PR**: branch `feature/batch-7-local-api-foundation` (loop prompt 2, 2026-06-28).

---

## BATCH-6 — Lazy mode: no forced list-fetch on the config page (P2) — shipped 2026-06-28

> Developed via loop prompt 2 on branch `feature/batch-6-lazy-destinations`. Closes the last path that
> still forced a login in lazy mode: opening the config page. Recorded as a **refinement of
> DECISION-021**. Middleware + UI change; `contract.md` unchanged.

### [BL-007] Stop the config page from force-fetching the shopping lists in lazy mode

- Type: Bug · Priority: P2 · Batch: BATCH-6 · Source: user remark (2026-06-28)
- **Date shipped**: 2026-06-28
- **Approved design decision**: the lazy gate is **session-aware** (user's choice), identical to the
  BL-006 `/health` gate — a live session fetches for free; only lazy **and** no live session stays
  dormant.
- **What was actually done**:
  - **Shared contract** (`packages/shared/src/api/contract.ts`): `DestinationsResponse` gained
    **`listsIdle?: boolean`** — `true` when the live list set was deliberately NOT fetched (lazy +
    no live session), distinct from `listsError` (a real failure).
  - **Backend** (`packages/backend/src/http/apiRoutes.ts`): the live fetch was factored into a local
    `destinationsWithLiveLists()` helper. **`GET /config/destinations`** now gates on
    `authMode === 'lazy' && !deps.auth.hasLiveSession()` → returns the cached/known lists +
    `listsIdle: true` with **no** Chronodrive call (mirrors the `/health` gate); otherwise it
    auto-fetches as before. New **`POST /config/destinations/refresh`** forces the live fetch
    (and thus an on-demand login in lazy mode), mirroring `POST /health/connect`. No new `ApiDeps`
    wiring — `auth` + `authMode` were already present from BL-006.
  - **Frontend** (`packages/frontend/src/api/client.ts`, `pages/ConfigPage.tsx`): new
    `api.refreshDestinations()`; `DestinationsSection` shows a blue "mode économique — listes en cache"
    note when `listsIdle`, and a **"Recharger les listes depuis Chronodrive"** button (shown on
    `listsIdle || listsError`) that calls the refresh endpoint and repopulates the live choices
    **without** resetting the user's in-progress cart/checkbox selection. The existing `mergeLists`
    path already renders the cached `enabled.lists` when `available.lists` is empty (incl. the empty
    first-run set). Keep-alive auto-fetches as before.
  - **Tests** (all green: 172 backend + 20 frontend): backend — lazy + no live session →
    `GET /config/destinations` returns the saved lists + `listsIdle: true` and makes no call;
    `POST /config/destinations/refresh` fetches even in lazy; keep-alive GET asserts `listsIdle`
    absent. Frontend — lazy idle renders the cached list + the refresh button, and clicking it loads
    the freshly-fetched list.
  - **Docs/specs**: DECISION-021 refined (`decisions.md`), `PROJECT_CONTEXT.md` (config-page lazy
    behaviour + API-surface + decision-table row + header). `contract.md` unchanged.
- **Acceptance criteria — met**:
  - Lazy: opening the config page makes no Chronodrive call / no login; the saved lists still display;
    the manual button fetches on demand (only then a login occurs).
  - Keep-alive: the config page behaves exactly as today (auto-fetch; never idle).
  - First-time lazy with nothing cached: cart + empty list set + the refresh button (one click fetches
    the lists to choose from).
  - Tests cover both modes; DECISION-021 refined; PROJECT_CONTEXT.md updated.
- **Commit/PR**: branch `feature/batch-6-lazy-destinations` (loop prompt 2, 2026-06-28).

---

## BATCH-5 — Configurable auth-token policy (P1) — shipped 2026-06-28

> Developed via loop prompt 2 on branch `feature/batch-5-auth-token-policy`. Adds an `auth_mode`
> setting (on-demand **lazy** vs **keep-alive**) so the gateway authenticates only when a scan needs
> it. Recorded as **DECISION-021**. Middleware + UI change; `contract.md` unchanged.

### [BL-006] Add a setting to choose the auth-token policy: on-demand (lazy) vs keep-alive

- Type: Evolution · Priority: P1 · Batch: BATCH-5 · Source: user remark (2026-06-28)
- **Date shipped**: 2026-06-28
- **What was actually done**:
  - **Config key `auth_mode`** (`lazy` | `keepalive`) added to `AppConfig`/`ApiConfig` and the
    `config` table (`packages/backend/src/config/defaults.ts`, `packages/shared/src/api/contract.ts`).
    `DEFAULT_APP_CONFIG.authMode = 'lazy'` (fresh installs); `appConfigFromMap` resolves a missing /
    invalid value to `keepalive`.
  - **Dev-gate against flipping prod** (`packages/backend/src/storage/config.ts`): `seedDefaults()`
    now detects a fresh DB (empty `config` table) and seeds `auth_mode` **only** then — an upgraded DB
    keeps the key absent (→ `keepalive`), so an `INSERT OR IGNORE` can't silently switch an existing
    deployment to `lazy`.
  - **Refresh timer gated on keep-alive** (`packages/backend/src/auth/lifecycle.ts`): new `keepAlive`
    dep (default `true`); `scheduleRefresh` runs only when `keepAlive`. Added `hasLiveSession()`
    (non-expired token). `bootstrap.ts` passes `keepAlive: config.authMode === 'keepalive'`.
  - **Self-test dormant while idle in lazy** (`selfTest.ts` + `main.ts`): new `hasSession?` option →
    when lazy and no live session, the self-test is skipped (no forced login) and the report carries
    `idle: true` (new `HealthReport.idle` field); `main.ts` emits a "Health self-test skipped (lazy,
    idle)" log. `errorMonitor` treats an idle report as informational (no surface change).
  - **API** (`apiRoutes.ts` + `server.ts`): `authMode` round-trips through GET/PUT `/api/config`
    (invalid value → 400); `GET /api/health` and the top-level `/health` apply the lazy/idle gate (no
    auto-connect); new **`POST /api/health/connect`** forces an on-demand login + full probe. `auth`
    threaded into `ApiDeps`.
  - **UI**: config page "Gestion de la connexion" `SegmentedControl` + plain-French trade-off
    explanation + "Vérifier la connexion maintenant" button; dashboard shows an "En veille (mode
    économique)" card with a "Se connecter / vérifier maintenant" button when idle
    (`ConfigPage.tsx`, `DashboardPage.tsx`, `api/client.ts` `connectNow`).
  - **Tests** added/updated (all green: 170 backend + 19 frontend): lazy never arms the timer +
    `hasLiveSession`; self-test idle gate; fresh→lazy / upgraded→keepalive seed (+ no auto-insert) +
    invalid→keepalive; `authMode` round-trip + 400; `/api/health` idle + `/api/health/connect` probe;
    ConfigPage mode switch + connect; DashboardPage idle card + connect.
  - **Docs/specs**: DECISION-021 (`decisions.md`), `PROJECT_CONTEXT.md` (auth-flow modes + decision
    table + header), `docs/deployment.md` (connection-mode section). `contract.md` unchanged.
- **Acceptance criteria — met**:
  - Fresh install defaults to lazy; an upgraded DB with no `auth_mode` keeps keep-alive until switched
    in the UI (covered by `config.test.ts`).
  - Lazy: no login at startup; a scan triggers an on-demand login; no refresh timer armed; the
    startup/6h self-test is skipped while idle with the "skipped (lazy, idle)" log.
  - Keep-alive: behaviour unchanged (refresh timer + startup/6h self-test).
  - The setting round-trips through GET/PUT `/api/config` and the config page; an invalid value is
    rejected; DECISION-021 + PROJECT_CONTEXT.md updated.
- **Commit/PR**: branch `feature/batch-5-auth-token-policy` (loop prompt 2, 2026-06-28).

---

## BATCH-1 — Hardware validation (P1) — shipped 2026-06-27

> Developed via loop prompt 2 on branch `feature/batch-1-hardware-validation`. Reference scanner
> firmware reconciled to **LED-only + Home-Assistant-integrated** and validated on real hardware.
> Recorded as **DECISION-020**. No middleware/app change; firmware is not in the Docker image, so no
> version bump.

### [BL-001] Validate the full scan flow on real ESP32 hardware

- Type: Evolution · Priority: P1 · Batch: BATCH-1 · Source: verification check (Phase 7, 2026-06-27)
- **Date shipped**: 2026-06-27
- **What was actually done**:
  - The ESP32-C6 + GM861S arrived and the firmware was validated on real hardware. The reference
    `firmware/esphome/barclaude-scanner.yaml` was reconciled to the user's working config:
    **buzzer removed** (LED-only — `output:`/`error_beep`/all beeps gone), a **white in-flight LED**,
    **Home-Assistant integration** (encrypted API + manual-EAN `text` + "resend" `button` +
    `last_ean`/`last_status` `text_sensor`s), `request_headers:` (newer ESPHome syntax), and `!secret`
    WiFi/AP/OTA/API hygiene.
  - **Status → LED** (validated): white in-flight; **green** = `added`/`duplicate_ignored`; **orange** =
    `added_to_lists_only`/`partial`; **red** = `not_found`/`invalid_ean`/`error`/no-response.
  - **Anomaly found & fixed on hardware**: an out-of-stock product looked **red**. The operational logs
    proved the middleware was correct (`scan_complete: added_to_lists_only`); the cause was the **orange
    LED value** — `(255, 80, 0)` renders too red on the WS2812, **tuned to `(255, 185, 10)`** (amber).
    Not a middleware bug.
  - Docs/specs updated: `docs/esphome-contract.md` (LED-only feedback table + white in-flight + HA
    section + updated sketch), **DECISION-020** in `decisions.md`, `PROJECT_CONTEXT.md` ESP32 section,
    and the `README.md` diagram (LED, no buzzer). The `ScanResponse` contract is unchanged.
- **Acceptance criteria — met** (adapted to LED-only per DECISION-020): each scan state, triggered
  physically (and/or via the HA manual-EAN input), shows the expected LED colour and a matching entry in
  **Historique des scans** + **Logs techniques** + the HA `last_status` sensor; the YAML and
  `docs/esphome-contract.md` reflect the firmware's real behaviour. The buzzer half of the original
  criterion was dropped (LED-only). **User-accepted on hardware 2026-06-27.**

---

## BATCH-4 — Scan behaviour: already-in-list (P1) — shipped 2026-06-27

> Resolved via loop prompt 2 on branch `feature/batch-4-already-in-list`
> (`docs(contract): confirm idempotent duplicate list-add; close BL-005 by investigation`).
> **Resolved by investigation — no application code change.** Recorded as **DECISION-019**.

### [BL-005] Treat "product already in the list" as a distinct green outcome

- Type: Evolution · Priority: P1 · Batch: BATCH-4 · Source: user remark (2026-06-27)
- **Date shipped**: 2026-06-27
- **Outcome**: **closed by investigation** — the premise (a duplicate list-add fails → red/orange) was
  disproven by a live probe; no distinct signal was built (the user chose to simplify at the dev gate).
- **What was actually done**:
  - **Live probe** (`packages/backend/scripts/probe-duplicate-add.mjs`, kept as the reproducible
    capture source): logged in, added a not-present product to a list twice, read the quantity each
    time, then restored state. Result — a fresh add and a duplicate add **both return `204 No
    Content`**, and the quantity **stays at 1** (idempotent); the duplicate response is
    **indistinguishable** from a fresh add.
  - **Consequence**: scanning an already-listed product **already** produces a green `added` outcome
    today (the `204` → destination `written` → aggregate `added`), so the red/orange concern never
    existed. A _distinct_ `already_in_list` label would have required a per-scan membership pre-check
    (`getListContents`, ~1–4 GET/scan/list on the ~191-item "Classiques" list) for marginal value —
    the user chose to drop it ("the result is green either way — why complicate?").
  - **contract.md** §5.8: documented the idempotent-`204` duplicate-add behaviour (capture noted),
    added a changelog row, and bumped the doc version **1.4.2 → 1.4.3**.
  - **decisions.md**: **DECISION-019** records the investigation, the options, and the "do not build"
    decision. **PROJECT_CONTEXT.md**: added the list-idempotency domain-knowledge bullet + a resolved
    decisions-table row; **no** scan-state added.
  - **No change** to `ScanStatus` / `DestinationResult`, the scan pipeline, the Chronodrive client,
    the server, the frontend, or the firmware. No app version bump (docs/spec only — no image rebuild).
- **Acceptance criteria** (original): superseded by the finding — scanning a product already in an
  enabled list is **already** a green, non-error outcome (`added`, HTTP 200), as is a fresh add; the
  two are deliberately not distinguished (DECISION-019). contract.md §5.8 documents the real
  duplicate-add response with the capture noted and the doc version bumped.

---

## BATCH-2 — First-run ergonomics (P2) — shipped 2026-06-27

> Developed and shipped via loop prompt 2 on branch `feature/batch-2-assisted-master-key`
> (`feat(config): assisted master-key generation on first run (BL-002)`). Recorded as a **refinement of
> DECISION-008** (refines, does not reverse, the env-injected key model).

### [BL-002] Assisted master-key generation on first run

- Type: Evolution · Priority: P2 · Batch: BATCH-2 · Source: user remark (2026-06-27)
- **Date shipped**: 2026-06-27
- **What was actually done**:
  - `config/env.ts`: new typed **`MissingMasterKeyError`** thrown by `loadEnv()` when `BCG_MASTER_KEY` is
    absent/blank (a *present-but-invalid* key keeps its existing plain `/32 bytes/` error, so a typo is
    not masked). New **pure** `formatFirstRunKeyHelp(key = generateMasterKeyHex())` that formats a
    copy-and-restart message embedding a freshly generated 64-hex key — no filesystem/DB access, reusing
    the existing `generateMasterKeyHex()`.
  - `main.ts`: the entry-point `catch` now branches on `MissingMasterKeyError` → prints
    `formatFirstRunKeyHelp()` to stderr and exits non-zero (the assisted first-run path); other failures
    keep the existing "Fatal" path. Hard-fail-to-start preserved — the app still does not run until the
    key is set in the environment.
  - `docs/deployment.md`: documented the first-run assist (printed generated key + copy-and-restart),
    kept the manual `openssl rand -hex 32` option, softened the `BCG_MASTER_KEY` table-row note.
  - Specs: `decisions.md` DECISION-008 gained a **Refinement (2026-06-27, BL-002)** note;
    `PROJECT_CONTEXT.md` secret-model bullet records the assisted first-run UX.
- **Acceptance criteria — met**: starting with no `BCG_MASTER_KEY` prints a ready-to-use generated key +
  instructions and exits non-zero (`formatFirstRunKeyHelp` unit-tested to embed a `parseMasterKey`-valid
  key); the key is **never written to `/data` or the DB** (the formatter is pure — no fs/DB access);
  setting the key in the env and restarting brings the app up; `docs/deployment.md` documents the flow.

---

## BATCH-3 — Logs & scan-history rework (P1) — shipped 2026-06-27

> Developed and shipped via loop prompt 2 on branch `feature/batch-3-logs-history`
> (`feat(logs): operational event-logging subsystem + searchable scan history (BL-003/004)`).
> Architecture recorded as **DECISION-018**. `contract.md` unchanged (internal journaling).

### [BL-003] Replace the live scan stream with a real operational-logs page

- Type: Evolution · Priority: P1 · Batch: BATCH-3 · Source: user remark (2026-06-27)
- **Date shipped**: 2026-06-27
- **What was actually done**:
  - New persisted, bounded **`event_log`** table (`storage/db.ts`) + **`EventLog`** store
    (`storage/eventLog.ts`) with retention **50 000 rows OR 10 years** (most restrictive), pruned on
    startup + daily alongside the scan log (`main.ts`). User-chosen at the development gate.
  - New **dedicated** `EventLogBus` (`logging/eventLogBus.ts`) + **`EventLogger`**
    (`logging/eventLogger.ts`, redact → persist → publish, exposed as an optional `EmitEvent`). The
    existing `ScanEventBus` was **left untouched** (still feeds the Phase-5 error monitor + scan
    history) — the user's chosen architecture (DECISION-018).
  - Shared **`LogEvent`** type + `LogCategory`/`LogLevel`/`LogEventType` + `EventsResponse`
    (`shared/src/logging/contract.ts`).
  - Emission wired (optional `emit`, additive — existing unit tests untouched) into: **auth**
    (`auth/login.ts` per PKCE step + `session_captured`/`login_complete`/`silent_refresh`;
    `auth/lifecycle.ts` `login_required`/`full_relogin`, success **and** failure), the **scan
    pipeline** (`ingest/pipeline.ts`: ordered `ean_read → search_request →
    product_resolved|product_not_found → cart_write/list_write → scan_complete`), the **health
    self-test** (`main.ts`), the **config/credentials** routes (`http/apiRoutes.ts`), the **HA
    notifier** (`health/haWebhook.ts`), and **startup** (`main.ts`).
  - New REST **`GET /api/events`** (category filter + pagination + total) and SSE
    **`GET /api/events/stream`** (live tail), mirroring the existing scans SSE pattern.
  - New frontend **`Logs techniques`** page (`pages/LogsPage.tsx`, replacing the old live-scan page):
    seeds from `/api/events`, tails `/api/events/stream`, category filter
    (Authentification / Scan d'objet / Autre / Tous), level badges, errors shown in red. Route `/logs`
    + nav in `App.tsx`; `components/logEvent.tsx` label/badge helpers.
  - **Redaction**: every event passes `logging/redact.ts` before storage/stream; a unit test asserts a
    secret in `detail` is masked (no token/cookie/password/code reaches `event_log` or the tail).
- **Acceptance criteria — met**: a full login emits the ordered auth lines and a silent refresh emits
  its two steps + a refresh marker (login.test.ts); a single scan emits the ordered `scan` set
  (server.test.ts); the category filter restricts/gates the tail (LogsPage.test.tsx); events appear
  live; logs persist in `event_log` and prune at 50 000/10 y (eventLog.test.ts); redaction proven
  (eventLogger.test.ts); PROJECT_CONTEXT.md updated.

### [BL-004] Repurpose the current page into a searchable, paginated scan history

- Type: Evolution · Priority: P1 · Batch: BATCH-3 · Source: user remark (2026-06-27)
- **Date shipped**: 2026-06-27
- **What was actually done**:
  - `GET /api/scans` extended (`http/apiRoutes.ts`) with **`status`** filter, **`search`** (EAN or
    message), **`page`/`pageSize`** (10/50/100/500 or `all`, default **100**) and a **`total`**;
    `ScansResponse` (`shared/src/api/contract.ts`) gained `total`/`page`/`pageSize` (was `count`).
  - `ScanLog` (`storage/scanLog.ts`) gained `query()` + `countMatching()` (filtered/paginated, LIKE
    with `ESCAPE` so literal `%`/`_` are safe); `recent()`/`count()` kept for the dashboard.
  - The former live page became **`Historique des scans`** (`pages/ScanHistoryPage.tsx`): **no SSE
    auto-append**; search box, status `Select`, page-size `Select` (10/50/100/500/Tout), pager.
    Route `/history` + nav in `App.tsx`. Dashboard updated to the new `ScansResponse` shape.
- **Acceptance criteria — met**: the page lists codes + status and does **not** auto-append
  (ScanHistoryPage.test.tsx, no EventSource); status filter + EAN/message search narrow the set and
  paginate (apiRoutes.test.ts); page size switches 10/50/100/500/all with **100** default;
  PROJECT_CONTEXT.md lists the two distinct pages.
