## Summary

`checkAchievements()` rebuilt a full state-spread view (`clubView`, a
`{ ...g, ...c }` through the club proxy) once per *unearned* achievement — up to
57 per call — and it runs once per sim slice (10× per simulated second). That
made it ~94% of pacing-suite wall time. The pass now builds the view once and
re-syncs the reward-mutated primitives (`cash`/`clout`/`legacy`/`legacyTotal`)
onto it after each credit, so a later check still sees the freshest value
(`legacy_50` reads `legacyTotal`, which earlier rewards increment).

## Why

The full six-scenario pacing suite took ~30–40 minutes, and the `/oc` review
bot re-runs it, blowing the 15-minute workflow timeout. `node pacing.mjs --fast`
alone exceeded 2 minutes. Profiling showed `checkAchievements` at ~3.0 ms/call
(57 × 54 µs spreads) versus ~19 µs for `rates()` — ~30 ms per simulated second.

## Verification

- `git diff --check` — pass
- `node --check game.js` — pass
- `node economy.test.mjs` — 307 passed, 0 skipped, 0 failed
- `node pacing.mjs --fast` — pass, ~28 s (was >2 min)
- `node pacing.mjs` (full) — pass, ~2m23s (was ~30–40 min); milestone values
  bit-identical (rail 1.53m, crew 7.70m, LED 14.35m, research 19.85m,
  all-upgrades 32.00m, all-research 105.18m, renown/mid-band gate 311.70m,
  lifetime $5.45M / 54.5% of ★1).

## Documentation and save compatibility

- Docs touched: none — internal loop restructure; no constant, count, or system
  changed.
- `SAVE_VER` unchanged (13): no persisted field or save-shape change.
- `VERSION`/`CHANGELOG` unchanged: pure performance refactor, output bit-identical
  to the prior build.
