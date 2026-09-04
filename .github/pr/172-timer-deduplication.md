# 172: fix: extract startTickTimer() to remove duplicated 10Hz sim callback

## Summary

The 10Hz sim tick-timer body was duplicated verbatim between `init()`
(game.js:2199) and the `pageshow` BFCache-restore handler (game.js:2392) —
~25 lines each — and the two copies were already drifting: the `pageshow`
copy omitted the `Math.min(dt, this.MAX_DT)` clamp present in the `init()`
copy, so a large BFCache gap could advance the sim differently on restore
than on a fresh boot.

Extracted `startTickTimer()` (carrying the clamp) from the `init()` copy and
call it from both `init()` and the `pageshow` re-arm path. One definition of
the sim loop; `pageshow` no longer needs its own inline callback.

## Behavior

Pure refactor. `startTickTimer()` is a no-op if `this.timer` is already set,
so the guard `if (!this.timer && this.isTabOwner())` in `pageshow` is
preserved — re-arming only happens when the timer was actually cleared by
`pagehide`. The callback body is byte-identical to the `init()` copy that
already shipped, including the `Math.min(dt, this.MAX_DT)` clamp on the
`liveStep` branch.

## Verification

- `node --check game.js` — syntax OK
- `node economy.test.mjs` — 364 passed, 0 skipped, 0 failed
- `node pacing.mjs --fast` — exit 0, all milestones within band, prestige and
  second-room scenarios passed

## Docs / versioning

- `CHANGELOG` gains a `TIMER DEDUPLICATION (PR #172)` note under the existing
  `0.15.2` entry; `build` bumped 292 → 293.
- `SAVE_VER` stays 16 — the persisted save shape is unchanged.
