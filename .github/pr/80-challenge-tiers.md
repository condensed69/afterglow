# PR 2 (next-roadmap) — Challenge tiers: the replay ladder

Second PR of the post-replay roadmap (design: `.hermes/plans/2026-08-16_next-roadmap.md`).
The four challenges were one-time: complete them once and the replay-modifier
system goes static forever. **Challenge tiers** turn them into a 12-run ladder —
each challenge has 3 tiers that tighten the modifier and scale the permanent
reward ×tier, so the game's only explicit replay hook actually replays.

## What ships

- **3 tiers per challenge** (`CHALLENGES.tiers`; tier 1 = the table `mod`):
  - Tight Till: $0 start → + all income ×0.85 → ×0.7
  - Slim Margins: income ×0.5 → ×0.4 → ×0.3
  - No Street Team: Flyer Crew locked → + Marquee → + Door Staff
  - Lean Night: Back Bar locked → + VIP Booths → + Tip Rails
- **Rewards scale ×tier, derived** — `challengeBonus(g)` reads the completed-tier
  map: Tight Till tier 3 → +15% all cash (0.05 × 3), Slim Margins tier 3 → +3
  Door Staff cap, crew tiers → +15% output. No separate reward field, no
  Clout/Legacy (Legacy-not-Clout rule holds).
- **Sequential gating** — `startChallenge` starts `highestDone + 1` (1 when
  fresh, capped at 3); a completed challenge is only re-runnable at a HIGHER
  tier; maxed reads "Maxed". The active tier's modifier routes through the same
  `challengeMod` composition point (incomeMult → `totalCashMult` — passive AND
  clicks/whale/golden; locked → `buyBuilding`/`autoBuyManagers`/card).
- **State:** `g.challengeTier` (the ACTIVE run's tier 1–3 — a mid-challenge
  reload keeps the difficulty) + `g.challengeTiers` (map `id → highest done`).
  Both additive, fail-closed in `sanitizeG`/`completeImportedG`.
  **SAVE_VER bumped to 12** with no-clobber `MIGRATIONS[11]` — including a
  **backfill**: a challenge in `challengesDone` without a tier record counts as
  tier 1, so pre-tier saves keep every earned reward.
- **Lifecycle:** prestige and challenge starts preserve earned tiers (the
  every-reset snapshot rule — both `confirmPrestige` and `startChallenge`
  snapshot/restore `challengeTiers`); **the franchise sale wipes them**
  (challenges re-lock, consistent with `challengesDone` §8.4).
- **Card:** shows `N/3` progress, "Start tier N" buttons, and the next tier's
  reward on the meta line (goal-directed, not history).

## Gates (all run locally, same as CI)

| Gate | Result |
|------|--------|
| `node --check game.js` | ✅ |
| `node economy.test.mjs` | ✅ 290 passed (285 + 5 new: sequential ladder/modifiers/×tier rewards, every-reset preservation + sale wipe, v11→v12 migration default+backfill+no-clobber, sanitize/import parity, renderVals tier display) |
| `node pacing.mjs` | ✅ all main-run milestone bands **bit-identical** to the 0.11.12 baseline (rail 1.53 / crew 7.70 / patrons 5.70 / LED 14.35 / research 19.85 / all-upgrades 32.00 / all-research 105.18m) + prestige/second-room/renown scenarios — the bot never starts a challenge, and the new fields default to tier 1 / empty in the deterministic path |

## Docs touched

- `DESIGN.md` §20.1 (new: tier table, reward ×tier derivation, state, gating,
  lifecycle); §13 save-format line + field-partition paragraph updated to
  SAVE_VER 12 / `MIGRATIONS[11]`; §9 reset table touched.
- `PRESTIGE.md` §11 — tiers bullet (modifier tightening, ×tier rewards,
  SAVE_VER 12 + backfill, prestige/challenge-start preserve, sale wipes).
- `REPLAY_ROADMAP.md` §6 — the "additive, no SAVE_VER bump" line marked
  **superseded** by the tier extension (same pattern as §8.9 in PR #79).
- `SECOND_LOCATION.md` §4 — `challengeTier`/`challengeTiers` added to the
  account-level field list (THREE-place sync with `ACCOUNT_FIELDS`).
- `VERSION` 0.11.12/225 → **0.11.13/226**; in-file `CHANGELOG` entry added
  (newest first).

## SAVE_VER

**Bumped to 12** (repo convention, review-set in PR #79: a new persisted field
bumps even when additive). `MIGRATIONS[11]` is no-clobber: v11 saves load with
`challengeTier: 1` / empty tier map, and any challenge already in
`challengesDone` backfills to tier 1 — existing rewards are byte-preserved.
Backward compat: v9/v10/v11 saves migrate through the chain automatically.

## Spine claim (per the roadmap's locked format)

**Deepen a run + reason to reset:** the modifier system stops being one-time —
completing a challenge now unlocks a harder tier with a bigger permanent
reward, giving the Perks panel a 12-run collection arc and every prestige
cycle a reason to run a tier it hasn't earned yet.
