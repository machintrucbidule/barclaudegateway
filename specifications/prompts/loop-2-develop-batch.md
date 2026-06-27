# Loop prompt 2 — Develop the top batch

> Reusable maintenance-loop prompt (post-Phase 7). Paste the body below to develop and ship the top
> batch of [`BACKLOG.md`](../BACKLOG.md). Canonical definition: [`ROADMAP.md`](../ROADMAP.md) §
> "Iterative maintenance loop". Shipped items move to [`BACKLOG_ARCHIVE.md`](../BACKLOG_ARCHIVE.md).

---

Run in: Code

Cross-cutting rules (apply without exception):

1. Never decide alone — present the approach and options first.
2. Plain language with the user; discussion in French.
3. All artifacts in English.
4. No code before the approach is explicitly approved.
5. Update PROJECT_CONTEXT.md / decisions.md / contract.md as the work requires.

## Resume check

Before anything else:

- Read PROJECT_CONTEXT.md, decisions.md, api/chronodrive/contract.md, BACKLOG.md, BACKLOG_ARCHIVE.md.
- Identify the top batch (highest priority, top of BACKLOG.md).
- Inspect whether any of its items are already partially implemented. State: "Resuming batch X at
  item Y" or "Starting batch X from the beginning."

## Goal

Develop and ship the top batch of BACKLOG.md, then archive it, keeping BACKLOG.md clean.

## Steps

1. Read every item in the top batch. Present a single implementation plan covering the whole batch
   (files to touch, order, tests, any spec edits the items flagged). Wait for explicit approval.
2. Implement the items. Apply the spec edits flagged in each item (contract.md / PROJECT_CONTEXT.md /
   decisions.md) as part of the work.
3. Test: cover each item's acceptance criteria. Do not declare done while tests fail or implementation
   is partial.
4. On success, move every completed item OUT of BACKLOG.md and INTO BACKLOG_ARCHIVE.md, appending:
   date shipped, what was actually done, commit/PR reference. BACKLOG.md must no longer contain these
   items.
5. Update PROJECT_CONTEXT.md (and decisions.md if an implementation decision was made).

## End of prompt

- Present a summary: what shipped, what moved to archive, the new top batch.
- Ask the user: anything to verify or change before closing the batch?
- After validation, remind the user they can run Loop prompt 2 again on the next batch, or Loop prompt
  1 to add new remarks.
