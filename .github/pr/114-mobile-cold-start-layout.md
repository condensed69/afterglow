# PR B — mobile cold-start layout: goal-card auto-scroll + pinned stage-CTA (0.11.28)

## What

Adversarial-UX follow-up (YELLOW: "first-building buy row below the fold on
390×844" + verified WHITE: "stage-CTA position:fixed scrolls with the grid").
Browser-verified geometry at 390×844 on `main @ b720f04`:

1. **Buy row below the fold.** The Tip Rail card's ×1/×5/×10/×Max row renders at
   viewport y≈811–855 while the `.shell-grid` visible band ends at 816 — the first
   purchase buttons are cut off and the player must discover inner scroll with no
   affordance. Content above the fold drifts with state (VISION block, banners,
   log lines), so pixel-trimming is fragile; the robust fix is guidance, not CSS
   compaction.
2. **Stage-CTA is not pinned.** `.shell-grid { will-change: transform }` (0.11.22)
   establishes a containing block for `position: fixed` descendants, so the mobile
   `.stage-cta` (Work the room / Buy a round, documented "stays pinned while the
   shell scrolls") scrolls away with the content — verified: it moves by exactly
   the scroll delta. It vanishes exactly when the player scrolls to find the buy
   row. Browser probe: swapping to `will-change: scroll-position` restores the pin
   (bottom stays 28px above the viewport footer, unchanged under scroll) while
   keeping the 0.11.22 GPU-scroll compositing hint (scroll-position is the
   canonical hint for a scroller; it does not create a containing block).

## Changes

- **game.js** — one guarded hook at the end of `render()` (after the
  `[data-scroll]` restore): on ≤900px viewports, when the active goal targets a
  Club-tab building (`rail`/`word`/`backstage`/`roster`) and that card's buy row
  sits below the visible band (minus the pinned CTA's height), scroll the shell by
  exactly the overflow, once per goal (`state.autoScrolledGoal`, transient UI
  state — never persisted). No-op in test harnesses (stubbed DOM + no
  `innerWidth`). Goal 1 targets the CTA itself (already visible); crew-tab hire
  card is at the top of its tab.
- **style.css** — mobile-only (≤900px block) `.shell-grid`: `will-change: transform`
  → `will-change: scroll-position`, with a comment recording the containing-block
  root cause. Desktop layout untouched (desktop shell-grid doesn't scroll).
- **game.js** — `VERSION` 0.11.27 → **0.11.28**, build 240 → **241**, CHANGELOG
  entry.
- **DESIGN.md** — §14.1 0.11.22 bullet amended with the 0.11.28 follow-on.

## Gates

- `node --check game.js` / `node --check catalogs.js` — pass
- `node economy.test.mjs` — N passed, 0 failed
- `node pacing.mjs` — full suite, bands bit-identical (render-path + CSS only; the
  bot sim never renders and never queries the goal-card hook)

## Save shape

None. `state.autoScrolledGoal` is transient UI state (like `sessionSnap`,
`autoScrolledGoal` never enters `g`) → SAVE_VER stays 13.

## Verification performed

- 390×844 emulation: buy row 811→855 vs shell bottom 816 (cut off); goal-2 card
  scroll brings the row to a visible band (measured).
- `will-change` override test: CTA pins at 692–816 and stays fixed under
  `scrollTop=300` with both `auto` and `scroll-position` variants (headless;
  real-device scroll-smoothness is the one thing to eyeball after merge).