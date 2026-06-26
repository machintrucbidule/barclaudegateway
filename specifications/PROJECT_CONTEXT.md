# BarclaudeGateway — Project Context

> **This file is read at the start of every development step.** Keep it up to date.
> Last updated: 2026-06-26

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
  package.json                   ← workspace root (private, version 0.0.1, aggregated scripts)
  tsconfig.base.json             ← shared TypeScript compiler options
  eslint.config.js               ← ESLint flat config
  .prettierrc.json / .editorconfig / .gitattributes / .npmrc
  .husky/pre-commit              ← runs lint-staged on staged .ts/.tsx files
```

> `docker/` and the image-publish workflow are intentionally **absent** until Phase 6
> (Docker is never built or tested on Windows). The version starts at **0.0.1**.

---

## Architecture: DECIDED — do not re-open without the user

### Deployment

- Single Docker container, managed via Portainer
- Image published to **GHCR** (GitHub Container Registry)
- Network isolation upstream via **Cloudflare Tunnel** — the app itself needs no TLS, no auth
- Web UI is local-only by design; no application-level authentication required
- Dev environment: **Windows 11**
- Prod environment: **Docker / Portainer on Linux homelab** (Proxmox)

### Application stack (DECIDED — Phase 0, see decisions.md)

- **Backend**: Node.js / TypeScript (DECISION-002). Caveat: HTTP client must expose raw `Set-Cookie` headers (`__Host-SESSION`) — verify in Phase 2.
- **Frontend**: React + Vite (DECISION-004), sharing contract types with the backend.
- **Storage**: SQLite, single file on a Docker volume (DECISION-003). Credentials encrypted at rest (AES-256). Scan-log retention policy keeps the log table bounded.
- **Repo structure**: Monorepo, backend + frontend in one repo, one Docker build (DECISION-006).
- **CI/CD**: GitHub Actions, two triggers (DECISION-005 release model). Routine push/PR → checks only (lint + tests). Version tag (e.g. `v0.0.2`, user-initiated) → build + publish the versioned Docker image to GHCR. App starts at **0.0.1**. Docker is never built/tested on Windows; all Docker/GHCR setup lives in **Phase 6**.
- **ESP32 → app protocol**: HTTP POST, synchronous response (DECISION-001).

### Dev tooling (DECIDED — Phase 1, see DECISION-007)

- **Package manager**: npm with native **workspaces** (`packages/shared|backend|frontend`). Exact versions pinned (`.npmrc` `save-exact`); Node/npm enforced via `engines` + `engine-strict`. Target runtime: **Node 24 LTS**.
- **Cross-package type sharing**: `@barclaudegateway/shared`'s `types`/`exports` point at its source, so both sides typecheck against the same source with no build-order coupling (Phase-1 imports are type-only).
- **TypeScript**: shared `tsconfig.base.json` (strict); per-package `tsconfig.json` for typecheck (`tsc --noEmit`) and `tsconfig.build.json` (excludes tests) for emit.
- **Lint/format**: ESLint flat config + Prettier (LF enforced via `.gitattributes` + `.editorconfig`).
- **Tests**: **Vitest** (backend = node env, frontend = jsdom + Testing Library), scoped to `src/`.
- **Pre-commit**: Husky + lint-staged (ESLint `--fix` + Prettier on staged `.ts`/`.tsx`).
- **CI**: `.github/workflows/ci.yml`, checks-only on push/PR (install → lint → format check → typecheck → test → build). No image build (Phase 6).
- **Git conventions** (`CONTRIBUTING.md`): branches `feature/`·`fix/`·`chore/`·`docs/`; **Conventional Commits**; release = bump version → push `vX.Y.Z` tag (triggers the image build in Phase 6).

### Chronodrive API

Full spec: `specifications/api/chronodrive/contract.md`

Auth flow (Reach5 PKCE):

- **Step 1** — `POST /identity/v1/password/login` → short-lived `tkn`
- **Step 2** — `GET /oauth/authorize?prompt=none&tkn=...` → sets `__Host-SESSION` cookie (72h) + auth code
- **Step 3** — `POST /oauth/token` (auth code exchange) → `access_token` (2h TTL)
- **Silent refresh** (every ~2h): Steps 2+3 only, using `__Host-SESSION` cookie — no password needed
- **Full re-login** (every ~72h or on `login_required`): Steps 1+2+3 with stored credentials
- Per-service static API keys exist — if one key rotates, only that service breaks
- `x-api-version` response header signals Chronodrive backend deploys (monitor this)
- All endpoints confirmed, no remaining spec gaps

### ESP32 / ESPHome side

- Hardware: ESP32 + GM65 or GM861 UART barcode scanner
- ESPHome handles scanner, sends EAN code to middleware over local network
- **Protocol: HTTP POST** (DECISION-001). Synchronous HTTP response carries the scan result so ESPHome drives LED + buzzer feedback (CLARIFY-04). Trade-off accepted: a scan during app downtime is lost (no queue).
- **Physical feedback: LED + buzzer** (CLARIFY-04). Middleware returns a status detailed enough to distinguish multiple states (added / not-found / ineligible / out-of-stock / API error); ESPHome maps colors + buzzer. Exact wiring + response schema finalized in Phase 3.

### Web UI

- Local access only, no auth
- Pages: Config, Dashboard, Real-time log stream, API error/maintenance page
- **Config page = destination checkboxes** (CLARIFY-02 + 03): shows "Panier" (cart) + every shopping list (fetched dynamically via `GET /v1/shopping-lists`), each with a checkbox. A scan feeds every checked destination. Also holds credentials (write-only display) and the HA webhook URL.
- **Not-found handling** (CLARIFY-01): log + visible alert in the UI (no manual-link screen in v1).
- API error page must include: Firefox HAR capture tutorial + ready-to-paste Claude debug prompt (shipped in v1, CLARIFY-06).
- **Proactive error notification** (CLARIFY-05): on critical API error, call a Home Assistant webhook (URL configured in the UI). Mosquitto/HA confirmed present in the homelab.

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
