# Loop prompt 3 — Operations & backlog grooming (periodic / scheduled)

> Reusable maintenance-loop prompt (post-Phase 7). **This is the prompt Phase 7 hands off to.** Run it
> on a cadence (e.g. monthly) or after any suspected Chronodrive change. Canonical definition:
> [`ROADMAP.md`](../ROADMAP.md) § "Iterative maintenance loop".
>
> The Chronodrive API is private and changes without notice; the standing detect-and-patch process
> lives in [`contract.md`](../api/chronodrive/contract.md) §7, and the Phase 5 maintenance page is the
> user-facing front door to it. This prompt runs that process on a schedule and feeds any breakage
> back into [`BACKLOG.md`](../BACKLOG.md) as a P0 item.

---

Run in: Code + Cowork

Cross-cutting rules (apply without exception):
1. Never decide alone. 2. Plain language; discussion in French. 3. English artifacts.
4. No code without approval. 5. Keep spec files in sync.

## Resume check

- Read PROJECT_CONTEXT.md, decisions.md, api/chronodrive/contract.md, BACKLOG.md, BACKLOG_ARCHIVE.md.
- State the current backlog state and the date of the last spec verification.

## Goal

Keep the system and the backlog healthy: re-verify the Chronodrive API against the spec, and groom the
backlog so it stays clean, coherent, and correctly prioritized.

## Steps

1. Run the verification checklist (contract.md §6 / §7.4) against the live API. Record observed
   x-api-version values and update contract.md verification dates. For any breakage detected, create a
   P0 Bug entry in BACKLOG.md using the entry schema (this re-enters Loop prompt 1's triage flow for
   that item).
2. Groom BACKLOG.md: re-sort batches by priority, re-group for coherence, flag stale or duplicate
   items, and confirm each remaining item still carries enough dev info. Propose changes; the user
   confirms — never re-prioritize or delete alone.
3. Update PROJECT_CONTEXT.md / decisions.md / contract.md as required.

## End of prompt

- Present a summary: verification result, any new P0 items, grooming changes.
- Ask the user: anything to adjust?
- After validation, remind the user of the next action (run Loop prompt 2 on the top batch, or Loop
  prompt 1 for new remarks).
