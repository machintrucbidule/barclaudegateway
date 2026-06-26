# BarclaudeGateway — Development Roadmap

> **Living document.** Generated at the end of Phase 0 planning, refined after every phase.
> Last updated: 2026-06-26
> Companion files: `PROJECT_CONTEXT.md` (architecture state), `decisions.md` (decision log), `api/chronodrive/contract.md` (API spec).

---

## How to read this roadmap

Each phase below is a self-contained unit of work. A phase is launched by a **launch prompt** — a complete, paste-ready instruction generated only at the end of the previous phase, after the user validates. No phase starts until the one before it is validated.

The roadmap defines _what_ each phase covers and _in what order_. The launch prompt for a phase defines _exactly how_ to execute it, and is the artifact actually pasted into a new Cowork or Code session.

### Phase numbering note (read before challenging the order)

`PROJECT_CONTEXT.md` mandates 8 phases (0–7) and explicitly forbids merging or skipping any of them. The task brief that requested this roadmap listed 7 phases (0–6) as a _minimum_ and omitted the dev-environment/repository-bootstrap phase. These two are reconciled here by following `PROJECT_CONTEXT.md`: the bootstrap phase is kept as **Phase 1**, and the backend/ingestion/UI/error/Docker/validation phases shift down by one. If you want the shorter 7-phase numbering instead, say so at validation and the roadmap will be renumbered.

---

## Cross-cutting rules — embedded at the top of every phase launch prompt

These rules are non-negotiable and must be copied verbatim into each generated phase prompt:

1. **Never decide alone.** Surface options with plain-language impacts; the user chooses. No important decision is made by the assistant unilaterally.
2. **Plain language, always.** Questions to the user are in plain language — no jargon, no bullet-point technical lists. Explain what each choice means in practice (what it costs, what it gains, what it risks), not just its name.
3. **English artifacts.** All code, docs, config, variable names, comments, commit messages are in English.
4. **French discussion.** All conversation and clarification with the user happens in French.
5. **No code before approval.** Present the approach → wait for explicit go-ahead → only then implement.
6. **`Run in:` is declared first.** Every phase prompt states `Run in: Cowork` or `Run in: Code` with no ambiguity.
7. **Validation gate before handoff.** Each phase ends by presenting a summary, asking what to change/add/challenge, waiting for explicit validation, and only then generating the next phase (or sub-phase) launch prompt.
8. **Context persistence.** `PROJECT_CONTEXT.md` and `decisions.md` are updated at the end of every phase.
9. **Re-entrant prompts.** Every phase prompt begins with a resume check (read context files, inspect what exists, identify the first incomplete step, resume without redoing finished work) so it can be re-sent as-is if a session ends mid-way.

---

## Phase overview

| Phase | Name                                                                       | Run in        | Depends on                                               |
| ----- | -------------------------------------------------------------------------- | ------------- | -------------------------------------------------------- |
| 0     | Requirements clarification & architecture decisions                        | Cowork        | —                                                        |
| 1     | Dev environment setup & repository bootstrap                               | Cowork + Code | All Phase 0 decisions resolved                           |
| 2     | Core backend: auth engine, token lifecycle, Chronodrive API client         | Code          | DECISION-002, 003, 006; repo bootstrapped                |
| 3     | Barcode ingestion: ESPHome integration endpoint                            | Code          | DECISION-001; CLARIFY-02, 03, 04; Phase 2 client working |
| 4     | Web UI: config, dashboard, real-time log stream                            | Code          | DECISION-004; CLARIFY-01, 03; Phase 2 + 3                |
| 5     | API error detection, maintenance page, HAR tutorial, embedded debug prompt | Code          | CLARIFY-05, 06; Phase 4 UI shell                         |
| 6     | Docker packaging, GHCR CI/CD, Portainer deployment                         | Code          | DECISION-005; all app features feature-complete          |
| 7     | End-to-end validation and hardening                                        | Code + Cowork | Phase 6 deployed image                                   |

---

## Phase 0 — Requirements clarification & architecture decisions

- **Run in**: Cowork
- **Goal**: Resolve every open functional ambiguity and architecture decision so that Phase 1 can start with zero unknowns.
- **Prerequisites**: None. This is the entry phase.

### Steps

1. **Resume check.** Read `PROJECT_CONTEXT.md` and `decisions.md`. List which CLARIFY-_ and DECISION-_ items are still `OPEN` vs already `Resolved`. State "Resuming from decision X" or "Starting from the beginning."
   - Input: `PROJECT_CONTEXT.md`, `decisions.md`
   - Output: a stated list of remaining open items.
2. **Walk the functional clarifications (CLARIFY-01 … CLARIFY-06), one at a time, in plain French.** For each, present the options with their practical impact and let the user choose. Do not batch them into a single message.
   - Input: `decisions.md` (Pending — Requirements clarifications)
   - Output: a chosen answer per CLARIFY item, written into `decisions.md` under Resolved.
3. **Walk the architecture decisions (DECISION-001 … DECISION-006), one at a time, in plain French.** Same method. Surface the impact of each choice on later phases (e.g., backend language constrains Phase 2; frontend choice constrains Phase 4).
   - Input: `decisions.md` (Pending — Architecture decisions)
   - Output: a chosen option per DECISION item, written into `decisions.md` under Resolved with rationale.
4. **Update the context files.** Move every resolved item from OPEN to its decided state. Update the OPEN table in `PROJECT_CONTEXT.md` so no decision is left as OPEN.
   - Input: all answers from steps 2–3
   - Output: updated `decisions.md`, updated `PROJECT_CONTEXT.md`.
5. **Present summary to user and, after validation, generate the next phase launch prompt** (Phase 1 — Dev environment setup & repository bootstrap).

### Deliverables to the user

- `decisions.md` with all CLARIFY-_ and DECISION-_ items resolved, each with rationale.
- `PROJECT_CONTEXT.md` with no remaining OPEN decisions.
- The Phase 1 launch prompt, ready to paste.

### Risks / open questions at phase entry

- The user may not yet know whether they run MQTT/Mosquitto (DECISION-001) — may need to check Home Assistant before answering.
- Some clarifications interact (CLARIFY-02 scan intent ↔ CLARIFY-03 which list ↔ DECISION-001 protocol). Resolve them in an order that surfaces dependencies, and re-confirm if a later answer contradicts an earlier one.

---

## Phase 1 — Dev environment setup & repository bootstrap

- **Run in**: Cowork + Code
- **Goal**: Stand up the GitHub repository, the Windows 11 dev environment, and all tooling so the first line of application code has a clean home.
- **Prerequisites**: All Phase 0 decisions resolved — specifically DECISION-002 (backend language), DECISION-004 (frontend), DECISION-006 (monorepo vs packages), DECISION-005 (CI/CD approach) determine the repo shape and tooling.

### Steps

1. **Resume check.** Read `PROJECT_CONTEXT.md`, `decisions.md`. Inspect whether a repo, `package.json`/equivalent, or `.github/` already exist. State where to resume.
   - Input: context files, current repo tree
   - Output: resume statement.
2. **Create the GitHub repository.** Decide name, visibility, `.gitignore`, README, license with the user (plain French).
   - Input: decisions from Phase 0
   - Output: GitHub repo created; README.md, .gitignore.
3. **Configure the Windows 11 dev environment.** Install/verify the chosen runtime (e.g. Node LTS or Python), package manager, editor config.
   - Input: DECISION-002
   - Output: documented setup steps in README or `docs/dev-setup.md`.
4. **Lay down the initial project structure** per the monorepo/packages decision: folders, `package.json`/`pyproject.toml`, `tsconfig` if applicable, `src/` skeleton, `docker/` and `.github/workflows/` placeholders.
   - Input: DECISION-006, DECISION-002
   - Output: committed project skeleton.
5. **Define Git workflow conventions.** Branch naming, commit message format, written into `CONTRIBUTING.md` or README.
   - Output: `CONTRIBUTING.md`.
6. **Connect local repo to GitHub and push the bootstrap commit.**
   - Output: first commit on GitHub.
7. **Set up GHCR credentials and test a first image push.** Verify a trivial placeholder image builds and pushes to `ghcr.io`.
   - Input: DECISION-005
   - Output: one image published to GHCR; documented credential setup.
8. **Install baseline tooling** (linter, formatter, editorconfig, pre-commit hook if wanted) before any application code.
   - Output: configured linter/formatter, passing on the skeleton.
9. **Present summary to user and, after validation, generate the next phase launch prompt** (Phase 2 — Core backend).

### Deliverables to the user

- A live GitHub repository with skeleton, README, .gitignore, CONTRIBUTING.
- Confirmed Windows dev environment and a first successful GHCR image push.
- The Phase 2 launch prompt, ready to paste.

### Risks / open questions at phase entry

- GHCR authentication on Windows (PAT scopes, `docker login ghcr.io`) is a common friction point — budget time for it.
- Monorepo tooling choice (workspaces vs single package) must match DECISION-006 exactly; a mismatch here ripples into Phases 2 and 4.

---

## Phase 2 — Core backend: auth engine, token lifecycle, Chronodrive API client

- **Run in**: Code
- **Goal**: Build a tested backend module that authenticates against Chronodrive, keeps the token alive, and exposes typed methods for every confirmed API operation.
- **Prerequisites**: DECISION-002 (language), DECISION-003 (config + secret storage), DECISION-006 (structure) resolved; Phase 1 repo and tooling in place.
- **Likely sub-phases** (split at launch if scope exceeds one session):
  - **2.1** Auth engine: 3-step PKCE login, PKCE pair generation, `__Host-SESSION` capture, silent refresh, full re-login fallback.
  - **2.2** Token lifecycle: in-memory access-token store, refresh at `exp - 60s`, encrypted-at-rest credential storage per DECISION-003.
  - **2.3** Chronodrive API client: typed wrappers for §5.1–5.11 (EAN resolve, cart read/add/remove with signed delta, list read/add/remove, customer/site context).

### Steps

1. **Resume check.** Read context files + `contract.md`. Inspect `src/` for existing auth/client modules and tests. State resume point.
   - Input: context files, `api/chronodrive/contract.md`, current `src/`
   - Output: resume statement.
2. **Present the backend design** (module boundaries, error model, retry/backoff, where secrets live) and wait for approval before writing code.
   - Input: `contract.md` §2–§5, DECISION-003
   - Output: approved design note.
3. **Implement the auth engine (2.1).** PKCE pair, Steps 1–3, parse inline auth code from HTML, capture and store both session cookies.
   - Input: `contract.md` §2
   - Output: `src/auth/*` + unit tests.
4. **Implement token lifecycle (2.2).** In-memory token, scheduled refresh, `login_required` → full re-login, AES-256 credential storage per DECISION-003.
   - Input: `contract.md` §2.4, §8
   - Output: `src/auth/lifecycle*` + tests.
5. **Implement the API client (2.3).** Per-service `x-api-key` mapping, dynamic `site_id` from `/v1/customers/me`, dynamic list UUIDs from `/v1/shopping-lists`, signed-delta cart mutations, list PATCH add/remove.
   - Input: `contract.md` §3–§5
   - Output: `src/chronodrive/*` + tests (mock HTTP).
6. **Add a `/health`-style self-test** that makes read-only test calls to each confirmed endpoint (per `contract.md` §7.1).
   - Output: health-check module + test.
7. **Update `PROJECT_CONTEXT.md` and `decisions.md`** with any implementation decisions made (e.g. HTTP library, retry policy).
8. **Present summary to user and, after validation, generate the next phase launch prompt** (Phase 3 — Barcode ingestion).

### Deliverables to the user

- A backend that can log in, stay logged in, and perform every Chronodrive operation, with passing tests.
- A health self-test reflecting the spec's §7.1 checklist.
- The Phase 3 launch prompt, ready to paste.

### Risks / open questions at phase entry

- Token **refresh** flow (Steps 2+3 with session cookie) is CONFIRMED in the spec but was never exercised live by us; the first real refresh may reveal a gap. Build it defensively with re-login fallback.
- `__Host-SESSION` is HttpOnly and only present in Step 2 _response headers_ — the HTTP client must expose raw Set-Cookie headers, which some libraries hide. Verify library choice supports this before committing to it.
- Static `x-api-key` rotation (spec §3.1 risk) cannot be tested in advance; surface it as a known operational risk, not a Phase 2 blocker.

---

## Phase 3 — Barcode ingestion: ESPHome integration endpoint

- **Run in**: Code
- **Goal**: Accept a scanned EAN from the ESP32 and route it to cart and/or list according to the user's configured scan intent.
- **Prerequisites**: DECISION-001 (HTTP POST vs MQTT) resolved; CLARIFY-02 (scan intent), CLARIFY-03 (target list), CLARIFY-04 (physical feedback) resolved; Phase 2 client working.

### Steps

1. **Resume check.** Read context files. Inspect for an existing ingestion endpoint/subscriber. State resume point.
2. **Present the ingestion design** (endpoint or MQTT subscriber per DECISION-001, request/response contract, how scan intent maps to cart vs list per CLARIFY-02/03) and wait for approval.
   - Input: `decisions.md`, Phase 2 client interface
   - Output: approved design note.
3. **Implement the ingestion entry point.** HTTP POST endpoint _or_ MQTT subscriber depending on DECISION-001. Validate EAN format.
   - Output: `src/ingest/*` + tests.
4. **Implement the scan→action pipeline.** Resolve EAN → product (§5.1), handle empty result per CLARIFY-01, then add to cart and/or configured list(s) per CLARIFY-02/03.
   - Input: Phase 2 client, CLARIFY-01/02/03
   - Output: pipeline module + tests covering found / not-found / ineligible / out-of-stock.
5. **Implement scan feedback response** so ESPHome can drive a LED/buzzer per CLARIFY-04 (only if Option B chosen). Define the response contract ESPHome will consume.
   - Output: documented response schema (`docs/esphome-contract.md`).
6. **Update context files** with the ingestion contract.
7. **Present summary to user and, after validation, generate the next phase launch prompt** (Phase 4 — Web UI).

### Deliverables to the user

- A working scan-to-Chronodrive path, testable with curl/MQTT publish.
- A documented ESPHome-facing contract (and feedback response if applicable).
- The Phase 4 launch prompt, ready to paste.

### Risks / open questions at phase entry

- If DECISION-001 is HTTP POST, a scan during downtime is lost (no queue). If MQTT, a broker dependency is introduced. The chosen trade-off must be restated here.
- "Add to cart" semantics are a signed delta (+1), not absolute — double-scanning the same item increments. Confirm with the user whether that is desired or needs de-duplication.

---

## Phase 4 — Web UI: config, dashboard, real-time log stream

- **Run in**: Code
- **Goal**: Give the user a local-only web interface to configure the app, watch live activity, and see history.
- **Prerequisites**: DECISION-004 (frontend approach) resolved; CLARIFY-01 (not-found alerting) and CLARIFY-03 (list config) resolved; Phases 2 and 3 functional.
- **Likely sub-phases**:
  - **4.1** Config page (credentials, target list(s), cart toggle, scan mode).
  - **4.2** Dashboard (current cart/list state, recent scans).
  - **4.3** Real-time log stream (WebSocket/SSE).

### Steps

1. **Resume check.** Read context files. Inspect `src/` for existing UI scaffolding. State resume point.
2. **Present the UI design** (page list, how live logs are transported, how config is persisted per DECISION-003) and wait for approval.
   - Output: approved design note / wireframe description.
3. **Build the config page (4.1).** Edit credentials (write-only display), target lists per CLARIFY-03, cart toggle, scan mode per CLARIFY-02.
   - Output: config page + persistence wired to backend.
4. **Build the dashboard (4.2).** Show active cart, enabled lists, last N scans, last-found/not-found per CLARIFY-01.
   - Output: dashboard page.
5. **Build the real-time log stream (4.3).** Stream backend events to the browser live.
   - Output: log-stream page + transport.
6. **Update context files.**
7. **Present summary to user and, after validation, generate the next phase launch prompt** (Phase 5 — API error detection & maintenance page).

### Deliverables to the user

- A usable local web app: configure, monitor, and watch logs live.
- The Phase 5 launch prompt, ready to paste.

### Risks / open questions at phase entry

- The UI has no application auth by design (Cloudflare Tunnel + local-only). Confirm the user accepts that anyone on the LAN can change config.
- Credential editing in the UI must never echo the stored password back; define the write-only pattern before building.

---

## Phase 5 — API error detection, maintenance page, HAR tutorial, embedded debug prompt

- **Run in**: Code
- **Goal**: When Chronodrive breaks, detect it, show a clear maintenance page, and hand the user a guided path to capture a HAR and get a fix.
- **Prerequisites**: CLARIFY-05 (notification beyond UI) and CLARIFY-06 (HAR workflow in first release vs deferred) resolved; Phase 4 UI shell exists.

### Steps

1. **Resume check.** Read context files (`contract.md` §6, §7 are central here). State resume point.
2. **Present the error-detection design** (how the health self-test from Phase 2 maps to symptom patterns in `contract.md` §7.1, what flips the app into maintenance state) and wait for approval.
3. **Implement error detection.** Classify failures per `contract.md` §7.1 symptom table (401 all, 401 per-key, schema drift, empty results, auth-step failures); detect `x-api-version` changes.
   - Input: `contract.md` §3.1, §7
   - Output: detection module + tests.
4. **Build the maintenance page** shown when a critical error is active, including the Firefox HAR capture tutorial and a ready-to-paste Claude debug prompt embedding the relevant spec section and observed symptom.
   - Input: `contract.md` §7.2
   - Output: maintenance page + templated debug prompt.
5. **Implement notification beyond the UI** per CLARIFY-05 (Home Assistant webhook) if Option B was chosen — config field for the webhook URL, trigger on critical error.
   - Output: notification module + config field (conditional on CLARIFY-05).
6. **Update context files.**
7. **Present summary to user and, after validation, generate the next phase launch prompt** (Phase 6 — Docker packaging & deployment).

### Deliverables to the user

- Automatic detection and a self-service maintenance/debug workflow.
- Optional proactive notification per CLARIFY-05.
- The Phase 6 launch prompt, ready to paste.

### Risks / open questions at phase entry

- If CLARIFY-06 deferred the HAR workflow, this phase may shrink to detection only — confirm scope at entry.
- The embedded debug prompt must not leak credentials or tokens into the generated text (spec §8). Sanitize before templating.

---

## Phase 6 — Docker packaging, GHCR CI/CD, Portainer deployment

- **Run in**: Code
- **Goal**: Ship the app as a single versioned image that Portainer can pull and run, built and published automatically.
- **Prerequisites**: DECISION-005 (build/publish approach) resolved; all application features complete (Phases 2–5).

### Steps

1. **Resume check.** Read context files. Inspect `docker/` and `.github/workflows/` for existing Dockerfile/CI. State resume point.
2. **Present the packaging design** (single-container layout, volume mounts for config/logs per DECISION-003, env/secret handling, CI trigger model per DECISION-005) and wait for approval.
3. **Write the Dockerfile and compose** (single container; volume for SQLite/JSON per DECISION-003; no in-app TLS/auth per architecture).
   - Output: `docker/Dockerfile`, `docker/compose.yml`.
4. **Build the GitHub Actions → GHCR pipeline** (build, tag/version, push) per DECISION-005.
   - Output: `.github/workflows/*.yml`; a published versioned image.
5. **Document Portainer deployment** (stack definition, volume, env vars, how to update the image tag).
   - Output: `docs/deploy-portainer.md`.
6. **Update context files.**
7. **Present summary to user and, after validation, generate the next phase launch prompt** (Phase 7 — End-to-end validation & hardening).

### Deliverables to the user

- A versioned image on GHCR, an automated build, and a Portainer deployment guide.
- The Phase 7 launch prompt, ready to paste.

### Risks / open questions at phase entry

- Secret handling in the image/compose must not bake credentials into layers — define the env/volume approach explicitly.
- CI must authenticate to GHCR with the right token scopes; a misconfigured workflow fails silently on push.

---

## Phase 7 — End-to-end validation and hardening

- **Run in**: Code + Cowork
- **Goal**: Prove the full chain works on real hardware against the live API, then close the gaps that only show up in production.
- **Prerequisites**: Phase 6 image deployed and runnable; ESP32 hardware available.

### Steps

1. **Resume check.** Read context files. Review what has been deployed and tested. State resume point.
2. **Run the end-to-end scenario** (Cowork-driven test plan in French): scan a real product → appears in the correct list and/or cart; scan unknown EAN → handled per CLARIFY-01; out-of-stock / ineligible cases.
   - Output: a recorded test report.
3. **Exercise the failure paths**: token expiry → silent refresh; 72h session expiry → full re-login; simulated API error → detection + maintenance page + notification.
   - Output: validated resilience behaviors.
4. **Harden** based on findings: rate-limit/delay between bulk scans (spec §8), HAR sanitization script (spec §8), log rotation if JSON-file storage was chosen, secret-at-rest verification.
   - Output: hardening changes + tests.
5. **Run the spec verification checklist** (`contract.md` §6 / §7.4) against the live API and record `x-api-version` values.
   - Output: updated `contract.md` verification dates.
6. **Final context update.** Mark the project as released in `PROJECT_CONTEXT.md`; record the verification baseline.
7. **Initialize the iterative maintenance loop.** Create `BACKLOG.md` and `BACKLOG_ARCHIVE.md` (empty, with their headers and entry schema), and confirm the three reusable loop prompts defined in the section below are ready to use.
8. **Present summary to user and, after validation,** hand off to the **Iterative maintenance loop** (next section). This is the terminal build phase: from here, work is driven by the three reusable loop prompts, not by new build-phase prompts.

### Deliverables to the user

- A validated, hardened, deployed system with a recorded end-to-end test report.
- Updated spec verification baseline.
- An initialized `BACKLOG.md` + `BACKLOG_ARCHIVE.md` and the three loop prompts, ready to use.

### Risks / open questions at phase entry

- Live testing depends on the real Chronodrive account and CGU risk (spec §8) — keep volumes low to avoid account flags.
- Some failure paths (key rotation, schema drift) cannot be triggered on demand; validate the _detection_ logic with mocks, accept that live confirmation waits for a real incident.

---

## Iterative maintenance loop (post-Phase 7)

Once the initial build is delivered, development no longer follows numbered phases. It follows a **continuous loop**: the user shares remarks and improvements, those are triaged into a clean, prioritized backlog, batches are developed one at a time, and completed work is archived. The loop is driven by three reusable prompts and two files.

### The two files

**`specifications/BACKLOG.md`** — the active backlog, **kept clean**: it contains only items not yet developed. Items are organized into priority-ordered batches (top batch = next to develop). When an item is shipped, it leaves this file.

**`specifications/BACKLOG_ARCHIVE.md`** — append-only history of shipped items, for reference. An item moves here when its batch is completed, keeping its full spec plus what was actually done, the date, and the commit/PR reference.

### Backlog entry schema

Every backlog item is captured with **everything needed to develop it without re-asking the user**:

```
### [BL-NNN] Short imperative title
- Type: Bug | Evolution
- Priority: P0 (critical / breaks core flow) | P1 (high) | P2 (normal) | P3 (nice-to-have)
- Status: Triaged | Batched | In progress | Done
- Source: user remark (YYYY-MM-DD) | verification check | incident
- Spec impact: none | contract.md §X | PROJECT_CONTEXT.md | decisions.md (DECISION-XXX)
- Affected files / areas: <paths or subsystems>
- Description: what is wrong or wanted, and why (plain language)
- Change to make: the concrete development work — enough detail to implement directly
- Acceptance criteria: how we confirm it is done
- Batch: BATCH-X | standalone
- Dependencies: BL-NNN, … (or none)
```

### Spec-update rule (when do the spec files change?)

A change's _need_ to touch the spec is **flagged at triage** (the `Spec impact` field). The actual edit happens **when the item is developed**, so spec and code stay in sync — **except** corrections to `contract.md` (the Chronodrive API contract). Because that file records observed reality, not intent, an API correction is written immediately at triage, following the process in `contract.md` §7.

### Batching rule

Items are grouped into a batch when they touch the same area, the same files, or the same subsystem, so a batch can be developed and tested coherently in one pass. Grouping is **proposed by the assistant and confirmed by the user** — never decided alone. A change with no natural neighbours is a `standalone` (single-item) batch.

---

### Loop prompt 1 — Intake & triage (user shares remarks)

```
Run in: Cowork

Cross-cutting rules (apply without exception):
1. Never decide alone — present options with plain-language impacts; the user chooses.
2. Plain language only — no jargon lists; say what each choice means in practice.
3. All artifacts (backlog entries, specs, code) in English. Discussion in French.
4. No code in this prompt — triage only.
5. Update PROJECT_CONTEXT.md / decisions.md / contract.md per the spec-update rule.

## Resume check
Before anything else:
- Read PROJECT_CONTEXT.md, decisions.md, api/chronodrive/contract.md, BACKLOG.md, BACKLOG_ARCHIVE.md.
- Summarize the current backlog state: batches, priorities, top batch.
- State: "Ready to take new remarks."

## Goal
Turn the user's free-form remarks and improvement ideas into clean, fully-specified backlog entries, grouped into coherent batches and sorted by priority.

## Steps
1. The user pastes one or more remarks (in French). For EACH remark:
   a. Discuss in French to remove ambiguity — ask only what is necessary.
   b. Classify: Bug or Evolution.
   c. Propose a priority (P0–P3) with a one-line justification; the user confirms.
   d. Determine spec impact (none / contract.md §X / PROJECT_CONTEXT.md / decisions.md). If it is a contract.md correction, apply it now per contract.md §7; otherwise just flag it.
   e. Capture ALL development info into the entry schema: affected files, the concrete change to make, acceptance criteria.
   f. Propose grouping: attach to an existing batch (same area/files/subsystem) or create a new batch or mark standalone. The user confirms.
2. Write/update BACKLOG.md: insert the new entries, re-group batches so each stays coherent, re-sort batches by priority (top = next to develop). Keep the file clean — no done items here.
3. Update PROJECT_CONTEXT.md / decisions.md only as required by the spec-update rule.

## End of prompt
- Present a summary: what was added, to which batches, at which priority; what the new top batch is.
- Ask the user: anything to re-classify, re-prioritize, or re-group?
- After validation, remind the user that the next action is to run Loop prompt 2 on the top batch (do not start development here).
```

---

### Loop prompt 2 — Develop the top batch

```
Run in: Code

Cross-cutting rules (apply without exception):
1. Never decide alone — present the approach and options first.
2. Plain language with the user; discussion in French.
3. All artifacts in English.
4. No code before the approach is explicitly approved.
5. Update PROJECT_CONTEXT.md / decisions.md / contract.md as the work requires.

## Resume check
Before anything else:
- Read PROJECT_CONTEXT.md, decisions.md, api/chronodrive/contract.md, BACKLOG.md, BACKLOG_ARCHIVE.md.
- Identify the top batch (highest priority, top of BACKLOG.md).
- Inspect whether any of its items are already partially implemented. State: "Resuming batch X at item Y" or "Starting batch X from the beginning."

## Goal
Develop and ship the top batch of BACKLOG.md, then archive it, keeping BACKLOG.md clean.

## Steps
1. Read every item in the top batch. Present a single implementation plan covering the whole batch (files to touch, order, tests, any spec edits the items flagged). Wait for explicit approval.
2. Implement the items. Apply the spec edits flagged in each item (contract.md / PROJECT_CONTEXT.md / decisions.md) as part of the work.
3. Test: cover each item's acceptance criteria. Do not declare done while tests fail or implementation is partial.
4. On success, move every completed item OUT of BACKLOG.md and INTO BACKLOG_ARCHIVE.md, appending: date shipped, what was actually done, commit/PR reference. BACKLOG.md must no longer contain these items.
5. Update PROJECT_CONTEXT.md (and decisions.md if an implementation decision was made).

## End of prompt
- Present a summary: what shipped, what moved to archive, the new top batch.
- Ask the user: anything to verify or change before closing the batch?
- After validation, remind the user they can run Loop prompt 2 again on the next batch, or Loop prompt 1 to add new remarks.
```

---

### Loop prompt 3 — Operations & backlog grooming (periodic / scheduled)

This is the prompt Phase 7 hands off to. Run it on a cadence (e.g. monthly) or after any suspected Chronodrive change.

```
Run in: Code + Cowork

Cross-cutting rules (apply without exception):
1. Never decide alone. 2. Plain language; discussion in French. 3. English artifacts.
4. No code without approval. 5. Keep spec files in sync.

## Resume check
- Read PROJECT_CONTEXT.md, decisions.md, api/chronodrive/contract.md, BACKLOG.md, BACKLOG_ARCHIVE.md.
- State the current backlog state and the date of the last spec verification.

## Goal
Keep the system and the backlog healthy: re-verify the Chronodrive API against the spec, and groom the backlog so it stays clean, coherent, and correctly prioritized.

## Steps
1. Run the verification checklist (contract.md §6 / §7.4) against the live API. Record observed x-api-version values and update contract.md verification dates. For any breakage detected, create a P0 Bug entry in BACKLOG.md using the entry schema (this re-enters Loop prompt 1's triage flow for that item).
2. Groom BACKLOG.md: re-sort batches by priority, re-group for coherence, flag stale or duplicate items, and confirm each remaining item still carries enough dev info. Propose changes; the user confirms — never re-prioritize or delete alone.
3. Update PROJECT_CONTEXT.md / decisions.md / contract.md as required.

## End of prompt
- Present a summary: verification result, any new P0 items, grooming changes.
- Ask the user: anything to adjust?
- After validation, remind the user of the next action (run Loop prompt 2 on the top batch, or Loop prompt 1 for new remarks).
```

---

### How the loop fits together

```
        user remarks ─────► Loop 1 (triage)  ──┐
                                                ├──►  BACKLOG.md (clean, prioritized, batched)
  periodic / incidents ──► Loop 3 (ops/groom) ─┘            │
                                                            ▼
                                              Loop 2 (develop top batch)
                                                            │
                                                            ▼
                                                   BACKLOG_ARCHIVE.md
```

The Chronodrive API is private and will change without notice; the standing detect-and-patch process lives in `contract.md` §7, and the maintenance page built in Phase 5 is the user-facing front door to it. Loop prompt 3 is what runs that process on a schedule and feeds any breakage back into the backlog as a P0 item.
