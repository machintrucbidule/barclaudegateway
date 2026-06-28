# BarclaudeGateway — Active Backlog

> The **active** backlog: only items **not yet developed**. Items are organized into priority-ordered
> batches — the top batch is the next to develop (run loop prompt 2 on it). When an item ships, it
> moves to [`BACKLOG_ARCHIVE.md`](./BACKLOG_ARCHIVE.md). Keep this file clean: no done items here.
>
> Driven by the three reusable loop prompts in [`prompts/`](./prompts/):
> [intake/triage](./prompts/loop-1-intake-triage.md) · [develop a batch](./prompts/loop-2-develop-batch.md) ·
> [ops/grooming](./prompts/loop-3-ops-grooming.md). Schema and process: [`ROADMAP.md`](./ROADMAP.md) §
> "Iterative maintenance loop".
>
> Last updated: 2026-06-28 (**BATCH-7 shipped** — BL-008 local API foundation + BL-009 logging taxonomy,
> DECISION-023, app v0.3.0; moved to `BACKLOG_ARCHIVE.md`. The new top batch is **BATCH-8** — develop it
> via loop prompt 2.)

---

## Entry schema

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

---

## Epic: Local Chronodrive query API (DECISION-022)

> Widen the gateway into a **local personal API** (its own "Layer B" contract) querying Chronodrive
> (product, nutrition, price, cart, lists), enabling the macronome integration. Upstream knowledge is
> already captured in `contract.md` v1.5.0 (HAR 2026-06-28). Batches are priority-ordered; **BATCH-8 is
> the next to develop** (BATCH-7 shipped — see `BACKLOG_ARCHIVE.md`). Develop one batch per loop-2 run.
>
> **Cross-cutting acceptance (every batch in this epic):** each new exchange — both an **upstream
> Chronodrive** client call and an **inbound local-API** request served — emits a `LogEvent` that is
> visible and filterable on the `/logs` (Logs techniques) page, clearly identified as **API Chronodrive**
> vs **API interne** (relies on the BL-008 taxonomy extension). `auth_mode` lazy/keepalive behaviour
> (DECISION-021) must be preserved: a local read that needs Chronodrive triggers an on-demand login in
> lazy mode, but no new background/polling call may run while idle (except the BATCH-10 price scheduler,
> which is itself gated/opt-in).

---

## BATCH-8 — Products & nutrition via the local API (P1, Macronome cluster) — top batch, next to develop

### [BL-010] Expose search + product sheet (with nutrition, weight, price, image)

- Type: Evolution
- Priority: P1
- Status: Batched
- Source: user remark (2026-06-28)
- Spec impact: api/local/contract.md; reuses contract.md §5.1/§5.12/§5.12.1/§5.13/§5.14
- Affected files / areas: `packages/backend/src/chronodrive/` (client: add product detail/search/batch
  calls + nutrition-code mapper + image-URL builder), `packages/backend/src/http/` (local routes),
  `packages/shared/src/api/` (product/nutrition DTOs)
- Description: serves UC2/3/4/8 and the macronome "create a food with nutrition auto" path. Both EAN
  paths (keyword search and direct EAN) resolve via upstream `GET /v1/products?searchTerm=`.
- Change to make:
  - Chronodrive client methods for `GET /v1/products/{id}`, `GET /v1/products?searchTerm=`,
    `GET /v1/products?ids=` (Products `x-api-key`).
  - A **nutrition mapper** translating `characteristics.features[]` codes (§5.12.1 essential set) into
    a normalized nutrition object (energy kJ/kcal, fat, saturates, carbs, sugars, fibre, protein, salt,
    Nutri-Score, allergens text, origin), per 100 g (code 563).
  - An **image-URL builder** prefixing `https://static1.chronodrive.com/`.
  - Local endpoints: `GET /api/v1/search?q=` and `GET /api/v1/products/{eanOrId}` returning a
    normalized product DTO (identity, **weight/unitQuantity**, price incl. lastPeriodLowestPrice, stock/
    eligibility, nutrition, ingredients, allergens, image URLs).
- Acceptance criteria: a known EAN returns a normalized product with mapped nutrition + weight + image
  URL; a keyword returns a product page; an unknown EAN returns a clean not-found; the exchange is
  logged as API Chronodrive (upstream) and the inbound call as API interne; tests cover the mapper with
  the two captured samples.
- Batch: BATCH-8
- Dependencies: BL-008, BL-009

---

## BATCH-9 — Cart & lists via the local API (P1)

### [BL-011] Expose cart read/write, lists CRUD, recipe-fill, and a budget/nutrition aggregate

- Type: Evolution
- Priority: P1
- Status: Batched
- Source: user remark (2026-06-28)
- Spec impact: api/local/contract.md; reuses contract.md §5.3/§5.3b/§5.4-5.6/§5.7-5.11
- Affected files / areas: `packages/backend/src/chronodrive/` (cart read incl. non-empty schema + the
  existing add/remove + lists), `packages/backend/src/http/` (local routes), `packages/shared/src/api/`
- Description: serves UC1/5/6/9/10 — read the current cart, push items (by EAN or id, batched), manage
  lists from any device, fill a cart/list from a recipe's ingredient list, and aggregate budget +
  nutrition for the cart.
- Change to make:
  - `GET /api/v1/cart` → normalized cart (line items with product summary + line totals + cart totals
    from §5.3 `amounts`).
  - `POST /api/v1/cart/items` (batch; each item by EAN or id, signed delta per §5.4-5.6),
    `DELETE /api/v1/cart/items/{id}`.
  - `GET /api/v1/lists`, `GET /api/v1/lists/{id}`, `POST|DELETE /api/v1/lists/{id}/items` (idempotent
    add per §5.8/DECISION-019).
  - `POST /api/v1/recipe-fill` → resolve a list of EANs/names (via §5.13/§5.14) into cart/list adds in
    one call.
  - `GET /api/v1/cart/nutrition` (or enrich `/cart`) → sum price + nutrition across the cart (UC10).
- Acceptance criteria: cart read returns items + totals; add/remove mutate the real cart (signed delta);
  lists CRUD works; recipe-fill resolves and adds a multi-item set; the aggregate returns total € +
  summed macros; all exchanges logged + categorized; `auth_mode` lazy still only logs in on demand.
- Batch: BATCH-9
- Dependencies: BL-008, BL-009, BL-010

---

## BATCH-10 — In-gateway price tracking & alerts (P2)

### [BL-012] Price-history store, per-product thresholds, scheduler, and HA webhook alert

- Type: Evolution
- Priority: P2
- Status: Batched
- Source: user remark (2026-06-28)
- Spec impact: api/local/contract.md; decisions.md (DECISION-022); reuses DECISION-014 HA-webhook pattern
- Affected files / areas: `packages/backend/src/storage/` (new price-history + tracked-products tables),
  `packages/backend/src/` (scheduler), `packages/backend/src/health/haWebhook.ts` (reuse notifier),
  `packages/backend/src/http/` (tracking CRUD routes), `packages/frontend/` (tracking UI)
- Description: serves UC7 — the alert logic lives in the gateway (user's choice): historise prices,
  compare to per-product thresholds, notify via a Home Assistant webhook on a drop.
- Change to make: tables for tracked products + price history; a scheduler that periodically reads
  prices (gated so it respects the spirit of lazy mode — opt-in / its own interval) and appends history;
  threshold config per product; reuse `HaWebhookNotifier` to fire a secret-free alert on a qualifying
  drop; local API CRUD (`/api/v1/price-tracking/*`) + a small UI section to manage tracked products and
  view history.
- Acceptance criteria: adding a tracked product records prices over time; a price at/below threshold
  fires exactly one HA alert (cooldown like DECISION-014); the scheduler does not run unbounded calls;
  CRUD + history visible in the UI and logged/categorized.
- Batch: BATCH-10
- Dependencies: BL-008, BL-009, BL-010

---

## BATCH-11 — Wiring, ops, YAML/HA, docs & tests (P2)

### [BL-013] Surface config (paths + API key), update ESPHome/HA YAML, docs, full tests, lazy/keepalive check

- Type: Evolution
- Priority: P2
- Status: Batched
- Source: user remark (2026-06-28)
- Spec impact: PROJECT_CONTEXT.md; docs; api/local/contract.md (finalize)
- Affected files / areas: `packages/frontend/src/pages/ConfigPage.tsx` (API key + new paths/values),
  `firmware/esphome/barclaude-scanner.yaml` + `docs/esphome-contract.md`, `docs/` (deployment/readme),
  test suites across packages
- Description: steps 7-13 of the user's plan — make the new surface usable, observable and documented,
  and prove it end-to-end without regressing lazy/keepalive.
- Change to make:
  - Config UI: show/edit the **local API key** and any new user-relevant values/paths; surface what the
    user must know (base URL, key).
  - **Update the default ESPHome/HA YAML** to call the right local API for search/add, and expose useful
    HA functions beyond add-by-EAN (e.g. add-to-list, price-check) — **start from the user's current
    YAML (ask Ivan for it; do NOT use the one currently in conf)**.
  - Ensure both APIs are wired together and everything runs locally.
  - Update all docs (README, deployment, the two contracts).
  - Complete API tests (backend routes + mappers + frontend), and **verify lazy/keepalive compatibility**
    is preserved across the new endpoints.
- Acceptance criteria: the config page exposes the key + new values; the updated YAML (from Ivan's) adds
  the useful HA functions and works; both APIs communicate; full test suite green; docs current; lazy and
  keep-alive both behave per DECISION-021.
- Batch: BATCH-11
- Dependencies: BL-008..BL-012
