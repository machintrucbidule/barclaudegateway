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
> Last updated: 2026-06-29 (**BATCH-11 shipped** — BL-013 wiring/ops/firmware/docs, DECISION-028; moved to
> `BACKLOG_ARCHIVE.md`. **The DECISION-022 Layer-B epic (BATCH-7..11) is complete and the backlog is now
> empty.** The maintenance loop is idle — run **loop prompt 1** to add new remarks, or cut the **0.3.0**
> release (DECISION-027 — one user-triggered release for the whole epic).)

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

## (empty)

No active backlog items. The **DECISION-022 Local Chronodrive query API ("Layer B") epic** (BATCH-7..11)
is complete — see [`BACKLOG_ARCHIVE.md`](./BACKLOG_ARCHIVE.md). The maintenance loop is idle.

Next steps available:

- **Add remarks** → run [loop prompt 1 (intake/triage)](./prompts/loop-1-intake-triage.md) to capture and
  batch new items here.
- **Release** → the whole epic is one user-triggered **0.3.0** (DECISION-027): push the `vX.Y.Z` tag
  (DECISION-005) to build + publish the GHCR image.
- **Re-verify** → run [loop prompt 3 (ops/grooming)](./prompts/loop-3-ops-grooming.md) periodically.
