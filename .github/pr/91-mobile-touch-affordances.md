# PR 91 — Mobile touch affordances (MOBILE_IMPROVEMENT_PLAN.md PR 8/9)

## What
- Crew assignment steppers: stable 48px count width, `aria-label` + descriptive `title`.
- ×1 multi-buy button: adds `aria-label` and a Shift/max hint for discoverability.
- Club switcher buttons: `aria-label` on each switcher control.
- Look House-lights slider: adds `::-moz-range-thumb` parity and grows thumb to 28×28px below 900px (desktop stays 14px).
- All touch-critical buttons already enforce 44×44 minimum via the `min-height/min-width` rule; PR widens affordance + a11y, not enforcement.

## Why
MOBILE_IMPROVEMENT_PLAN.md PRs 8–9 (touch affordances + polish). Remaining mobile item — the plan is 91/91 after this.

## Changed files
- `game.js`: stepper `decLabel/incLabel`, escapeHtml on titles, 48px count, multi-buy and switcher aria labels.
- `style.css`: `::-moz-range-thumb` base, mobile 28×28 thumb with dark border.

## Gates
- `node --check game.js` — pass
- `node economy.test.mjs` — 301 passed, 0 failed
- `node pacing.mjs` — all bands PASS, all scenarios passed (exit 0; probe section prints header only — no regression)

## Save / Version
- `SAVE_VER` unchanged (13).
- `VERSION` `0.11.16` build 229 `2026-08-20`.

## Docs
- `CHANGELOG` entry in `game.js` for 0.11.16.

## Risk
Low — CSS-only thumb growth inside existing `@media (max-width: 900px)`, and JS adds attributes/escapes on already-rendered buttons. No economy, save, or pacing change.
