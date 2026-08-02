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
  was previously a single self-contained page produced by the Claude design-tool bundler; operator
  rejected that format in favor of a normal, portable, readable static site.)

## Art direction (locked v0.4.0)
- Neon-noir club interior. Dark plum/near-black base, lit by stage rigging.
- Palette: bg #07050c, panel #0a0611 / #0f0a18, border #2a1738 / #3a2350,
  magenta #ff2d78 (primary), cyan #22d3ee (secondary), gold #ffc94a (currency),
  violet #a855f7 (time/prestige), green #4ade80 (long-term), text #f2e8f7, muted #9c86ab / #6f5885.
- Type: Monoton (neon signage / logo only), Space Grotesk (all UI), IBM Plex Mono (every number).
- Numbers are always monospace. Labels are uppercase, 9-11px, 2.5-3.5px letter-spacing.
- Environmental art is CSS/DOM (marquee bulbs, sweeping spotlight cones, crowd silhouettes,
  stage lip, haze) — no illustrated characters in the shell.
- Layout: three columns — ledger (262px) / stage + log (fluid) / systems tabs (352px),
  with a header bar and a footer version stamp.

## Content boundary
The performer figure is a CSS/DOM animation rendered directly in `#performer-stage` (210x238) by
game.js's render() — no undressing/nudity progression is authored, just idle dance-loop art. (The
prior version of this doc described `#performer-stage` as an empty mount reserved for a separate
design-tool-injected canvas; operator confirmed 2026-08-02 to leave the current CSS animation as-is
rather than restore that mount-point contract.)

## Version tracker contract
- `VERSION = { num, build, channel, date, codename }` lives at the top of the logic class.
- `SAVE_VER` is a separate integer. Bump it on any save-shape change; a mismatch wipes the save
  and logs "Save format changed".
- Every save writes `{ saveVer, ver, build, g }`; on load a differing `ver` logs "Updated x → y".
- `CHANGELOG` is an array of `{ v, date, codename, notes[] }`, newest first, shown in the
  header-badge modal. Add an entry for every version bump — the badge, the footer and the
  changelog must never disagree.

## Last sync
date: 2026-08-02T18:04:00Z
source: read index.html + README.md at main (tree d2ae312a4acf)

### Updated in this project
- Rebuilt the game as a Design Component: `Strip Club Idle.dc.html` (v0.4.0, build 141, alpha).
- Replaced the canvas + flat button strip with a three-column idle shell and a night log.
- New economy: 6 resources with soft caps and per-second rates, 8 buildings, 6 upgrades,
  5 research nodes, crew hiring + 4-way job assignment, 4-phase shift cycle.
- Added the strict version tracker, autosave, offline progress and save export.

## Screen map
| Screen / area | Built from |
| --- | --- |
| Whole game shell | rewritten; supersedes index.html |
| Resource ledger | index.html money/tipsRes/hype/attn counters, expanded |
| Club / Upgrades tabs | index.html bTipJar/bVip/bDj/bAds/bStage cost-scaling buttons |
| Crew tab | index.html bGirl (hire) generalised into crew + jobs |
| Stage panel | index.html canvas draw() replaced by CSS set + render target |
