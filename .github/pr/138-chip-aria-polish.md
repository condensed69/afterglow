# #138 · Challenge chip a11y — title + aria-label on End

**Branch:** `ux/chip-aria-polish` → `main`
**Version:** 0.11.37 / build 250 · **SAVE_VER 13** (unchanged)

## What
HUD chip `End · no reward` button had no `title`/`aria-label` — screen readers announced bare "End", hover gave no hint. Now `title="End challenge — no reward"` + `aria-label` matching the Perks-card affordance. One attribute, no visual change.

## Why
A11y is never lazy — persistent 44px control must self-describe.

## How tested
- `node --check game.js` · `node economy.test.mjs` 323 passed · `node pacing.mjs` 5/5 PASS bit-identical (render-only, no economy).

## Risk
None — attribute-only.

## Pacing
Bit-identical.

## Gates
| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | 323 passed |
| `node pacing.mjs` | all 5 PASS |

## SAVE_VER
13

## Skipped
No visual change — add when chip needs tier color or reward preview.
