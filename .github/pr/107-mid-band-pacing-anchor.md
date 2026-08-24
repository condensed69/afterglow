## Summary

PR 7 of the post-polish roadmap (`.hermes/plans/2026-08-23_post-polish-roadmap.md`):
a `midBandRun()` scenario in `pacing.mjs` that anchors a milestone in the
measured dead zone between "all research owned" (~105m) and the first franchise
sale (~312m). Test-coverage only — no `game.js`/`catalogs.js` change, no save
change, no player-visible behavior change.

## Approach

`midBandRun()` plays the deterministic bot's prestige loop to the franchise
gate, sells for the first Renown, and buys the first Brand perk — the first
Renown-sink event. The milestone is pinned at **311.70m ±5%** (296.12m–327.29m).

Why "first Brand perk" and not the plan's original "first Endorsement": an
endorsement costs 15 Renown (`endorsementCost(g) = 15 × 1.35^level`), but the
first sale yields ~14 — so the bot cannot buy one without a second prestige
loop. The plan's own fallback is explicit: *"Pick the cheaper milestone for the
bot: 'buy any brand perk' = first_brand_perk_purchased, anchored at ~315m."*
The cheapest Brand perk (`offline`, 3 Renown) is affordable on the first sale.

**Honest positioning note:** the first Brand perk is bought the instant Renown
exists — i.e. at the franchise gate — so the anchor lands at the *far edge* of
the 105m→311m dead zone, not its middle. The plan's "mid-band" name is
aspirational; the concrete deliverable is the first finer-grained (±5%) band on
the post-research progression (vs `renownRun`'s wide 2h–8h gate band), so a
balance change that moves the post-research progression by >5% now fails the
gate instead of silently drifting.

The bot's standard per-second policy (`botSecond` / `buyAllMeta`) never buys
Brand perks or Endorsements, so the scenario's explicit purchase cannot shift
the other five scenarios' bands — they stay bit-identical.

## Verification

- `node --check pacing.mjs` PASS
- `node economy.test.mjs` — 307 passed, 0 failed (unchanged: no game logic
  touched).
- `node pacing.mjs` (full local suite) — **exit 0**. The six milestone bands are
  unchanged (rail 1.53m / patrons 5.70m / crew 7.70m / LED 14.35m / research
  19.85m / all-upgrades 32.00m / all-research 105.18m), and the new `midBandRun`
  scenario lands "first brand perk" at the franchise gate inside its ±5% band
  (renown 311.70m, endgame probe both still pass). CI's `--fast` skips the three
  full-cap scenarios (renown / mid-band / endgame) exactly as before.

## Save version

**Unchanged (SAVE_VER 13).** No persisted field, no `VERSION`/`CHANGELOG`
advance — this is a test-harness change, not a player-visible behavior change.

## Docs updated

- `DESIGN.md` §23 — added a "Mid-band anchor (post-polish PR 7)" paragraph
  documenting the `midBandRun()` scenario, the 311.70m ±5% band, and the
  first-brand-perk (not endorsement) choice.

## Files

- `pacing.mjs` (new `midBandRun()` scenario + `--fast`/header comment updates)
- `DESIGN.md` (§23 mid-band anchor note)
- `.github/pr/107-mid-band-pacing-anchor.md` (this body)
