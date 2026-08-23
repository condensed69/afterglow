## Summary

PR 1 of the post-polish roadmap (`.hermes/plans/2026-08-23_post-polish-roadmap.md`):
split the static catalog data out of the `game.js` monolith into a sibling
`catalogs.js`. Pure refactor — no behavior change, no save change, `SAVE_VER`
stays 13.

`game.js` shrinks from 4,927 lines to ~4,594; the 12 catalogs
(`BUILDINGS`, `UPGRADES`, `RESEARCH`, `CHALLENGES`, `BRAND_PERKS`,
`LOCATION_EXTRAS`, `PRESTIGE_PERKS`, `MANAGERS`, `FLAVOR`, `REGULAR_NAMES`,
`ACHIEVEMENTS`, `GOALS`) now live in `catalogs.js` as a single
`window.AfterglowCatalogs` object. `VISION_TIERS`, `JOBS`, `SPECIAL_SHIFTS`,
`MIGRATIONS`, `CHANGELOG`, and the `Game` class itself stay in `game.js`.

This unblocks the later roadmap PRs (achievement density, challenge tiers,
flavor v2) — each becomes a small `catalogs.js` diff instead of a needle-in-4927
-lines edit.

## Approach

The catalogs were class *instance* fields, read everywhere as `this.BUILDINGS`,
`this.ACHIEVEMENTS`, etc. The split keeps that surface:

- `catalogs.js` defines `const AfterglowCatalogs = { … }` and assigns it to
  `window.AfterglowCatalogs` (browser global + the test harness's `window` stub
  both see it — same IIFE/global pattern the repo already uses; no ESM).
- `game.js` attaches it with a single line after the class body:
  `Object.assign(Game.prototype, window.AfterglowCatalogs)`. Every existing
  `this.BUILDINGS` / `this.RESEARCH` call site in the class body resolves
  through the prototype chain exactly as it did when they were instance fields.
- `index.html` loads `catalogs.js` before `game.js`.
- Both harnesses (`economy.test.mjs`, `pacing.mjs`) load the two files in order
  and strip only `game.js`'s trailing boot block.

**One correction to the plan's "no internal call-site changes" note.** The
`ACHIEVEMENTS`/`GOALS` check lambdas that *read other catalogs or helper
methods* (`this.BUILDINGS.every(…)`, `this.perk(…)`, `this.doorMax(…)`,
`this.RESEARCH.some(…)`, etc. — 8 lambdas total) captured `this` = the instance
only because they were defined as class fields. Moved to `catalogs.js`, those
arrows would capture the global scope. So those 8 lambdas become method
shorthand (`check(g) { … }`) and are bound at the call site with `.call(this, …)`
— three sites: `MIGRATIONS[4]` goal backfill, `noteGoals`, and
`checkAchievements`. Pure-data lambdas (the other ~60 checks, `FLAVOR` conds,
`CHALLENGES` checks, `GOALS` progress) use no `this` and are untouched.

## Verification

- `node --check catalogs.js` PASS
- `node --check game.js` PASS
- `node economy.test.mjs` — 301 passed, 0 skipped, 0 failed, exit 0
  (the 8 converted lambdas are pinned by the existing `study`/`builtin` orphan-key
  and goal-well-formedness tests, now invoked via `.check.call(game, g)`)
- `node pacing.mjs` (full local suite) — exit 0, bit-identical to the
  pre-change baseline. Standard bot: rail 1.53m / patrons 5.70m / crew 7.70m /
  LED 14.35m / research 19.85m / all-upgrades 32.00m / all-research 105.18m;
  prestige, second-room, renown (franchise sold @ 311.70m, rooftop extras
  verified live), and the endgame probe all ✅. No milestone moved.

## Save version

**Unchanged (SAVE_VER 13).** No persisted field added; the save shape is
bit-identical. `VERSION` and `CHANGELOG` are also unchanged — this is a pure
refactor with no player-visible behavior, so there is nothing to announce in the
changelog.

## Docs updated

None. No system, number, or achievement count changed.

## Files

- `catalogs.js` (new — the 12 catalogs)
- `game.js` (catalogs removed; `Object.assign` attach line; 3 `.call(this, …)` binds)
- `index.html` (load `catalogs.js` before `game.js`)
- `economy.test.mjs` (load both files; `.check.call(game, …)` at 2 test sites)
- `pacing.mjs` (load both files)
- `.github/pr/102-catalogs-split.md` (this body)
