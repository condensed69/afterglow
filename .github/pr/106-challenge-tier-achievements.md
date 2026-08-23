## Summary

PR 6 of the post-polish roadmap (`.hermes/plans/2026-08-23_post-polish-roadmap.md`):
challenge-**tier**-aware achievements. The challenge system is a 12-run ladder
(4 challenges × 3 tiers, 0.11.13), but the achievements only celebrated the flat
"4 challenges done" count — a player who ran all 12 tiered runs had no
collectible for the difficulty ladder. This PR adds four tier-aware achievements
so re-running challenges at higher tiers is a visible, rewarded goal.

No new save field, no `SAVE_VER` bump, no economy or sim change. The new checks
read `g.challengeTiers` (the post-0.11.13 source of truth), which the pacing bot
never populates — so every band stays bit-identical.

## Approach

Four new `ACHIEVEMENTS` entries, all `legacy: 3` (Legacy-only, per the
Renown-rewards rule — never Clout, which is the research currency):

| id | name | check |
|----|------|-------|
| `challenge_t2_one` | Hardened | any challenge tier ≥ 2 |
| `challenge_t3_one` | Ironclad | any challenge tier ≥ 3 |
| `challenge_t2_all` | Gauntlet | all 4 challenges tier ≥ 2 |
| `challenge_t3_all` | Legendary | all 4 challenges tier ≥ 3 |

**Dual-read pattern (pre-empting the PR #74 review finding):** the existing flat
`challenge_1` / `challenge_all` achievements keep reading `g.challengesDone`
(their legacy shape). The new tier-aware achievements read `g.challengeTiers` —
the map `{ challengeId: highestCompletedTier }` that is the actual source of
truth since 0.11.13. The `_all` checks iterate `this.CHALLENGES` (the
4-entry catalog), mirroring `brand_max`'s `this.BRAND_PERKS.every(...)` pattern,
so a future 5th challenge auto-participates.

Rewards flow through the existing `checkAchievements` Legacy dual-credit
(credits both `g.legacy` and `g.legacyTotal` per the 0.9.5 accounting rule).

## Verification

- `node --check game.js && node --check catalogs.js` PASS
- `node economy.test.mjs` — 307 passed, 0 failed (was 306; +1 pin, and the
  catalog-count / milk-multiplier / reachability fixtures updated for 53 → 57).
  The new test drives the threshold ladder step-by-step: `challengesDone` alone
  must NOT fire the tier-aware ids; tier-2 on one challenge fires `t2_one` only;
  all-4-tier-2 fires `t2_all` (not `t3_all`); all-4-tier-3 fires `t3_one` +
  `t3_all`; and the 4×3 Legacy is dual-credited to spendable + lifetime.
- `node pacing.mjs` (full local suite) — **exit 0**, all milestone bands
  bit-identical (rail 1.53m / patrons 5.70m / crew 7.70m / LED 14.35m /
  research 19.85m / all-upgrades 32.00m / all-research 105.18m / franchise
  311.70m). The bot never starts a challenge, so the new checks never fire on
  its path.

## Save version

**Unchanged (SAVE_VER 13).** No persisted field — achievements reuse the
existing `g.achievements` array. `VERSION` advanced 0.11.25 → 0.11.26
(build 239) with a matching `CHANGELOG` entry. The milk multiplier ceiling
expands +49% → +53% (53 non-burst of 57 total), and is still ×1.0 on the bot
path.

## Docs updated

The plan listed this PR as "no docs change", but `DESIGN.md` carries an
**exhaustive achievement table** plus the milk-multiplier count, so those went
stale. Updated in this PR (not deferred to the docs sweep):

- `DESIGN.md` — added the 4 rows to the achievement table, added a
  "0.11.26 challenge-tier pass" history note (53 → 57, +49% → +53%), and
  corrected the §11.2 milk-multiplier ceiling sentence.
- `README.md` — the "Achievements" section count/boost (48/+44% → 57/+53%);
  this also fixes a count left stale by the 0.11.23 density pass.

## Files

- `catalogs.js` (4 new `ACHIEVEMENTS` entries)
- `game.js` (achievementMult comment, VERSION/CHANGELOG)
- `economy.test.mjs` (count + milk + reachability fixtures, +1 tier-aware pin)
- `DESIGN.md` (achievement table, §11.2, history note)
- `README.md` (achievement count/boost)
- `.github/pr/106-challenge-tier-achievements.md` (this body)
