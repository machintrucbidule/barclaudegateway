# BarclaudeGateway — Project Context

> **This file is read at the start of every development step.** Keep it up to date.
> Last updated: 2026-06-27

---

## What is this?

A self-hosted middleware that bridges an ESP32 barcode scanner (ESPHome) with the Chronodrive private grocery e-commerce API. Scanning an empty product triggers the app to add it to the user's Chronodrive cart and/or shopping lists. A local web UI allows configuration and monitoring.

---

## Repository layout

npm-workspaces monorepo (DECISION-006), bootstrapped in Phase 1:

```
barclaudegateway/
  specifications/
    api/chronodrive/contract.md  ← Chronodrive private API spec (reverse-engineered, v1.4.0)
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
> The version started at **0.0.1**; **current published version is `0.0.4`** (adds the ESPHome
> scanner firmware `firmware/esphome/barclaude-scanner.yaml` + a version-controlled prod-deploy
> script; **no middleware code change vs `0.0.3`**, which shipped the DECISION-017 log-redaction
> hardening fix; v0.0.2 was DECISION-016).
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
  the only state to back up. The key is injected at run time (never baked/logged); no `.env`, DB, or
  secret is in the image.
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
- All `/oauth/*` + `/identity` calls must carry `Origin: https://www.chronodrive.com` + `Referer: https://www.chronodrive.com/`
- Per-service static API keys exist — if one key rotates, only that service breaks
- `x-api-version` response header signals Chronodrive backend deploys (monitor this)
- All endpoints confirmed, no remaining spec gaps

### ESP32 / ESPHome side

- Hardware: ESP32 + GM65 or GM861 UART barcode scanner
- ESPHome handles scanner, sends EAN code to middleware over local network
- **Protocol: HTTP POST** (DECISION-001). Synchronous HTTP response carries the scan result so ESPHome drives LED + buzzer feedback (CLARIFY-04). Trade-off accepted: a scan during app downtime is lost (no queue).
- **Physical feedback: LED + buzzer** (CLARIFY-04). Middleware returns a status detailed enough to distinguish multiple states; ESPHome maps colors + buzzer. **Finalized in Phase 3 (DECISION-010):** endpoint `POST /v1/scan { ean }` → rich `ScanResponse` with `status` ∈ `added` / `added_to_lists_only` (+reason) / `duplicate_ignored` / `not_found` / `partial` / `error` (+category) / `invalid_ean`. Firmware-facing mapping (states → LED colour + buzzer pattern, request/response examples) in `docs/esphome-contract.md`; shared types in `@barclaudegateway/shared`.

### Web UI

- Local access only, no auth
- Pages: Config, Dashboard, Real-time log stream, API error/maintenance page
- **Config page = destination checkboxes** (CLARIFY-02 + 03): shows "Panier" (cart) + every shopping list (fetched dynamically via `GET /v1/shopping-lists`), each with a checkbox. A scan feeds every checked destination. Also holds credentials (write-only display) and the HA webhook URL.
- **Not-found handling** (CLARIFY-01): log + visible alert in the UI (no manual-link screen in v1).
- API error page must include: Firefox HAR capture tutorial + ready-to-paste Claude debug prompt (shipped in v1, CLARIFY-06).
- **Proactive error notification** (CLARIFY-05): on critical API error, call a Home Assistant webhook (URL configured in the UI). Mosquitto/HA confirmed present in the homelab.

**Implemented in Phase 4 (DECISION-011/012/013):**

- **Stack** — React 19 + Vite, **Mantine** components + **react-router** (`/config`, `/dashboard`, `/logs`). Built bundle served by Fastify (`@fastify/static`, SPA history-fallback); in dev, Vite proxies `/api` and `/v1` to the backend.
- **API surface** (`/api`, same Fastify app as `POST /v1/scan`): `GET/PUT /config`, `GET/PUT /config/destinations`, `PUT/DELETE /credentials`, `GET /scans`, `GET /scans/stream` (SSE), `GET /health`. Shapes typed in `@barclaudegateway/shared` (`ApiConfig`, `ConfigResponse`, `DestinationsResponse`, `ScansResponse`, `ScanRecord`, `ScanEvent`).
- **Real-time** — **SSE** over an in-process `ScanEventBus` the pipeline publishes to at every journalled outcome (DECISION-012).
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
- List UUIDs are stable but must be fetched dynamically at startup via `GET /v1/shopping-lists`.
- EAN → productId resolution: `GET /v1/search-suggestions?searchTerm={ean}` → `products[0].id`
- `isEligible: false` means the product exists but is unavailable at the configured drive location.
- `stock` enum: `HIGH_STOCK`, `NO_STOCK`. `LOW_STOCK` inferred, not confirmed.
- The `__Host-SESSION` cookie must be captured from the Step 2 response headers and stored in memory; it is not in the token JSON body.
- Auth calls to `connect.chronodrive.com` require `Origin: https://www.chronodrive.com` + `Referer: https://www.chronodrive.com/` headers — without them Step 2 returns 400 `No origin or referer retrieved` (discovered live, contract.md §2.0).
- Step 1 (`password/login`) sets the initial Reach5 session cookie that Step 2's `prompt=none` needs; a stateless client must forward Step 1's cookies into the Step 2 request.
- **Scan behavior (CLARIFY-07/08, for Phase 3):** double-scan of the same EAN is debounced (~3 s window) then `+1`; out-of-stock (`NO_STOCK`) and ineligible (`isEligible: false`) products are added to the checked **lists only, never the cart**, with a distinct state returned for the ESPHome LED/buzzer.
- **Phase 2 backend core is complete** (auth engine, token lifecycle, encrypted storage, typed Chronodrive client, read-only health self-test) — auth flow live-verified.
- **Phase 3 ingestion is complete** (DECISION-009/010): Fastify server (`POST /v1/scan`, `GET /health`), EAN validation (length + GS1 check digit), debounce, scan→action pipeline (cart `+1` only when orderable; lists always; CLARIFY-01/08), bounded journaling, and the rich `ScanResponse` contract for ESPHome (`docs/esphome-contract.md`). Enabled destinations live in the SQLite `config` table under `enabled_destinations` (read side + minimal setter; full editor is Phase 4). Tested with mocked HTTP (`undici` `MockAgent`, `fastify.inject`).
