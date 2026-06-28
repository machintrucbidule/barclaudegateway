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
> Last updated: 2026-06-28 (**BATCH-10 shipped** — BL-012 in-gateway price tracking & HA alerts + a UI
> page, DECISION-026; moved to `BACKLOG_ARCHIVE.md`. The new top batch is **BATCH-11** (wiring, ops,
> YAML/HA, docs & tests) — the final batch of the epic. **DECISION-027**: the whole epic is ONE
> user-triggered **0.3.0** release — no per-batch version bumps — and the exposed contracts are
> stability-first. Develop it via loop prompt 2.)

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
> already captured in `contract.md` v1.5.0 (HAR 2026-06-28). Batches are priority-ordered; **BATCH-11 is
> the next to develop** (BATCH-7/8/9/10 shipped — see `BACKLOG_ARCHIVE.md`) — the final batch. Develop one
> batch per loop-2 run.
>
> **Cross-cutting acceptance (every batch in this epic):** each new exchange — both an **upstream
> Chronodrive** client call and an **inbound local-API** request served — emits a `LogEvent` that is
> visible and filterable on the `/logs` (Logs techniques) page, clearly identified as **API Chronodrive**
> vs **API interne** (relies on the BL-008 taxonomy extension). `auth_mode` lazy/keepalive behaviour
> (DECISION-021) must be preserved: a local read that needs Chronodrive triggers an on-demand login in
> lazy mode, but no new background/polling call may run while idle (except the BATCH-10 price scheduler,
> which is itself gated/opt-in).

---

## BATCH-11 — Wiring, ops, YAML/HA, docs & tests (P2) — top batch, next to develop

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
