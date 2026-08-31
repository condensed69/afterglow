## Summary

Docs-only. `IMPLEMENTATION_PLAN.md` still billed itself as "a brief for the one
remaining runner-up: small-screen stacking" — work that shipped in 0.10.7–0.10.17
(its §6 even says "operator has not requested it" for the stacking that §14.1 of
DESIGN.md documents as shipped four different ways). The file was the last doc
claiming unshipped work.

Rewritten as a **shipped-plans index**: a table of every plan → where its
results are documented (DESIGN.md / PRESTIGE.md / REPLAY_ROADMAP.md /
CHANGELOG), the architecture notes that still hold (render loop, event
delegation, motion prefs, no-performer invariant), a pointer to git history for
the original 2026-08-05 brief, and a "start from the audit" pointer for future
work.

Nothing else claims unshipped work: REPLAY_ROADMAP.md §12 is fully ticked;
PLAN.md describes the offline catch-up loop that shipped.

## Scope

- `IMPLEMENTATION_PLAN.md` only. No `game.js`, no `style.css`, no behavior.
- Doc-only PR → no VERSION/CHANGELOG bump (no player-visible change, consistent
  with repo convention of versioning behavior, not docs chores).

## Gates

| Gate | Result |
|---|---|
| `node --check game.js` | PASS (file untouched) |
| `node economy.test.mjs` | PASS |
| `node pacing.mjs` | PASS — exit 0, bit-identical (doc-only commit) |

## Docs

The PR *is* the docs pass. AGENTS.md grep for every system referenced by the
new index: DESIGN.md (§14.1 mobile, §23 replay), REPLAY_ROADMAP.md (§12),
PRESTIGE.md (Renown/Legacy sections) — all confirmed present.
