Run in: Code

# BarclaudeGateway — Phase 2: Core backend — auth engine, token lifecycle & Chronodrive API client

## Cross-cutting rules (apply without exception, all phases)
1. Never decide alone. Surface options with plain-language impacts; the user chooses.
2. Plain language only. No jargon, no technical bullet lists. Say what each choice means in
   practice — what it costs, what it gains, what it risks.
3. All artifacts (code, docs, config, variable names, comments, commit messages) in English.
4. All discussion with the user is in French.
5. No code before the approach is approved. Present the plan → wait for explicit go-ahead → implement.
6. This phase is split into sub-phases (2.1 → 2.2 → 2.3). Each ends with its own validation gate
   before moving to the next. The final gate generates the Phase 3 launch prompt.
7. PROJECT_CONTEXT.md and decisions.md are updated at the end of the phase (and contract.md if any
   API observation needs correcting per its §7 process).

## Resolved decisions this phase depends on (do not re-open)
- Backend: Node.js / TypeScript (DECISION-002).
- Storage: SQLite single file, credentials AES-256 at rest, bounded scan-log retention (DECISION-003).
- Monorepo: npm workspaces — `packages/{shared,backend,frontend}` (DECISION-006).
- Dev tooling: npm workspaces, strict TS, ESLint+Prettier, Vitest, Husky, exact-pinned deps,
  Node 24 LTS, checks-only CI (DECISION-007). Backend work lives in `packages/backend`; shared
  Chronodrive contract types go in `packages/shared` so the frontend can reuse them later.
- Chronodrive auth = Reach5 PKCE 3-step flow; silent refresh (~2h) reuses the `__Host-SESSION`
  cookie; full re-login (~72h or on `login_required`) replays all 3 steps. Per-service static
  `x-api-key`s; `x-api-version` response header signals Chronodrive backend deploys.

## ⚠️ Phase 2 caveat — verify BEFORE committing to an HTTP client
The `__Host-SESSION` cookie is **HttpOnly** and appears **only in the Step-2 response `Set-Cookie`
header**, never in any JSON body. Some HTTP clients hide or strip raw `Set-Cookie` headers.
**Before writing the auth engine, prove the chosen client exposes raw `Set-Cookie` headers** (and
lets you send the cookie back on later requests). If it cannot, pick another client. Treat this as a
go/no-go gate on the library choice, surfaced to the user in plain French (contract.md §2.4).

## Scope guardrails for THIS phase
- Backend only. No frontend/UI work (Phase 4), no ESP32 ingestion endpoint (Phase 3), no Docker
  (Phase 6).
- No real credentials in the repo. Tests mock HTTP; any live trial uses local-only secrets that are
  never committed (`.env*` is git-ignored). Keep live calls minimal — CGU/account-flag risk (§8).
- Secrets never logged. Tokens, passwords, cookies and the HAR-able payloads must be sanitized out
  of any log or error message (§8).

## Resume check (do this first)
Before anything else:
- Read, in full:
  - specifications/PROJECT_CONTEXT.md
  - specifications/decisions.md
  - specifications/api/chronodrive/contract.md  (§2 auth, §3 keys, §4 headers, §5 endpoints,
    §7 verification, §8 safety — all central this phase)
- Inspect `packages/backend/src` and `packages/shared/src` for any already-built auth/lifecycle/
  client modules, types or tests.
- State clearly which sub-phase/step is the first incomplete one, and: "Resuming from sub-phase X,
  step Y" or "Starting from the beginning." Do not redo finished work.

## Goal
A tested backend module that authenticates against Chronodrive, keeps the token alive on its own,
and exposes typed methods for every confirmed API operation — with secrets encrypted at rest and a
read-only health self-test. No HTTP server wiring beyond what the tests need; the ingestion endpoint
is Phase 3.

## Steps (walk in order; for each decision, ask in French and wait)

1. **Resume check** (above). Output: a stated list of what is done vs remaining.

2. **Present the backend design and wait for approval.** In plain French, lay out:
   - module boundaries (`auth/`, `chronodrive/` client, `storage/` for secrets, `health/`);
   - the HTTP-client choice **with the Set-Cookie verification result** (the caveat above) — show
     the user the trade-off and the proof before committing;
   - the error model (how API failures are classified for Phase 5 later), retry/backoff policy,
     and where secrets live (SQLite + AES-256 per DECISION-003);
   - which values are dynamic (site_id, list UUIDs) vs static (per-service keys).
   Output: an approved design note. No code before this approval.

3. **Sub-phase 2.1 — Auth engine.** Implement the 3-step PKCE login:
   - PKCE pair generation; Step 1 `POST /identity/v1/password/login` → short-lived `tkn`;
   - Step 2 `GET /oauth/authorize?prompt=none&tkn=...` → capture `__Host-SESSION` from raw
     `Set-Cookie` + parse the inline auth code from the HTML response;
   - Step 3 `POST /oauth/token` → `access_token`.
   - Silent refresh (Steps 2+3 using the stored cookie) and full re-login fallback (Steps 1+2+3).
   - Output: `packages/backend/src/auth/*` + unit tests (mock HTTP), covering capture + both flows.
   - Sub-phase validation gate (summary in French → wait → proceed to 2.2).

4. **Sub-phase 2.2 — Token lifecycle.** In-memory access-token store; scheduled refresh at
   `exp − 60s`; `login_required` → full re-login; AES-256 credential storage in SQLite per
   DECISION-003 (define and confirm the key-management approach with the user); propose the
   scan-log retention thresholds to finalize here or in Phase 4.
   - Output: `packages/backend/src/auth/lifecycle*` + `storage/*` + tests.
   - Sub-phase validation gate (summary in French → wait → proceed to 2.3).

5. **Sub-phase 2.3 — Chronodrive API client.** Typed wrappers for the confirmed operations:
   - per-service `x-api-key` mapping; dynamic `site_id` from `/v1/customers/me`; dynamic list UUIDs
     from `/v1/shopping-lists`;
   - EAN → productId resolution (`/v1/search-suggestions`); cart read/add/remove using **signed
     delta** quantity (+1/−1, 0 removes); shopping-list add/remove via
     `PATCH /v1/shopping-lists/{listId}` (`objectsToAdd`/`objectsToRemove`);
   - surface `isEligible`, `stock` and `x-api-version` so Phase 3/5 can act on them.
   - Output: `packages/backend/src/chronodrive/*` + shared types in `packages/shared` + tests
     (mock HTTP).

6. **Health self-test.** A read-only self-test that exercises each confirmed endpoint per
   contract.md §7.1 (no mutations). Output: `health/*` + test.

7. **Update context files.** Record implementation decisions (HTTP library, retry/backoff, secret
   key management, retention thresholds) in PROJECT_CONTEXT.md and decisions.md (DECISION-008+).
   Apply any contract.md correction via its §7 process if a live call contradicts the spec.

8. **Keep the gates green.** `npm run lint && npm run typecheck && npm run test && npm run build`
   pass locally and in CI before declaring done.

## Validation gate (end of phase)
1. Present a summary in French of everything produced (auth engine, lifecycle, client, health
   self-test, tests, any decisions logged).
2. Ask the user: anything to change, add, or challenge?
3. Wait for explicit go-ahead.
4. ONLY THEN: generate and print the **Phase 3 launch prompt** (Barcode ingestion — ESPHome HTTP
   POST endpoint, scan→cart/list pipeline, rich feedback response contract) — fully self-contained
   (Run in: Code, cross-cutting rules, resolved decisions, scope guardrails, resume check, steps,
   validation gate), per ROADMAP Phase 3. Carry forward: the scan→action pipeline must handle
   found / not-found (CLARIFY-01) / ineligible / out-of-stock, and the response must be rich enough
   for ESPHome LED+buzzer states (CLARIFY-04); "add to cart" is a signed delta (+1), so confirm
   double-scan behavior with the user.
