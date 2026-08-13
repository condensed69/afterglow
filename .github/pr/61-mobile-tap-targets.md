## Mobile: 44px minimum tap target on every button

### What this PR does

Fixes the last open ticket from the mobile UX review (2026-08-13): **36 of 48 buttons measured under the 44px tap-target minimum**. The offenders:

| Control | Before | After |
|---|---|---|
| ×1/×5/×10/×Max multi-buy row (32 buttons) | 40×30px — Barbara's thumb covered two at once, bought the wrong thing twice | **44×44** |
| Tab bar (Club/Crew/Research) | 38px tall | **44** |
| ☰ hamburger | 34×34 | **44×44** |
| Job steppers (+/−) | 26×26 | **44×44** |
| Version badge | 33px tall | **44** |
| Work the room | 43px tall | **44** |
| Modal + Look-panel buttons | sub-44 | **44** |

### The fix

One CSS rule inside the ≤900px media query:

```css
#app button,
#look-panel button {
  min-height: 44px !important;
  min-width: 44px !important;
}
```

`min-height`/`min-width` override the inline `height`/`width`/`padding` from `game.js` (a min-constraint beats a fixed size), so one rule covers the shell, header, modals (inside `#app`) and the body-mounted Look panel. `!important` is needed only where the multi-buy row carries an inline `min-width:40px` that would otherwise win on specificity. **Desktop is untouched** — the rule lives inside the media query, matching the v0.10.7/v0.10.8/v0.10.16 pattern.

### Verification

Headless Chrome at mobile width, all `#app button` + `#look-panel button` measured: **41 buttons, all ≥44×44** (the single 0×0 exception is the hire-crew CTA inside `#stage`, which is `display:none` on phones and is not a target). Settings modal and Look panel re-checked while open — all ≥44px.

### Gates

- `node --check game.js` ✅
- `node economy.test.mjs` ✅ (208 passed, 1 skipped, 0 failed)
- `node pacing.mjs` ✅ (all milestones within band, prestige scenario passed)

No new test: CSS-only change, unreachable by the DOM-stubbing harnesses — same as the earlier media-query changes (DESIGN.md notes this for v0.10.7).

### Docs touched

- `CHANGELOG`: entry for `0.10.17`
- `DESIGN.md` §14.1: "Narrow screens — tap targets (v0.10.17)" bullet, matching the versioned-bullet pattern the review asked for on #60

### SAVE_VER

- Unchanged (8) — no save shape changes, CSS-only
