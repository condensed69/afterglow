## Summary

Ultra-review fix plan PR 3/3 — two behavior-neutral cleanups (N7 + N9).
No behavior change, no `VERSION`/`CHANGELOG`/`SAVE_VER` movement (mirrors
PR #108 precedent).

## Changes

- **N7 — game.js `completeImportedG`** — removed the second copy of the
  `if (!g.brand || …) g.brand = {};` guard. The first copy (line 1580, the
  "Brand map (PR 6, SAVE_VER 10)" block) already establishes the plain-object
  default before challenge state is normalized; the duplicate immediately
  before the Brand-perks `brandNext` loop was dead code. Pure dedup — the
  `brandNext` loop and fail-closed clamping are untouched.

- **N9 — pacing.mjs endgame probe budget** — the endgame probe sat ~1% under
  the 5-minute default `RUN_BUDGET_MS` wall clock, so a concurrent
  `economy.test.mjs` run could trip a false-positive `exit 2`. Added
  `ENDGAME_BUDGET_MS = 7 * 60 * 1000` and pointed the probe at it. Wall-clock
  only — the bit-identical bands are untouched. CI runs `--fast` (skips the
  probe), so this affects only the local full suite.

## Gates

All three run sequentially, nothing concurrent (the very failure mode N9
fixes).

- `node --check game.js` — pass
- `node economy.test.mjs` — pass (307 passed, unchanged)
- `node pacing.mjs` — pass (all 6 scenarios, bands bit-identical)

## Docs

No docs touched — both changes are internal cleanups with no player-visible
number, count, or behavior change.

## Versioning

No `VERSION`/`SAVE_VER` bump. No `CHANGELOG` entry (not a shipped behavior).

## Plan

`.hermes/plans/2026-08-23_ultra-review-fixes.md` — PR 3/3 (PR 2
pacing-sensitive lands last).