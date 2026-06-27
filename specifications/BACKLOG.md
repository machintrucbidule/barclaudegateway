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
> Last updated: 2026-06-27

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

## BATCH-1 — Hardware validation (top batch, P1)

### [BL-001] Validate the full scan flow on real ESP32 hardware

- Type: Evolution
- Priority: P1 (high)
- Status: Triaged
- Source: verification check (Phase 7, 2026-06-27 — ESP32 module not yet received)
- Spec impact: none expected (confirm `docs/esphome-contract.md` against the real firmware behaviour)
- Affected files / areas: ESP32/ESPHome firmware, `docs/esphome-contract.md`, `POST /v1/scan`
- Description: Phase 7 proved every `ScanResponse` state end-to-end against the real Chronodrive API
  using direct HTTP calls, because the ESP32 + GM65/GM861 scanner had not arrived. The physical
  half — a real barcode scan driving the LED + buzzer feedback off the `status` field — has not yet
  been observed on hardware.
- Change to make: flash the ESPHome firmware per `docs/esphome-contract.md`, point it at the deployed
  middleware, scan real products covering `added`, `added_to_lists_only`, and `not_found`, and
  confirm the LED colour + buzzer pattern matches the contract for each state. Correct
  `docs/esphome-contract.md` if the real firmware mapping differs.
- Acceptance criteria: each of the three states, triggered by a physical scan, shows the documented
  LED/buzzer feedback and the matching dashboard log entry; `docs/esphome-contract.md` reflects what
  the firmware actually does.
- Batch: BATCH-1
- Dependencies: none (waiting on hardware)

---

## BATCH-2 — First-run ergonomics (P2)

### [BL-002] Assisted master-key generation on first run

- Type: Evolution
- Priority: P2 (normal)
- Status: Triaged
- Source: user remark (2026-06-27)
- Spec impact: decisions.md (DECISION-008 — would refine, not reverse, the env-injected key model)
- Affected files / areas: `packages/backend/src/config/env.ts`, `packages/backend/src/main.ts`,
  `docs/deployment.md`
- Description: today the operator must generate `BCG_MASTER_KEY` themselves (`openssl rand -hex 32`)
  and inject it before the first boot, which the user found rough. The key must stay env-injected and
  never be written to disk (that separation is what protects the encrypted credentials — DECISION-008),
  so it cannot simply be auto-persisted.
- Change to make: when `BCG_MASTER_KEY` is absent on first boot, instead of only hard-failing, generate
  a candidate 32-byte key and print it once to the logs with a clear instruction to copy it into the
  environment variable and restart — **without ever writing it to `/data` or the DB**. Keep the
  hard-fail-to-start behaviour (the app still does not run until the key is set in the environment).
- Acceptance criteria: starting the container with no `BCG_MASTER_KEY` prints a ready-to-use generated
  key plus instructions and exits non-zero; setting that key in the env and restarting brings the app
  up; the key is never found in `/data` or the DB; `docs/deployment.md` documents the assisted flow.
- Batch: BATCH-2
- Dependencies: none
