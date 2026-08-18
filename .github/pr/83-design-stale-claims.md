# PR 83: DESIGN.md stale-claims correction

## Summary
Housekeeping pass on `DESIGN.md` (the PLAN.md §Deferred "full rewrite" item). The document is already incrementally current through §23 (0.11.15) — every system shipped across the PR series landed in it. A from-scratch rewrite would have destroyed that accuracy. Instead this PR corrects every claim that had drifted from `game.js` (the source of truth), verified against the current tree.

## Changes

- **Spec target header** — "post-workstreams A–D and post-0.9.x systems … v0.11.0, SAVE_VER 9" → "all shipped systems through 0.11.15 … v0.11.15, SAVE_VER 13" with the full shipped system list (second room + rooftop, research tree, challenge tiers, manager levels, Renown/Brand perks/Endorsement, Vision ladder, location extras).
- **Ancestry** — extended through 0.10.x (second room / burst events / golden ticket) and 0.11.x (research tree, challenges + tiers, manager levels, Renown unlocks, Vision ladder).
- **§9.2 reset table** — Persists row adds `g.brandLevel` and `g.lifetimeEarned` (PR #82 fixed REPLAY_ROADMAP's table but missed this one); Wipes row adds `challengeTier` / `challengeTiers`; clubs row notes annex *and rooftop* re-lock.
- **§9.2 save format** — SAVE_VER 12 → **13**; adds the `lifetimeEarned: 0` migration (SAVE_VER 13, `MIGRATIONS[12]`); sanitizeG now fail-closes non-finite `lifetimeEarned` → 0.
- **§9.2 UI copy** — Renown card meta "spent on Brand unlocks (coming)" → **"spent on Brand perks below"** (the actual game.js copy).
- **§13 SAVE_VER table** — **10 → 13**.
- **§13.1 heading** — "(v10 — renown layer 0.11.9)" → "(v13 — Vision ladder 0.11.15)".
- **§13.1 layout note** — "emits the real v12 layout" → "v13 layout".
- **§14.1 / §14.5** — the `[ Main ] [ Annex ]` switcher gains the third `[ Rooftop ]` entry (appears once the Rooftop Lease is bought, §22.2); Ledger room label updated to "Main Room" / "Annex" / "Rooftop".

Deliberately left unchanged: historical "(SAVE_VER 9)" notes that describe ship-time state (research 0.11.6, challenges 0.11.7, manager levels 0.11.8 all shipped while SAVE_VER was 9), and §13.1's additive-field paragraph which already correctly describes SAVE_VER 10/11/12/13. **No section renumbering** — the externally-referenced anchors §14.4 (AGENTS.md), §22.1 (PRESTIGE.md), §22.3 (SECOND_LOCATION.md), §23 (REPLAY_ROADMAP.md) all still resolve.

## Verification

All three gates pass (run locally on this branch — the tree is doc-only, but the gates are required status checks):
- `node --check game.js` ✅
- `node economy.test.mjs` → **301 passed, 0 failed** ✅
- `node pacing.mjs` → all milestones within band; Prestige, Second-room, Renown scenarios + Endgame probe all pass ✅

## Save Version
**Unchanged (SAVE_VER 13).** Doc-only PR — no save shape, no behavior, no balance change.

## Docs Updated
- DESIGN.md only (12 insertions, 12 deletions)
- `.github/pr/83-design-stale-claims.md` (this body)
