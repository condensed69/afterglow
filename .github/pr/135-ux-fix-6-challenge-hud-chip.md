# #135 · YELLOW-7 — Challenge-active HUD chip with End affordance

**Branch:** `ux/fix-6-challenge-hud-chip` → `main`
**Version:** 0.11.34 / build 247 · **SAVE_VER 13** (unchanged)

## What
An active challenge had no persistent HUD indicator — only one log line on start (`push` at 3176). Ticker is flavor text; escape hatch lives in Perks (after RED-1 fix) but invisible mid-run. Now: pinned banner between ticker and stage — `Challenge active: <name> T<n>` with `End` button calling existing `endChallenge()` (`g.challenge → null`). Reads `g.challenge + g.challengeTier` via `activeChallenge()`; render-only, no new state, no save shape.

## Why
Visibility + escape — challenge modifies income/locks buildings, player needs constant reminder + one-tap exit without hunting Perks.

## How tested
- `node --check game.js` · `node economy.test.mjs` 323 passed · `node pacing.mjs` 5/5 PASS bit-identical (bot never starts challenges).
- New test: `challenge HUD chip shows when g.challenge is active` — null when idle, `label` includes name + `T2` when `tight T2`, `endChallenge` invocable clears `g.challenge` and chip vanishes. Existing surface sweep covers bound click handler.

## Risk
Low. One view-model field + one conditional banner (pinned above `shell-grid`, outside scrollable region, z-index irrelevant — not a modal). Existing `endChallenge` unchanged.

## Pacing
Bit-identical — render-only, challenge never active on bot path. `node pacing.mjs` quoted: 1.53m / 5.70m / 7.70m / 14.35m / 19.85m / 32m / 105.18m / 311.70m / 5.45M 54.5% ★1.

## Gates
| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | 323 passed |
| `node pacing.mjs` | all 5 PASS |

## SAVE_VER
13 — `challengeChip` is derived from `g.challenge`/`g.challengeTier` at render time, never persisted.

## Skipped
No CSS, no modal — banner reuses existing ticker/golden banner placement. Add when chip needs tier color or reward preview.
