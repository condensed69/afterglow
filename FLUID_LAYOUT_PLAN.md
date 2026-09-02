# Afterglow UI Enhancement Plan: Fluid Widescreen Layout & Side-Gutter Elimination

## 1. Problem Statement & Root Cause

### Symptoms
On desktop monitors (standard 1080p, 1440p, and ultrawide screens), large empty black side gutters flank the central gameplay layout, wasting valuable screen real estate. The top header and bottom footer span 100% of the viewport width, while the 3-column game shell is constrained inside a narrow, centered island.

### Root Cause in `style.css`
```css
/* style.css:222-227 */
.shell-grid {
  display: grid;
  grid-template-columns: minmax(232px, 300px) minmax(320px, 720px) minmax(320px, 440px);
  width: 100%;
  max-width: 1460px;
  margin-inline: auto;
  min-height: 0;
}
```
1. **Hard Maximum Caps**: Every column has a fixed upper pixel limit (`300px`, `720px`, `440px`), totaling exactly `1460px`.
2. **Fixed `max-width` Constraint**: `max-width: 1460px; margin-inline: auto;` locks the entire grid into a static box. On a 1920x1080 monitor, **460px** of screen width is wasted as dead black margins. On 2560x1440, **1100px** is wasted.
3. **Header/Shell Disconnect**: The header (`#app-header`, `padding: 0 18px`) and ticker bar (`padding: 3px 18px`) span 100% width, making the centered 1460px grid appear misaligned with the logo on the left and controls on the right.

---

## 2. Architecture & Design Solution

### A. Fluid 3-Column Grid (`.shell-grid`)
Replace the rigid `1460px` box with a responsive, fluid grid spanning full viewport width:

```css
.shell-grid {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(440px, 1fr) minmax(360px, 480px);
  width: 100%;
  max-width: 100%;
  padding-inline: 18px; /* Matches header and ticker padding */
  gap: 0;
  min-height: 0;
  min-width: 0;
  overflow: auto;
}
```

* **Left Panel (Ledger / Vitals): `minmax(260px, 320px)`**
  - Keeps financial metrics, rate gauges, and club status readable without over-stretching text.
  - Aligns flush with the **Afterglow Club Idle** brand title in the header.
* **Center Panel (Stage / Dance Floor & Actions & Log): `minmax(440px, 1fr)`**
  - Expands dynamically with `1fr` to occupy all available center space.
  - The HTML5 Canvas floorboard dynamically fills the wider stage, providing an expansive, lively club venue.
  - Action buttons (`WORK THE ROOM`, `Buy a round`, `Stock`, `Beat Drop`) receive comfortable spacing and visual prominence.
  - Night Log gains horizontal space, eliminating cramped line wrapping.
* **Right Panel (Cockpit / Systems / Upgrades): `minmax(360px, 480px)`**
  - Gives building cards, multiplier buttons (`×1 ×5 ×10 Max`), and goal cards sufficient breathing room.
  - Aligns flush with the right-side header controls (Shift status, Heat badge, sound, settings).

### B. Ultrawide Display Guard (> 2160px)
For ultrawide (3440px) or 4K monitors, prevent excessive distortion by constraining max layout width to 2200px while maintaining the fluid center:
```css
@media (min-width: 2160px) {
  .shell-grid {
    grid-template-columns: 340px 1fr 520px;
    max-width: 2200px;
    margin-inline: auto;
  }
}
```

### C. Canvas Floorboard Adaptation (`src/ui/floorboard.js`)
- `FloorboardEngine` already observes `canvas.parentElement` via `ResizeObserver` and invokes `resize()`.
- Ensure particle generation, spotlight beams, and grid projection scale across the full canvas width rather than clustering within a 720px zone.

### D. Accompanying UX & Layout Polish
1. **Right Panel `×0` Multiplier Fix**: In `game.js` building renderers, when the player cannot afford any units of a structure, render `Max (0)` with disabled styling rather than an unhelpful `×0`.
2. **Ticker Bar Left Padding / Clipping**: Fix the ticker text container so the initial character (e.g. `T` in `TODAY`) is never cut off by overflow bounds.
3. **Police Heat Indicator Visibility**: Add a subtle warning glow to the header Heat meter when Police Heat exceeds 50% so players focused on the center action bar notice impending raids.

---

## 3. Implementation Steps

1. **Feature Branch Creation**:
   - MUST use `.githooks/new-branch.sh <slug>`:
     ```bash
     .githooks/new-branch.sh fluid-widescreen-layout
     ```
   - Never run raw `git checkout -b`.
2. **CSS Layout Updates**:
   - Edit `style.css`: update `.shell-grid` desktop rule to fluid `100%` width with `minmax(260px, 320px) minmax(440px, 1fr) minmax(360px, 480px)` and `padding-inline: 18px`.
   - Add ultrawide media query guard for `min-width: 2160px`.
3. **Canvas Floorboard Refinements**:
   - Edit `src/ui/floorboard.js`: ensure particle horizontal bounds, light beams, and perspective focal points adjust cleanly to wider canvases.
4. **UX Polish**:
   - Edit `game.js`: fix `×0` button label to `Max (0)` with disabled state; ensure ticker text has clean padding.
5. **Local Verification Gates**:
   - Syntax validation: `node --check game.js && node --check src/ui/floorboard.js`.
   - Unit tests: `node economy.test.mjs` (must pass 363/363 tests, 0 failures).
   - Reference bot pacing: `node pacing.mjs --fast` (must be 100% bit-identical across all bands).
6. **PR Creation & Durable Body**:
   - Write PR body artifact at `.github/pr/<number>-fluid-widescreen-layout.md` covering:
     - What changed
     - Why
     - Verification gates run and results
     - Documentation files touched
     - SAVE_VER moved? (No)
     - VERSION moved? (0.15.1 patch bump)
   - Push branch and open pull request via `gh pr create`.

---

## 4. OpenCode Review Protocol (`/oc review` Mandate)

All code pushed to pull requests must pass the automated OpenCode review protocol before merging:

### 1. Mandatory Review Invariant
- For **EVERY** commit pushed to the PR branch, comment `/oc review` on the PR:
  ```bash
  gh pr comment <PR_NUMBER> --body "/oc review"
  ```
- No unreviewed code merges to `main`.

### 2. Workflow Monitoring
- Watch the GitHub Actions `opencode` workflow execution:
  ```bash
  gh run watch $(gh run list --workflow opencode --limit 1 --json databaseId -q '.[0].databaseId')
  ```
- Await workflow completion (`status: completed, conclusion: success`).

### 3. Review Analysis & Remediation Loop
- Retrieve review comments via `gh pr view <PR_NUMBER> --comments`.
- Read and classify all findings:
  - **High / Blocking**: Code defects, sanitization bypasses, unbounded loops, broken state invariants, missing documentation rows.
  - **Medium**: Catalog divergence, type guards, missing edge-case handling.
  - **Low / Nits**: Typo cleanups, stylistic suggestions, unused variables.
- For any identified finding:
  1. Apply code or documentation fixes.
  2. Run local verification gates (`node --check ...`, `node economy.test.mjs`, `node pacing.mjs --fast`).
  3. Commit fixes with a descriptive commit message.
  4. Push commit to branch.
  5. Re-trigger `/oc review`.
  6. Repeat until the reviewer outputs formal approval:
     > *"Recommendation: Approve. No blocking defects."*

### 4. Squash-Merge & Post-Merge Verification
- Once approved with zero blocking defects:
  ```bash
  gh pr merge <PR_NUMBER> --squash --delete-branch
  ```
- Pull `main` locally and run the full verification gate suite on `main`:
  ```bash
  git pull origin main
  node --check game.js && node economy.test.mjs && node pacing.mjs --fast
  ```
- Close out session with `/recap` skill.
