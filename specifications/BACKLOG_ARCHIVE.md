# BarclaudeGateway — Backlog Archive

> Append-only history of **shipped** backlog items, for reference. An item moves here from
> [`BACKLOG.md`](./BACKLOG.md) when its batch is completed (loop prompt 2), keeping its full entry
> plus **what was actually done**, the **date shipped**, and the **commit/PR reference**.
>
> Newest entries on top. Nothing here is active work — the active backlog is [`BACKLOG.md`](./BACKLOG.md).
>
> Last updated: 2026-06-27 (BATCH-2 shipped — BL-002)

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
