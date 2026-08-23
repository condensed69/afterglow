## Summary

PR 3 of the post-polish roadmap (`.hermes/plans/2026-08-23_post-polish-roadmap.md`):
achievement density — fill the location-extras and endorsement-ladder coverage
gaps identified in §1.5. Five new achievements, pure additive catalog, no save
change.

- `vista_1` "Panorama" — own the Panorama Deck at the Rooftop (`g.clubs.rooftop.u.vista === true`) — 3 Legacy
- `heli_2` "Sky Armada" — build 2 Helipads at the Rooftop (`g.clubs.rooftop.b.heli >= 2`) — 5 Legacy
- `endorse_10` "Sponsored" / `endorse_25` "Household Name" / `endorse_50` "Icon" — Brand Endorsement levels 10/25/50 — 4/8/16 Legacy

All reward Legacy only (crediting both `g.legacy` and `g.legacyTotal` per the
0.9.5 accounting rule). The milk multiplier ceiling expands +44% → +49%
(49 non-burst of 53 total).

## Scope note — the research-tier achievements are NOT in this PR

The plan's §4 also listed `research_t1/t2/t3` ("Tier 1/2/3 scholar" — every
tier-N research owned, Clout reward). Those are **deferred**: they fire on the
pacing bot's standard path (the bot deterministically buys every research node
— "all research" is a measured milestone at 105.18m), so they would (a) grant
Clout into the research currency mid-run and (b) add +1% milk each, shifting
the "all upgrades" and "all research" bands. That violates the roadmap's
bit-identical contract. They can ship only as a deliberate pacing-change PR
with a re-baseline, not inside a "bit-identical by construction" PR. Flagging
for a decision rather than silently dropping them.

## Approach

Data-only, in `catalogs.js` (which PR #102 extracted). Each check is a pure
arrow lambda — no `this`, no save field, no `SAVE_VER` bump. Club-level reads
use the full `g.clubs.rooftop` path (not the active club's `b`/`u` view),
mirroring the existing `rooftop_1`/`heli_1`. All five are bot-unreachable: the
pacing bot never opens the Rooftop nor buys Brand Endorsement, so the bot's
owned-achievement set (and therefore the milk multiplier) is unchanged.

## Verification

- `node --check catalogs.js` PASS
- `node --check game.js` PASS
- `node economy.test.mjs` — 302 passed, 0 failed (was 301; +1 dedicated
  dual-credit pin). Updated pins: milk ceiling 1.44 → 1.49 (53 total / 49
  non-burst), catalog-count 48 → 53, reachability sweep extended to the five
  new ids, plus an exact-Legacy dual-credit test (`legacy === legacyTotal === 45`
  for the density fixture).
- `node pacing.mjs` (full local suite) — exit 0, all five scenarios pass. The six
  main-run milestone bands are bit-identical (rail 1.53m / patrons 5.70m /
  crew 7.70m / LED 14.35m / research 19.85m / all-upgrades 32.00m /
  all-research 105.18m). One scenario-internal *reported* value moved: the
  renown scenario's "extras" arm (which deliberately seeds `u.vista = true` to
  verify the extras move the economy) now also fires `vista_1`, adding a
  deterministic +1% milk and moving rooftop-first-LED 7.20m → 7.15m. The arm's
  assertion — "extras must be ≥15% faster than control" — still passes at 39%
  (11.67m control vs 7.15m extras), and the control arm is unchanged (11.67m).
  No milestone band, band, or assertion broke.

## Save version

**Unchanged (SAVE_VER 13).** No persisted field added. `VERSION` advanced
0.11.22 → 0.11.23 (build 236) with a matching `CHANGELOG` entry, per the
behavior-change rule (player-visible collectibles).

## Docs updated

- `DESIGN.md` — §12 header + new "0.11.23 density pass" bullet + milk-multiplier
  ceiling (+44% → +49%) + five achievement-table rows.
- `game.js` — `VERSION` + `CHANGELOG` + `achievementMult` comment (ceiling).
- `catalogs.js` — the five `ACHIEVEMENTS` entries.
- `economy.test.mjs` — updated pins + the dual-credit test.

## Files

- `catalogs.js`
- `game.js` (version/changelog/comment only)
- `DESIGN.md`
- `economy.test.mjs`
- `.github/pr/103-achievement-density.md` (this body)
