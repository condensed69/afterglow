# #134 · YELLOW-6 — Session strip: earned vs spent, no fake loss

**Branch:** `ux/fix-5-session-strip-spend` → `main`  
**Version:** 0.11.33 / build 246 · **SAVE_VER 13** (unchanged)

## What
The Ledger "This session" Cash delta no longer lies. It was `c.cash - snap.cash` — manager auto-buys spend cash, so a returning player with managers saw `Cash −$219K` while the away line said +$4.67M earned. First number on screen read as money lost.

Now: transient `this.sessionSpent` counter (render-only, never persisted) increments at the five cash-spend sites — `buyBuilding`, `buyUpgrade`, `autoBuyManagers`, `hireCrew`, `buyRound` — and the strip renders `+$E earned · −$S spent` (`E = max(0, cash−snap+spent)`). Earned green, spent pink, dot separator. When `spent===0` keeps today's single-value `+$X` format — no churn for click/idle sessions.

Research spends Clout, not cash — not counted (correct).

## Why
Money-state trust — the strip is the first number a returning player reads. A big negative that is actually spending destroys trust in the sim.

## How tested
- `node --check game.js` · `node economy.test.mjs` 321 passed · `node pacing.mjs` 5/5 PASS bit-identical.
- New test: `session strip shows earned vs spent after a cash purchase` — `renderVals` to snap at 500 cash, `buyBuilding(rail)` 140, asserts `sessionSpent===140`, second `renderVals` Cash `includes('·')`, starts `+$`, spent present, `earned>=0`, cumulates on second buy, and `JSON.stringify(g)` excludes `sessionSpent`/`sessionSnap` (transient).

## Risk
Low. One transient field + five `+= price` lines next to existing `c.cash -= price`. Pacing bot never reads `sessionDeltas`.

## Pacing
Bit-identical — render-only. `node pacing.mjs` quoted in CI: 1.53m / 5.70m / 7.70m / 14.35m / 19.85m / 32m / 105.18m / 311.70m / 5.45M 54.5% ★1, identical to 0.11.32.

## Gates
| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | 321 passed |
| `node pacing.mjs` | all 5 PASS |

## SAVE_VER
13 — `sessionSnap`/`sessionSpent` are in-memory on the `Game` instance, reset on first render, never written to `localStorage`.

## Skipped
Brand perk / Legacy spend not in the strip — cash only. Add when the Ledger grows a separate Renown/Legacy delta.

