# Stage Improvements — shipped notes + remaining runner-up

Written 2026-08-05. Tasks 1–3 (stage width cap, state-driven stage, click feedback) are **shipped** in this branch.  
This document now serves as a brief for the one remaining runner-up: small-screen stacking.

## 0. Repo rules (from AGENTS.md — obey all of them)

- Dependency-free static site: `index.html`, `style.css`, `game.js`. **No npm, no build step, no new files unless necessary.**
- The stage carries **no performer figure** (removed v0.7.0 by operator decision). All stage work is lighting / haze / crowd silhouettes / stage lip only. Do not reintroduce a dancer or pole.
- `VERSION`, the visible build number, and `CHANGELOG` advance together for every behavior change (bump `build` by 1, bump patch version, add a CHANGELOG entry at the top of the array). Do **not** bump `SAVE_VER` (no save-shape changes here).
- Validate: `node --check game.js` after every edit.
- Test: `node economy.test.mjs` must end with `0 failed` (currently 103 passed), `node pacing.mjs` must say `All milestones within band`.
- Balance numbers (costs, rates) are off-limits. These tasks are visual only.

## 1. Architecture facts you must know before editing

1. **Full-repaint render loop.** `render()` sets `this.root.innerHTML = ...` (search: `this.root.innerHTML`, around line 1888) and re-renders on **every game tick (~1s)** and every action (`forceUpdate()`). Consequences:
   - Any DOM node you append inside `#app` is destroyed on the next tick. Persistent/transient FX elements (floaters) must live **outside `#app`** — copy the existing pattern used for the Look panel: search `this.lookPanel` (created once, lives outside `#app`, comment at ~line 1692 explains why).
   - The stage DOM is regenerated from template strings each render, so stage visuals must be expressed as **values interpolated into the template** (compute them in the view-model, where `stageLine`/`energyPct` are built — search `stageLine:`, around line 1564), not as post-render DOM mutation.
2. **Event handlers** are bound via `data-h="${this.bind(fn)}"` and dispatched by one delegated listener: `if (fn) fn(e);` (~line 436). **Handlers receive the original event**, so `e.clientX` / `e.clientY` are available in `workCrowd`.
3. **Motion preferences already exist** and must keep working: `html[data-motion="still"]` pauses all CSS animations; `html[data-motion="easy"]` pauses `#stage` children. Prefer pure-CSS animations so these prefs apply for free.
4. **The stage panel is a CSS size container** (`#stage { container-type: inline-size }` in `style.css`) with `@container` rules for the neon sign at 660px/300px. Do not break that.
5. Stage column is now capped at 720px (v0.7.1). Design stage FX for a 320–720px wide, 190px+ tall box.

## 2. Task 2 — Make the stage reflect game state

**Goal:** the stage currently renders identically at 0 patrons/0 hype and at peak. Wire three existing visual elements to state. All changes are inside the stage template (search `<div id="stage"`) plus new computed values in the view-model next to `stageLine` (~line 1564).

### 2a. Crowd size from `g.patrons`

Replace the six hardcoded crowd `<span>`s (search `crowdBob 3.1s` — the row is the `<div style="position:absolute;left:0;right:0;bottom:0;height:74px;display:flex;...">` containing them) with a generated list. In the view-model add:

```js
// Crowd mirrors the room: 0 patrons -> 2 wallflowers, scales to 14 silhouettes.
crowdN: Math.min(14, 2 + Math.floor(g.patrons / 2)),
crowdBobDur: (2.4 + 1.2 * (1 - Math.min(1, g.hype / cap.hype))).toFixed(2) + 's',
```

In the template, replace the fixed spans with:

```js
${Array.from({ length: v.crowdN }, (_, i) => {
  const w = 24 + (i * 7) % 9;          // 24–32px wide
  const h = 38 + (i * 13) % 19;        // 38–56px tall
  const d = ((i * 37) % 10) / 10;      // staggered animation delay 0–0.9s
  const shades = ['#160d20', '#120a1b', '#180e23', '#150c1f', '#110919', '#170d21'];
  return `<span style="width:${w}px;height:${h}px;border-radius:${Math.round(w/2)}px ${Math.round(w/2)}px 0 0;background:${shades[i % 6]};animation:crowdBob ${v.crowdBobDur} ease-in-out infinite ${d}s"></span>`;
}).join('')}
```

Keep the existing 200px center spacer `<span style="width:200px"></span>` — split the generated spans into two halves around it (e.g. build two arrays and join each). Reduce `gap:22px` to `gap:14px` so 14 silhouettes still fit at 320px stage width. Verify the narrowest case (320px stage, 14 silhouettes) does not overflow: if it does, cap `crowdN` lower or reduce widths.

### 2b. Lighting intensity from room energy (hype ratio)

The ratio already exists: `energyPct` uses `g.hype / cap.hype`. Add to the view-model:

```js
energyRatio: Math.max(0, Math.min(1, g.hype / cap.hype)),
```

On the two beam divs (search `animation:sweepL 9s` and `animation:sweepR 11s`), make opacity state-driven. Each beam's color stops are rgba with alpha .42 (pink) / .34 (cyan); compute in the view-model:

```js
beamPinkA: (0.12 + 0.30 * energyRatioValue).toFixed(2), // energyRatioValue = the ratio above
beamCyanA: (0.10 + 0.24 * energyRatioValue).toFixed(2),
```

and interpolate those into the `linear-gradient` rgba alphas, e.g. `rgba(255,45,120,${v.beamPinkA})`. Also scale the floor spotlight (search `radial-gradient(closest-side,rgba(255,232,180,.34)`): alpha `.10 + .26 * ratio`, and its `width:230px` can grow to `230 + 90 * ratio` px. Result: dead room = faint single wash; Peak = full saturated sweeps. Do not touch the `@keyframes sweepL/sweepR` themselves.

### 2c. Neon sign reacts to stage crew

On the `stage-neon` div (search `class="stage-neon"`): when `g.jobs.stage === 0` the club has no one on stage, so the sign should look half-dead — add view-model:

```js
neonStyle: g.jobs.stage > 0
  ? ''                                     // current lit look (default)
  : 'opacity:.35;animation-duration:2.5s', // dim, nervous flicker
```

and append `${v.neonStyle}` to the div's inline style. (Faster flicker = shorter `neonFlicker` duration; the keyframes already exist.)

### 2d. Task 2 done criteria

- Fresh save (0 patrons, 0 hype, 0 crew): 2 silhouettes, dim beams, dim flickering sign.
- Simulate a busy room (see section 4): 12-14 silhouettes bobbing faster, bright beams, lit sign.
- `node --check game.js`, `node economy.test.mjs`, `node pacing.mjs` all pass.
- Motion prefs: Settings -> Look & feel -> Motion "Still" freezes all stage motion; "Easy" stills the stage children.
- Bump VERSION/build/CHANGELOG once for the whole task.

## 3. Task 3 — Click feedback for "Work the room"

**Goal:** the primary action (`workCrowd`, search `workCrowd: () => {`, ~line 1573) currently only changes numbers. Add floating `+$x.xx` text at the click point and a short stage pulse.

### 3a. FX layer outside `#app` (mandatory — see section 1.1)

In the constructor, next to where `this.lookPanel` is created (search `this.lookPanel`, ~line 1692), create once:

```js
this.fxLayer = document.createElement('div');
this.fxLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:60;overflow:hidden';
document.body.appendChild(this.fxLayer);
```

### 3b. Floater animation in `style.css`

```css
@keyframes tipFloat {
  0%   { transform: translateY(0);     opacity: 1; }
  80%  { opacity: .9; }
  100% { transform: translateY(-72px); opacity: 0; }
}
.tip-floater {
  position: fixed; pointer-events: none; z-index: 61;
  font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 700;
  color: #ffc94a; text-shadow: 0 0 8px rgba(255,201,74,.6);
  animation: tipFloat 1.1s ease-out forwards;
}
```

`html[data-motion="still"]` already pauses this (it pauses all animations) — acceptable: the floater just expires in place.

### 3c. Spawn from `workCrowd`

The handler receives the click event (section 1.2). Change its signature to `workCrowd: (e) => { ... }` and after `this.forceUpdate();` add:

```js
if (e) {
  const f = document.createElement('span');
  f.className = 'tip-floater';
  f.textContent = '+$' + this.fmt(clickVal);
  if (e.clientX) {
    f.style.left = (e.clientX - 10) + 'px';
    f.style.top = (e.clientY - 24) + 'px';
  } else {
    // Keyboard activation (Enter/Space): clientX is 0 — anchor to the button instead.
    const btn = document.querySelector('[data-h] .cta') || document.getElementById('stage');
    const r = (btn && btn.getBoundingClientRect()) || { left: innerWidth / 2, top: innerHeight / 2, width: 0 };
    f.style.left = (r.left + r.width / 2) + 'px';
    f.style.top = (r.top - 8) + 'px';
  }
  f.addEventListener('animationend', () => f.remove());
  this.fxLayer.appendChild(f);
}
const stage = document.getElementById('stage');
if (stage && stage.animate) stage.animate(
  [{ filter: 'brightness(1.35)' }, { filter: 'brightness(1)' }],
  { duration: 140, easing: 'ease-out' }
);
```

Notes:
- The stage pulse uses WAAPI (`el.animate`) on the node **after** `forceUpdate()` re-rendered it, so it targets the current node. Worst case a tick replaces the node mid-pulse — visually harmless.
- The Look panel's `data-lights="on"` filter on `#stage` coexists fine; the WAAPI filter animation overrides it for 140ms only.

### 3d. Task 3 done criteria

- Clicking "Work the room" spawns one floater at the cursor that rises ~72px, fades, and is removed from the DOM. Verify no leak: after 20 clicks, `document.querySelectorAll('.tip-floater').length` returns to 0.
- Keyboard activation also spawns a floater (anchored to the button).
- All validation commands from section 0 pass. Bump VERSION/build/CHANGELOG.

## 4. Manual test setup (no test framework needed)

```bash
cd <repo> && python3 -m http.server 8791 --bind 127.0.0.1
# open http://127.0.0.1:8791/
```

- **Fresh state:** the game starts with $20, 0 patrons/hype/crew — this is your "dead room" check.
- **Busy-room state** without playing for an hour: open devtools console and tamper the save (find the exact key via `this.KEY` in game.js):
  ```js
  const k = Object.keys(localStorage).find(x => x.startsWith('afterglow'));
  const s = JSON.parse(localStorage.getItem(k));
  s.g.patrons = 22; s.g.hype = 55; s.g.crew = 3; s.g.jobs.stage = 2;
  localStorage.setItem(k, JSON.stringify(s)); location.reload();
  ```
- Check 1280x720 and 1920x1080 viewports, plus ~900px width for the narrow-stage case.

## 5. Explicitly out of scope (do NOT do these)

- No dancer/performer/pole figure (operator decision, AGENTS.md invariant).
- No dependencies, bundler, canvas, images, or fonts.
- No balance/rate/cost changes; no `SAVE_VER` bump; no changes to `catchUp`, saving, or multi-tab ownership code.
- Do not revert or alter the v0.7.1 720px stage cap while doing Tasks 2-3.

## 6. Optional runner-up (only if explicitly asked): small-screen stacking

Below ~872px the three fixed-minimum columns force horizontal scrolling. Proper fix needs the grid rule moved from the inline style to a class in `style.css` with a `@media (max-width: 900px)` single-column fallback (Ledger / Stage / Systems stacked). Not started; operator has not requested it.
