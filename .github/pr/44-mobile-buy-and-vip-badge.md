## feat: mobile buy-multiple + compact VIP golden-ticket badge (0.10.5, build 196)

Two player-facing changes, both aimed at making the game usable on a phone.

### 1. Buy-multiple on building cards

Building cards now render a **×1 / ×5 / ×10 / ×Max** row, so touch players can bulk-buy
without a Shift key. Desktop Shift-click on any of the four still forces a max buy.

- `buyBuilding(def, count)` folds the old `buyBuilding` / `buyBuildingMax` duplication into
  one loop. Cash and the per-building `max` are re-checked every iteration, and the
  single-buy log format is preserved when `count === 1`.
- `buildingMaxAffordable()` is extracted as the shared source of truth for ×Max and for each
  button's affordability state, so the renderer no longer duplicates the loop.

### 2. Golden ticket becomes a collapsible VIP badge

The rare golden-ticket offer moves from a large centered overlay to a compact badge in the
stage's top-right corner. The idle sim stays visible and keeps ticking underneath; tap the
badge to expand the cash/crowd choice.

`this.state.goldenOpen` tracks the expanded state. It lives in `this.state`, not in `g`, so
it is transient UI and **does not** persist.

### Review findings addressed

The automated review on this branch raised four items. Two were fixed in the current head
before this body was written; two were open and are fixed here.

| Finding | Status |
|---|---|
| Claim buttons referenced bare `g`, which `render()` does not have in scope — `ReferenceError` on click | Fixed at head — closures now built in `renderVals()` and consumed as `v.takeGoldenCash` / `v.takeGoldenCrowd` |
| `crowdAmount` interpolated as a raw float (`+7.339999999999998 crowd`) | Fixed at head — `Math.round(...)`, matching the log line |
| No test covering `goldenOpen` or the claim actions | **Fixed here** — 3 tests added (below) |
| `title` tooltip duplicated across all four buy buttons | **Fixed here** — kept on ×1 only |

The `g`-in-template bug is the same class as PR #30's prestige modal. It renders fine and
only throws when the button is actually clicked, so a render smoke test does not catch it.
Added tests:

- `renderVals()` exposes both claim actions and a rounded crowd preview.
- `render()` does not throw with the badge expanded.
- **Click-through** — invoking `v.takeGoldenCash()` / `v.takeGoldenCrowd()` resolves the
  offer. This is the one that would have caught the shipped bug.

`DESIGN.md` §14.4 now states the rule (templates read the view model, never `g`) and notes
that it has shipped twice, so the next interactive surface gets both tests by default.

### Docs touched

| File | Change |
|------|--------|
| `DESIGN.md` §11.4 | Golden-ticket presentation change: badge not overlay, `goldenOpen`, rounded crowd preview. |
| `DESIGN.md` §14.3 | New — buy-multiple buttons, the shared `buildingMaxAffordable()`, Shift-click behavior. |
| `DESIGN.md` §14.4 | New — templates read `v`, never `g`; the regression-test pair required for new interactive surfaces. |

`README.md` untouched: it documents no controls. `PLAN.md` / `PRESTIGE.md` untouched:
nothing here touches prestige or a planned item.

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass — 195 tests, 0 failed (192 before; +3) |
| `node pacing.mjs` | pass — all milestones in band |

Pacing is unaffected by construction: both changes are live-UI only. The pacing bot drives
`step()` with `_live = false`, so the golden ticket never rolls in it, and buy-multiple
changes the number of clicks a purchase takes, not its cost curve.

### Version / save format

- `VERSION` `0.10.5`, build `196`, and the `CHANGELOG` entry advance together — behavior change.
- `SAVE_VER` **stays 8**. `goldenOpen` is transient `this.state`, not persisted `g`; no field
  was added to the save shape.
