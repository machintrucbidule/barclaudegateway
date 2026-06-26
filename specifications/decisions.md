# BarclaudeGateway — Architecture Decisions Log

> Decisions are added here as they are resolved. Each entry records: the question, the options considered, the choice made, and who decided.
> All Phase 0 functional clarifications (CLARIFY-_) and architecture decisions (DECISION-_) are now resolved.
> Last updated: 2026-06-26

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

## Cross-cutting consequences for later phases

- **Phase 3** must define a **rich HTTP response contract** (multiple distinct states: success / not-found / ineligible / out-of-stock / API error) so ESPHome can drive LED colors + buzzer (CLARIFY-04).
- **Phase 1** must resolve **GHCR authentication on Windows** (PAT scopes, `docker login ghcr.io`) (DECISION-005).
- **Phase 2** must **verify the HTTP client exposes raw `Set-Cookie` headers** before committing to it (DECISION-002, contract.md §2.4).
- **SQLite log-retention thresholds** to be finalized in Phase 2/4 (DECISION-003).
- **HA webhook URL** is a config field added in Phase 5 (CLARIFY-05).
