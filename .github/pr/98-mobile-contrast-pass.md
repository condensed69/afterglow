## Summary

The 2026-08-28 headless mobile audit (390×844 emulated, real-pointer verified)
found the 0.10.14/0.10.17 REDs still fixed (tap targets 0/54 undersized, Ledger
collapse round-trips, sticky tabs, `100dvh` holds, zero JS errors) but measured
three contrast failures — the dimmest text tones sit under the WCAG AA floor on
the exact small font sizes phones magnify least:

| Token | Was | On `#07050c` | Used for |
|---|---|---|---|
| `#4a3860` | 1.96:1 | FAIL | night-log timestamps, locked crew steppers, Buy-a-round |
| `#6f5885` | 3.29:1 | FAIL | tab hints, requirement/meta lines, look-panel values,.Owner's-List flavor |
| `#7b5f90` | 3.75:1 | FAIL | Ledger/Shift/House/Room-energy/Assignments micro-labels, inactive tabs |

All three collapse to one readable muted purple, **`#8f6f9c` — 4.75:1 on the
page background, 4.49:1 on the control backgrounds (`#120c1c`, `#1f1430`)**
these texts sit on. Same hue family, so the neon-noir palette reads
unchanged; dim hierarchy comes from size/weight, not near-invisibility.

Plus: the mobile-only 8px header labels (wordmark sub-line, version-button
sub-text — `style.css` ≤900px block) rise to 9px.

Affects desktop too — the same tokens render there — which is the point:
contrast is a property of the palette, not the viewport.

## Approach

Pure color/size swaps in the render layer and the mobile media block:
`s/#4a3860/#8f6f9c/`, `s/#6f5885/#8f6f9c/`, `s/#7b5f90/#8f6f9c/` in `game.js`
(41 occurrences total), two `font-size: 8px !important` → `9px` in
`style.css`. No layout, no selectors, no behavior, no balance, no save shape
(SAVE_VER stays 13).

## Verification

- `node --check game.js` PASS
- `node economy.test.mjs` → **323 passed, 0 skipped, 0 failed**, exit 0
- `node pacing.mjs` (full five-scenario) → exit 0, all milestones in band,
  prestige/second-room/renown/mid-band/endgame pass (render-only change,
  bands bit-identical)
- Contrast math re-checked numerically post-edit: `#8f6f9c` = 4.75:1 page /
  4.49:1 controls (WCAG AA normal text 4.5:1, large/bold ≥3:1 — all roles pass)

## Save version

**Unchanged (SAVE_VER 13).** `VERSION` advanced 0.11.37 → 0.11.38 / build 251
with a matching `CHANGELOG` entry (render-only contrast pass).

## Docs updated

- `DESIGN.md` — §14.1 "Contrast floor (v0.11.38)" bullet with before/after
  measurements; Spec target bumped to 0.11.38.
- `game.js` — `VERSION` + `CHANGELOG` top entry.

## Files

- `game.js` — color token swaps, VERSION, CHANGELOG
- `style.css` — 8px → 9px mobile header labels
- `DESIGN.md` — §14.1 contrast bullet + spec target
- `.github/pr/98-mobile-contrast-pass.md` — this body
