# BarclaudeGateway — Architecture Decisions Log

> Decisions are added here as they are resolved. Each entry records: the question, the options considered, the choice made, and who decided.
> All Phase 0 functional clarifications (CLARIFY-_) and architecture decisions (DECISION-_) are now resolved.
> Last updated: 2026-06-27 (DECISION-018 — operational event-logging architecture, BATCH-3)

---

## Template

```
### [DECISION-XXX] Decision title
- **Date**: YYYY-MM-DD
- **Question**: What needed to be decided
- **Options considered**:
  - Option A: description | Impact: ...
  - Option B: description | Impact: ...
- **Decision**: Chosen option
- **Decided by**: User / Mutual
- **Rationale**: Why
```

---

## Resolved — Requirements clarifications (Phase 0, Part 1)

### [CLARIFY-01] Product not found in Chronodrive

- **Date**: 2026-06-26
- **Question**: When the app looks up a scanned EAN and Chronodrive returns zero results, what should happen?
- **Options considered**:
  - A: Log only | Impact: simplest, but silent — a wanted product can be missed.
  - B: Log + visible alert in the web UI | Impact: user is notified, no manual recovery.
  - C: Log + alert + manual search/link | Impact: nothing lost, but needs an extra search screen in Phase 4.
- **Decision**: **B, extended** — log the event AND show a visible alert in the web UI, AND return an error status to the ESP32 so it can signal failure (red LED).
- **Decided by**: User (Ivan)
- **Rationale**: User wants to be notified in the UI without building a manual-link screen now, and wants immediate physical feedback at the scanner. The "return error status to the ESP32" requirement ties directly into CLARIFY-04 and the Phase 3 HTTP response contract.

### [CLARIFY-02] Scan intent: list vs cart — when and how

- **Date**: 2026-06-26
- **Question**: How does the user switch between "add to list" and "add to cart"?
- **Options considered**:
  - A: Mode set globally in the web config | Impact: simple to build, slower to change.
  - B: Physical button on the ESP32 toggles mode | Impact: convenient, needs wiring + ESPHome config + a mode indicator.
  - C: Both always happen simultaneously | Impact: no choice, but can fill the real cart unintentionally.
- **Decision**: **A (config-driven), generalized** — destinations are configured in the web UI, and it is NOT an exclusive list-OR-cart mode: multiple destinations can be active at once (cart and/or one or more lists). See CLARIFY-03 for the concrete UI.
- **Decided by**: User (Ivan)
- **Rationale**: User wants to enable several destinations simultaneously and control them from the config page, not via a physical mode toggle. Merged with CLARIFY-03 into a single checkbox screen.

### [CLARIFY-03] Which shopping list(s) receive scanned items

- **Date**: 2026-06-26
- **Question**: Should scanned items go to one fixed list, multiple lists, or a per-scan choice?
- **Options considered**:
  - A: One fixed list in config | Impact: simple, doesn't cover multiple targets.
  - B: Multiple lists enabled simultaneously | Impact: covers more cases, no per-scan cost.
  - C: Per-scan list choice | Impact: most flexible, requires manual action per scan.
- **Decision**: **B, as a checkbox screen** — the config page displays **"Panier" (cart) + every shopping list** (fetched dynamically from the account via `GET /v1/shopping-lists`), each with a checkbox. Checked = the scan adds to that destination; unchecked = ignored. A single scan feeds every checked destination.
- **Decided by**: User (Ivan)
- **Rationale**: Simple, explicit, and combines CLARIFY-02 (config-driven destinations) and CLARIFY-03 (multiple targets) into one screen. List set is dynamic, so new lists appear automatically.

### [CLARIFY-04] Feedback to the user at scan time

- **Date**: 2026-06-26
- **Question**: Should the ESP32 give immediate physical feedback (LED, buzzer) at scan time?
- **Options considered**:
  - A: No physical feedback, log only | Impact: no hardware work.
  - B: ESPHome drives LED/buzzer from the middleware's HTTP response | Impact: more comfortable, widens ESP32 scope, conditions the Phase 3 response contract.
- **Decision**: **B — physical feedback enabled, LED + buzzer.** The middleware returns a status detailed enough to distinguish multiple states (added / not-found / unavailable-ineligible / API error). ESPHome may map 2 colors (simple) or more (e.g. orange = out of stock) plus a buzzer, without changing the app. Exact LED/buzzer wiring is finalized in Phase 3.
- **Decided by**: User (Ivan)
- **Rationale**: User explicitly wants red-on-error (from CLARIFY-01) and added a buzzer. Recording the richer (multi-state) response contract keeps the visual-granularity option open at the ESPHome layer.

### [CLARIFY-05] Error notification beyond the web UI

- **Date**: 2026-06-26
- **Question**: On a critical Chronodrive API error, is a web-UI error enough, or is a proactive notification wanted?
- **Options considered**:
  - A: Web UI only | Impact: no extra dependency, user must check.
  - B: Home Assistant webhook notification | Impact: proactive alert, adds a config field (HA webhook URL) and a dependency.
- **Decision**: **B — proactive notification via a Home Assistant webhook** on critical API error. Adds a "HA webhook URL" config field.
- **Decided by**: User (Ivan)
- **Rationale**: User wants to be warned without watching the UI. Mosquitto/Home Assistant is confirmed present in the homelab (HA MQTT integration "Mosquitto broker" loaded), so HA integration is low-friction.

### [CLARIFY-06] HAR debug workflow — first release or later?

- **Date**: 2026-06-26
- **Question**: Should the maintenance page (Firefox HAR tutorial + ready-to-paste Claude debug prompt) ship in the first release or be deferred?
- **Options considered**:
  - A: Include from the start | Impact: longer first deliverable, equipped early if the API breaks.
  - B: Defer to a later iteration | Impact: faster first release, manual diagnosis if the API breaks early.
- **Decision**: **A — include in the first version** (Phase 5 ships in full).
- **Decided by**: User (Ivan)
- **Rationale**: It is part of the long-term maintenance vision for a private API that will change without notice; better to be equipped before the first breakage.

---

## Resolved — Architecture decisions (Phase 0, Part 2)

### [DECISION-001] ESPHome → middleware communication protocol

- **Date**: 2026-06-26
- **Question**: How does the ESP32 transmit a scan to the app?
- **Options considered**:
  - A — HTTP POST: direct request, synchronous HTTP response | Impact: simplest in ESPHome, immediate synchronous LED/buzzer feedback; a scan during app downtime is lost.
  - B — MQTT (Mosquitto): publish/subscribe | Impact: no scan lost if the app restarts; but asynchronous, more complex LED feedback, and silent feedback while the app is down.
- **Decision**: **A — HTTP POST.**
- **Decided by**: User (Ivan)
- **Rationale**: The CLARIFY-04 requirement (immediate LED/buzzer feedback) is best served by a synchronous HTTP response. The app is normally on when scanning at home, so the "scan lost while app is down" risk is rare and accepted. (Note: Mosquitto IS available — this was not the deciding factor; feedback immediacy was.)

### [DECISION-002] Backend language and framework

- **Date**: 2026-06-26
- **Question**: What language/framework powers the backend?
- **Options considered**:
  - A — Node.js / TypeScript | Impact: typed API contract, unified stack, native async + WebSocket.
  - B — Python | Impact: common in homelab, but no shared typing with a JS frontend.
- **Decision**: **A — Node.js / TypeScript.**
- **Decided by**: User (Ivan) — recommendation requested explicitly, not based on prior projects.
- **Rationale**: Strong typing on the Chronodrive contract makes API changes fail at compile time rather than silently at runtime, directly serving the project's core goal (surviving a private API that changes). Enables a unified stack and shared types with the React frontend (DECISION-004). Caveat for Phase 2: verify the chosen HTTP client exposes raw `Set-Cookie` headers (needed to capture `__Host-SESSION`).

### [DECISION-003] Configuration and log storage

- **Date**: 2026-06-26
- **Question**: Where does the app store credentials, config (cart/list toggles, HA webhook URL), and scan history/logs?
- **Options considered**:
  - A — SQLite (single file, Docker volume) | Impact: queryable, survives restarts, single dependency, bounded log table.
  - B — JSON config + append-only log file | Impact: human-readable, but unbounded log and risky concurrent writes.
  - C — PostgreSQL (separate container) | Impact: robust but overkill, adds a container.
- **Decision**: **A — SQLite**, with credentials encrypted at rest (AES-256, per contract.md §8) **and a log-retention policy** (prune the scan-log table by row count and/or age) to keep it a reasonable size.
- **Decided by**: User (Ivan)
- **Rationale**: Structured, queryable, single-container, and keeps the scan journal bounded — fits the need without the overhead of PostgreSQL or the fragility of flat files. Retention thresholds finalized in Phase 2/4.

### [DECISION-004] Frontend approach

- **Date**: 2026-06-26
- **Question**: What technology builds the local web UI?
- **Options considered**:
  - A — React + Vite | Impact: shared types with the TS backend, good reactivity; requires a build step.
  - B — Vanilla HTML/JS | Impact: zero build, but verbose/fragile live updates.
  - C — HTMX | Impact: no build, lightweight, but unfamiliar pattern and no shared typing.
- **Decision**: **A — React + Vite.**
- **Decided by**: User (Ivan)
- **Rationale**: Sharing contract types between the TS backend and the React frontend extends the DECISION-002 rationale across the whole stack (API changes caught at compile time end-to-end). The build step is absorbed by CI.

### [DECISION-005] Docker image build and publication

- **Date**: 2026-06-26
- **Question**: How is the Docker image built and published to GHCR?
- **Options considered**:
  - A — GitHub Actions → GHCR | Impact: automatic versioned build/publish on push; one-time Actions config.
  - B — Local build + manual push | Impact: works immediately, but manual, forgettable, no auto versioning.
- **Decision**: **A — GitHub Actions → GHCR**, with two distinct CI triggers (see release model below).
- **Decided by**: User (Ivan)
- **Rationale**: The project will receive recurring patches (private API changes); automation avoids forgotten manual pushes and keeps a clean versioned image history.
- **Release model (refined 2026-06-26)**:
  - The Docker image is **built only by CI on GitHub's Linux runners — never on the Windows dev machine.** Windows is for development/testing via the npm toolchain only; Docker is a release artifact, not a dev-loop tool.
  - **Trigger 1 — routine push / PR**: CI runs checks only (lint + tests). No image built.
  - **Trigger 2 — version bump (user-initiated)**: the user decides to iterate a version → bump the version → push a git tag (e.g. `v0.0.2`) → that tag triggers the build + publish of the versioned Docker image to GHCR → installable on prod (Portainer).
  - The app starts at version **0.0.1**.
  - **Scope**: ALL Docker/GHCR work (Dockerfile, image-publish workflow, GHCR credentials) lives in **Phase 6** (Docker packaging & deployment), not Phase 1. Phase 1's CI is checks-only.
  - This supersedes the original PROJECT_CONTEXT.md Phase 1 minimum item "Setting up GHCR credentials and testing a first image push" — that work moves to Phase 6.

### [DECISION-006] Monorepo vs separate packages

- **Date**: 2026-06-26
- **Question**: Backend and frontend in one repo or separate?
- **Options considered**:
  - A — Monorepo | Impact: one repo, one Docker build, shared types co-located; simple for solo work.
  - B — Separate repos | Impact: clean separation but coordination overhead (two repos, two CIs, shared types via published package).
- **Decision**: **A — Monorepo.**
- **Decided by**: User (Ivan)
- **Rationale**: Coherent with the unified stack and shared-types decisions; lets backend and frontend import the same contract types without publishing a package. Right-sized for a solo project with a single deployed container.

---

## Resolved — Implementation decisions (Phase 1)

### [DECISION-007] Monorepo dev tooling

- **Date**: 2026-06-26
- **Question**: Which package manager and baseline tooling implement the monorepo (DECISION-006) on Windows 11?
- **Options considered**:
  - Package manager — **npm workspaces** | Impact: bundled with Node, zero extra install, native workspaces; slightly slower installs.
  - Package manager — pnpm | Impact: faster, disk-efficient, monorepo-friendly; one more tool to install on every machine and in CI.
- **Decision**: **npm workspaces**, with the following baseline tooling:
  - **TypeScript** strict, shared `tsconfig.base.json`; per-package `tsconfig.json` (typecheck, `--noEmit`) + `tsconfig.build.json` (emit, excludes tests).
  - **ESLint** (flat config) + **Prettier**; LF line endings enforced via `.gitattributes` / `.editorconfig`.
  - **Vitest** for tests (backend: node; frontend: jsdom + Testing Library), scoped to `src/`.
  - **Husky** + **lint-staged** pre-commit hook (user opted in).
  - Exact-version pinning (`.npmrc` `save-exact`); Node 24 LTS enforced via `engines` + `engine-strict`.
  - **Cross-package type sharing** without build-order coupling: `@barclaudegateway/shared` exposes its `types`/`exports` from source, and Phase-1 cross-imports are type-only.
  - **CI** (`.github/workflows/ci.yml`): checks-only on push/PR — install → lint → format check → typecheck → test → build. No image build.
  - **Git conventions** (`CONTRIBUTING.md`): `feature/`·`fix/`·`chore/`·`docs/` branches; Conventional Commits; release = bump version → push `vX.Y.Z` tag.
- **Decided by**: User (Ivan) — package manager and pre-commit hook chosen explicitly; the rest are standard-ecosystem defaults presented and approved.
- **Rationale**: Keep the toolchain minimal and zero-extra-install on Windows while staying strict and reproducible. npm workspaces satisfy the monorepo shared-types need without publishing a package. Repo: <https://github.com/machintrucbidule/barclaudegateway> (public, MIT).

---

## Resolved — Implementation decisions (Phase 2)

### [DECISION-008] Core backend implementation choices (auth engine, lifecycle, storage)

- **Date**: 2026-06-26
- **Question**: Which concrete libraries and policies implement the Phase 2 backend (HTTP client, secret storage, retry, retention, static config) on Node 24 / TypeScript?
- **Options considered & decisions** (each surfaced to the user with plain-language impacts):
  - **HTTP client — `undici` (explicit dependency), pinned `7.28.0`.** Chosen over native `fetch` for an explicit, mature, richly-typed dependency with first-class test mocking (`MockAgent`). **Go/no-go gate passed**: a throwaway proof showed undici exposes raw `Set-Cookie` (`__Host-SESSION` + legacy) and replays them — the blocking caveat from DECISION-002 / contract.md §2.4 is cleared.
  - **Secret key management — env var `BCG_MASTER_KEY`** (32 bytes, hex/base64), never written to disk. Absent → hard, clear failure (no silent fallback). Credentials are **AES-256-GCM** (authenticated; wrong key fails closed) via Node built-in `node:crypto`.
  - **Retry/backoff — limited retries with exponential backoff + jitter** (3 attempts, base 300ms, honour `Retry-After`), only on network/timeout/5xx/429. Never retry 401 (→ token refresh) or business 4xx.
  - **Scan-log retention — 10 000 rows OR 10 years, most restrictive wins** (user-chosen). Prune on startup + daily.
  - **SQLite driver — `node:sqlite` (Node 24 built-in).** Zero extra dependency; accepts the runtime ExperimentalWarning. Only native runtime dep added this phase is `undici`.
  - **Static API config (client_id, x-api-keys, base URLs) lives in a SQLite `config` table**, seeded from code on first run (`INSERT OR IGNORE`), editable in the Phase 4 UI without redeploy when a key rotates. Env carries only the master key + DB path.
  - **Error model** — a `ChronodriveError` taxonomy with a shared `category` (`auth`/`api_key`/`schema`/`not_found`/`rate_limit`/`server`/`network`/`timeout`) mapped to contract.md §7.1, so Phase 5 can route failures without re-parsing.
  - **Optional manual live smoke-test (`npm run auth:smoke`)** — git-ignored `.env`, not in CI; one real login + refresh.
- **Decided by**: User (Ivan) — package manager, key management, retry, retention and SQLite driver chosen explicitly; the rest presented and approved.
- **Live-verification outcome (contract.md → v1.4.1)**: running the smoke-test against production surfaced **two real corrections to the auth contract**, now fixed in code and spec: (1) `connect.chronodrive.com` requires `Origin`/`Referer` headers (else 400 `No origin or referer retrieved`); (2) Step 1 sets the initial session cookie that must be forwarded to Step 2. With both, full login **and** silent refresh are confirmed working live (the refresh was previously only inferred).
- **Rationale**: Minimal, mature, well-typed toolchain; secrets never on disk; resilience to transient API hiccups without masking real failures; the contract stays a living record of observed reality (§7 process applied immediately on the live findings).

---

## Resolved — Scan-behavior clarifications (Phase 2 design gate → carried into Phase 3)

### [CLARIFY-07] Double-scan of the same product

- **Date**: 2026-06-26
- **Question**: "Add to cart" is a signed `+1`, so scanning the same EAN twice sets quantity 2. Cheap UART scanners (GM65/GM861) sometimes emit two reads for one pass. What happens on a repeat of the same code?
- **Options considered**:
  - A: Short debounce then +1 | Impact: absorbs hardware double-reads, intentional repeats still work after the window.
  - B: Always +1 per scan | Impact: simplest, but a stuttering scanner adds 2 unintentionally.
  - C: Idempotent (stays 1) | Impact: no duplicates, but can't raise quantity from the scanner.
- **Decision**: **A — short debounce then +1.** Ignore a repeat of the same EAN within a short window (~3 s default) to absorb double-reads; a later scan adds `+1`.
- **Decided by**: User (Ivan).
- **Impact on Phase 3**: the scan pipeline keeps a small in-memory last-scan map (EAN → timestamp); the debounce window is a tunable constant (default ~3 s, expose/confirm in the Phase 4 config UI).

### [CLARIFY-08] Unavailable products — out-of-stock or ineligible

- **Date**: 2026-06-26
- **Question**: What to do when a scanned product exists but is **out-of-stock** (`stock: NO_STOCK`) at the drive, or **ineligible** (`isEligible: false` — not sold at this drive)?
- **Options considered**:
  - A: Add everywhere + signal | Impact: lists complete, but an unbuyable item lands in the cart.
  - B: Lists yes, cart no + signal | Impact: cart stays orderable, the wish is kept on the list; slightly finer per-destination logic.
  - C: Add nothing + signal | Impact: nothing unwanted, but the wish is lost / must be re-scanned.
- **Decision**: **B — lists yes, cart no, and signal the state** (same rule for both out-of-stock and ineligible). Add to the checked shopping lists but skip the cart; return a distinct state so ESPHome drives a specific LED/buzzer.
- **Decided by**: User (Ivan).
- **Impact on Phase 3**: the scan→action pipeline branches on `stock` / `isEligible` from §5.1 — cart writes are skipped for these, list writes proceed — and the rich response distinguishes `out_of_stock` / `ineligible` from `added` / `not_found` / `error`.

---

## Resolved — Implementation decisions (Phase 3)

### [DECISION-009] HTTP server framework for the ingestion endpoint

- **Date**: 2026-06-26
- **Question**: Phase 2 shipped no HTTP server. What stands up the `POST /v1/scan` endpoint the ESP32 calls?
- **Options considered** (surfaced with plain-language impacts):
  - A — Node built-in `http` | Impact: zero dependency, consistent with the project's minimal-runtime-deps discipline (only `undici`); but more manual routing/body-parsing as routes grow in Phase 4/5.
  - B — **Fastify** | Impact: one dependency (+ its tree); ergonomic routing, automatic JSON body parsing, `inject()` for socket-free tests; pays off when Phase 4 adds config CRUD, dashboard and the real-time log stream.
- **Decision**: **B — Fastify** (pinned `5.8.5`, exact via `.npmrc save-exact`).
- **Decided by**: User (Ivan).
- **Rationale**: The route surface grows in Phase 4+, where a framework earns its keep; `fastify.inject()` keeps server tests fast and deterministic (no real socket). Accepted the one-dependency cost.

### [DECISION-010] Ingestion contract and scan→action pipeline

- **Date**: 2026-06-26
- **Question**: How is a scanned EAN validated, routed, journaled and answered (rich enough for LED + buzzer, CLARIFY-04)?
- **Decisions** (each surfaced to the user):
  - **EAN validation** — digits-only, length ∈ {8, 12, 13}, **GS1 mod-10 check digit verified**; UPC-A normalised to EAN-13. A malformed barcode is rejected with **HTTP 400 `invalid_ean`** without any Chronodrive call (user-chosen over length-only validation).
  - **Endpoint** — `POST /v1/scan` `{ ean }`, synchronous `ScanResponse`. `GET /health` reuses the Phase 2 read-only self-test. No application auth (local-only, PROJECT_CONTEXT §Deployment).
  - **Rich response states** — `added` · `added_to_lists_only` (+`reason` `out_of_stock`|`ineligible`) · `duplicate_ignored` · `not_found` · `partial` · `error` (+`category`) · `invalid_ean`. The firmware switches on `status`; the HTTP code is secondary (200 business outcomes, 400 invalid, 502 upstream failure). Shared types in `@barclaudegateway/shared`; firmware mapping in `docs/esphome-contract.md`.
  - **Partial-failure semantics** — when a scan targets several destinations and only some succeed, return a **distinct `partial` state** (user-chosen over a single global red error), so the firmware can show it and the user need not blindly re-scan.
  - **Debounce** — identical EAN repeated inside a **~3 s window** (tunable constant `DEFAULT_DEBOUNCE_MS`) → `duplicate_ignored`, **not journaled** (it is a hardware artefact, CLARIFY-07).
  - **Routing rules** (CLARIFY-08) — cart receives a signed `+1` **only when orderable** (`stock !== NO_STOCK && isEligible !== false`); lists always receive the product when it exists. Cart-id cached (contract.md §5.3), refetched once on a stale 404.
  - **Enabled-destinations config** — stored as JSON in the SQLite `config` table under `enabled_destinations` (`{ cart: boolean, lists: [{ id, name }] }`), default the safe empty set `{ cart: false, lists: [] }`. Read by `DestinationsStore`; the full checkbox editor is Phase 4.
  - **Optional manual smoke** — `npm run ingest:smoke` (git-ignored `.env`, not in CI): **read-only by default** (resolves a known EAN to confirm auth + search + §3 Origin/Referer); the real write path is opt-in behind `BCG_SMOKE_WRITE=true`.
- **Decided by**: User (Ivan) — server framework, EAN strictness, partial-failure state and the smoke test chosen explicitly; the rest presented and approved.
- **Rationale**: Cheap, early rejection of bad scans; a response contract that keeps the visual-granularity option open at the ESPHome layer without app changes; a safe default that never touches the real cart until the user configures destinations.

---

## Resolved — Implementation decisions (Phase 4)

### [DECISION-011] Local web-UI stack and how it is served

- **Date**: 2026-06-26
- **Question**: Phase 1 chose React + Vite (DECISION-004). What component/styling library, navigation, and serving model implement the three pages (Config / Dashboard / Logs)?
- **Options considered** (surfaced with plain-language impacts):
  - **Styling** — plain hand-written CSS (zero dependency, light) vs a **component library** (more weight, but batteries-included widgets). The user chose a component library; **Mantine** (`@mantine/core` + `@mantine/hooks`, React 19-ready) picked for its complete set (checkboxes, inputs, tables, badges, alerts, app-shell) and good docs.
  - **Navigation** — home-rolled tab state (no dependency, no per-page URL) vs **react-router** (real `/config`/`/dashboard`/`/logs` URLs, working back button + refresh). The user chose **react-router** (`react-router-dom`).
  - **Serving** — Fastify serves the built `packages/frontend/dist` in production (`@fastify/static`, single origin, no CORS, SPA history-fallback via `setNotFoundHandler`); in dev, Vite dev server proxies `/api` and `/v1` to the backend. Static serving is skipped when the bundle is absent (dev/CI without a build).
- **Decided by**: User (Ivan) — styling approach and navigation chosen explicitly; the serving model confirmed.
- **Rationale**: A small utilitarian UI gains more from ready-made accessible widgets than from bespoke CSS; real URLs are expected of a web app; one origin keeps deployment (Phase 6) and the browser simple.

### [DECISION-012] Real-time transport for the live log stream

- **Date**: 2026-06-26
- **Question**: How does the browser receive scans live on the Logs page?
- **Options considered**: SSE (one-way server→browser, native to HTTP/Fastify, auto-reconnect, no extra plugin) · WebSocket (bidirectional, heavier, needs a plugin — unused capability here) · short polling (trivial but laggy/wasteful).
- **Decision**: **Server-Sent Events.** `GET /api/scans/stream` writes `text/event-stream`; a small **in-process event bus** (`ScanEventBus`, a typed `EventEmitter` wrapper) is published to by the ingest pipeline at every journalled outcome and subscribed to by the SSE route. The pipeline takes the bus as an optional dependency, so the publish is additive and Phase 3 tests are untouched. Debounced repeats are not journalled and therefore not streamed.
- **Decided by**: User (Ivan).
- **Rationale**: The page only needs to display scans as they happen — a one-way push with built-in reconnection is the simplest fit; the bus decouples the pipeline from the transport and lets the live event carry the full `ScanResponse` (richer than the persisted journal row).

### [DECISION-013] Phase 4 API surface, write-only credentials, and editable static params

- **Date**: 2026-06-26
- **Question**: What backend routes feed the UI, and what exactly is editable — given credentials must stay write-only (contract.md §8)?
- **Decisions** (each surfaced to the user):
  - **API surface** under `/api`: `GET/PUT /config` (static params + a credentials `set` flag), `GET/PUT /config/destinations` (the `enabled_destinations` editor, plus the live `getShoppingLists()` choices), `PUT/DELETE /credentials` (write-only), `GET /scans` (recent journal + count), `GET /scans/stream` (SSE), `GET /health` (self-test). All shapes typed in `@barclaudegateway/shared` (`ApiConfig`, `ConfigResponse`, `DestinationsResponse`, `ScansResponse`, `ScanRecord`, `ScanEvent`).
  - **Credentials are write-only** — the backend never serialises the password; `GET /api/config` exposes only `credentials.set`. Enforced and tested (a route test asserts the password never appears in any GET response). The per-service `x-api-key`s are **not** secret (public bundle, §8) and are returned/edited normally.
  - **All static API params editable now** (user-chosen over deferring): `client_id`, `redirect_uri`, `scope`, `identity_base_url`, `api_base_url`, the four `x-api-key`s, `site_mode`, **plus a new optional `site_id` override**. `site_id` is empty by default → the client keeps deriving the store id dynamically (`lastVisitedSite.id`); a non-empty value pins the store and skips the lookup (`ChronodriveClient` already accepts an injected `siteId`).
  - **Single source of truth** — the config page edits the same Phase 3 `enabled_destinations` row; no second store invented.
- **Decided by**: User (Ivan) — editable static params (incl. the store-id override) chosen explicitly; the rest presented and approved.
- **Rationale**: A thin API over the existing stores; write-only credentials keep the secret one-directional; making every static param (and the store id) editable lets the operator recover from a Chronodrive key rotation or a wrong auto-detected store without a redeploy.

---

## Resolved — Implementation decisions (Phase 5)

### [DECISION-014] Critical-error detection, maintenance surface, and Home Assistant alerting

- **Date**: 2026-06-26
- **Question**: What counts as a "critical" API breakage, how is it detected, how is it surfaced in the UI, and how does the proactive Home Assistant alert fire (CLARIFY-01/05/06)? Reuses the existing `ErrorCategory` taxonomy — Phase 5 classifies, it does not re-taxonomise.
- **Decisions** (each surfaced to the user, who chose):
  - **Critical categories** = `auth`, `api_key`, `schema`, `server`, `network`, `timeout`. **Excluded**: `not_found` (a normal business outcome, already shown on the dashboard) and `rate_limit` (transient throttling — nothing is broken). These six are the trigger for both the maintenance surface and the HA alert.
  - **Detection = both sources**: a periodic read-only health self-test (every **6 h**, plus once at startup — `runHealthSelfTest` fed to the monitor via `ingestHealthReport`) **and** live scan failures off the existing `ScanEventBus` (`ingestScan`). The self-test catches a breakage even with no scans (a few cheap recurring calls); the scan path catches real failures instantly with zero extra calls.
  - **In-process `ErrorMonitor`** (`packages/backend/src/health/errorMonitor.ts`) holds the single current `ErrorState` (`{ active, error? }` with `category`/`endpoint`/`message`/`apiVersion`/`at`). It emits **only on a genuine transition** (inactive↔active or a different incident), so SSE clients and the notifier see one event per incident, not one per scan. A reachable, non-critical outcome (any success, `not_found`, `rate_limit`, or an ok self-test) **auto-clears** the surface — no manual acknowledge. Exposed at `GET /api/error-state` (REST, initial load) and `GET /api/error-state/stream` (SSE, live).
  - **Surface = a global red banner + a dedicated `/maintenance` page**. The banner sits in the app shell (every page) and links to `/maintenance`, which explains the breakage in plain French (keyed by `ErrorCategory`), then carries a **Firefox HAR capture tutorial** and a **ready-to-paste Claude debug prompt** prefilled with the observed `category`/`endpoint`/`message`/`x-api-version`/timestamp and instructed to diff against `contract.md` §7.2. The tutorial + prompt are always available, even with no active error. The existing dashboard `not_found` alert stays as a separate non-critical case.
  - **HA webhook = once per incident, with a 15-min cooldown** (`HaWebhookNotifier`). On a new critical incident it POSTs a **secret-free** payload (`source`/`severity`/`category`/`endpoint`/`message`/`apiVersion`/`at`/`test` — never tokens/cookies/passwords, contract.md §8) to the configured URL; the cooldown suppresses re-fires if the same incident flaps. No-op when the URL is empty. A **"Tester le webhook"** button on the config page (`POST /api/notify/test`) sends a clearly-marked sample.
  - **New config key `ha_webhook_url`** added to `AppConfig`/`CONFIG_KEYS`/`DEFAULT_APP_CONFIG`/`appConfigToEntries`/`appConfigFromMap` and `ApiConfig`/`ConfigResponse` (empty by default), mirroring the Phase 4 `site_id` addition — the single new field, stored in the same `config` table (CLARIFY-05, deferred from Phase 4). `PUT /api/config` accepts empty or a valid http(s) URL.
- **Decided by**: User (Ivan) — the four product choices (critical set, detection sources, surface shape, firing policy) chosen explicitly from presented trade-offs; the HAR tutorial + prompt wording approved in the plan.
- **Rationale**: A Chronodrive-side change must be visible and actionable without reading logs. Classifying through the existing taxonomy keeps one source of truth; "both" detection covers the idle case and the active case; banner-plus-page makes a breakage impossible to miss yet keeps the diagnostics off the busy dashboard; once-per-incident-with-cooldown alerts the user proactively without notification spam; the embedded HAR workflow turns each breakage into a self-serve diagnosis against the documented contract.

---

## Resolved — Docker packaging, GHCR CI/CD & Portainer deployment (Phase 6)

### [DECISION-015] Container image, GHCR release pipeline, and the Portainer deployment artifact

- **Date**: 2026-06-27
- **Question**: How is the single-process app (Fastify serving the SPA + `/api` + `/v1`) packaged into a Docker image, built and published by CI, and deployed in the homelab — without ever building Docker on Windows (DECISION-005/007)?
- **Options considered** (each surfaced to the user with plain-language impacts; the user chose):
  - **Image shape & base** — multi-stage vs single-stage; `node:24-slim` vs `node:24-alpine` vs distroless. **Chosen: multi-stage on `node:24-slim`.** A builder stage runs `npm ci` + `npm run build`; a slim runtime stage carries only production `node_modules` + the built backend `dist` + the built SPA. Slim (Debian/glibc) is the safe base for the Node 24 built-in `node:sqlite` (musl/Alpine can bite experimental bits; distroless is smallest but undebuggable). Smallest clean image without surprises.
  - **GHCR authentication** — built-in `GITHUB_TOKEN` vs a personal PAT. **Chosen: `GITHUB_TOKEN`** (`permissions: packages: write`). No secret to manage; the package is tied to the repo. A PAT would only be needed for cross-repo/org pushes.
  - **Image visibility** — public vs private GHCR package. **Chosen: public.** Portainer/Watchtower pull with **no registry credentials**. The image carries no secrets regardless (the repo is already open-source).
  - **Tag scheme** from a `vX.Y.Z` git tag — **Chosen: exact `X.Y.Z` + moving `X.Y` + `latest`** (`latest` only for non-prerelease tags, gated on `!contains(github.ref_name, '-')`). App version source of truth is `package.json` (starts at `0.0.1`); a release = bump version → push the tag.
  - **Healthcheck** — **Chosen: add a tiny `GET /livez` liveness route** (always 200, server-up only) and point the Docker HEALTHCHECK at it. `GET /health` is deliberately **not** used: it runs a live Chronodrive self-test and returns 503 when the upstream is merely down/unconfigured ([packages/backend/src/ingest/server.ts](../packages/backend/src/ingest/server.ts)), which would wrongly mark a live container unhealthy (and could trigger restarts). The `/livez` route + its test are the only code change this phase.
  - **Restart policy** — **Chosen: `unless-stopped`** (recovers after host reboot/crash, not after a deliberate stop).
  - **Deployment artifact** — **Chosen: a Portainer/compose stack file _plus_ explanatory docs.** [`deploy/stack.yml`](../deploy/stack.yml) is modeled on the user's existing Macronome stack: `image: ghcr.io/machintrucbidule/barclaudegateway:${BCG_TAG:-latest}`, `restart: unless-stopped`, the Watchtower auto-update label, a parametrized published port, the `BCG_MASTER_KEY: ${BCG_MASTER_KEY:?…}` fail-fast env, and a named `appdata` volume at `/data` (no Postgres — SQLite). [`docs/deployment.md`](../docs/deployment.md) explains every line.
- **Release mechanism**: `.github/workflows/release.yml` triggers ONLY on `v*` tags — checkout → Buildx → GHCR login (`GITHUB_TOKEN`) → `docker/metadata-action` derives the tag set → `docker/build-push-action` builds on the Linux runner and pushes, with GitHub Actions layer caching. The existing checks-only `ci.yml` is untouched. A separate `.github/workflows/docker-build.yml` builds the image **without pushing** on PRs that touch the Dockerfile (proves it on Linux, fork-safe, no secrets).
- **Persistence & secret model**: the **SQLite file on the `/data` volume + `BCG_MASTER_KEY`** are the only persistent state. The key is injected at run time (env/secret), never baked into the image or logged; no `.env`, no DB file, no secrets in the image. The image runs as the non-root `node` user (uid/gid 1000); a bind-mounted `/data` must be `chown 1000:1000` by the operator (a named volume inherits ownership).
- **Decided by**: User (Ivan) — image shape/base, GHCR auth, visibility, tag scheme, healthcheck approach, restart policy, and deployment-artifact form all chosen explicitly from presented trade-offs.
- **Rationale**: A reproducible, minimal image built only by CI (never on Windows) keeps the Windows box on the Node toolchain alone; a public image with `GITHUB_TOKEN` auth is the lowest-friction path for a solo homelab; the `/livez` split keeps container liveness honest while preserving `/health` as the Chronodrive readiness probe; and a Macronome-shaped stack + docs lets the operator deploy without guessing, with a single clear thing to back up.

---

## Resolved — Post-deployment fix (after first homelab run)

### [DECISION-016] "Not configured yet" is an informational state, not a critical error

- **Date**: 2026-06-27
- **Question**: On a fresh install with **no Chronodrive credentials saved**, the startup health self-test tried to reach Chronodrive, failed, and the Phase 5 error monitor classified it as a critical `auth` breakage — showing the red "panne" maintenance banner for what is simply an unconfigured app. How should "not configured yet" be handled so it reads as information, not a failure?
- **Decision** (surfaced to the user, who approved):
  - **New benign `ErrorCategory` `not_configured`** — kept OUT of `CRITICAL_CATEGORIES`, so it never raises the maintenance surface or fires a Home Assistant alert.
  - **The credentials loader throws `NotConfiguredError` (category `not_configured`) instead of `AuthError`** when none are saved, so every consumer (scan pipeline, health self-test, destinations) treats missing credentials as informational rather than an auth failure.
  - **The health self-test short-circuits when nothing is configured** — no connection is attempted — and `HealthReport` carries `configured: false`. Both `/health` (Phase 3) and `/api/health` (dashboard) honour it; `/health` returns **200** (not 503) for the unconfigured case, since it is not a breakage.
  - **The error monitor treats a `configured: false` report as benign** (clears/never raises).
  - **The dashboard shows an informational "configure me" card** (with a link to the Config page) instead of the degraded/error state. The `not_configured` label is added to the shared error-category label map.
  - **Scope note**: `not_configured` is an **app-internal** classification (a pre-flight state), NOT a Chronodrive API symptom — `contract.md` §7.1 is therefore intentionally left unchanged.
- **Shipped in**: **v0.0.2** (the first patch after the v0.0.1 launch).
- **Also bundled in v0.0.2** (dev tooling, not an app feature): Windows local-test scripts under `scripts/windows/` (`start-test.bat` / `stop-test.bat` / `reset-db.bat`) that run the single Node process on the dev box (Docker is still NEVER built/tested on Windows — DECISION-005/015), persist a test master key + SQLite under a git-ignored `.testdata/`, and `start-test.bat` opens the app in the browser after launch.
- **Decided by**: User (Ivan).
- **Rationale**: A brand-new install must not look broken. Distinguishing "not configured" from "configured but failing" keeps the maintenance surface meaningful (no false alarms), avoids a pointless connection attempt before setup, and still gives the operator a clear call to action.

---

## Resolved — End-to-end validation & hardening (Phase 7)

### [DECISION-017] Phase 7 validation outcomes, the redaction hardening fix, and the maintenance-loop handoff

- **Date**: 2026-06-27
- **Question**: Does the **deployed** system (the published GHCR image on the homelab Portainer stack)
  work end-to-end on the real Chronodrive API, is it secure and resilient enough for an always-on
  homelab service, and what — if anything — must be fixed before the project is accepted and handed
  off to the iterative maintenance loop?
- **Campaign** (run 2026-06-27 against `0.0.2` on the real Portainer stack; full report in
  [`docs/validation/phase-7-validation.md`](../docs/validation/phase-7-validation.md)):
  - **Smoke** — first run with no credentials behaved as DECISION-016 specifies (`/livez` 200,
    `/api/health` `configured:false` with no upstream call, dashboard "configure me" card, no error
    banner). After saving credentials the live self-test passed all four confirmed endpoints with
    matching `x-api-version` values (**no contract drift**). All three targeted `ScanResponse` states
    were proven live via `POST /v1/scan`: `added` (cart + list), `added_to_lists_only` (`NO_STOCK` →
    lists only, cart skipped — CLARIFY-08), and `not_found` (UPC-A normalized to EAN-13). Credentials
    are write-only (`/api/config` never returns the password).
  - **Security** — credentials AES-256-GCM at rest (wrong key fails closed); HA webhook payload
    secret-free; no secret baked in the image (`.dockerignore` + Dockerfile); container runs non-root
    (`uid=1000(node)`) with `node`-owned `/data`.
  - **Resilience** — state (config + scan journal) survives both a container **restart** and a full
    **Recreate** (what a Watchtower image update does), because the only state lives on the `appdata`
    named volume.
  - **Live-call discipline** — the whole campaign used the minimal real calls needed (one self-test +
    three scans on the user's own account); the ESP32 module had not arrived, so physical scans were
    substituted with HTTP calls.
- **Decisions taken** (each surfaced to the user, who chose):
  - **Hardening fix → image `v0.0.3`**: `redactSecrets` was implemented and tested but wired into no
    log path, and a comment in `http/errors.ts` overstated reality. No active leak existed (Fastify's
    defaults log only method/url/status; the Chronodrive client never logs its bearer token), but the
    guarantee rested on "never log the wrong object." Fixed by wiring a new `redactLogObject` helper as
    the Fastify logger's `formatters.log` hook, so **every** log record (headers, bodies, serialized
    errors — present or future) is deep-redacted centrally; the misleading comment was corrected and a
    request-shaped redaction test added. The user chose to wire it (over fixing only the comment).
  - **Backup docs corrected for WAL mode**: the DB runs in SQLite WAL mode (`-wal`/`-shm` alongside the
    `.sqlite`), so copying only the `.sqlite` file can lose recent writes. `docs/deployment.md` now
    documents a WAL-safe backup (online `VACUUM INTO`, or stop-then-copy-all-three) and a restore
    procedure, and the stale `0.0.1` pin/release examples were updated to `0.0.3`.
  - **Deferred to the backlog**: physical ESP32 LED/buzzer validation (**[BL-001]**, P1) until the
    module arrives; **assisted master-key generation on first run** (**[BL-002]**, P2) — print a
    generated key once to logs with copy-and-restart instructions, never writing it to disk (refines,
    does not reverse, the env-injected key model of DECISION-008).
  - **Maintenance-loop handoff**: created `specifications/BACKLOG.md` (seeded with BL-001/BL-002) and
    `specifications/BACKLOG_ARCHIVE.md`, and extracted the three reusable loop prompts into standalone
    files under `specifications/prompts/` (`loop-1-intake-triage.md`, `loop-2-develop-batch.md`,
    `loop-3-ops-grooming.md`). The Phase 5 maintenance page's diagnostic prompt already routes a
    detected Chronodrive breakage into `BACKLOG.md` as a P0 Bug (Source: incident), so the
    detect-and-patch loop is wired end to end.
  - **Maintenance-page prompt tidied** (ships in v0.0.3): `MaintenancePage.tsx` `buildDebugPrompt` no
    longer says "create `BACKLOG.md` if it doesn't exist" (it now does), and gained a one-line pointer
    noting it is the **incident** entry-point of the maintenance loop, while the periodic
    re-verification/grooming runs via `specifications/prompts/loop-3-ops-grooming.md`. The page prompt
    stays incident-specific (prefilled with the live `category`/`endpoint`/`message`/`x-api-version`/
    timestamp) and is deliberately **not** replaced by the generic loop-3 prompt.
- **Decided by**: User (Ivan) — the redaction fix (wire vs comment-only) and the BL-002 backlog item
  chosen explicitly; the doc corrections and loop-prompt extraction presented and approved.
- **Rationale**: The deployed system is validated against reality; the one gap found was a latent
  defense-in-depth weakness, now closed without changing the `BCG_*` contract or the
  single-process/single-origin model; honest backup docs prevent silent data loss; and the project
  exits the numbered-phase model into a clean, ready-to-run maintenance loop.
- **Acceptance**: **Accepted for everyday use on 2026-06-27** by the user (Ivan) at the Phase 7
  validation gate. This is the final build phase — the project is complete and hands off to the
  iterative maintenance loop (`BACKLOG.md` + the three loop prompts); no Phase 8 prompt is generated.
  The hardening fix ships as image **v0.0.3**.

---

## Resolved — Maintenance loop (post-Phase 7)

### [DECISION-018] Operational event-logging architecture (BATCH-3 / BL-003, BL-004)

- **Date**: 2026-06-27
- **Question**: The original single "Real-time log stream" page was built as a live *scan* stream, but
  the operator wanted genuine **operational logs** — every Chronodrive auth exchange, the per-step
  detail of each scan, every token refresh, and system events — filterable by area, with errors shown
  clearly; **and** a separate **searchable, paginated scan history**. What storage shape, event
  taxonomy, transport and retention implement this, and how is the existing scan event path affected?
- **Options considered** (each surfaced to the user, who chose):
  - **Event bus** — generalize the existing `ScanEventBus` into one app-wide bus carrying both
    `ScanEvent` and `LogEvent`, vs a **dedicated** `EventLogBus` + `event_log` table reserved for
    `LogEvent`s. **Chosen: dedicated subsystem.** The `ScanEventBus` is left untouched (it still feeds
    the Phase-5 `ErrorMonitor` and the scan history), so the proven scan path carries zero regression
    risk; the two buses each have one clear role.
  - **Retention** — match the scan-log (10 000 rows OR 10 years) vs a verbosity-aware bound. **Chosen:
    50 000 rows OR 10 years**, most restrictive wins, pruned on startup + daily (mirrors the `ScanLog`
    retention model). The operational log is far more verbose (several lines per scan + each refresh),
    so the higher row cap is the effective bound.
  - **Transport** — reuse the established SSE + in-process-bus pattern (DECISION-012). **Chosen: SSE
    live tail** (`GET /api/events/stream`) for the page tail + REST (`GET /api/events`, category filter
    + pagination) for the initial load.
- **`LogEvent` shape**: `id`, `at` (epoch-ms), `category` (`auth` | `scan` | `other`), `type` (a typed
  union — `login_step1/2/3`, `session_captured`, `login_complete`, `silent_refresh`, `full_relogin`,
  `login_required`, `ean_read`, `search_request`, `product_resolved`, `product_not_found`,
  `cart_write`, `list_write`, `scan_complete`, `self_test`, `startup`, `config_change`,
  `credentials_change`, `ha_alert`), `level` (`info` | `warn` | `error`), secret-free `message`, optional
  redacted `detail`. `category=other` is the catch-all (health self-test, startup, config/credentials
  changes, HA alerts). Shared type in `@barclaudegateway/shared`.
- **Emission**: a single `EventLogger.record` (redact → persist → publish) is injected as an optional
  `EmitEvent` into auth (per PKCE step + refresh/re-login, success and failure), the scan pipeline (the
  ordered `ean_read → search_request → product_resolved|not_found → cart/list writes → scan_complete`
  set), the health self-test, the config/credentials routes, the HA notifier, and startup. Optional so
  un-wired call sites stay no-ops (existing unit tests untouched).
- **Redaction**: every event passes through `logging/redact.ts` (`redactSecrets`) before storage and
  streaming, so no token/cookie/password/code ever reaches the `event_log` table or the SSE tail
  (contract.md §8). A unit test asserts a secret in `detail` is masked.
- **Scan history (BL-004)**: `GET /api/scans` gains status/search/`page`/`pageSize` (10/50/100/500/all,
  default 100) + a `total`; `ScanLog` gains a filtered query + count; the old live page becomes a
  **static** `Historique des scans` (no SSE auto-append) and the new `Logs techniques` page is the
  operational-logs tail.
- **`contract.md` unchanged**: internal journaling, NOT a Chronodrive API behaviour (same rationale as
  DECISION-016 `not_configured`).
- **Decided by**: User (Ivan) — the dedicated-bus architecture and the 50 000-row retention chosen
  explicitly from presented trade-offs; the taxonomy, transport and emission points presented and
  approved.
- **Rationale**: A dedicated subsystem gives real operational visibility (auth + per-step scan +
  refreshes + system) without touching the proven scan path; an SSE tail matches the "live" intent and
  reuses an existing pattern; central redaction keeps the new journal secret-free by construction; and
  splitting the page into operational-logs + scan-history resolves the long-standing spec ambiguity.
- **Shipped in**: BATCH-3 (loop prompt 2, 2026-06-27). Full entries in `BACKLOG_ARCHIVE.md`.

---

## Cross-cutting consequences for later phases

- **Phase 3** must define a **rich HTTP response contract** (multiple distinct states: success / not-found / ineligible / out-of-stock / API error) so ESPHome can drive LED colors + buzzer (CLARIFY-04).
- ~~**Phase 6** must resolve **GHCR authentication** (PAT scopes, `docker login ghcr.io`) (DECISION-005).~~ — **RESOLVED (Phase 6, 2026-06-27)**: GHCR auth uses the built-in `GITHUB_TOKEN` (`packages: write`), image **public**, tag-triggered build/push in `release.yml` (DECISION-015). _(Moved from Phase 1: Docker is never built/tested on Windows; Phase 1's CI is checks-only — DECISION-007.)_
- ~~**Phase 2** must **verify the HTTP client exposes raw `Set-Cookie` headers**~~ — **RESOLVED**: undici proven and adopted (DECISION-008, contract.md §2.4).
- ~~**SQLite log-retention thresholds** to be finalized in Phase 2/4~~ — **RESOLVED**: 10 000 rows OR 10 years (DECISION-008). Still adjustable in the Phase 4 UI.
- ~~**Phase 2 live finding**: the data-API (`api.chronodrive.com`) `Origin`/`Referer` requirement is INFERRED~~ — **RESOLVED (Phase 3, 2026-06-26)**: the data API `/v1/search-suggestions` was exercised live by the middleware (`ingest:smoke`) with `Origin`/`Referer` present and returned 200 — contract.md §3 note downgraded to CONFIRMED (v1.4.2). Enforcement of a call *without* them remains untested but moot (always sent).
- ~~**HA webhook URL** is a config field added in Phase 5 (CLARIFY-05).~~ — **RESOLVED (Phase 5, 2026-06-26)**: `ha_webhook_url` config key + once-per-incident HA alert + maintenance/HAR page shipped (DECISION-014).
- **Phase 6** carries the single-origin Fastify-serves-the-SPA model (DECISION-011) and the `BCG_*` env vars (`BCG_MASTER_KEY`, `BCG_DB_PATH`, `BCG_PORT`, `BCG_HOST`, optional `BCG_UI_DIR`) into the container runtime contract; the SQLite file + master key are the only persistent state to mount.
