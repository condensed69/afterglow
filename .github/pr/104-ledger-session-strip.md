## Summary

PR 4 of the post-polish roadmap (`.hermes/plans/2026-08-23_post-polish-roadmap.md`):
a compact "This session" strip at the top of the Ledger that frames the main
stats as session-level deltas — Cash, Hype, Regulars, Rounds, and Work — so a
slow night reads as progress instead of a wall of static numbers.

Pure render. No new save field, no `SAVE_VER` bump, no economy or sim change.

## Approach

- A `sessionSnap = null` class field captures a first-render baseline
  (`cash`, `hype`, `regulars`, `rounds`, `clicks`) — populated in
  `renderVals()`, **never** in `init()`, per the plan's pitfall: `init()` may
  still be restoring `g` from a save mid-load, so the snapshot must land on the
  first actual render.
- `renderVals()` derives five signed deltas from the snapshot and exposes them
  as `sessionDeltas` (`+$2.1K` / `−3` / `+5`, etc.). Cash uses the game's `fmt`
  suffix formatter; the small counters floor to whole numbers.
- The strip renders at the top of `ledger-detail` with inline styles (the
  codebase's norm).

**Deviation from the plan's "style.css" touch:** no CSS was needed. The strip
rides the existing Ledger collapse — `ledger-detail` is already
`max-height:0`-collapsed by default below 900px and expands via the existing ▸
toggle — so the "collapsed on mobile by default, expandable via a tap" behavior
is satisfied without a second, redundant collapse affordance. The strip is
inline-styled like every other Ledger block.

## Verification

- `node --check game.js` PASS
- `node economy.test.mjs` — 303 passed, 0 failed (was 302; +1 pin). The new test
  asserts the strip has 5 deltas, that the first-render delta is zero, that
  `cash`/`regulars`/`rounds`/`work` deltas reflect state advances, and that
  `sessionSnap` is absent from the JSON save shape (`JSON.stringify(g)`).
- `node pacing.mjs` (full local suite) — **exit 0**, all milestone bands
  bit-identical (rail 1.53m / patrons 5.70m / crew 7.70m / LED 14.35m /
  research 19.85m / all-upgrades 32.00m / all-research 105.18m). Confirms the
  render-only change never touches the bot path.

## Save version

**Unchanged (SAVE_VER 13).** No persisted field. `VERSION` advanced
0.11.23 → 0.11.24 (build 237) with a matching `CHANGELOG` entry (player-visible
UI change).

## Docs updated

None — render-only, no system/number/count changed.

## Files

- `game.js` (snapshot field, `renderVals` deltas, template strip, VERSION/CHANGELOG)
- `economy.test.mjs` (the session-delta pin)
- `.github/pr/104-ledger-session-strip.md` (this body)
