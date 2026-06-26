# BarclaudeGateway — Phase 7: End-to-end validation & hardening

## Run in: Code + Cowork
Code drives the system-under-test (the deployed container), the smoke runs, the security/secret review,
the resilience checks, and the code/doc fixes. Cowork is for the human-in-the-loop decisions, the real
ESP32 hardware steps the agent cannot perform, and the final acceptance sign-off.

## Cross-cutting rules (apply without exception, all phases)
1. Never decide alone. Surface options with plain-language impacts; the user chooses.
2. Plain language only. No jargon, no technical bullet lists. Say what each choice means in
   practice — what it costs, what it gains, what it risks.
3. All artifacts (code, docs, config, variable names, comments, commit messages) in English.
4. All discussion with the user is in French.
5. No code before the approach is approved. Present the plan → wait for explicit go-ahead → implement.
6. This phase ends with its own validation gate. As the **final** roadmap phase, its gate concludes the
   project (acceptance + final docs) — it does NOT generate a Phase 8 prompt.
7. PROJECT_CONTEXT.md and decisions.md are updated at the end of the phase (and contract.md per its §7
   process if any live observation corrects the spec).
8. This phase launch prompt lives at `specifications/prompts/phase-7-launch.md` (this file).

## Resolved decisions this phase depends on (do not re-open)
- **The system under test is the published container** (DECISION-005/015): the image
  `ghcr.io/machintrucbidule/barclaudegateway` is **public** on GHCR, tagged `X.Y.Z` + `X.Y` + `latest`,
  built only by CI on a `vX.Y.Z` tag. **Current latest = `v0.0.2`** (`v0.0.1` was the launch, superseded by
  the DECISION-016 fix). Deploy it via the **Portainer/compose stack** (`deploy/stack.yml`,
  Watchtower-enabled, `restart: unless-stopped`) and the operator docs (`docs/deployment.md`).
- **Unconfigured ≠ broken** (DECISION-016): with no credentials saved, the app makes **no upstream call**,
  the health self-test is skipped (`HealthReport.configured: false`), the dashboard shows an informational
  "configure me" card (not the red maintenance banner), and a scan returns the benign `not_configured`
  category. Phase 7 must confirm this first-run behaviour and that configuring credentials brings it online.
- **Single-process, single-origin runtime** (DECISION-011/015): one Fastify process serves the built SPA
  **and** the `/api` + `/v1` routes. No nginx, no second container. Liveness probe = `GET /livez`
  (always 200); `GET /health` is the live Chronodrive readiness self-test (503 when upstream down).
- **Runtime contract = `BCG_*` env vars**: `BCG_MASTER_KEY` (required, 32-byte hex/base64 — absent → hard
  failure, DECISION-008), `BCG_DB_PATH` (default `/data/barclaudegateway.sqlite`), `BCG_PORT` (default
  8090), `BCG_HOST` (default 0.0.0.0), optional `BCG_UI_DIR`. **The SQLite file on the `/data` volume +
  the master key are the only persistent state** — the key is injected at run time, never baked or logged.
- **Node runtime**: backend uses Node 24 built-in `node:sqlite` + Node 24 `undici`/`crypto` (DECISION-008).
- **Write-only credentials & secret-free payloads** (DECISION-013/014, contract.md §8): the UI never reads
  back stored credentials; HA webhook and logs carry **no** tokens/cookies/passwords. Logs are redacted
  (`packages/backend/src/logging/redact.ts`).
- **Live-call caution** (DECISION-008, contract.md): real Chronodrive calls hit a private third-party API
  under the user's own account. Keep live calls **minimal**, use a **git-ignored `.env`** for any
  credential, never commit secrets, and respect the CGU risk (the user accepts it for their own account).
  The error-detection + HAR-diagnosis surface (DECISION-014) is the recovery path if the contract drifts.

## What earlier phases already provide (reuse — do not rebuild)
- A **published, CI-built `v0.0.2` image** and a green pipeline: checks-only `ci.yml`, the tag-triggered
  `release.yml` (GHCR push), and the no-push PR `docker-build.yml`. 152 tests pass.
- **Windows local-test scripts** (`scripts/windows/`): `start-test.bat` (build if needed → run the single
  Node process on `127.0.0.1:8090`, persist a test key + SQLite under git-ignored `.testdata/`, open the
  browser), `stop-test.bat`, `reset-db.bat` (confirmation-gated wipe). Handy to reproduce behaviour on the
  dev box WITHOUT Docker (still never built on Windows).
- The full app: auth engine + token lifecycle + Chronodrive client (Phase 2), the `POST /v1/scan`
  ingestion endpoint with rich `ScanResponse` states + EAN validation + debounce (Phase 3), the
  config/dashboard/logs web UI + SSE stream + write-only credentials (Phase 4), and the ErrorMonitor +
  `/maintenance`/HAR page + Home Assistant webhook (Phase 5).
- Manual live smoke tools (git-ignored `.env`, not in CI): `npm run auth:smoke` and `npm run ingest:smoke`
  (`packages/backend/scripts/`), plus the ESPHome contract (`docs/esphome-contract.md`).
- Deployment artifacts: `Dockerfile`, `.dockerignore`, `deploy/stack.yml`, `docs/deployment.md`.

## Scope guardrails for THIS phase
- **Validation + hardening only.** No new product features. Allowed code changes are **fixes** surfaced by
  the validation (a real bug, a security/secret gap, a resilience hole, a doc error) — each presented and
  approved before implementing (rule 5).
- **Keep the `BCG_*` contract and the single-process/single-origin model intact.** Do not rename env vars,
  add a second container, or introduce a reverse proxy.
- **Docker is still never built or tested on Windows.** The image under test is the CI-built GHCR image,
  run on the Linux homelab (Portainer). Any new image is cut only by a CI tag (e.g. `v0.0.3`) if a fix lands.
- **Secrets never committed or logged.** Real credentials live only in a git-ignored `.env` / the Portainer
  secret. Minimal live calls; respect the CGU caution.
- **Keep every gate green**: `npm run lint && npm run format:check && npm run typecheck && npm run test &&
  npm run build`, plus the CI image build, must stay green through any fix.

## Resume check (do this first)
Before anything else:
- Read, in full:
  - specifications/PROJECT_CONTEXT.md
  - specifications/decisions.md (esp. DECISION-008/011/013/014/015/016 and the live-call caution)
  - specifications/api/chronodrive/contract.md (esp. §7 drift process and §8 secret-free payloads)
  - docs/deployment.md, deploy/stack.yml, docs/esphome-contract.md
  - packages/backend/src/main.ts + config/env.ts (the `BCG_*` contract) and
    packages/backend/src/logging/redact.ts (redaction)
- Inspect for any already-done Phase 7 work: a deployed container running in the homelab, a recorded
  end-to-end smoke result, a security/secret review note, resilience/recovery findings, a started
  `DECISION-017`, an acceptance/operations doc.
- State clearly: "Resuming from step X" or "Starting from the beginning." Do not redo finished work.

## Goal
Prove the **deployed** BarclaudeGateway works end-to-end on real hardware and the real API, harden it
against the failure modes that matter for an always-on homelab service, and leave the project with
honest, complete operator documentation and a clear acceptance sign-off:
1. **Deploy & smoke** the published image in the homelab (Portainer stack) and run a real
   **ESP32 → middleware → Chronodrive** scan, observing the rich `ScanResponse`/LED states.
2. **Secure**: confirm secrets are never baked/logged/read-back, the container runs non-root, the volume +
   master-key model is sound, and the attack surface (local-only behind Cloudflare Tunnel) holds.
3. **Harden**: verify resilience and recovery — container restart, DB persistence across updates, master-key
   loss behaviour, Chronodrive token refresh/expiry, upstream-down handling, and the error/maintenance/HA
   alert path firing correctly.
4. **Finalize**: correct any drift in the docs/contract, log the decisions, and record acceptance.
5. **Initialize the iterative maintenance loop** (ROADMAP Phase 7 §7): create `specifications/BACKLOG.md`
   and `specifications/BACKLOG_ARCHIVE.md` with their headers + the backlog entry schema, and confirm the
   three reusable loop prompts are ready — the post-Phase-7 work is driven by that loop, not new phases.

## Steps (walk in order; for each decision, ask in French and wait)

1. **Resume check** (above). Output: a stated list of what is done vs remaining.

2. **Plan the validation campaign and wait for approval.** In plain French, lay out and ask:
   - **Deploy method for the test** — deploy the `latest`/`0.0.2` image via the Portainer stack on the
     homelab (the real target), vs a throwaway `docker run` on the Linux host. The user chooses; recommend
     the real Portainer stack so the test mirrors production.
   - **Live-call budget** — how many real Chronodrive scans to run (recommend the minimum that proves each
     `ScanResponse` state the user cares about: success-to-cart, success-to-list, not-found, and at least one
     error state). Confirm the git-ignored `.env` / Portainer secret holds the only real credential.
   - **Hardware step ownership** — the agent cannot physically scan; confirm the user (Cowork) performs the
     ESP32 scans and reports the LED/buzzer + UI/log outcomes, while the agent observes via the dashboard
     SSE log, `/health`, and container logs.
   - **Resilience checks to run** — pick from: restart the container (state survives), update the image tag
     (DB persists across a Watchtower/redeploy), simulate a wrong/absent master key (hard-fail is clean and
     loud), simulate Chronodrive down (maintenance surface + HA alert fire, `/livez` stays green so the
     container isn't killed), token expiry → silent refresh. The user chooses the set; recommend all.
   Output: an approved validation plan. No code/fixes before this approval.

3. **Deploy & end-to-end smoke.** Deploy the published image per the approved method. Confirm, in order:
   (a) **first run, before any credentials** — the SPA loads, `GET /livez` is 200, `GET /api/health` returns
   `configured: false`, the dashboard shows the informational "configure me" card (NOT the red banner), and
   `GET /api/error-state` is `{active:false}` (DECISION-016); (b) **after saving credentials** —
   `GET /health` reflects real Chronodrive readiness and config/login works (write-only creds); (c) a
   **real ESP32 scan** flows through to Chronodrive with the correct `ScanResponse` state and LED/buzzer
   feedback, visible live in the dashboard log. Capture each tested state. Output: a smoke report (the
   first-run info state, what was scanned, the observed state, the UI/LED outcome).

4. **Security & secret review.** Verify, with evidence: `BCG_MASTER_KEY` and the DB are never in the image
   (`.dockerignore` + image inspection), never logged (redaction holds across auth/scan/error paths), and
   never read back by the UI (write-only credentials). Confirm the container runs as non-root, the `/data`
   volume permissions are correct, and the local-only/Cloudflare-Tunnel posture (no app auth by design) is
   intact. Surface any gap as an approved fix. Output: a security review note.

5. **Resilience & recovery checks.** Run the approved set. For each, record expected vs observed: container
   restart (config + scan log survive on the volume), image update (DB persists, no migration loss), absent/
   wrong master key (clean hard failure, no silent fallback, encrypted creds unreadable as designed), upstream
   down (maintenance banner + `/maintenance` page + one-per-incident HA webhook fire; `/livez` stays 200 so
   the container is not restart-looped; auto-clear on recovery), token refresh/expiry (silent refresh).
   Output: a resilience report; any defect becomes an approved fix.

6. **Fix what the validation found (if anything).** Each fix: present in French → approve → implement → keep
   all gates green → if it warrants a new image, cut a CI tag (`v0.0.3`+, bump `package.json`) and confirm
   the new image publishes. Apply any contract.md §7 correction only if a live call contradicts the spec.

7. **Finalize docs & context.** Correct any drift found in `docs/deployment.md` / `docs/esphome-contract.md`
   / contract.md. Record the validation outcomes and any new decisions in PROJECT_CONTEXT.md and decisions.md
   (DECISION-017+). Ensure the operator can deploy, back up (DB + master key), update, and recover from the
   docs alone.

8. **Initialize the iterative maintenance loop** (ROADMAP Phase 7 §7). Create
   `specifications/BACKLOG.md` (the active, clean backlog — only not-yet-developed items, in
   priority-ordered batches) and `specifications/BACKLOG_ARCHIVE.md` (append-only shipped history), each
   with its header and the **backlog entry schema** from ROADMAP (`[BL-NNN]` title, Type/Priority/Status/
   Source/Spec impact/Affected files/Description/Change to make/Acceptance criteria/Batch/Dependencies).
   Seed `BACKLOG.md` with any already-known open items surfaced during this phase (each as a proper entry),
   else leave it empty under its headers. Note that the maintenance page's diagnostic prompt already directs
   a detected Chronodrive breakage into `BACKLOG.md` as a **P0 Bug** (Source: incident), so the loop's
   detect-and-patch path is wired end to end. Confirm the three reusable loop prompts (intake/triage,
   develop-a-batch, ops/grooming) are ready to use.

9. **Keep the gates green.** `npm run lint && npm run format:check && npm run typecheck && npm run test &&
   npm run build` and the CI image build all pass before declaring done.

## Validation gate (end of phase = end of project)
1. Present a summary in French of the whole campaign: the end-to-end smoke result (states proven on real
   hardware + API), the security/secret review, the resilience/recovery findings, any fixes made (and the
   image version they shipped in), the initialized `BACKLOG.md` / `BACKLOG_ARCHIVE.md` + the three loop
   prompts, and the final state of the docs/contract/decisions.
2. Ask the user: anything to change, add, or challenge? Is the system accepted for everyday use?
3. Wait for explicit go-ahead.
4. ONLY THEN: record final **acceptance** (a dated note in PROJECT_CONTEXT.md / decisions.md) and confirm the
   project is complete. As the final phase, this gate produces **no further phase prompt** — it hands off to
   the **iterative maintenance loop** (ROADMAP): the three reusable loop prompts + `BACKLOG.md` /
   `BACKLOG_ARCHIVE.md` drive all subsequent work. Carry-forward for ongoing operation: the published GHCR
   image + Portainer stack as the running system, the `BCG_*` runtime contract, the DB-file + master-key
   backup as the only state, write-only credentials (contract.md §8), the live-call caution (minimal calls,
   git-ignored `.env`, CGU risk), and the error/maintenance/HAR-diagnosis path — which logs incidents into
   `BACKLOG.md` as P0 items — as the recovery route if Chronodrive's private API drifts.
