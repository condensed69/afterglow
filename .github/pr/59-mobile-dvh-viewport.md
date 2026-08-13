## Fix: app root uses 100dvh so the footer is reachable on phones

### What this PR does

Fixes the mobile finding "hard to scroll all the way down" (adversarial UX review, 2026-08-13).

**The bug:** the app root was `height:100vh` — on mobile, `100vh` is the URL-bar-**collapsed** viewport height. With the browser chrome visible (the normal state), the visual viewport is ~64px shorter than `100vh`. Because the root clips at `100vh` with `overflow:hidden` and the document itself has nothing left to scroll, the footer (28px) plus the last strip of shell content sat permanently below the fold. Measured: footer at 692–720px vs a 656px visible viewport; `document.scrollHeight === clientHeight`, so no scroll could ever reveal it.

**The fix:** `height:100vh;height:100dvh` — dynamic viewport units track the visible viewport as the URL bar shows/collapses, so the bottom of the page is always reachable. `100vh` remains as the fallback declaration for browsers without `dvh` support (the later declaration wins where supported).

### Changes

- `game.js`: root div inline style (line 2900) — `height:100vh` → `height:100vh;height:100dvh`
- `style.css`: two comments describing the root height updated to match
- `DESIGN.md`: narrow-screens section updated (was `height:100vh; overflow:hidden`)

### Gates

- `node --check game.js` ✅
- `node economy.test.mjs` ✅ (207 passed, 1 skipped, 0 failed)
- `node pacing.mjs` ✅ (all milestones within band, prestige scenario passed)

### Docs touched

- `CHANGELOG`: entry for `0.10.15`
- `DESIGN.md`: narrow-screens section

### SAVE_VER

- Unchanged (8) — no save shape changes, layout-only

### Notes

- Verified live: build 206 renders with both declarations, `100dvh` winning in supporting browsers
- Remaining mobile findings from the review (read-only Ledger occupying the first screen, tabs at 1113px, 36/48 buttons under 44px tap target) are tracked as follow-up tickets, not in this PR
