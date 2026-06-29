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
> Last updated: 2026-06-29 (**BATCH-12 shipped** — BL-014 single-owner LED race fix + BL-015 bounded
> search payload; moved to `BACKLOG_ARCHIVE.md`. **The active backlog is now empty.** The DECISION-022
> Layer-B epic (BATCH-7..11) shipped as **`0.3.0`**; BATCH-12 shipped as the **`0.3.1`** patch (both GHCR
> builds succeeded, DECISION-027) — run [loop prompt 1](./prompts/loop-1-intake-triage.md) to add remarks,
> or [loop prompt 3](./prompts/loop-3-ops-grooming.md) to re-verify.)

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

## No active batches

The active backlog is **empty** — every triaged item has shipped (latest: **BATCH-12**, BL-014 + BL-015,
2026-06-29; see [`BACKLOG_ARCHIVE.md`](./BACKLOG_ARCHIVE.md)).

> The **DECISION-022 Local Chronodrive query API ("Layer B") epic** (BATCH-7..11) is complete and shipped
> as **`0.3.0`** (DECISION-027 — one user-triggered release for the whole epic); BATCH-12 shipped as the
> **`0.3.1`** patch. See [`BACKLOG_ARCHIVE.md`](./BACKLOG_ARCHIVE.md). Run
> [loop prompt 1](./prompts/loop-1-intake-triage.md) to add remarks, or
> [loop prompt 3](./prompts/loop-3-ops-grooming.md) to re-verify.
