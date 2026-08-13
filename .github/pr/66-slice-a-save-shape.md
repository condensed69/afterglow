# Save format v9: run state moves under `g.clubs.main` (second-location groundwork)

Slice A of the Second Location plan (PLAN.md Deferred; design in `SECOND_LOCATION.md`). No player-visible gameplay change — this is the save-shape foundation a second club needs.

## What changed

- **SAVE_VER 8 → 9.** `fresh()` now emits `g.clubs.main` carrying the run state: `cash, hype, buzz, patrons, regulars, b, u, elapsed, night, shiftIdx, shiftT, _specialShift, _whaleCooldown`. Account/shared fields (`clout, crew, jobs, r, perks, legacy, legacyTotal, prestiges, managers, managerPaused, achievements, goals, clicks, rounds, whalesCount, specialsCount, golden, ts, log, clubs, activeClub`) stay top-level. `activeClub: 'main'` marks the club being played.
- **MIGRATIONS[8]** moves a v8 save's fields into `clubs.main` on load/import (clone-safe: never clobbers a map sanitizeG already built on older chains; `MIGRATIONS[4]` now reads club fields through the accessor too).
- **`club(g, id)` accessor** threaded through every club-field read/write in the sim: `caps/rates/step/catchUp/advanceShift/effectiveShift`, whale/golden/critic/special-shift paths, all buy/hire/prestige/round actions, `workCrowd`, and `renderVals`. Falls back `active id → main → g` (pre-v9 shapes), so nothing reads `g.clubs[g.activeClub]` scattered.
- **`clubView(g)`** merged view for GOALS/ACHIEVEMENTS checks (account + active club, `b`/`u` from the club); `checkAchievements` rebuilds it per check so Legacy rewards credit `legacyTotal` mid-pass and feed later checks (regression covered by the existing `legacy_50` test).
- **Compat layer** (`wrapState` → `clubProxy`): flat `g.cash`/`g.b`/`g.hype` reads and writes forward to the active club; transparent to serialization (`JSON.stringify` still emits the real v9 shape). Production and both harnesses share it, so the 200+ flat-g test assertions and the pacing bot needed zero rewrites.
- **Import validation**: `isValidSavePayload` accepts v9 (`g.clubs.main?.[k] ?? g[k]`) and pre-v9; `completeImportedG` rebuilds a flat body into `clubs.main` (backfilling defaults), validates every club's numerics/maps/specials, and rejects hybrid v9 bodies that also carry flat leftovers (fail-closed).

## Gates

- `node --check game.js` — pass
- `node economy.test.mjs` — **216 passed, 0 failed** (was 209; +7: v8→v9 migration shape, `club()` resolution/fallback/activeClub routing incl. inherited-key rejection, fresh() v9 partition, empty-clubs-map rejection, prestige club preservation, plus the armed `SPLIT_TEST`)
- `node pacing.mjs` — all milestones within band; prestige delta **−1.87m** — bit-identical to pre-refactor (same 39.97m all-upgrades, 14.67m first LED), confirming zero pacing change

## Docs

- `DESIGN.md` — spec target, SAVE_VER table, import-validation description
- `SECOND_LOCATION.md` — status/save-format header, §4 account list gains `clubs, activeClub`
- `PLAN.md` — Deferred: second location groundwork shipped note
- `PRESTIGE.md` — gate/formula/code sketch scoped to the active club (`club(g)` accessor)

## SAVE_VER

**Moved 8 → 9** with a migration step (v8→v9), as required — the persisted shape changed. Old saves load unchanged via the migration chain.
