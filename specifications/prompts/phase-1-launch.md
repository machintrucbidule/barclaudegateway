```
Run in: Code

# BarclaudeGateway — Phase 1: Dev environment setup & repository bootstrap

## Cross-cutting rules (apply without exception, all phases)
1. Never decide alone. Surface options with plain-language impacts; the user chooses.
2. Plain language only. No jargon, no technical bullet lists. Say what each choice means in
   practice — what it costs, what it gains, what it risks.
3. All artifacts (code, docs, config, variable names, comments, commit messages) in English.
4. All discussion with the user is in French.
5. No code before the approach is approved. Present the plan → wait for explicit go-ahead → implement.
6. This phase ends by generating the Phase 2 launch prompt — only after explicit user validation.
7. PROJECT_CONTEXT.md and decisions.md are updated at the end of the phase.

## Resolved Phase 0 decisions this phase depends on (do not re-open)
- Backend: Node.js / TypeScript (DECISION-002).
- Frontend: React + Vite (DECISION-004).
- Storage: SQLite on a Docker volume, credentials AES-256 at rest, log-retention policy (DECISION-003).
- Repo structure: Monorepo, backend + frontend, one Docker build (DECISION-006).
- CI/CD: GitHub Actions (DECISION-005 release model). Two triggers:
    * routine push / PR → checks only (lint + tests),
    * version tag (e.g. v0.0.2, user-initiated) → build + publish the Docker image to GHCR.
- ESP32 → app: HTTP POST (DECISION-001).
- Deployment: single Docker container via Portainer; Cloudflare Tunnel upstream; no in-app TLS/auth.

## Scope guardrails for THIS phase (important)
- Docker is NEVER built or tested on Windows. Windows = development/testing via the npm toolchain only.
- ALL Docker/GHCR work — Dockerfile, image-publish workflow, GHCR credentials, Portainer — is
  **Phase 6**, NOT this phase. Do not create a Dockerfile or an image-publish workflow here.
- This phase's CI is **checks-only**: lint + tests on push/PR. Nothing builds an image.
- The application version starts at **0.0.1**.

## Resume check (do this first)
Before anything else:
- Read, in full:
  - specifications/PROJECT_CONTEXT.md
  - specifications/decisions.md
  - specifications/ROADMAP.md  (Phase 1 section)
- Inspect the repository to see what already exists:
  - Is there a Git repo initialized? A GitHub remote configured?
  - Does package.json / tsconfig / a monorepo workspace config exist? Is the version 0.0.1?
  - Do .gitignore, README.md, CONTRIBUTING.md exist?
  - Is a checks-only CI workflow present under .github/workflows/?
  - Is linter/formatter config present and passing?
- State clearly which of the steps below are already complete, and: "Resuming from step X"
  or "Starting from the beginning." Do not redo finished steps.

## Goal
Stand up the GitHub repository, the Windows 11 dev environment, and all tooling so the first line
of application code (Phase 2) has a clean, conventional home. By the end, the repo skeleton builds
and lints locally via npm, and a checks-only CI runs green on GitHub. No Docker work in this phase.

## Steps (walk in order; for each decision, ask in French and wait)

1. **Resume check** (above). Output: a stated list of which steps are done vs remaining.

2. **Create the GitHub repository.** Decide WITH the user, in plain French:
   - repository name (propose "barclaudegateway"),
   - visibility (private vs public — explain the practical difference: a private repo keeps the
     code closed; either way the Chronodrive credentials are never stored in the code),
   - license (or none),
   - the .gitignore and README baseline.
   Output: GitHub repo created; initial README.md and .gitignore.

3. **Configure the Windows 11 dev environment.** Verify/install the chosen runtime and tooling:
   Node.js LTS, the package manager (propose one and explain the trade-off briefly), Git. (No
   Docker — not used on Windows.) Confirm versions. Document the setup in README.md or
   docs/dev-setup.md. Output: documented, reproducible dev-environment steps.

4. **Lay down the monorepo skeleton** (DECISION-006). Propose the structure first, then create:
   - a workspace layout holding the backend (Node/TS) and the frontend (React + Vite) plus a
     shared place for the Chronodrive contract types (so both sides import the same types),
   - package.json / workspace config (version 0.0.1), tsconfig(s),
   - src/ skeletons.
   Present the proposed tree and wait for approval before writing files.
   (Note: docker/ and the image-publish workflow are intentionally deferred to Phase 6.)
   Output: committed project skeleton matching the monorepo decision.

5. **Define Git workflow conventions** (branch naming, commit message format, and how a release is
   cut: bump version → push a `vX.Y.Z` tag, which in Phase 6 will trigger the image build). Write
   them into CONTRIBUTING.md or the README. Output: CONTRIBUTING.md.

6. **Add a checks-only CI workflow** under .github/workflows/: on push/PR, install deps, run the
   linter and the tests. No image build. Output: a green CI run on GitHub.

7. **Connect the local repo to GitHub and push the bootstrap commit.** Confirm CI runs green.
   Output: first commit on GitHub, passing checks.

8. **Install baseline tooling before any application code:** linter, formatter, editorconfig, and
   (if the user wants) a pre-commit hook. Make them pass on the skeleton, locally and in CI.
   Output: configured, passing linter/formatter.

9. **Update context files.** Record any implementation choices made here (package manager, exact
   monorepo tooling, branch/commit/release conventions) in PROJECT_CONTEXT.md and, where a real
   decision was made, in decisions.md.

## Validation gate (end of phase)
1. Present a summary in French of everything produced (repo, skeleton, conventions, checks-only CI, tooling).
2. Ask the user: anything to change, add, or challenge?
3. Wait for explicit go-ahead.
4. ONLY THEN: generate and print the Phase 2 launch prompt (Core backend: auth engine, token
   lifecycle, Chronodrive API client) — fully self-contained (Run in: Code, resume check, steps,
   validation gate), per the ROADMAP Phase 2 definition and its likely sub-phases (2.1 auth engine,
   2.2 token lifecycle, 2.3 API client). Carry forward the Phase 2 caveat: verify the HTTP client
   exposes raw Set-Cookie headers (`__Host-SESSION`) before committing to it.
```
