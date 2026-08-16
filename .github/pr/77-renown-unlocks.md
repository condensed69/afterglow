# PR 7 — Renown unlocks: Brand perks + third club + location identity

Implements `REPLAY_ROADMAP.md` §9: Renown becomes a spendable sink (the reason
to sell the franchise again), a third club opens, and each room gains its own
buildings/upgrades.

## What ships

**Brand perks (`BRAND_PERKS`, bought with Renown)**
- Data table mirroring `PRESTIGE_PERKS` (`{ id, name, cost, max, desc, req? }`);
  ranks live in the account-level `g.brand` map, read via `brandRank(g, id)`
  (fail-closed to 0), bought via `buyBrandPerk` (tabStale-guarded, capped at
  max, prerequisite-aware).
- **Nationwide Reach** (+10% all cash per rank — folded into `totalCashMult`,
  the single all-cash composition point, so passive AND clicks/whale/golden
  scale), **Loyalty Program** (+1 starting Regular per rank — restored BEFORE
  `applyStartPerks` on prestige so it seeds the new run), **R&D Lab** (−10%
  research cost per rank via the new `researchCost(g, def)`, floored at 1,
  single source for both the buy action and the card), **Night Owl Network**
  (+10% offline rate per rank in `catchUp`), **Rooftop Lease** (unlocks the
  third club).
- Brand ranks **persist through the franchise sale** (they are the sink — the
  sale snapshot/restore carries `brand`) and through ordinary prestige.

**Third club — the Rooftop**
- `Rooftop Lease` rank ≥ 1 opens `canOpenRooftop()`; `confirmOpenRooftop()`
  creates `g.clubs.rooftop` via `freshClubState('rooftop')` — the same
  account-level unlock pattern as the annex. No new save shape beyond PR 6.
- Club switcher + Ledger gain the third room; `freshClubState(loc)` initializes
  each location's extra ids in `b`/`u`.

**Location identity (`LOCATION_EXTRAS`)**
- Per-location buildings/upgrades appended to the shared catalog (supersedes
  SECOND_LOCATION.md §11's "no location-specific buildings" non-goal):
  `main` Neon Pool (+$0.60/s, +6 patron cap); `annex` Rooftop Bar (+$0.90/s,
  +8 cap) + Skyline View (×1.25 all cash); `rooftop` Helipad Lounge (+$1.50/s,
  +12 cap) + Panorama Deck (×1.40 hype). Extras flow through `rates()`/`caps()`
  and render on the Structures/Upgrades tabs.
- `sanitizeG`/`completeImportedG` backfill extra ids for existing saves; every
  extras read is `|| 0` / `=== true` fail-safe — **fixes a real infinite loop**:
  a club lacking its location's extra id priced it as NaN (`NaN < cash` is
  false, so `buyBuildingMax` never broke), now prices as 0 owned.

## Gates (all run locally, same as CI)

| Gate | Result |
|------|--------|
| `node --check game.js` | ✅ |
| `node economy.test.mjs` | ✅ 278 passed, 0 failed (6 new PR-7 tests: table well-formedness, buyBrandPerk spend/cap/req/shortage, effect wiring nationwide/loyalty/rnd/offline, rooftop unlock gate, freshClubState(loc) + sanitize backfill, extras in rates/caps) |
| `node pacing.mjs` | ✅ all 7 milestone bands **bit-identical** to the PR 6 baseline (rail 1.53m, crew 7.70m, patrons 5.70m, LED 14.35m, research 19.85m, all-upgrades 32.00m, all-research 105.18m — the bot never buys brand perks or location extras) + prestige + second-room + `renownRun()` extended with the §9 rooftop scenario: lease bought (+14 Renown → −10), rooftop opened with extras initialized, extras verified live via `rates()` toggles (heli cash, vista hype — per §10, a fresh-baseline LED control would pass on achievement carryover alone), third club plays to first LED 11.82m |

## Docs touched

- `DESIGN.md` §22 (new: BRAND_PERKS / rooftop / LOCATION_EXTRAS, with effects
  table and the NaN-loop note).
- `SECOND_LOCATION.md` §11 — the "no location-specific buildings" non-goal row
  marked SUPERSEDED (grep of the superseded section, not just the new one).
- `PRESTIGE.md` §10.6 — Renown readout meta updated ("spent on Brand unlocks
  (coming)" → "spent on Brand perks below") to match the shipped card.
- `REPLAY_ROADMAP.md` §12 checklist: PRs 2–5 ticked (merged but stale) + PR 7
  ticked; §13 doc-history row added.
- `README.md` — new "Renown, Brand perks & the Rooftop" controls section.
- `VERSION` 0.11.9/222 → **0.11.10/223**; in-file `CHANGELOG` entry added
  (newest first, per repo convention).

## SAVE_VER

**Unchanged (stays 10).** All new state is additive inside the PR 6 shape:
`g.brand` ranks (map of known perk ids, fail-closed in sanitize/import), the
`rooftop` club in the existing `g.clubs` map, and extra ids inside existing
`b`/`u` maps (backfilled for old saves). No migration needed.
