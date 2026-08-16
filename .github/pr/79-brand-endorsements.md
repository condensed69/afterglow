# PR 1 (next-roadmap) — Brand Endorsements: the repeatable Renown sink

First PR of the post-replay roadmap (design: `.hermes/plans/2026-08-16_next-roadmap.md`).
The five Brand perks are a finite sink (~58 Renown maxes them in ~5 sales) — once
maxed, the sell loop's Renown has nothing to spend on. **Brand Endorsement** is the
repeatable sink: +2% all cash per level, forever, at an escalating cost.

## What ships

- **Brand Endorsement card** under the five Brand perks in the Perks panel:
  `All cash income +2% per level, forever.` — always visible, so the next
  endorsement is a goal line even before the first sale ("15 Renown short").
- **Escalating cost** — `endorsementCost(g) = floor(15 × 1.35^level)` (15, 20,
  27, 37, 50, 67…). Cost growth outpaces the linear +2%, so the sink never
  needs a cap: every franchise sale has a permanent spend target.
- **Composition point** — folds into the single `totalCashMult(g)` as
  `(1 + 0.02 × brandLevel(g))`, so passive income AND clicks/whale/golden all
  scale (same routing as Nationwide Reach).
- **New account field `g.brandLevel`** (additive integer ≥ 0, fail-closed in
  `sanitizeG`/`completeImportedG`, default 0 in `fresh()`). **Persists through
  every reset, like brand ranks** — the PR #77 lesson applied: `confirmPrestige`,
  `startChallenge`, AND `confirmFranchiseSale` all snapshot and restore
  `brandLevel` (the challenge-start path was the one that used to wipe brand).
- **Multi-tab safe**: `tabStale` guard, locked view-model, `checkAchievements`
  in-call, fail-closed normalization — the four review-bot conventions.

## Gates (all run locally, same as CI)

| Gate | Result |
|------|--------|
| `node --check game.js` | ✅ |
| `node economy.test.mjs` | ✅ 285 passed (280 + 5 new: buy/escalation/shortage, totalCashMult ×1.02/level incl. rates(), every-reset preservation, sanitize/import parity, renderVals card) |
| `node pacing.mjs` | ✅ all main-run milestone bands **bit-identical** to the 0.11.11 baseline (rail 1.53 / crew 7.70 / patrons 5.70 / LED 14.35 / research 19.85 / all-upgrades 32.00 / all-research 105.18m) + prestige/second-room/renown scenarios — the bot never buys endorsements, and `brandLevel` defaults to 0 → ×1.0 in the deterministic path |

## Docs touched

- `DESIGN.md` §22.4 (new: Brand Endorsement — formula, composition point,
  every-reset persistence, non-goals clarification: a permanent multiplier,
  never a Renown → cash exchange).
- `PRESTIGE.md` — §10.1 currency/id tables, §10.3 persist matrix (`g.brandLevel`
  row), §10.4 sink line, §10.9 non-goals: the §8.9 "only Renown sink in v1"
  line is **superseded** by the endorsement (same supersession pattern as
  SECOND_LOCATION.md §11 in PR #77).
- `REPLAY_ROADMAP.md` §8.9 — the "only Renown sink in v1" non-goal marked
  superseded, with the endorsement's rail argument.
- `README.md` — Renown bullet extended with the endorsement.
- `SECOND_LOCATION.md` §4 — `brandLevel` added to the account-level field list
  (THREE-place sync with `ACCOUNT_FIELDS` in economy.test.mjs).
- `VERSION` 0.11.11/224 → **0.11.12/225**; in-file `CHANGELOG` entry added
  (newest first, per repo convention).

## SAVE_VER

**Bumped to 11** (repo convention — a new persisted field bumps even when
additive; PR 6 bumped 9→10 for the same class). `g.brandLevel` is an additive
integer ≥ 0 with a no-clobber `MIGRATIONS[10](g)`: v10 saves load by defaulting
`brandLevel` to 0, valid values pass through untouched; `sanitizeG` /
`completeImportedG` run the same fail-closed shape after the chain. Backward
compat: v9/v10 saves migrate automatically (chain 9→10→11).

## Spine claim (per the roadmap's locked format)

**Reason to reset:** the endorsement is the reason to sell again — after the
five Brand perks max out (~sale 5), every sale's +14 Renown buys the next
endorsement level, so the sell loop never dead-ends.
