# 172: fix: extract startTickTimer() to remove duplicated 10Hz sim callback

## Summary

The 10Hz sim tick-timer body was duplicated verbatim between `init()`
(game.js:2199) and the `pageshow` BFCache-restore handler (game.js:2392) —
~25 lines each — and the two copies were already drifting: the `init()`
copy used the hardcoded literal `28800` in its catchUp branch while the
`pageshow` copy used the constant `this.MAX_DT`, so changing MAX_DT
in the future would leave the init path un-updated.

Extracted `startTickTimer()` (carrying the unified constant-based
clamp) from the `init()` copy and call it from both `init()` and the
`pageshow` re-arm path. One definition of the sim loop; `pageshow`
no longer needs its own inline callback.

## Behavior

Pure refactor. `startTickTimer()` is a no-op if `this.timer` is already set,
so the guard `if (this.isTabOwner())` in `pageshow` is preserved —
re-arming only happens when the timer was actually cleared by
`pagehide`. The `startTickTimer()` callback body is byte-identical to
the old `init()` copy that already shipped (including the catchUp
branch's `Math.min(dt, this.MAX_DT)` clamp). The `liveStep` branch
now passes `dt` directly (the `MAX_DT` clamp was redundant for
`dt <= 2`). The `pageshow` guard simplified to `if (this.isTabOwner())`
since both `startTickTimer()` and `startAutosave()` are idempotent.

## Verification

- `node --check game.js` — syntax OK
- `node economy.test.mjs` — 364 passed, 0 skipped, 0 failed
- `node pacing.mjs --fast` — exit 0, all milestones within band, prestige and
  second-room scenarios passed

## Docs / versioning

- `CHANGELOG` gains a `TIMER DEDUPLICATION (PR #172)` note under the existing
  `0.15.2` entry; `build` bumped 292 → 293.
- `SAVE_VER` stays 16 — the persisted save shape is unchanged.
