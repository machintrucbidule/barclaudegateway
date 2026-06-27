# Loop prompt 1 — Intake & triage (user shares remarks)

> Reusable maintenance-loop prompt (post-Phase 7). Paste the body below to start a triage session.
> Canonical definition and how the loop fits together: [`ROADMAP.md`](../ROADMAP.md) §
> "Iterative maintenance loop". Files: [`BACKLOG.md`](../BACKLOG.md) · [`BACKLOG_ARCHIVE.md`](../BACKLOG_ARCHIVE.md).

---

Run in: Cowork

Cross-cutting rules (apply without exception):

1. Never decide alone — present options with plain-language impacts; the user chooses.
2. Plain language only — no jargon lists; say what each choice means in practice.
3. All artifacts (backlog entries, specs, code) in English. Discussion in French.
4. No code in this prompt — triage only.
5. Update PROJECT_CONTEXT.md / decisions.md / contract.md per the spec-update rule.

## Resume check

Before anything else:

- Read PROJECT_CONTEXT.md, decisions.md, api/chronodrive/contract.md, BACKLOG.md, BACKLOG_ARCHIVE.md.
- Summarize the current backlog state: batches, priorities, top batch.
- State: "Ready to take new remarks."

## Goal

Turn the user's free-form remarks and improvement ideas into clean, fully-specified backlog entries,
grouped into coherent batches and sorted by priority.

## Steps

1. The user pastes one or more remarks (in French). For EACH remark:
   a. Discuss in French to remove ambiguity — ask only what is necessary.
   b. Classify: Bug or Evolution.
   c. Propose a priority (P0–P3) with a one-line justification; the user confirms.
   d. Determine spec impact (none / contract.md §X / PROJECT_CONTEXT.md / decisions.md). If it is a
   contract.md correction, apply it now per contract.md §7; otherwise just flag it.
   e. Capture ALL development info into the entry schema: affected files, the concrete change to make,
   acceptance criteria.
   f. Propose grouping: attach to an existing batch (same area/files/subsystem) or create a new batch
   or mark standalone. The user confirms.
2. Write/update BACKLOG.md: insert the new entries, re-group batches so each stays coherent, re-sort
   batches by priority (top = next to develop). Keep the file clean — no done items here.
3. Update PROJECT_CONTEXT.md / decisions.md only as required by the spec-update rule.

## End of prompt

- Present a summary: what was added, to which batches, at which priority; what the new top batch is.
- Ask the user: anything to re-classify, re-prioritize, or re-group?
- After validation, remind the user that the next action is to run Loop prompt 2 on the top batch (do
  not start development here).
