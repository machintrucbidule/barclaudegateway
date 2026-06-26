Run in: Code

# BarclaudeGateway — Phase 5: API error detection, maintenance page, HAR debug tutorial & proactive Home Assistant alert

## Cross-cutting rules (apply without exception, all phases)
1. Never decide alone. Surface options with plain-language impacts; the user chooses.
2. Plain language only. No jargon, no technical bullet lists. Say what each choice means in
   practice — what it costs, what it gains, what it risks.
3. All artifacts (code, docs, config, variable names, comments, commit messages) in English.
4. All discussion with the user is in French.
5. No code before the approach is approved. Present the plan → wait for explicit go-ahead → implement.
6. This phase ends with its own validation gate before generating the Phase 6 launch prompt.
7. PROJECT_CONTEXT.md and decisions.md are updated at the end of the phase (and contract.md if any
   live API observation needs correcting per its §7 process).

## Resolved decisions this phase depends on (do not re-open)
- Error taxonomy: **`ErrorCategory`** (DECISION-008) lives in `@barclaudegateway/shared`
  (`auth` / `api_key` / `schema` / `not_found` / `rate_limit` / `server` / `network` / `timeout` /
  `unknown`), mapped to contract.md §7.1. Every Chronodrive failure already carries a `category`
  (`ChronodriveError.category`); scans expose it via `ScanResponse.category`; the health self-test
  reports per-endpoint `EndpointCheck.status`. **Phase 5 turns these into UI states + alerts — it does
  not invent a new taxonomy.**
- Frontend stack: **React + Vite + Mantine + react-router** (DECISION-004/011), sharing contract types
  via `@barclaudegateway/shared`. Web UI is **local-only, no application authentication**.
- Real-time: **SSE** over an in-process `ScanEventBus` (DECISION-012). The pipeline publishes a
  `ScanEvent` (full `ScanResponse` + timestamp) at every journalled outcome; the Logs page consumes it.
- Storage: SQLite + generic `config` key/value table (DECISION-003/008). Static config is editable in
  the Phase 4 UI without redeploy. **The HA webhook URL is a NEW config key added this phase** (it was
  deliberately deferred from Phase 4, CLARIFY-05) — store it like the other config values.
- **Not-found alert** (CLARIFY-01) already ships on the Phase 4 dashboard. It is the seed of the
  error-surface; Phase 5 generalises the surface to all critical categories.
- **HA webhook on critical API error** (CLARIFY-05): on a critical failure, call a Home Assistant
  webhook whose URL is configured in the UI. Mosquitto/HA are confirmed present in the homelab.
- **HAR debug workflow** (CLARIFY-06): the maintenance page ships in v1 with a **Firefox HAR capture
  tutorial** + a **ready-to-paste Claude debug prompt**.

## What earlier phases already provide (reuse — do not rebuild)
In `packages/backend/src`:
- `http/errors.ts` — the `ChronodriveError` taxonomy (`category`, `status`, `endpoint`).
- `health/selfTest.ts` `runHealthSelfTest(client)` → `HealthReport { ok, siteId, checks:
  EndpointCheck[], apiVersions, checkedAt }`. Exposed at `GET /api/health` and `GET /health`.
- `ingest/scanEvents.ts` `ScanEventBus` (`publish` / `subscribe`) — already wired through the pipeline;
  the live error signal can hang off the same bus.
- `ingest/pipeline.ts` — produces `ScanResponse` with `category` on `error`/`partial`.
- `storage/config.ts` `ConfigStore.get()/set()`, `config/defaults.ts` (`AppConfig`, `CONFIG_KEYS`,
  `appConfigToEntries`/`appConfigFromMap` — add the webhook key here, mirroring how `site_id` was added
  in Phase 4).
- `http/apiRoutes.ts` — the `/api` plugin (`GET/PUT /api/config`, `/api/scans`, `/api/scans/stream`
  SSE, `/api/health`, …). Phase 5 extends `ApiConfig`/`ConfigResponse` and adds any new routes here.
- `ingest/server.ts` `buildServer(deps)` — serves the SPA + API; the maintenance surface is part of the
  same app/UI.
In `packages/frontend/src`:
- `pages/ConfigPage.tsx` (the config editor — add the HA webhook URL field here),
  `pages/DashboardPage.tsx` (health card + the existing not-found alert),
  `components/StatusBadge.tsx`, `api/client.ts` (typed fetch wrappers), the Mantine + react-router
  shell in `App.tsx`/`main.tsx`.
Shared types in `@barclaudegateway/shared`: `ErrorCategory`, `ScanResponse`, `ScanEvent`, `HealthReport`,
`EndpointCheck`, `ApiConfig`, `ConfigResponse`.

## Scope guardrails for THIS phase
- **Error detection + maintenance page + HAR tutorial + embedded Claude prompt + HA webhook ONLY.**
- **No Docker / deployment / GHCR** (Phase 6, DECISION-005).
- The HA webhook URL is the single new config field; reuse the Phase 4 `config` storage and config
  page — do not invent a second settings store.
- Reuse the existing `ErrorCategory` taxonomy and `HealthReport`; classify, don't re-taxonomise.
- **Credentials stay write-only** (contract.md §8); secrets never logged or sent to the browser or to
  the HA webhook payload (EANs/labels/categories are allowed; tokens/passwords are not).
- No real credentials in the repo. Tests mock the backend boundary (undici `MockAgent`, `fastify.inject`,
  React Testing Library + jsdom). Any live trial uses the git-ignored `.env`, minimal calls
  (CGU risk, contract.md §8).

## Resume check (do this first)
Before anything else:
- Read, in full:
  - specifications/PROJECT_CONTEXT.md
  - specifications/decisions.md  (esp. DECISION-008/010/011/012/013, CLARIFY-01/05/06)
  - specifications/api/chronodrive/contract.md  (§7 error/version monitoring, §8 security)
  - docs/esphome-contract.md  (the `status`/`category` contract the error surface mirrors)
- Inspect what Phase 4 shipped: `http/apiRoutes.ts`, `health/selfTest.ts`, `ingest/scanEvents.ts`,
  `ingest/pipeline.ts`, `storage/config.ts`, `config/defaults.ts`; on the UI side `pages/*`,
  `api/client.ts`, `components/StatusBadge.tsx`.
- Inspect for any already-built Phase 5 work: an error monitor / last-error store, a `/maintenance`
  route or maintenance banner, an `ha_webhook_url` config key, a webhook notifier, a HAR tutorial page.
- State clearly: "Resuming from step X" or "Starting from the beginning." Do not redo finished work.

## Goal
Make a Chronodrive-side breakage visible and actionable without reading logs:
1. **Detect** critical API errors (from the health self-test and/or live scan failures), classified by
   the existing `ErrorCategory`.
2. **Surface** them: a maintenance/error page (or banner) that names what broke in plain French and
   carries a **Firefox HAR capture tutorial** + a **ready-to-paste Claude debug prompt** prefilled with
   the observed error context.
3. **Notify proactively**: on a critical error, POST to a **Home Assistant webhook** whose URL is a new
   config field, so the user is told even when not looking at the UI.

## Steps (walk in order; for each decision, ask in French and wait)

1. **Resume check** (above). Output: a stated list of what is done vs remaining.

2. **Present the design and wait for approval.** In plain French, lay out and ask:
   - **What counts as a "critical" error** (the trigger for both the maintenance state and the HA
     webhook). Present the trade-off: e.g. `auth` / `api_key` / `schema` / `server` / `network` /
     `timeout` are infrastructure breakages worth alerting; `not_found` / business outcomes are NOT.
     The user chooses the exact set.
   - **How errors are detected** — options with impacts: (a) a periodic background health self-test on
     a timer (catches breakage even with no scans, costs minimal recurring API calls); (b) reacting to
     live scan failures via the `ScanEventBus` (zero extra calls, but only sees errors when someone
     scans); (c) both. The user chooses.
   - **How the maintenance state is surfaced** — a dedicated `/maintenance` route vs a persistent banner
     on every page vs a dashboard panel; and whether it auto-clears when health recovers or needs an
     acknowledge. User chooses.
   - **The HA webhook** — when it fires (every error vs once per incident with a debounce/cooldown),
     the payload shape (category, endpoint, message, timestamp — no secrets), and a "send test" button
     in the config page. User chooses the firing policy.
   - **The HAR tutorial + embedded Claude prompt** — confirm Firefox-specific capture steps and the
     exact prefilled debug-prompt text (what error context it embeds: category, endpoint, observed
     `x-api-version`, timestamp).
   Output: an approved design note. No code before this approval.

3. **Add the HA webhook URL to config.** Extend `AppConfig`/`CONFIG_KEYS`/`appConfigToEntries`/
   `appConfigFromMap` (mirror the Phase 4 `site_id` addition) with an optional `ha_webhook_url` (empty
   by default). Extend `ApiConfig`/`ConfigResponse` in shared and the `GET/PUT /api/config` validation.
   Add the field to `ConfigPage.tsx`. Output: round-trip test for the new key.

4. **Implement error detection + classification.** A small in-process error monitor that records the
   latest critical error (category, endpoint, message, `x-api-version`, timestamp) from the chosen
   source(s) — periodic self-test and/or the `ScanEventBus` — and exposes it via a new
   `GET /api/error-state` (and ideally pushes changes over SSE). Map strictly through `ErrorCategory`.
   Output: route + tests; never persist or emit secrets.

5. **Implement the HA webhook notifier.** On a newly-detected critical error (per the chosen firing
   policy + cooldown), POST the secret-free payload to `ha_webhook_url` if set. Add the config-page
   "send test" action. Output: notifier + `MockAgent` test (fires once per incident, respects cooldown,
   no-op when the URL is empty, never includes secrets).

6. **Implement the maintenance/error page (UI).** A page/route (or banner) that, when a critical error
   is active, shows in plain French what broke, plus the **Firefox HAR capture tutorial** and the
   **ready-to-paste Claude debug prompt** prefilled with the observed error context (a copy button).
   Reuse `StatusBadge`/`ErrorCategory`; fold in the existing not-found alert as one case of the surface.
   Output: components + React Testing Library tests (render on an active error, copy-prompt present,
   recovery clears the surface).

7. **Wire it together end-to-end.** Confirm a classified backend error reaches the maintenance surface
   and (when configured) the HA webhook; keep live Chronodrive calls out of CI.

8. **Update context files.** Record the critical-error policy, detection mechanism, maintenance-surface
   choice, webhook payload/firing policy, and the new `ha_webhook_url` key in PROJECT_CONTEXT.md and
   decisions.md (DECISION-014+). Apply any contract.md §7 correction if a live call contradicts the spec.

9. **Keep the gates green.** `npm run lint && npm run format:check && npm run typecheck && npm run test
   && npm run build` pass locally and in CI before declaring done.

## Validation gate (end of phase)
1. Present a summary in French of everything produced (error detection, maintenance page, HAR tutorial,
   embedded debug prompt, HA webhook + config field, tests, decisions logged).
2. Ask the user: anything to change, add, or challenge?
3. Wait for explicit go-ahead.
4. ONLY THEN: generate and print the **Phase 6 launch prompt** (Docker packaging + GitHub Actions →
   GHCR deployment, DECISION-005/007: Docker is never built/tested on Windows, CI publishes the image;
   resolve GHCR authentication / PAT scopes), fully self-contained (Run in: Code, cross-cutting rules,
   resolved decisions, scope guardrails, resume check, steps, validation gate), per ROADMAP Phase 6.
   Carry forward: the single-origin Fastify-serves-the-SPA model (DECISION-011) and `BCG_*` env vars
   (`BCG_MASTER_KEY`, `BCG_DB_PATH`, `BCG_PORT`, `BCG_HOST`, optional `BCG_UI_DIR`) become the
   container's runtime contract; the SQLite file + master key are the only persistent state to mount.
