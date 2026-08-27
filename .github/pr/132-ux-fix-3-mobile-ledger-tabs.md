## Summary — RED-3 + YELLOW-4: the mobile play surface can't be exiled by the Ledger or out-scrolled by tabs

Two tickets, one mobile media block, one CSS-only PR:

- **RED-3** — expanding the Ledger buried the whole game. The expanded mobile
  ledger (six resource rows + Floor) measured 852px + a 117px spacer, pushing
  the Systems column to y≈1260 against a 844px viewport; one tap on the `▸`
  toggle (order:-1, thumb-reachable) exiled tabs, goals, and cards ~1000px
  below the fold.
- **YELLOW-4** — the tab bar (`position: relative`) sat below the ledger block
  and scrolled away on long tabs; every tab switch needed a scroll-up first.

## Fix (style.css only, both inside `@media (max-width: 900px)`)

1. **`.ledger-detail`** → `max-height: min(45vh, 420px); overflow-y: auto`.
   The 0.11.18 collapse animation is `max-height`-based, so this is a cap on
   the same mechanism — expand/collapse still animates, the expanded detail
   gets its own scroll, and the toggle stays in the ledger header row
   (order:-1). At 390×844 the cap is 380px — the tab row and first System
   cards stay in the viewport.
2. **`.tab-bar-wrap`** → `position: sticky !important; top: 0; z-index: 10`.
   The `!important` is load-bearing: game.js bakes an inline
   `position:relative` into the `.tab-bar-wrap` div, which beats any plain
   stylesheet rule — the same override pattern as the 0.11.18 CTA-glow rule
   in this media block. Mobile is a single scroller (`.shell-grid` carries
   `data-scroll="main"` and is the only scroll container below 900px), so
   sticky resolves against the page scroller. `z-index: 10` sits under
   `.stage-cta` (20) and modal backdrops (60) — correct: the pinned action
   bar and modals still win. The `::after` edge fade rides along (absolute
   inside a positioned ancestor). Desktop (≥901px) is untouched — the rule
   lives in the mobile block and the inline `position:relative` still
   applies there.

No JS, no template, no palette/type change — the neon is untouched. No save
shape (**SAVE_VER stays 13**).

## Verification

- Browser (Chromium emulation, 390×844): ledger expand keeps the tab row and
  first System card visible after scrolling to top; at `scrollTop` 1500 the tab
  bar is pinned and taps land without scrolling. Both short-tab and long-tab
  states checked.
- Gates: `node --check` pass; `economy.test.mjs` unchanged, still run;
  `pacing.mjs` full suite — CSS-only change, bands bit-identical (quoted
  below).

## Gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | **317 passed, 0 failed** (unchanged — CSS-only) |
| `node pacing.mjs` (full five scenarios) | pass — bands byte-identical |

### Pacing bands (bit-identical reference; unchanged — no JS path touched)

```
Milestone                          Hit          Target            Band  Status
------------------------------------------------------------------------------
First building (rail)            1.53m     ~2 min ±25%     1.50m–2.50m  PASS
First crew                       7.70m    5–8 min ±25%    3.75m–10.00m  PASS
10 patrons                       5.70m     ~6 min ±25%     4.50m–7.50m  PASS
First upgrade (LED)             14.35m  12–18 min ±30%    8.40m–23.40m  PASS
First research                  19.85m    ~25 min ±30%   17.50m–32.50m  PASS
All upgrades owned              32.00m    ~32 min ±30%   22.40m–41.60m  PASS
All research owned             105.18m   ~105 min ±30%  73.50m–136.50m  PASS
------------------------------------------------------------------------------
```

## Docs

`DESIGN.md` §14.1 (narrow screens — collapsible Ledger) amended with the
0.11.31 cap + sticky tab bar. `README.md` grep: no mobile-layout description.
`CHANGELOG` + `VERSION` → **0.11.31 / 244**. `SAVE_VER` unchanged at 13.