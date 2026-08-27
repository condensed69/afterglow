# #137 · Docs sweep 0.11.26→0.11.35 (no behavior change)

**Branch:** `ux/docs-sweep-0-11-35` → `main`
**Version:** 0.11.36 / build 249 · **SAVE_VER 13** (unchanged)

## What
DESIGN.md spec target was `0.11.26 / 57 achievements` — shipped 9 PRs since. Now `0.11.35 / 61`, ladder 20/60/65/70, session strip `earned vs spent`, challenge chip (no prefix), golden-over-modals. Header `Spec target` + `Ancestry` updated; milk line already 57 non-burst of 61 total so correct. `game.js` CHANGELOG entry only.

## Why
Docs must match shipped code — stale header breaks reviewer trust.

## How tested
- `node --check game.js` · `node economy.test.mjs` 323 passed · `node pacing.mjs` 5/5 PASS bit-identical (docs-only, no JS economy).

## Risk
None — docs + version bump + changelog.

## Pacing
Bit-identical — no economy change.

## Gates
| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | 323 passed |
| `node pacing.mjs` | all 5 PASS |

## SAVE_VER
13

## Skipped
Full section rewrites — add when new system ships.
