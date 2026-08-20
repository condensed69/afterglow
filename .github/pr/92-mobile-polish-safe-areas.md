# PR 92 — Mobile polish & safe areas (MOBILE_IMPROVEMENT_PLAN.md PR 9 — final)

## What
- Ledger collapse animates via `max-height`/`opacity` transition (was hard `display:none`).
- Look panel (`#look-panel`) respects `env(safe-area-inset-*)` for notch/home-indicator (bottom/right/max-width).
- Tab bar wrapper (`.tab-bar-wrap`) gains a right-edge fade shadow for horizontal scroll affordance.
- Ledger toggle re-flows thumb-reachable on mobile (`order:-1`).

## Why
Final polish of the mobile 9-PR. Purely CSS/accessibility — no new JS affordances beyond the wrapper class. Closes the last open item in `MOBILE_IMPROVEMENT_PLAN.md` while PR91 (8/9 touch affordances) is in review; both PRs stay open for review before any merge per the workflow.

## Changed files
- `game.js`: adds `tab-bar-wrap` class to the tab bar container (positioning hook); VERSION `0.11.17` build 230; CHANGELOG entry for 0.11.16.
- `style.css`: ledger animated collapse rules, `#look-panel` safe-area, `.ledger-toggle` reflow, `.tab-bar-wrap` fade — all inside existing `@media (max-width:900px)`.

## Gates
- `node --check game.js` — pass
- `node economy.test.mjs` — 301 passed, 0 failed
- `node pacing.mjs` — all milestones PASS, all scenarios passed

## Save / Version
- `SAVE_VER` unchanged (13).
- `VERSION` `0.11.17` build 230 `2026-08-20` — rebased to 0.11.17 to avoid collision with PR91's `0.11.16` build 229 (both off `origin/main 487af7e`).

## Merge order
PR91 merges first (0.11.16/229), then PR92 rebases to `0.11.17`/`0.11.18` as needed. No merge until both clear review.

## Risk
Low — CSS inside existing mobile media query and a single class addition on an already-rendered div. No economy, save, or pacing change.
