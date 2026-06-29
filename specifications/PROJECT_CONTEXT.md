# BarclaudeGateway — Project Context

> **This file is read at the start of every development step.** Keep it up to date.
> Last updated: 2026-06-29 (**BATCH-12 shipped**: two scanner fixes. **BL-014** — the WS2812 wrong-colour
> race is fixed by making `set_led` the **single LED owner** (`mode: restart`, parameterised for white
> in-flight + result; last call wins) — a refinement of DECISION-020, firmware-only. **BL-015** — the HA
> "Search" `IncompleteInput` is fixed by bounding the payload: `GET /api/v1/search` now takes `size`/`page`
> (clamped; default 20 unchanged) and the firmware requests `&size=1`; local `contract.md` → **0.4.1**.
> **The active `BACKLOG.md` is empty.** **DECISION-027** still holds: the Layer-B epic is ONE user-triggered
> **0.3.0** release (still pending, independent of BATCH-12). Upstream `contract.md` (Chronodrive) at **1.5.0**.)

---

## What is this?

A self-hosted middleware that bridges an ESP32 barcode scanner (ESPHome) with the Chronodrive private grocery e-commerce API. Scanning an empty product triggers the app to add it to the user's Chronodrive cart and/or shopping lists. A local web UI allows configuration and monitoring.

---

## Repository layout

npm-workspaces monorepo (DECISION-006), bootstrapped in Phase 1:

```
barclaudegateway/
  specifications/
    api/chronodrive/contract.md  ← Chronodrive UPSTREAM private API spec (reverse-engineered, v1.5.0)
    api/local/contract.md        ← LOCAL API "Layer B" contract (v0.1.0, foundation shipped BATCH-7; DECISION-022/023)
    PROJECT_CONTEXT.md           ← this file
    ROADMAP.md                   ← development roadmap (generated, living doc)
    decisions.md                 ← all architecture decisions with rationale
    prompts/                     ← per-phase launch prompts
  packages/
    shared/                      ← @barclaudegateway/shared: contract types shared by both sides
    backend/                     ← @barclaudegateway/backend: Node/TS service (Phase 2+)
    frontend/                    ← @barclaudegateway/frontend: React + Vite web UI (Phase 4+)
  docs/dev-setup.md              ← reproducible Windows dev-environment steps
  .github/workflows/ci.yml       ← checks-only CI (lint + format + typecheck + test + build)
    BACKLOG.md                   ← active maintenance backlog (post-Phase 7 loop)
    BACKLOG_ARCHIVE.md           ← append-only shipped-items history
  package.json                   ← workspace root (private, version 0.0.3, aggregated scripts)
  tsconfig.base.json             ← shared TypeScript compiler options
  eslint.config.js               ← ESLint flat config
  .prettierrc.json / .editorconfig / .gitattributes / .npmrc
  .husky/pre-commit              ← runs lint-staged on staged .ts/.tsx files
```

> Container packaging lives at the repo root: `Dockerfile`, `.dockerignore`, the GHCR release
> workflow (`.github/workflows/release.yml`, tag-triggered) + a no-push PR build check
> (`docker-build.yml`), the Portainer stack (`deploy/stack.yml`), and `docs/deployment.md`
> (Phase 6, DECISION-015). Docker is still never built or tested on Windows — only CI builds it.
> The version started at **0.0.1**. The **whole Layer-B epic (BATCH-7..11) was developed as one
> in-development release with no per-batch bumps** (DECISION-027; `package.json` accumulated at `0.3.0`).
> The user **cut that release on 2026-06-29 as `0.3.1`** (tag `v0.3.1` → GHCR), bundling the epic **plus
> BATCH-12** (BL-014 LED race fix + BL-015 search payload) — so **`0.3.1` is the first published image of
> the epic** (the prior published image was `0.2.2`; `0.3.0` was never tagged). Under that release:
> **BATCH-7** (BL-008 local "Layer B" API foundation — `/api/v1` prefix +
> app-managed `X-API-Key` guard + `GET /api/v1/ping` stub + `api/local/contract.md`; BL-009 logging split
> API Chronodrive vs API interne; DECISION-023); **BATCH-8** (BL-010 products & nutrition —
> `GET /api/v1/search?q=` + `GET /api/v1/products/{eanOrId}`, Products `x-api-key`, §5.12.1 mapper;
> DECISION-024); **BATCH-9** (BL-011 cart & lists — `GET /cart` + `/cart/nutrition`, `POST/DELETE
> /cart/items`, lists CRUD, `POST /recipe-fill`, `ItemRef` id/ean/name; DECISION-025); **BATCH-10** (BL-012
> in-gateway price tracking & HA alerts + the "Suivi des prix" page, on both `/api/v1/price-tracking/*` and
> internal `/api/price-tracking/*`; DECISION-026); **BATCH-11** (BL-013 wiring/ops/YAML/docs/tests, scan
> moved onto `POST /api/v1/scan`; DECISION-028 — epic complete); and **BATCH-12** (BL-014 single-owner LED
> race fix + BL-015 bounded search payload, local `contract.md` → 0.4.1). Earlier published versions:
> `0.2.2` shipped
> **BATCH-6** (BL-007: lazy mode no longer force-fetches the shopping lists
> on the config page; cached display + manual `POST /api/config/destinations/refresh`, refines
> DECISION-021). `0.2.1` shipped **BATCH-5**
> (configurable auth-token policy `auth_mode` lazy vs keep-alive, DECISION-021; the first middleware
> code change since `0.1.1`). `0.2.0` was the maintenance-loop milestone: **BATCH-1** (ESP32 hardware
> validated; LED-only Home-Assistant-integrated scanner firmware, DECISION-020) and **BATCH-4**
> (duplicate list-add confirmed idempotent, DECISION-019), firmware/docs only.
> `0.1.1` shipped **BATCH-3** (operational event-logging + searchable scan history, DECISION-018) and
> **BATCH-2** (assisted first-run master-key generation, refines DECISION-008); `0.1.0` was the ESPHome
> scanner firmware + a version-controlled prod-deploy script; `0.0.3` shipped the DECISION-017
> log-redaction hardening fix; v0.0.2 was DECISION-016.
> Local dev/test on Windows uses `scripts/windows/` (start/stop/reset-db) — the Node toolchain only.

---

## Architecture: DECIDED — do not re-open without the user

### Deployment

- Single Docker container, managed via Portainer
- Image published to **GHCR** (GitHub Container Registry)
- Network isolation upstream via **Cloudflare Tunnel** — the app itself needs no TLS, no auth
- Web UI is local-only by design; no application-level authentication required
- Dev environment: **Windows 11**
- Prod environment: **Docker / Portainer on Linux homelab** (Proxmox)

**Container packaging (Phase 6, DECISION-015):**

- **Image**: multi-stage `Dockerfile` on `node:24-slim`, runs as non-root `node` (uid 1000), one
  process (`node packages/backend/dist/main.js`) serving the SPA + `/api` + `/v1`. Ref:
  `ghcr.io/machintrucbidule/barclaudegateway`, **public** (no Portainer registry creds needed).
- **Release**: `.github/workflows/release.yml` builds + pushes to GHCR on a `vX.Y.Z` tag
  (`GITHUB_TOKEN`, `packages: write`), tagged `X.Y.Z` + `X.Y` + `latest`. `docker-build.yml` builds
  the image without pushing on PRs that touch it. Checks-only `ci.yml` is unchanged.
- **Persistence / secret model**: the **SQLite file on the `/data` volume + `BCG_MASTER_KEY`** are
  the only state to back up. The key is injected at run time (never baked, never written to disk); no
  `.env`, DB, or secret is in the image. **First-run assist (BL-002, refines DECISION-008):** if the key
  is absent on boot, the app prints a freshly *generated candidate* key with copy-and-restart
  instructions and exits non-zero — the candidate is only printed, never persisted, and the app still
  refuses to start until the key is set in the environment.
- **Healthcheck**: image HEALTHCHECK hits `GET /livez` (liveness, always 200), **not** `/health`
  (a live Chronodrive readiness probe that 503s when the upstream is down). Restart: `unless-stopped`.
- **Deploy artifact**: `deploy/stack.yml` (Portainer/compose, Watchtower-enabled) + `docs/deployment.md`.

### Application stack (DECIDED — Phase 0, see decisions.md)

- **Backend**: Node.js / TypeScript (DECISION-002). Caveat: HTTP client must expose raw `Set-Cookie` headers (`__Host-SESSION`) — verify in Phase 2. **HTTP server: Fastify** (DECISION-009, Phase 3) — exposes the ingestion endpoint; `inject()` keeps route tests socket-free.
- **Frontend**: React + Vite (DECISION-004), sharing contract types with the backend.
- **Storage**: SQLite, single file on a Docker volume (DECISION-003). Credentials encrypted at rest (AES-256). Scan-log retention policy keeps the log table bounded.
- **Repo structure**: Monorepo, backend + frontend in one repo, one Docker build (DECISION-006).
- **CI/CD**: GitHub Actions, two triggers (DECISION-005 release model). Routine push/PR → checks only (lint + tests). Version tag (e.g. `v0.0.2`, user-initiated) → build + publish the versioned Docker image to GHCR. App starts at **0.0.1**. Docker is never built/tested on Windows; the Docker/GHCR pipeline shipped in **Phase 6** (DECISION-015).
- **ESP32 → app protocol**: HTTP POST, synchronous response (DECISION-001).

### Dev tooling (DECIDED — Phase 1, see DECISION-007)

- **Package manager**: npm with native **workspaces** (`packages/shared|backend|frontend`). Exact versions pinned (`.npmrc` `save-exact`); Node/npm enforced via `engines` + `engine-strict`. Target runtime: **Node 24 LTS**.
- **Cross-package type sharing**: `@barclaudegateway/shared`'s `types`/`exports` point at its source, so both sides typecheck against the same source with no build-order coupling (Phase-1 imports are type-only).
- **TypeScript**: shared `tsconfig.base.json` (strict); per-package `tsconfig.json` for typecheck (`tsc --noEmit`) and `tsconfig.build.json` (excludes tests) for emit.
- **Lint/format**: ESLint flat config + Prettier (LF enforced via `.gitattributes` + `.editorconfig`).
- **Tests**: **Vitest** (backend = node env, frontend = jsdom + Testing Library), scoped to `src/`.
- **Pre-commit**: Husky + lint-staged (ESLint `--fix` + Prettier on staged `.ts`/`.tsx`).
- **CI**: `.github/workflows/ci.yml`, checks-only on push/PR (install → lint → format check → typecheck → test → build). Image build/publish lives in `release.yml` (tag-triggered) + `docker-build.yml` (no-push PR check) — Phase 6, DECISION-015.
- **Local Windows test env**: `scripts/windows/start-test.bat` (build if needed → run `node packages/backend/dist/main.js` on `127.0.0.1:8090`, persist a test master key + SQLite under git-ignored `.testdata/`, open the browser), `stop-test.bat`, `reset-db.bat` (confirmation-gated DB wipe). Runs the single Node process — Docker is never used on Windows (DECISION-016).
- **Git conventions** (`CONTRIBUTING.md`): branches `feature/`·`fix/`·`chore/`·`docs/`; **Conventional Commits**; release = bump version → push `vX.Y.Z` tag (triggers the GHCR image build, `release.yml`).

### Chronodrive API

Full spec: `specifications/api/chronodrive/contract.md`

Auth flow (Reach5 PKCE) — **live-verified end-to-end by the middleware 2026-06-26** (contract.md §2, v1.4.1):

- **Step 1** — `POST /identity/v1/password/login` → short-lived `tkn` **+ initial Reach5 session cookie** (forward it to Step 2)
- **Step 2** — `GET /oauth/authorize?prompt=none&tkn=...` → sets `__Host-SESSION` cookie (72h) + auth code. **Requires `Origin`/`Referer` headers and the Step-1 cookies**, else 400 `No origin or referer retrieved`.
- **Step 3** — `POST /oauth/token` (auth code exchange) → `access_token` (2h TTL)
- **Silent refresh** (every ~2h): Steps 2+3 only, using `__Host-SESSION` cookie — no password needed. **Confirmed working live.**
- **Full re-login** (every ~72h or on `login_required`): Steps 1+2+3 with stored credentials
- **Token policy is configurable** (`auth_mode`, BL-006/DECISION-021): `keepalive` arms the ~2h silent
  refresh + connects on the startup/6h self-test (above); `lazy` does neither — it logs in only when a
  scan needs it and keeps the proactive self-test/health reads dormant while idle (no *live* token).
  Fresh installs default to **lazy**; a DB upgraded from before BL-006 stays **keep-alive** until the
  user switches it in the config UI. A manual `POST /api/health/connect` forces an on-demand
  login + probe (the "connect / check now" buttons on the dashboard + config page).
- All `/oauth/*` + `/identity` calls must carry `Origin: https://www.chronodrive.com` + `Referer: https://www.chronodrive.com/`
- Per-service static API keys exist — if one key rotates, only that service breaks
- `x-api-version` response header signals Chronodrive backend deploys (monitor this)
- All endpoints confirmed, no remaining spec gaps
- **Product/cart surface extended (v1.5.0, 2026-06-28, DECISION-022):** new **Products** service
  (`x-api-key 34bfe4e1…`) — `GET /v1/products/{id}` (full sheet: nutrition, ingredients, allergens,
  origin, images, **packaging.weight**, prices incl. `lastPeriodLowestPrice`), `GET /v1/products?searchTerm=`
  (rich paginated search, same product shape), `GET /v1/products?ids=` (batch); `GET /v1/customers/me/carts/extended`.
  Nutrition is **coded** in `characteristics.features[]` (essential map in contract §5.12.1: 157=kJ,
  243=kcal, 159=fat, 160=saturates, 163=carbs, 164=sugars, 167=fibre, 168=protein, 169=salt,
  520=Nutri-Score, 383=allergens, 759/760=origin). Product images: `https://static1.chronodrive.com/` +
  relative path. `/v1/search-suggestions` (§5.1) also returns this full shape now (patched).

### Local API ("Layer B") — DECISION-022/023

Full spec: `specifications/api/local/contract.md` (v0.1.0). A **second** API the gateway *exposes* on the
LAN (distinct from the upstream Chronodrive API we consume and the internal UI `/api/*`), so other apps —
notably **macronome** — can query Chronodrive through it (products, nutrition, price, cart, lists).

- **Foundation shipped (BATCH-7, BL-008):** versioned prefix **`/api/v1`** on the same Fastify app; an
  **`X-API-Key`** guard (an encapsulated `onRequest` hook, constant-time compare, 401 on missing/wrong/
  empty) that leaves the UI `/api/*` untouched; a `GET /api/v1/ping` health stub.
- **Products & nutrition shipped (BATCH-8, BL-010, DECISION-024):** **`GET /api/v1/search?q=`** (lean
  `ProductSummary` page) and **`GET /api/v1/products/{eanOrId}`** (full `NormalizedProduct` with mapped
  `nutrition`, `weightKg`, `price`, absolute image URLs). EAN-vs-id is disambiguated with `validateEan`;
  the §5.12.1 nutrition mapper + image-URL builder live in `chronodrive/productMapper.ts`. Backed by a new
  **Products `x-api-key`** (`apiKeys.products`, seed `34bfe4e1…`, editable in the config page). Each
  upstream call is journalled as `chronodrive`; not-found → 404, upstream failure → 502.
- **Cart & lists shipped (BATCH-9, BL-011, DECISION-025):** **`GET /api/v1/cart`** (normalized line items +
  totals) and **`GET /api/v1/cart/nutrition`** (budget + summed macros, per-100g × weight × qty, flagging
  `incompleteLines`); **`POST/DELETE /api/v1/cart/items`**, **`GET /api/v1/lists`** + **`/lists/{id}`**,
  **`POST/DELETE /api/v1/lists/{id}/items`**, and **`POST /api/v1/recipe-fill`** (fill the cart or a list).
  Writes take an **`ItemRef`** (`id` / `ean` / `name`, priority in that order; `ean`/`name` resolve via
  search) and return a per-item **resolution report**. A single cart read yields lines + the aggregate (the
  §5.3 line carries the full product). Mapping in `chronodrive/cartMapper.ts`; a batch `updateCartItems`
  client method (the single-item `updateCartItem` delegates to it).
- **Price tracking shipped (BATCH-10, BL-012, DECISION-026):** tracked-products CRUD + per-product
  thresholds + price history + scheduler settings + a manual "check now", on **both** the local API
  `/api/v1/price-tracking/*` (key-guarded) and the internal `/api/price-tracking/*` (no key, used by the new
  UI page) — one `priceTrackingRoutes` sub-plugin mounted twice. New `tracked_products` + `price_history`
  tables (`storage/priceTracking.ts`); a **gated opt-in `PriceScheduler`** (`price/priceScheduler.ts`,
  default off, `priceTrackingEnabled`/`priceTrackingIntervalHours` config, `unref()` timer) that reads
  prices, historises them, and fires `HaWebhookNotifier.notifyPriceDrop` (a secret-free `price_drop`
  webhook) once per threshold crossing (per-product re-arm flag).
- **Scan + wiring shipped (BATCH-11, BL-013, DECISION-028 — epic complete):** the **scanner ingestion moved
  onto the local API** — **`POST /api/v1/scan`**, `X-API-Key`-guarded (the old keyless `/v1/scan` is removed
  → 404); the `ScanResponse` shape is unchanged. The Config page gained an **"API locale"** card (read-only
  key + base URL + a **Régénérer** button) backed by additive `GET /api/local-api-key` +
  `POST /api/local-api-key/regenerate` (the key still never appears in `GET/PUT /api/config`). The ESPHome
  firmware was **rebased on Ivan's actual YAML** (white-flush fix, GM861S config numbers) with the scan
  URL/key change + two HA functions (**product info on scan** from `ScanResponse.product`; **keyword search**
  via `GET /api/v1/search`) + `!secret` placeholders. lazy/keepalive preserved (endpoints log in on demand;
  the only background task, the price scheduler, is opt-in/off by default). **The DECISION-022 Layer-B epic
  (BATCH-7..11) is complete; the backlog is empty.**
- **The local API key is auto-generated and app-managed** (DECISION-023, user's choice): generated on
  first boot when empty (`bootstrap.ensureLocalApiKey`), persisted as the `local_api_key` config row,
  surfaced **once** (a `local_api_key_generated` log event carrying the key + a stdout line) for retrieval.
  It is **not user-editable** and **never** part of `GET/PUT /api/config` — deliberately kept out of the
  shared `ApiConfig` and out of `appConfigToEntries` so the user-facing config flow can't expose or
  clobber it. Rotation takes effect without a restart (read fresh per request).
- **Observability:** every inbound local-API request is journalled as an `api_local` ("API interne") event
  and every upstream call it makes as a `chronodrive` ("API Chronodrive") event (BL-009), both filterable
  on `/logs`. `auth_mode` lazy/keep-alive (DECISION-021) is preserved.

### ESP32 / ESPHome side

- Hardware: **ESP32-C6 + GM861S** UART barcode scanner + a single WS2812 LED (validated on real
  hardware, BL-001, 2026-06-27).
- ESPHome handles scanner, sends EAN code to middleware over local network
- **Protocol: HTTP POST** (DECISION-001). Synchronous HTTP response carries the scan result so ESPHome drives the LED feedback (CLARIFY-04). Trade-off accepted: a scan during app downtime is lost (no queue).
- **Physical feedback: LED-only** (DECISION-020 — the buzzer of CLARIFY-04 was dropped). White while the request is in flight, then the result colour ~1.5 s: green = `added`/`duplicate_ignored`, orange = `added_to_lists_only`/`partial`, red = `not_found`/`invalid_ean`/`error`/no-response. **Finalized in Phase 3 (DECISION-010):** endpoint `POST /api/v1/scan { ean }` (moved onto the key-guarded local API in BATCH-11/DECISION-028 — was `POST /v1/scan`) → rich `ScanResponse` with `status` ∈ `added` / `added_to_lists_only` (+reason) / `duplicate_ignored` / `not_found` / `partial` / `error` (+category) / `invalid_ean`. Firmware-facing mapping (states → LED colour, request/response examples) in `docs/esphome-contract.md`; shared types in `@barclaudegateway/shared`. **BATCH-12/BL-014 (refines DECISION-020):** a **single** `mode: restart` script (`set_led`) is now the sole LED owner (white in-flight + result colour, full R/G/B, last call wins) — fixes the wrong-colour (yellow/cyan) race from overlapping writes; `led_brightness` substitution centralises brightness.
- **Home-Assistant-integrated** (DECISION-020): encrypted HA API + a manual-EAN input & "resend" button (same `POST /api/v1/scan` pipeline as a physical scan) + `last_ean`/`last_status`/`last_product`/`last_price`/`search_result` sensors + a keyword-search text (BATCH-11). The scan + search carry the `X-API-Key`. **BATCH-12/BL-015:** the keyword search requests `&size=1` and the local `GET /api/v1/search` accepts `size`/`page` (clamped; default 20) so the constrained ESP `http_request` parses the body (no `IncompleteInput`). Reference firmware: `firmware/esphome/barclaude-scanner.yaml`.

### Web UI

- Local access only, no auth
- Pages: Config, Dashboard, **Operational logs**, **Scan history**, **Suivi des prix** (BL-012 price
  tracking — `/prices`), API error/maintenance page
  - **Operational logs** (technical): the exchanges with the Chronodrive auth server, the per-step detail
    of each scan (barcode read → search request → product id found → cart/list add request → result), and
    **every token refresh**, with errors shown clearly; **live tail**; filter Auth / Scan / **API
    Chronodrive** (upstream calls) / **API interne** (inbound local-API requests) / Other / All (BL-009).
  - **Scan history**: a searchable, filterable, **paginated** history of scanned codes and each code's
    status; **not** live-updated (a new scan does not auto-append).
  - **Spec correction (2026-06-27)**: the original single "Real-time log stream" wording was ambiguous and
    was implemented as a live *scan* stream. The intent was always **operational logs**; this is being
    corrected — the page is split into the two above (tracked by **[BL-003]** logs + **[BL-004]** history
    in `BACKLOG.md`). Internal journaling only — `contract.md` is unaffected.
- **Config page = destination checkboxes** (CLARIFY-02 + 03): shows "Panier" (cart) + every shopping list (fetched dynamically via `GET /v1/shopping-lists`), each with a checkbox. A scan feeds every checked destination. Also holds credentials (write-only display) and the HA webhook URL. **In `lazy` mode (BL-007), opening the page does NOT force a login**: if a session is already live the live lists are fetched (free), otherwise the page shows the cached/known lists (`DestinationsResponse.listsIdle: true`) plus a "Recharger les listes depuis Chronodrive" button that triggers the deliberate fetch (`POST /api/config/destinations/refresh`). Keep-alive auto-fetches as before — same session-aware gate as `/health`.
- **Not-found handling** (CLARIFY-01): log + visible alert in the UI (no manual-link screen in v1).
- API error page must include: Firefox HAR capture tutorial + ready-to-paste Claude debug prompt (shipped in v1, CLARIFY-06).
- **Proactive error notification** (CLARIFY-05): on critical API error, call a Home Assistant webhook (URL configured in the UI). Mosquitto/HA confirmed present in the homelab.

**Implemented in Phase 4 (DECISION-011/012/013):**

- **Stack** — React 19 + Vite, **Mantine** components + **react-router** (`/config`, `/dashboard`, `/history`, `/logs`). Built bundle served by Fastify (`@fastify/static`, SPA history-fallback); in dev, Vite proxies `/api` and `/v1` to the backend.
- **API surface** (`/api`, same Fastify app as the local API + the scan `POST /api/v1/scan`): `GET/PUT /config`, `GET/PUT /config/destinations`, **`POST /config/destinations/refresh`** (BL-007 — force the live list fetch on demand), `PUT/DELETE /credentials`, `GET /scans` (status/search/page/pageSize — BL-004), `GET /scans/stream` (SSE), **`GET /events`** (category filter + pagination) + **`GET /events/stream`** (SSE — BL-003), `GET /health` + `POST /health/connect` (BL-006). Shapes typed in `@barclaudegateway/shared` (`ApiConfig`, `ConfigResponse`, `DestinationsResponse` — with `listsIdle` for the lazy cached-only state, BL-007 — `ScansResponse`, `ScanRecord`, `ScanEvent`, `LogEvent`, `EventsResponse`).
- **Real-time** — **SSE** over in-process buses (DECISION-012). The scan `ScanEventBus` still feeds the Phase-5 error monitor; **the `/logs` page is now operational logs** over a dedicated `EventLogBus` + `event_log` table (auth exchanges + per-step scan detail + token refreshes + system events, live tail, Auth/Scan/Autre/Tous filter, errors shown clearly — **BL-003 shipped 2026-06-27**), and the old live table became a **static, searchable, paginated `Historique des scans`** (**BL-004 shipped 2026-06-27**). See DECISION-018.
- **Credentials write-only** — `PUT /api/credentials` stores them encrypted; no GET ever returns the password, only `credentials.set`. The `x-api-key`s are not secret and are returned/edited.
- **Config page edits all static params** including a **new optional `site_id`** store-id override (empty = dynamic `lastVisitedSite.id` detection). It is the editor of the single Phase 3 `enabled_destinations` row — no second source of truth.
- **Not-found alert** (CLARIFY-01) shipped on the dashboard.
- **Dev workflow** — terminal 1 (backend on :8090): `npm run build -w @barclaudegateway/backend` then `npm start -w @barclaudegateway/backend` with `BCG_MASTER_KEY` set (see `packages/backend/.env.example`). terminal 2 (UI on :5173): `npm run dev -w @barclaudegateway/frontend` — Vite proxies `/api` and `/v1` to :8090. Production: `npm run build` (root) then run the backend, which serves the built SPA from `packages/frontend/dist`. The default port is **8090** (not 8080, which is commonly already in use on the host); override with `BCG_PORT`.

**Implemented in Phase 5 (DECISION-014):**

- **Critical-error detection** — an in-process `ErrorMonitor` (`packages/backend/src/health/errorMonitor.ts`) holds the current `ErrorState`, fed by **both** the periodic health self-test (every 6 h + startup) and live scan failures off the `ScanEventBus`. Critical = `auth`/`api_key`/`schema`/`server`/`network`/`timeout`; `not_found`/`rate_limit` are not. Auto-clears on recovery; emits only on transitions. Exposed at `GET /api/error-state` + `GET /api/error-state/stream` (SSE).
- **Maintenance surface** — a global red **banner** (every page, links to `/maintenance`) + a dedicated **`/maintenance`** page with a plain-French explanation of the breakage, a **Firefox HAR capture tutorial**, and a **ready-to-paste Claude debug prompt** prefilled with the observed `category`/`endpoint`/`message`/`x-api-version`/timestamp (CLARIFY-06).
- **Home Assistant alert** (CLARIFY-05) — `HaWebhookNotifier` POSTs a **secret-free** payload to the configured webhook **once per incident** (15-min cooldown) on a new critical error; no-op when unset. A **"Tester le webhook"** button on the config page (`POST /api/notify/test`) sends a sample.
- **New config key `ha_webhook_url`** (empty by default) added to `AppConfig`/`ApiConfig`/`ConfigResponse` and the `config` table, edited in the config page's "Alerte Home Assistant" section — the single new field, mirroring the Phase 4 `site_id` addition.

**Validated & hardened in Phase 7 (DECISION-017):**

- **End-to-end on the real deployment** (Portainer stack, real Chronodrive API, 2026-06-27): the
  unconfigured first run is informational (DECISION-016), configuration brings it online with no
  contract drift, and the three `ScanResponse` states (`added` / `added_to_lists_only` / `not_found`)
  were proven live. Full report: `docs/validation/phase-7-validation.md`.
- **Hardening fix (v0.0.3)** — `redactSecrets` is now wired centrally as the Fastify logger's
  `formatters.log` hook (`logging/redact.ts` `redactLogObject` + `ingest/server.ts`), so every log
  record is deep-redacted. No `BCG_*`/architecture change.
- **Backup model documented for WAL** — `docs/deployment.md` now has WAL-safe backup/restore steps
  (the DB carries `-wal`/`-shm`; copying only the `.sqlite` can lose recent writes).
- **Maintenance loop initialized** — `specifications/BACKLOG.md` + `BACKLOG_ARCHIVE.md` and the three
  standalone loop prompts in `specifications/prompts/` drive all post-Phase-7 work. Deferred items:
  **[BL-001]** physical ESP32 validation (module not yet received), **[BL-002]** assisted master-key
  generation on first run.
- **✅ ACCEPTED 2026-06-27** — the user accepted the system for everyday use at the Phase 7 gate. The
  numbered build phases (0–7) are complete; the project is now driven by the iterative maintenance
  loop. No Phase 8.

---

## Architecture: OPEN — none

All Phase 0 architecture decisions and functional clarifications are resolved. See `specifications/decisions.md`.

| Decision                       | Status   | Resolution                           |
| ------------------------------ | -------- | ------------------------------------ |
| Backend language and framework | RESOLVED | Node.js / TypeScript (DECISION-002)  |
| Frontend approach              | RESOLVED | React + Vite (DECISION-004)          |
| Configuration + log storage    | RESOLVED | SQLite + retention (DECISION-003)    |
| ESPHome → middleware protocol  | RESOLVED | HTTP POST (DECISION-001)             |
| Monorepo vs packages           | RESOLVED | Monorepo (DECISION-006)              |
| CI/CD pipeline for GHCR        | RESOLVED | GitHub Actions → GHCR (DECISION-005) |
| Monorepo dev tooling           | RESOLVED | npm workspaces + ESLint/Prettier/Vitest/Husky (DECISION-007) |
| Web UI stack + serving         | RESOLVED | Mantine + react-router, Fastify static (DECISION-011) |
| Real-time log transport        | RESOLVED | SSE + in-process event bus (DECISION-012) |
| Phase 4 API + write-only creds | RESOLVED | `/api` surface, `site_id` override (DECISION-013) |
| Error detection + HA alert + HAR page | RESOLVED | `ErrorMonitor`, `/maintenance`, `ha_webhook_url` (DECISION-014) |
| Docker image + GHCR release + Portainer | RESOLVED | multi-stage `node:24-slim`, public GHCR, tag-triggered, `/livez` healthcheck (DECISION-015) |
| Unconfigured = info, not error        | RESOLVED | `not_configured` category, self-test skipped until configured, dashboard "configure me" card (DECISION-016, v0.0.2) |
| End-to-end validation + hardening      | RESOLVED | Deployed smoke/security/resilience proven; central log redaction wired (DECISION-017, v0.0.3); maintenance loop initialized |
| Operational event-logging + scan history | RESOLVED | Dedicated `EventLog`/`EventLogBus` + `event_log` table, `LogEvent` taxonomy, 50 000-row/10-y retention, SSE tail; scan page split into operational logs + searchable history (DECISION-018, BL-003/004) |
| "Already in list" as a distinct scan state | RESOLVED | Not built — duplicate list-add is an idempotent `204` (already green `added`); documented (contract.md §5.8) and closed by investigation (DECISION-019, BL-005) |
| Auth-token policy: lazy vs keep-alive          | RESOLVED | `auth_mode` config key; lazy = on-demand login only + dormant self-test while idle, keep-alive = ~2h refresh + proactive self-test; fresh→lazy, upgraded→keep-alive; manual `POST /api/health/connect` (DECISION-021, BL-006). **Refined (BL-007):** lazy also skips the config-page list auto-fetch (session-aware gate + `DestinationsResponse.listsIdle` + manual `POST /api/config/destinations/refresh`) |
| Scope expansion: local Chronodrive query API ("Layer B") | TRIAGED | All 10 use cases; new local API w/ own contract + `X-API-Key`; in-gateway price tracking; essential nutrition-code map; logs identify Chronodrive vs internal exchanges. `contract.md`→1.5.0. Staged BATCH-7..11 (DECISION-022). **BATCH-7 shipped → DECISION-023.** |
| Local API foundation + logging taxonomy (BATCH-7) | RESOLVED | `/api/v1` prefix; encapsulated `X-API-Key` guard; **auto-generated, app-managed key** (not in `ApiConfig`, not config-editable); `chronodrive`/`api_local` log split; `api/local/contract.md` v0.1.0; `GET /api/v1/ping` stub (DECISION-023, BL-008/009, v0.3.0) |
| Products & nutrition on the local API (BATCH-8) | RESOLVED | `GET /api/v1/search` + `GET /api/v1/products/{eanOrId}` → normalized DTOs; Products `x-api-key`; §5.12.1 nutrition mapper + image-URL builder; EAN-vs-id via `validateEan` (DECISION-024, BL-010) |
| Cart & lists on the local API (BATCH-9) | RESOLVED | `GET /cart` + `/cart/nutrition` aggregate, `POST/DELETE /cart/items`, `GET /lists` + `/lists/{id}`, `POST/DELETE /lists/{id}/items`, `POST /recipe-fill`; `ItemRef` id/ean/name + resolution report; batch cart write; cart mapper/aggregate (DECISION-025, BL-011) |
| In-gateway price tracking + UI page (BATCH-10) | RESOLVED | tracked-products CRUD + thresholds + history + settings + check-now on both `/api/v1/price-tracking/*` (key) and internal `/api/price-tracking/*`; gated opt-in `PriceScheduler`, re-arm `price_drop` HA webhook, new "Suivi des prix" page (DECISION-026, BL-012) |
| Release model + internal-contract stability | RESOLVED | The Layer-B epic (BATCH-7..11) is ONE user-triggered **0.3.0** release (no per-batch bumps); exposed contracts (Layer-B, UI `/api/*`, ESP `/api/v1/scan`) are stability-first — adapt the wiring on a Chronodrive change, modify/remove only when unavoidable + warn the user (DECISION-027) |
| Wiring/ops + scan consolidation (BATCH-11) | RESOLVED | Scan moved to `POST /api/v1/scan` (key-guarded; old `/v1/scan` removed → 404; `ScanResponse` unchanged); Config "API locale" card (read-only key + base URL + Régénérer) via `GET/POST /api/local-api-key*`; firmware rebased on Ivan's YAML + 2 HA functions (product-info-on-scan, keyword search); lazy/keepalive verified (DECISION-028, BL-013) — **epic complete** |

---

## Mandatory roadmap phases — Cowork must include all of these when generating ROADMAP.md

The roadmap must cover these phases in order. Do not merge or skip any of them.

| Phase | Name                                                                       | Run in        |
| ----- | -------------------------------------------------------------------------- | ------------- |
| 0     | Requirements clarification & architecture decisions                        | Cowork        |
| 1     | Dev environment setup & repository bootstrap                               | Code          |
| 2     | Core backend: auth engine, token lifecycle, Chronodrive API client         | Code          |
| 3     | Barcode ingestion: ESPHome integration endpoint                            | Code          |
| 4     | Web UI: config, dashboard, real-time log stream                            | Code          |
| 5     | API error detection, maintenance page, HAR tutorial, embedded debug prompt | Code          |
| 6     | Docker packaging, GHCR CI/CD, Portainer deployment                         | Code          |
| 7     | End-to-end validation and hardening                                        | Code + Cowork |

**Phase 1 must cover at minimum:**

- Creating the GitHub repository (name, visibility, .gitignore, README)
- Configuring the Windows 11 dev environment (runtime, package manager, editor setup if needed)
- Initial project structure (folders, package.json or equivalent, tsconfig if applicable), with app version starting at **0.0.1**
- Git workflow conventions (branch naming, commit message format)
- Connecting the local repo to GitHub
- A **checks-only CI** workflow (lint + tests on push/PR)
- Any tooling needed before the first line of application code is written (linter, formatter, etc.)

> **Docker / GHCR is NOT a Phase 1 concern** (refined 2026-06-26, DECISION-005 release model). Docker is never built or tested on Windows; the image is built only by CI on a version tag. The Dockerfile, the image-publish workflow, and GHCR credentials all live in **Phase 6**. Phase 1 is `Run in: Code`.

Phase 1 depends on Phase 0 decisions being fully resolved (backend language, monorepo structure, CI/CD approach).

---

## Iterative prompt model — applies to all phases

### Sub-phases

Phases that are too large for a single session must be split into numbered sub-phases (e.g., Phase 2.1, Phase 2.2). When generating a phase prompt, assess the expected scope: if it covers more than one logical unit of work, split it.

### Re-entrant prompts

Every phase or sub-phase prompt must be designed to be **re-sent as-is if the session ends mid-way**. When a prompt is re-executed, it must:

1. Read the context files (PROJECT_CONTEXT.md, decisions.md, and any phase-specific output files).
2. Inspect what has already been produced (files created, sections written, decisions logged).
3. Identify the first incomplete step.
4. Resume from that step without repeating completed work.

This means every phase prompt must begin with an explicit **resume check**:

```
## Resume check
Before doing anything else:
- Read [list of relevant files]
- Identify which steps are already complete based on file existence and content
- State clearly: "Resuming from step X" or "Starting from the beginning"
- Do not redo completed steps
```

### Validation gate

No phase or sub-phase generates the next prompt until the user has explicitly validated the work. The final step of every prompt is always:

1. Present a summary of what was produced.
2. Ask the user: anything to change, add, or challenge?
3. Wait for explicit go-ahead.
4. Only then: generate and print the next prompt.

### Next prompt scope

The next prompt generated at the end of a phase can be:

- The next **sub-phase** prompt (if the current phase has remaining sub-phases), or
- The next **phase** prompt (if the current phase is complete).

The generated prompt must always be fully self-contained: it lists the files to read, the resume check, the steps, and the validation gate. It must not rely on the current session's memory.

---

## Constraints — apply to ALL steps, no exceptions

1. **Never decide alone.** Surface options with plain-language impacts; the user chooses.
2. **Questions in plain language.** No jargon points. Say what the choice means in practice, not just the name.
3. **Proposals include impacts.** Every option must state: what it costs, what it gains, what it risks.
4. **All artifacts in English.** Code, docs, config, variable names, comments, commit messages.
5. **Discussion in French.**
6. **Each step begins with**: `Run in: Cowork` or `Run in: Code` — no ambiguity.
7. **Each step ends with**: the next step's launch prompt, ready to paste.
8. **Context persistence.** Update PROJECT_CONTEXT.md and decisions.md at end of each step.
9. **No code before the approach is approved.** Present plan → wait for go-ahead → implement.

---

## Key domain knowledge (for implementation steps)

- Cart mutations use **signed delta quantity** — `quantity: +1` adds, `-1` removes. NOT absolute values.
- Setting cart quantity to 0 removes the item. POST is the only cart mutation verb needed.
- Shopping list add/remove both use `PATCH /v1/shopping-lists/{listId}` with `objectsToAdd` / `objectsToRemove`.
- **List add is idempotent** (contract.md §5.8, BL-005/DECISION-019): re-adding a product already on the list returns the same `204` and leaves its quantity **unchanged** (no increment), and the response is indistinguishable from a fresh add — so an already-listed product already scans green (`added`), and detecting membership would require reading the list (§5.10). Contrast the **cart's signed delta** (a cart re-add is `+1`).
- List UUIDs are stable but must be fetched dynamically at startup via `GET /v1/shopping-lists`.
- EAN → productId resolution: `GET /v1/search-suggestions?searchTerm={ean}` → `products[0].id`
- `isEligible: false` means the product exists but is unavailable at the configured drive location.
- `stock` enum: `HIGH_STOCK`, `NO_STOCK`. `LOW_STOCK` inferred, not confirmed.
- The `__Host-SESSION` cookie must be captured from the Step 2 response headers and stored in memory; it is not in the token JSON body.
- Auth calls to `connect.chronodrive.com` require `Origin: https://www.chronodrive.com` + `Referer: https://www.chronodrive.com/` headers — without them Step 2 returns 400 `No origin or referer retrieved` (discovered live, contract.md §2.0).
- Step 1 (`password/login`) sets the initial Reach5 session cookie that Step 2's `prompt=none` needs; a stateless client must forward Step 1's cookies into the Step 2 request.
- **Scan behavior (CLARIFY-07/08, for Phase 3):** double-scan of the same EAN is debounced (~3 s window) then `+1`; out-of-stock (`NO_STOCK`) and ineligible (`isEligible: false`) products are added to the checked **lists only, never the cart**, with a distinct state returned for the ESPHome LED/buzzer.
- **Phase 2 backend core is complete** (auth engine, token lifecycle, encrypted storage, typed Chronodrive client, read-only health self-test) — auth flow live-verified.
- **Phase 3 ingestion is complete** (DECISION-009/010; the scan endpoint moved to `POST /api/v1/scan` in BATCH-11/DECISION-028): Fastify server (`POST /api/v1/scan`, `GET /health`), EAN validation (length + GS1 check digit), debounce, scan→action pipeline (cart `+1` only when orderable; lists always; CLARIFY-01/08), bounded journaling, and the rich `ScanResponse` contract for ESPHome (`docs/esphome-contract.md`). Enabled destinations live in the SQLite `config` table under `enabled_destinations` (read side + minimal setter; full editor is Phase 4). Tested with mocked HTTP (`undici` `MockAgent`, `fastify.inject`).
