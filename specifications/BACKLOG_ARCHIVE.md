# BarclaudeGateway — Backlog Archive

> Append-only history of **shipped** backlog items, for reference. An item moves here from
> [`BACKLOG.md`](./BACKLOG.md) when its batch is completed (loop prompt 2), keeping its full entry
> plus **what was actually done**, the **date shipped**, and the **commit/PR reference**.
>
> Newest entries on top. Nothing here is active work — the active backlog is [`BACKLOG.md`](./BACKLOG.md).
>
> Last updated: 2026-06-28 (BATCH-6 — BL-007 lazy mode no longer force-fetches the config-page lists; backlog now empty)

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
