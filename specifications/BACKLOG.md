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
> Last updated: 2026-06-27 (BATCH-2 shipped → archived; only **BATCH-1** remains, blocked on ESP32
> hardware not yet received — no actionable batch until the module arrives)

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

## BATCH-1 — Hardware validation (P1, blocked — ESP32 not received)

### [BL-001] Validate the full scan flow on real ESP32 hardware

- Type: Evolution
- Priority: P1 (high)
- Status: Triaged
- Source: verification check (Phase 7, 2026-06-27 — ESP32 module not yet received)
- Spec impact: none expected (confirm `docs/esphome-contract.md` against the real firmware behaviour)
- Affected files / areas: `firmware/esphome/barclaude-scanner.yaml`, `docs/esphome-contract.md`,
  `POST /v1/scan`
- Description: Phase 7 proved every `ScanResponse` state end-to-end against the real Chronodrive API
  using direct HTTP calls, because the ESP32 + GM861S scanner had not arrived. The physical
  half — a real barcode scan driving the LED + buzzer feedback off the `status` field — has not yet
  been observed on hardware.
- Progress (2026-06-27): the ESPHome firmware is written and committed
  (`firmware/esphome/barclaude-scanner.yaml`, ESP32-C6 Supermini + GM861S UART + external WS2812 +
  active buzzer; sound only on failure) but **not yet validated on hardware** (module not received).
- Change to make: flash `firmware/esphome/barclaude-scanner.yaml`, set the substitutions (WiFi,
  `server_host`/`server_port`, pins), configure the GM861S per the file header (UART 9600 8N1, auto
  output, CR/LF suffix, **good-read beep disabled**), then scan real products covering `added`,
  `added_to_lists_only`, and `not_found`, and confirm the LED colour + buzzer matches for each state.
  Correct the YAML / `docs/esphome-contract.md` if the real behaviour differs.
- Acceptance criteria: each of the three states, triggered by a physical scan, shows the expected
  LED colour (+ buzzer only on failure) and a matching dashboard log entry; the YAML and
  `docs/esphome-contract.md` reflect what the firmware actually does.
- Batch: BATCH-1
- Dependencies: none (waiting on hardware)
