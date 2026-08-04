repo: condensed69/stripper-dance
branch: main
path: (repo root — index.html + style.css + game.js)

## Project brief (persistent — do not re-ask)
- Genre: deeply complex incremental/idle game in the lineage of Kittens Game — many interlocking
  resources, soft caps, buildings, jobs/assignment, research tree, seasonal/cycle modifiers, prestige later.
- Current phase: stage 0. Design language and early-game mechanics are still being established;
  balance numbers are placeholders and expected to churn.
- Setting: a nightclub the player runs and grows. Cash / Hype / Buzz / Patrons / Regulars / Clout.
- Hard requirement: a strict, always-visible version tracker (header badge + footer stamp +
  in-game changelog + versioned save format).
- Build constraints: plain static site (index.html + style.css + game.js), no build step,
  no bundler/design-tool export format, localStorage saves, offline progress. (Changed 2026-08-02:
  operator rejected the single-file design-tool bundle in favor of a normal, portable static site.)
  **The .dc.html design component is historical — do not ship changes there.**

## Art direction (locked v0.4.0)
- Neon-noir club interior. Dark plum/near-black base, lit by stage rigging.
- Palette: bg #07050c, panel #0a0611 / #0f0a18, border #2a1738 / #3a2350,
  magenta #ff2d78 (primary), cyan #22d3ee (secondary), gold #ffc94a (currency),
  violet #a855f7 (time/prestige), green #4ade80 (long-term), text #f2e8f7, muted #9c86ab / #6f5885.
- Type: Monoton (neon signage / logo only), Space Grotesk (all UI), IBM Plex Mono (every number).
- Numbers are always monospace. Labels are uppercase, 9-11px, 2.5-3.5px letter-spacing.
- Environmental art is CSS/DOM (marquee bulbs, sweeping spotlight cones, crowd silhouettes,
  stage lip, haze).
- Layout: three columns — ledger (262px) / stage + log (fluid) / systems tabs (352px),
  with a header bar and a footer version stamp.

## Working rules (operator, 2026-08-04 — binding)
- Repo main (`index.html` + `style.css` + `game.js`) is **canonical**. Never re-bundle into a
  `.dc.html` or any single-file design-component format unless explicitly asked.
- The design component and `dist/` were **deleted 2026-08-04**. Do not recreate a parallel game.
- `KEY = 'afterglow.save'` stays as-is for the real game — multi-tab ownership depends on it.
  Do not invent a second key "to be safe". If a throwaway sandbox is ever needed, it uses
  `afterglow.save.dev` and is never pointed at production copy.
- Never open a stale/older build against the live key: an old build with a lower `SAVE_VER` takes
  the no-migration-path branch, wipes to a fresh club, and writes the empty save back.
  Origin caveat: a wipe only affects the same origin — a claude.ai preview cannot touch the
  GitHub Pages save, but it does destroy anything kept under claude.ai.
- The "Another tab owns this save" banner is the ownership lease working, not a wipe.
- Before any risky experiment, remind the operator to **Settings → Download save** first.

## Content boundary
No performer figure is rendered anywhere in the game. The CSS/DOM dancer and pole were removed in
**v0.7.0 (2026-08-04)** — the operator called them gimmicky. The Main Stage is environment only:
marquee bulbs, sweeping spotlight cones, haze, crowd silhouettes, the stage lip and the neon sign.
Do not reintroduce a figure, a pole, or any undressing/nudity progression.

## Version tracker contract
- `VERSION = { num, build, channel, date, codename }` at the top of the logic class.
- `SAVE_VER` is a separate integer. Bump it on any save-shape change; a mismatch wipes the save
  and logs "Save format changed".
- Every save writes `{ saveVer, ver, build, g }`; on load a differing `ver` logs "Updated x → y".
- `CHANGELOG` is an array of `{ v, date, codename, notes[] }`, newest first, shown in the
  header-badge modal. Badge, footer and changelog must never disagree.
- Repo gates (AGENTS.md): `node --check game.js`; VERSION + build + CHANGELOG advance together.

## Last sync
date: 2026-08-04T20:18:10Z
source: full pull of main (tree 4c2812412133) — index.html, style.css, game.js, AGENTS.md,
DESIGN.md, PLAN.md, PRESTIGE.md copied into the project; VERSION/CHANGELOG read from game.js.

### Current state of main
- game.js **v0.6.1 · build 169 · alpha · Neon Zero · 2026-08-04 · SAVE_VER 5**, 1976 lines.
- Shipped since the last sync: the whole 0.5.x logic series (unified `catchUp()`, strike rule,
  walk-in trickle, Door Staff max 6, consolidated patron income, upgrade-req enforcement, honest
  away report, Franchise research removed, save import/migration map, multi-tab guard, integer
  patron display, game.js sectioning) — **PLAN.md is fully executed; treat it as historical.**
- 0.5.3–0.5.6: import hardening (validate before replacing the live club, night-log XSS sanitize,
  file download/load save).
- 0.6.0: Owner's List — sequential 14-goal onboarding panel; new save fields goals/clicks/rounds
  (this is the SAVE_VER 4 → 5 bump, with migration crediting already-satisfied goals).
- 0.6.1: balance pass to PLAN-NEXT §C pacing bands + `pacing.mjs` reference bot; tab-ownership
  handshake (per-page token + lease/probe, non-owner tabs read-only, wipe/save no-op while stale).

### Updated in this project
- Pulled the repo fresh; the project now mirrors main's plain static site.
- Deleted `Strip Club Idle.dc.html`, `support.js` and `dist/` — no parallel build shares the save key.
- Local, not yet pushed — **v0.7.0 build 175**:
  - 0.6.2 stage-sign overlap fix (`#stage` is a CSS size container; the sign drops under 660px,
    hides under 300px).
  - 0.6.3 ledger sub-label contrast `#5c4470` → `#9c86ab`.
  - 0.6.4 density pass — columns 232/320/320, stage row min 190px, log row 132px.
  - 0.6.5 capped the stage column at 660px, **reverted in 0.6.6** — it left dead desktop gutters.
    Current grid: `minmax(232,268) / minmax(320,1fr) / minmax(320,392)`.
  - 0.6.6 Look panel (Settings → Look & feel, or `L`): House lights, Room mood
    (Hot Pink / Ultraviolet / Sodium), Motion (Full / Easy / Still). Prefs persist under
    `afterglow.look` — chrome only, never part of the save; the panel lives outside `#app`
    so the render loop cannot interrupt a slider drag.
  - 0.7.0 removed the dancer, the pole, `dancerHTML()`, `perfStyle`, the `#performer-stage`
    preservation path and the `stageH` ResizeObserver.

## Screen map
| Screen / area | Built from |
| --- | --- |
| Whole game shell | game.js render() — three-column layout |
| Resource ledger | game.js renderVals() resource rows (cash/hype/buzz/patrons/regulars/clout) |
| Stage panel | game.js stage markup (bulbs, sweeps, haze, silhouettes) — no figure since 0.7.0 |
| Club / Upgrades / Research tabs | game.js BUILDINGS / UPGRADES / RESEARCH tables |
| Crew tab | game.js crew + JOBS assignment |
| Version badge / footer / changelog | game.js VERSION + CHANGELOG |

## Sync history
- 2026-08-02T18:04:00Z — read index.html + README.md at main (tree d2ae312a4acf); built the
  now-superseded design-component version.
