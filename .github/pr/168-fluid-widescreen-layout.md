# feat: fluid widescreen layout & UX polish (0.15.1 / build 291)

## What

Eliminates the wasted 460px+ dead side gutters on desktop/widescreen displays and applies the accompanying canvas + UX polish from `FLUID_LAYOUT_PLAN.md`:

- **`style.css`** — `.shell-grid` is no longer a hard-capped 1460px centered island. It is now a fluid full-viewport 3-column grid, `grid-template-columns: minmax(260px, 320px) minmax(440px, 1fr) minmax(360px, 480px)`, with `padding-inline: 18px` that matches the header and ticker bar so the shell sits flush under the brand title and right-side controls. The center stage column absorbs all leftover width via `1fr`.
- **Ultrawide guard** — a `@media (min-width: 2160px)` media query re-caps the layout at 2200px (`340px 1fr 520px`, centered) so the fluid center column cannot stretch into illegible proportions on 3440px ultrawide and 4K monitors.
- **`src/ui/floorboard.js`** — crowd-particle spawn spread and the two sweeping spotlight beams now scale proportionally with canvas width (previously particles clustered in the old 720px zone and beams used a fixed 60px offset from center). Grid rays already radiated from `w * 0.5`, so they adapt automatically.
- **`game.js`** —
  - Right-panel building **Max** button: when affordable count is 0 it renders **`Max (0)`** with disabled styling instead of the unhelpful `×0`.
  - Ticker bar text gains a 4px left pad so the initial letter (`T` in `TODAY`) no longer clips against the overflow bounds.
  - Header **Police Heat** meter adds a subtle pink warning glow above 50% so players anchored to the center action bar notice an impending raid.
  - `VERSION` bumped to `0.15.1`, build 291; matching changelog entry.
- **`economy.test.mjs`** — version-pin assertion updated `0.15.0` → `0.15.1`.
- **`DESIGN.md`** — §14.1 shell-grid column spec updated and the spec target bumped to 0.15.1.

## Why

On any desktop monitor the old `max-width: 1460px; margin-inline: auto` grid floated as a narrow centered island flanked by black dead space (460px on 1920×1080, 1100px on 2560×1440). The header and footer already span 100% width, so the shell was visually disconnected from them, and the stage modestly capped at 720px never took advantage of the available canvas. This change makes the layout use the viewport it is given, keeping text readable through per-column minimums and the ultrawide guard.

## Verification gates

Run locally on the feature branch before opening the PR:

| Gate | Result |
|------|--------|
| `node --check game.js` | ✅ pass |
| `node --check src/ui/floorboard.js` | ✅ pass |
| `node economy.test.mjs` | ✅ 363 passed, 0 skipped, 0 failed |
| `node pacing.mjs --fast` | ✅ all milestones within band; bit-identical |

CI runs the same gates on this PR (`.github/workflows/gates.yml`) as required status checks.

## Docs touched

- `DESIGN.md` (§14.1, spec target) — the only docs file referencing the shell-grid dimensions and system cut-off version.

## SAVE_VER moved? (No)

Stays `16`. No save shape changes — all edits are CSS, render-layer labels/styling, or cosmetic canvas scaling. No migration required.

## VERSION moved? (Yes, 0.15.1)

`VERSION.num` `0.15.0` → `0.15.1`, `build` 290 → 291, codename `Fluid Widescreen Layout`. `CHANGELOG` gained a matching `0.15.1` entry. `economy.test.mjs` version-pin assertion updated to match.