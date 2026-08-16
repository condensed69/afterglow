# PR 81: Meta Achievements — Brand, Rooftop, Challenge, Sale Coverage

## Summary
Extends the achievement catalog from 38 → 48 with 10 new achievements covering the post-sale meta systems (Brand perks/endorsements, Renown, challenge tiers, Rooftop club, franchise sales). This addresses the finding that the collection drive was silent across the newest 60% of the game (§1.3 of next-roadmap).

## Changes
- **game.js**: Added 10 new `ACHIEVEMENTS` entries (all Legacy rewards, no Clout):
  - `franchise_1` (2 Legacy) — renownTotal ≥ 1
  - `franchise_5` (5 Legacy) — renownTotal ≥ 30
  - `franchise_10` (8 Legacy) — renownTotal ≥ 60
  - `brand_1` (2 Legacy) — any brand perk rank ≥ 1
  - `brand_max` (5 Legacy) — all 5 brand perks at max rank
  - `rooftop_1` (3 Legacy) — Rooftop club unlocked
  - `heli_1` (3 Legacy) — Rooftop Helipad built
  - `challenge_1` (2 Legacy) — any challenge tier completed
  - `challenge_all` (4 Legacy) — all 4 challenge tiers completed
  - `endorse_5` (3 Legacy) — Brand Endorsement level ≥ 5

- **game.js**: Updated `achievementMult` ceiling comment (34 → 44 non-burst, 38 → 48 total)
- **game.js**: VERSION 0.11.14 / build 227
- **game.js**: CHANGELOG entry for 0.11.14
- **economy.test.mjs**: Updated achievement catalog count test (38 → 48), milk multiplier test (1.34x → 1.44x), pre-recorded new achievements in `gateMetGame` fixture
- **pacing.mjs**: Updated Renown scenario assertion for expected legacy/legacyTotal from `franchise_1` achievement
- **DESIGN.md** §12: Added meta pass section, updated achievement table with 10 new entries, milk ceiling +44%
- **README.md**: Added Achievements section mentioning 48 achievements and +44% milk multiplier
- **REPLAY_ROADMAP.md** §3: Added note about meta pass expanding ceiling to +44%

## Verification
All three gates pass:
- `node --check game.js` ✅
- `node economy.test.mjs` → 290 passed ✅
- `node pacing.mjs` → All milestones bit-identical, Renown scenario passed ✅

## Save Version
SAVE_VER stays **12** — achievements reuse the existing `g.achievements` array, no new persisted fields.

## Docs Updated
- DESIGN.md §12 (achievement counts, table, milk multiplier)
- README.md (Achievements section)
- REPLAY_ROADMAP.md §3 (milk ceiling note)
- game.js CHANGELOG + VERSION

## Spine Invariant
**Deepen a run** — the new achievements attach collection pressure to the post-sale meta (Brand, Rooftop, challenges, sales, endorsements), giving players visible sub-goals during the 105m→312m gate stretch and a reason to engage with every new system. No pacing bands shift — the standard bot path never sells, opens rooftop, starts challenges, or owns brand.