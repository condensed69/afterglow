# PR 84: tick DESIGN.md rewrite as shipped in PLAN.md §Deferred

## Summary
Closes the last open thread from the original housekeeping request. PLAN.md §Deferred still listed "DESIGN.md full rewrite … remains undone as of this audit" — the doc correction shipped as PR #83, so the deferred item is now recorded as done per the repo convention (docs ship with the feature; PLAN.md items get ticked when implemented).

## Changes
- **PLAN.md** §Deferred — the DESIGN.md full rewrite entry now reads **shipped** (PR #83, 0.11.15), with a one-line summary of what the correction pass covered (Spec target/Ancestry → 0.11.15/SAVE_VER 13, §9.2 persist/wipe rows + save format, Renown card copy, §13 SAVE_VER table/headings, §14.1/§14.5 Rooftop switcher + Ledger label) and the note that external anchors (§14.4 / §22.1 / §22.3 / §23) were preserved with no section renumbering.

Matches the existing "Second location — **shipped**" entry style. No other files touched.

## Verification
All three gates pass on this tree — they were run on the identical `game.js` for PR #83 (301 passed, 0 failed; pacing in band) and this PR touches only PLAN.md (1 insertion / 1 deletion). CI re-runs the `gates` check as a required status anyway.

## Save Version
**Unchanged (SAVE_VER 13).** Doc-only PR — no save shape, no behavior, no balance change.

## Docs Updated
- PLAN.md only (1 insertion, 1 deletion)
- `.github/pr/84-plan-design-md-shipped.md` (this body)