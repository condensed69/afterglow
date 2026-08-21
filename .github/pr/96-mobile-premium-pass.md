## Summary

A focused premium pass on the mobile surface, working within the existing
neon-noir language (palette, fonts, and layout untouched). The audit found
three genuine gaps on the whole surface, not just mobile:

1. **No visible focus indicator anywhere** — `:focus-visible` was absent from
   the entire app. Now every button, link, `[tabindex]` control (including the
   inline help `?` icons) and Look-panel input gets a 2px cyan ring (offset 2px).
2. **Interactive states only on `.cta` / `.hv-*`** — most inline-styled buttons
   had no hover or press feedback. Every button now gets a smooth
   `filter/opacity/transform` transition, hover brightness, press
   translateY + dim, and disabled buttons read inert (`opacity:.6`,
   `not-allowed` cursor).
3. **Flat, purely-digital panels** — a fixed, `pointer-events:none` film-grain
   overlay (inline SVG `feTurbulence`, `opacity:.035`, `mix-blend-mode:overlay`)
   adds texture without washing out the neon.

Mobile-specific: the primary CTA's 22px pink bloom is pulled tight to
`0 3px 14px rgba(255,45,120,.22)` below 900px — an idle game sits on OLED
panels for hours and the wide bloom read as glare.

## Approach

CSS-only, deliberately. The sim UI is built with ~284 inline styles from
`game.js`, but `filter` / `opacity` / `transform` / `outline` / `transition`
are set on almost no button, so a plain stylesheet rule applies everywhere
without `!important` (the only `!important` is the CTA glow, which must beat
the inline `box-shadow`). No render path, no behavior, no balance, no save
shape — the inline styles were already internally consistent; the missing
layer was the global/interactive/texture one, which lives in stylesheet
territory. This is why the game.js side of the planned "targeted inline-style
upgrades" resolved to zero edits.

## Verification

- `node --check game.js` PASS
- `node economy.test.mjs` -> 301 passed, 0 skipped, 0 failed, exit 0
  (run on this exact `game.js` content; the later rebase onto `bced35c` is a
  no-op for content — that commit only touches `.github/workflows/opencode.yml`)
- `node pacing.mjs --fast` (the CI gate) -> exit 0, all 34 milestone checks
- `node pacing.mjs` (full local suite) -> pre-existing environmental failure
  on this machine, verified identical on baseline: the renown scenario's 5m
  wall-clock budget is exceeded at ~306-310m sim because this box sims roughly
  one sim-minute per wall-second (needs ~8m for a ~480m sim). The band
  assertions themselves all pass; this is the issue #92 liveness guard, not a
  regression. CI runs `--fast`, which passes.
- Visual verification in headless Chrome (390x844): cyan focus ring renders on
  keyboard Tab, grain overlay computed at opacity .035 / z 999 / overlay,
  button transition `filter, opacity, transform`, disabled at opacity .6; no
  layout regressions vs baseline screenshot.

## Save version

**Unchanged (SAVE_VER 13).** `VERSION` advanced 0.11.17 -> 0.11.18 / build 231
with a matching `CHANGELOG` entry (visual-only release).

## Docs updated

- `DESIGN.md` — new "Surface layer — universal states & texture (0.11.18)"
  section documenting the focus/interactive/texture layer and the mobile CTA
  glare change; the visual-invariant line still holds (neon-noir, no
  performer figure).
- `game.js` — `VERSION` + `CHANGELOG` top entry.

## Files

- `style.css`
- `game.js` (version bump + changelog only)
- `DESIGN.md`
- `.github/pr/96-mobile-premium-pass.md` (this body, added after open)