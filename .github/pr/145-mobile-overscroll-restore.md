## Summary

Mobile rubber-banding returned: touch gestures at the shell's top/bottom scroll
edges hand off to the browser (rubber-band on iOS, pull-to-refresh hand-off on
Android).

**Root cause (git-verified):** 0.11.19 (PR #97, `e062d3a`) added
`overscroll-behavior-y: contain` to `.shell-grid` inside the `≤900px` block —
the rubber-band fix. 0.11.21 (PR #100, `b1b63f2`) rewrote the adjacent comment
block while disabling button transitions and **silently deleted the
declaration with it** — `git show b1b63f2 -- style.css` shows the rule being
removed. Every build since 0.11.21 shipped without containment; `grep -rn
overscroll` on `main` matches only docs/changelog prose, no live CSS.

## Change

- `.shell-grid` (≤900px): restore `overscroll-behavior-y: contain` verbatim
  from `e062d3a`, with the original comment plus a note on the 0.11.21 loss.
- `.ledger-detail` (≤900px, expanded-Ledger nested scroller added 0.11.31 —
  after the 0.11.19 fix, so it never had containment): same rule, so its edge
  cannot chain the gesture into the shell.

Desktop (≥901px) untouched — both rules live inside the media query.

## Gates

| Gate | Result |
|---|---|
| `node --check game.js` | PASS |
| `node economy.test.mjs` | PASS — 323 passed, 0 failed |
| `node pacing.mjs` | PASS — exit 0, bands bit-identical |

## Docs

- `DESIGN.md` §14.1 — versioned bullet "Narrow screens — overscroll
  containment restored (0.11.42)".
- `game.js` CHANGELOG — 0.11.42 entry; `VERSION` → 0.11.42 / build 255.

## Save shape

`SAVE_VER` stays 13 — CSS-only, no persisted fields, no migration.
