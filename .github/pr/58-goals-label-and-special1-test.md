## UX: Owner's List banner "X of Y goals complete" + special_1 regression test

### What this PR does

Completes the last remaining item from the adversarial-UX fix plan (planned as PR 5, but the actual PR #56 turned out to be the AGENTS.md docs PR — this scope never shipped).

**Banner clarity (the actual bug):** the sticky onboarding banner showed `3 / 14 complete` — Barbara's complaint was unclear units ("X / Y complete" of *what?*). Now reads **`3 of 14 goals complete`**.

**special_1 regression test:** the root false-trigger ("Surprise Hit" unlocking on tutorial goal completion) was already fixed in 0.10.1 — `specialsCount` increments only in `advanceShift` when a special actually rolls. This PR adds a test locking the goal-completion path so a tutorial goal can never earn the achievement again.

### Changes

- `game.js`: banner text `${ol.n} / ${ol.total} complete` → `${ol.n} of ${ol.total} goals complete`
- `economy.test.mjs`: `special_1 does not unlock when completing Work the room goal (no special shift)` — completes the goal via `noteGoals`, runs the same `noteGoals` + `checkAchievements` pair every real call site uses, and asserts the goal actually completed, `special_1` absent, and `specialsCount` stays 0

### Gates

- `node --check game.js` ✅
- `node economy.test.mjs` ✅ (206 passed, 1 skipped, 0 failed)
- `node pacing.mjs` ✅ (all milestones within band, prestige scenario passed)

### Docs touched

- `CHANGELOG`: entry for `0.10.14`

### SAVE_VER

- Unchanged (8) — no save shape changes, purely display text + test

### Notes

- Rebased onto current `main` (0.10.13, post-#57); `VERSION` sits at 0.10.14/build 205 directly above it
- This branch previously existed unmerged (was based on pre-#55 main); force-pushed the rebased history
