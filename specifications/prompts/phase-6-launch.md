Run in: Code

# BarclaudeGateway — Phase 6: Docker packaging, GHCR CI/CD & Portainer deployment

## Cross-cutting rules (apply without exception, all phases)
1. Never decide alone. Surface options with plain-language impacts; the user chooses.
2. Plain language only. No jargon, no technical bullet lists. Say what each choice means in
   practice — what it costs, what it gains, what it risks.
3. All artifacts (code, docs, config, variable names, comments, commit messages) in English.
4. All discussion with the user is in French.
5. No code before the approach is approved. Present the plan → wait for explicit go-ahead → implement.
6. This phase ends with its own validation gate before generating the Phase 7 launch prompt.
7. PROJECT_CONTEXT.md and decisions.md are updated at the end of the phase (and contract.md if any
   live API observation needs correcting per its §7 process).
8. The phase launch prompt is saved to `specifications/prompts/phase-6-launch.md` (this file); the
   Phase 7 prompt this phase generates is saved to `specifications/prompts/phase-7-launch.md`.

## Resolved decisions this phase depends on (do not re-open)
- **Deployment target: Docker image published to GHCR, deployed via Portainer in the homelab**
  (DECISION-005). CI/CD is **GitHub Actions**: checks-only on push/PR; a **versioned image build +
  push to GHCR on a `vX.Y.Z` git tag**. App version starts at **0.0.1**.
- **Docker is NEVER built or tested on Windows** (DECISION-005/007). The Windows dev box runs the
  Node toolchain only; the image is built **exclusively in GitHub Actions (Linux runners)**. Do not
  run `docker build`/`docker run` locally; author the Dockerfile + workflow and let CI prove them.
- **Single-origin runtime model** (DECISION-011): one Fastify process serves the built SPA
  (`packages/frontend/dist`) **and** the `/api` + `/v1` routes. The container runs that one process —
  no nginx, no second container for the UI.
- **Runtime contract = `BCG_*` env vars**: `BCG_MASTER_KEY` (required, 32-byte hex/base64 — absent →
  hard failure, DECISION-008), `BCG_DB_PATH`, `BCG_PORT` (default 8090), `BCG_HOST`, optional
  `BCG_UI_DIR`. The **SQLite file + the master key are the only persistent state** — everything else
  is rebuildable. The DB file must live on a **mounted volume**; the master key is injected as a
  secret, never baked into the image.
- **Node runtime**: the backend uses `node:sqlite` (Node 24 built-in) and Node 24 `undici`/crypto
  (DECISION-008). The image base must be **Node 24+**.
- **Build tooling**: npm workspaces monorepo; `npm run build` (root) builds shared → backend → frontend
  (DECISION-006/007). The backend serves `packages/frontend/dist`.

## What earlier phases already provide (reuse — do not rebuild)
- `packages/backend/src/main.ts` — the runnable entry point (`node dist/main.js`); reads `BCG_*` via
  `config/env.js` (`loadEnv`), serves the SPA from `resolveUiDir()` (`BCG_UI_DIR` override), listens on
  `BCG_HOST:BCG_PORT`. Prunes the journal on startup + daily; runs the Phase 5 health self-test timer
  and the error monitor / HA webhook notifier.
- `packages/backend/.env.example` — the documented `BCG_*` variables.
- Root `package.json` build scripts (`npm run build` → shared/backend/frontend) and the existing
  GitHub Actions **checks-only** workflow under `.github/workflows/` (lint + format:check + typecheck +
  test + build on push/PR) — Phase 6 **adds** a release workflow, it does not replace the checks one.
- A green test/build pipeline across all three packages (Phase 5 left it passing, 146 tests).

## Scope guardrails for THIS phase
- **Dockerfile + .dockerignore + GHCR release workflow + deployment docs ONLY.** No new app features.
- **No local Docker build/run** (Windows constraint). All image build/test happens in CI.
- **Secrets never baked into the image or logged**: `BCG_MASTER_KEY` and the SQLite DB are injected at
  run time (env var + mounted volume). No real credentials, no `.env`, no DB file in the image or repo.
- **Single process, single origin** — do not split the UI into a separate container or add a reverse
  proxy; Fastify already serves both.
- Reuse the existing checks-only CI; the release workflow is additive and triggers only on version tags.
- Keep the existing `BCG_*` contract intact — do not rename env vars or invent a second config path.

## Resume check (do this first)
Before anything else:
- Read, in full:
  - specifications/PROJECT_CONTEXT.md
  - specifications/decisions.md (esp. DECISION-005/006/007/008/011 and the Phase 5 DECISION-014)
  - packages/backend/.env.example and packages/backend/src/main.ts + config/env.ts (the `BCG_*` contract)
  - root package.json + every package.json (build scripts, `engines`, dependencies)
  - .github/workflows/* (the existing checks-only pipeline) and .gitignore / any existing .dockerignore
- Inspect for any already-built Phase 6 work: a `Dockerfile`, `.dockerignore`, a release/publish
  workflow (tag-triggered GHCR push), a `docker-compose.yml` or Portainer stack file, deployment docs.
- Confirm the Node version the backend needs (`node:sqlite` → Node 24+) and how `npm run build` lays
  out `dist/` for backend and `packages/frontend/dist` for the UI.
- State clearly: "Resuming from step X" or "Starting from the beginning." Do not redo finished work.

## Goal
Ship BarclaudeGateway as a versioned container image, built and published **only by CI**, that the user
can deploy in the homelab via Portainer with the SQLite volume + master key as the sole state:
1. **Package** the single-process app (Fastify serving the SPA + API/scan routes) into a minimal,
   reproducible Docker image — built exclusively on GitHub's Linux runners.
2. **Publish** it to GHCR on a `vX.Y.Z` tag via GitHub Actions, with sound version/cache/auth handling.
3. **Deploy** it: document the Portainer stack (image ref, `BCG_*` env, the persistent DB volume, the
   master-key secret, the exposed port) so the user can run it without guessing.

## Steps (walk in order; for each decision, ask in French and wait)

1. **Resume check** (above). Output: a stated list of what is done vs remaining.

2. **Present the design and wait for approval.** In plain French, lay out and ask:
   - **Image shape** — options with impacts: (a) multi-stage build (a builder stage runs `npm ci` +
     `npm run build`, a slim runtime stage copies only `dist` + production `node_modules` + the built
     SPA) on a slim Node 24 base (smallest, cleanest, the recommended default); (b) single-stage
     (simpler to read, larger image, dev deps shipped). The user chooses; recommend (a).
   - **Base image** — e.g. `node:24-slim` vs `node:24-alpine` (musl can bite native/experimental
     bits like `node:sqlite`; slim is the safe default) vs distroless (smallest, hardest to debug).
     Present the trade-off; the user chooses.
   - **Versioning & tags** — how the image is tagged from a `vX.Y.Z` git tag: exact `X.Y.Z`, plus
     `latest`? plus a moving `X.Y`? Confirm app version source of truth (package.json `0.0.1`) and how
     a release bumps it. The user chooses the tag set.
   - **GHCR authentication** — the workflow authenticates to `ghcr.io` with the built-in
     `GITHUB_TOKEN` (`packages: write` permission) vs a personal PAT. Explain: `GITHUB_TOKEN` is the
     simplest and needs no secret management but ties the package to the repo; a PAT is needed only for
     cross-repo/org pushes. Recommend `GITHUB_TOKEN`. Also: image **visibility** (public vs private
     GHCR package — private means Portainer needs registry creds). The user chooses.
   - **Persistence & runtime** — confirm the DB lives on a **named volume** at `BCG_DB_PATH`, the
     master key is a Portainer **secret/env**, the exposed port, and whether to add a Docker
     **healthcheck** hitting `GET /health`. The user chooses the healthcheck + restart policy.
   - **Deployment artifact** — what we hand the user: a `docker-compose.yml` / Portainer stack snippet
     vs prose docs vs both. The user chooses.
   Output: an approved design note. No code before this approval.

3. **Write the Dockerfile + .dockerignore.** Implement the approved image shape: multi-stage, Node 24+
   base, builds via `npm ci` + `npm run build`, runtime stage carries only what's needed to run
   `node packages/backend/dist/main.js` and serve `packages/frontend/dist`. Run as a **non-root user**.
   Set sane defaults (`BCG_PORT=8090`, `BCG_HOST=0.0.0.0`, `BCG_DB_PATH` under the volume mount,
   `BCG_UI_DIR` pointing at the bundled SPA). The `.dockerignore` must exclude `node_modules`, `.git`,
   `.env`, any `*.db`, tests, and source maps not needed at runtime. **No secrets, no DB file** in the
   image. Output: a Dockerfile that CI can build; a note on the expected image size/layers.

4. **Add the GHCR release workflow.** A new `.github/workflows/release.yml` triggered on `v*` tags:
   checkout → set up Buildx → log in to `ghcr.io` (chosen auth) → build the image on the Linux runner →
   tag per the chosen scheme → push to GHCR, with layer caching (GitHub Actions cache) and the correct
   `permissions:` block. Keep the existing checks-only workflow untouched. Output: the workflow file +
   an explanation of how a release is cut (tag `vX.Y.Z` → image appears in GHCR).

5. **Write the deployment docs / Portainer stack.** Produce the approved artifact: the `BCG_*` env
   block, the persistent **volume** for the SQLite DB, the **master-key** secret injection, the
   published port, the healthcheck/restart policy, and the GHCR image reference (incl. how Portainer
   authenticates if the package is private). Put it under `docs/` (e.g. `docs/deployment.md`) and/or a
   committed stack file. State plainly what is the only persistent state to back up (the DB file + the
   master key). Output: docs a homelab operator can follow without guessing.

6. **Prove it in CI, not on Windows.** Push the branch and let GitHub Actions build the image (a build
   on PR without push, or a dry-run job) so the Dockerfile is validated on Linux. Do **not** run Docker
   locally. If a real release is desired, cut a `v0.0.1` tag and confirm the image lands in GHCR. Keep
   the checks-only pipeline green. Output: a link/sha of the successful CI image build.

7. **Update context files.** Record the image shape, base, tag scheme, GHCR auth + visibility, the
   release-on-tag mechanism, the persistence/secret model, and the deployment artifact in
   PROJECT_CONTEXT.md and decisions.md (DECISION-015+). Apply any contract.md §7 correction only if a
   live call contradicts the spec (none expected this phase).

8. **Keep the gates green.** `npm run lint && npm run format:check && npm run typecheck && npm run test
   && npm run build` pass locally and in CI; the image build passes in CI before declaring done.

## Validation gate (end of phase)
1. Present a summary in French of everything produced (Dockerfile + .dockerignore, GHCR release
   workflow, deployment docs/stack, GHCR auth + image-visibility choice, persistence/secret model,
   the CI proof, decisions logged).
2. Ask the user: anything to change, add, or challenge?
3. Wait for explicit go-ahead.
4. ONLY THEN: generate and save the **Phase 7 launch prompt** to
   `specifications/prompts/phase-7-launch.md` (end-to-end validation and hardening: real
   ESP32→middleware→Chronodrive smoke against the deployed container, security/secret review,
   resilience and recovery checks, final docs), fully self-contained (Run in: Code + Cowork,
   cross-cutting rules, resolved decisions, scope guardrails, resume check, steps, validation gate),
   per ROADMAP Phase 7. Carry forward: the deployed GHCR image + Portainer stack as the system under
   test, the `BCG_*` runtime contract, write-only credentials (contract.md §8), and the live-call
   caution (minimal calls, git-ignored `.env`, CGU risk).
