## Summary

PR 5 of the post-polish roadmap (`.hermes/plans/2026-08-23_post-polish-roadmap.md`):
back-half flavor derivations that surface progress in the quiet 105m–311m band.
The Ledger gains a "House" strip with three derived, render-only reads, and the
`FLAVOR` ticker gains three back-half lines.

Pure render. No new save field, no `SAVE_VER` bump, no economy or sim change —
the change rides the same `renderVals`-only contract the FLAVOR layer shipped
with at PR #72.

## Approach

Three derived helpers, all read in `renderVals()` only (never `rates()`/`step()`):

- **`houseReputation(g)`** — tiers a label + tint from `g.rounds` (the
  live-session "rounds bought" generosity counter): `null` before the first
  round, then "Buys the first round" → "Generous host" → "The block's favorite"
  → "Neighborhood legend".
- **`specialRecord(g)`** — the count of special shifts ridden, from the live-only
  `g.specialsCount` counter (0.10.1). `null` at zero.
- **`weekendEnergy(g)`** — `min(1, night/30)`, mapped to a cool→warm tint.

`renderVals()` builds a `houseChips` array (three inline-styled chips) and the
Ledger template renders a "House" strip **only when at least one chip is
non-empty** — a fresh club shows nothing, and the strip grows as rounds/specials/
nights accumulate in the back half. All chip strings are source-controlled
literals (labels/tints) or integers (special count, rounded %), so no escaping
is needed.

The `FLAVOR` catalog gains three lines keyed on existing counters — night 25, the
first special shift, and the first Brand Endorsement — all of which fall in the
dead zone or later.

## Verification

- `node --check game.js && node --check catalogs.js` PASS
- `node economy.test.mjs` — 306 passed, 0 failed (was 303; +3 pins):
  `houseReputation` tier thresholds, `specialRecord`/`weekendEnergy` derivation,
  and the "strip renders only when a chip is present" + non-persistence check.
- `node pacing.mjs` (full local suite) — **exit 0**, all milestone bands
  bit-identical (rail 1.53m / patrons 5.70m / crew 7.70m / LED 14.35m /
  research 19.85m / all-upgrades 32.00m / all-research 105.18m). Confirms the
  render-only change never touches the bot path.

## Save version

**Unchanged (SAVE_VER 13).** No persisted field — `houseChips` is a local in
`renderVals()`, never on `g`. `VERSION` advanced 0.11.24 → 0.11.25 (build 238)
with a matching `CHANGELOG` entry (player-visible UI change).

## Docs updated

- `DESIGN.md` §18 — added a "House strip (0.11.25, post-polish PR 5)" bullet
  describing the three derived reads and the FLAVOR extension.

## Files

- `game.js` (three derived helpers, `renderVals` chips, template strip, VERSION/CHANGELOG)
- `catalogs.js` (three back-half `FLAVOR` lines)
- `economy.test.mjs` (three pins)
- `DESIGN.md` (§18 flavor subsection)
- `.github/pr/105-back-half-flavor.md` (this body)
