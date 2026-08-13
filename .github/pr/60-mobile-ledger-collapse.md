## Mobile: Ledger collapses to the CASH row; Work the room + tabs become reachable

### What this PR does

Fixes the second mobile finding from the adversarial UX review (2026-08-13): on a 390px phone the full Ledger — six resource rows plus the Floor block — measured **776px tall, taller than the whole viewport**, and sat first in the stacked column. The primary action (**Work the room**, at 703px) and the Systems tabs (at **1113px**) were both below the fold: Barbara scrolls past a wall of read-only numbers before reaching anything she can press.

### The fix

The Ledger now renders **collapsed to the CASH row by default on narrow screens** — the money readout idle players watch stays visible — with a tap-to-expand chevron (▸/▾) for the full stats. Measured after:

| | Before | After |
|---|---|---|
| Ledger height | 776px | **144px** (70px content + padding) |
| Work the room offset | 703px | **219px** (above the fold) |
| Systems tabs offset | 1113px | **331px** (one short scroll) |

**Desktop is untouched:** the toggle button and the collapse rule both live inside the `@media (max-width: 900px)` block, so ≥901px keeps the always-expanded Ledger and never sees the button.

### Changes

- `game.js`: `ledgerOpen` state flag (default collapsed), `toggleLedger` action, ledger markup split into `.ledger-cash` (CASH row, always visible) + `.ledger-detail` (rest), toggle button in the Ledger header
- `style.css`: `.ledger-toggle` hidden by default; inside the ≤900px media query the toggle shows and `.ledger-collapsed .ledger-detail { display: none }`
- `economy.test.mjs`: `ledger collapses to CASH row by default and toggles open` — default state, toggle round-trip, CASH-first row

### Gates

- `node --check game.js` ✅
- `node economy.test.mjs` ✅ (208 passed, 1 skipped, 0 failed)
- `node pacing.mjs` ✅ (all milestones within band, prestige scenario passed)

### Docs touched

- `CHANGELOG`: entry for `0.10.16`
- `DESIGN.md`: no change needed — the narrow-screens section already documents the stacked column; this is a rendering detail of the Ledger panel itself

### SAVE_VER

- Unchanged (8) — no save shape changes; `ledgerOpen` is transient UI state like `tab`

### Notes

- Remaining mobile findings tracked separately: tap targets (36/48 buttons under 44px) — follow-up PR
