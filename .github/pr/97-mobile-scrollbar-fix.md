## Summary

The mobile scrollbar was stuck and jittery: a persistent classic scrollbar that
appeared, disappeared, and jumped as content height changed (the log appends
every few seconds, the Ledger expands/collapses), and a "stuck" feel at the
top/bottom edges. Three causes, all mobile-scoped — desktop is untouched:

1. **Custom scrollbar styling was global.** `::-webkit-scrollbar` was styled
   unconditionally (9px purple bar). On Android Chrome, styling the
   pseudo-element forces a persistent *classic* scrollbar with a reserved
   gutter, instead of the native auto-hiding overlay bar. As content height
   changed, that bar toggled on/off and the 9px gutter appeared/disappeared —
   the jitter, plus a permanent "weird" bar. The styling now lives behind a
   `(hover: hover) and (pointer: fine)` gate, so touch devices keep the native
   overlay bar with no gutter. Desktop keeps the purple bar, pixel-identical.

2. **No overscroll containment on the mobile scroller.** The shell
   (`.shell-grid`) is the only scroller below 900px; without containment,
   reaching the top or bottom handed the gesture to the browser
   (pull-to-refresh on Android, rubber-band chaining) — the "stuck" edges.
   `overscroll-behavior-y: contain` keeps the gesture inside the shell, plus
   `-webkit-overflow-scrolling: touch` for legacy iOS momentum (no-op on
   modern engines).

3. **The 0.11.18 film-grain layer re-blended the whole screen per scroll
   frame.** It is a fixed, full-viewport element with `mix-blend-mode: overlay`
   — on a coarse pointer the compositor re-blends the entire viewport on every
   scroll frame, which reads as scroll stutter on mobile GPUs. Coarse pointers
   now use `mix-blend-mode: normal` (same texture at opacity .035, a fraction
   of the cost). Desktop keeps the overlay blend.

## Approach

CSS-only, mobile-scoped. The `::-webkit-scrollbar` block moved into a media
query verbatim (no rule changed, only gated); `overscroll-behavior-y` /
`-webkit-overflow-scrolling` added to the existing `@media (max-width: 900px)`
`.shell-grid` block; one `@media (hover: none) and (pointer: coarse)` override
for the grain blend. No render path, no behavior, no balance, no save shape
(SAVE_VER stays 13).

## Verification

- `node --check game.js` PASS
- `node economy.test.mjs` -> **301 passed, 0 skipped, 0 failed**, exit 0
- `node pacing.mjs --fast` (the CI gate) -> exit 0, all 34 milestone checks
- Emulated Chrome 124, Pixel 7 (390x844, touch, coarse pointer):
  - the scrollbar-styling media gate excludes the device (`(pointer: fine)`
    false), so the custom bar CSS does not apply — native overlay bar, no
    reserved gutter (`offsetWidth - clientWidth == 0`)
  - shell computed `overscroll-behavior-y: contain`,
    `-webkit-overflow-scrolling: touch`, `overflow-y: auto`
  - grain computed `mix-blend-mode: normal`, opacity .035 (texture intact)
  - programmatic `scrollTop = 300` lands (shell scrolls normally)
- Desktop (fine pointer): gate active, grain `overlay` — unchanged.

## Save version

**Unchanged (SAVE_VER 13).** `VERSION` advanced 0.11.18 -> 0.11.19 / build 232
with a matching `CHANGELOG` entry (mobile scroll/CSS fix only).

## Docs updated

- `DESIGN.md` — "Narrow screens — native scrollbars (0.11.19)" note under the
  one-scroller section (overlay bars on touch, overscroll containment, grain
  blend split).
- `game.js` — `VERSION` + `CHANGELOG` top entry.

## Files

- `style.css`
- `game.js` (version bump + changelog only)
- `DESIGN.md`
- `.github/pr/97-mobile-scrollbar-fix.md` (this body, added after open)