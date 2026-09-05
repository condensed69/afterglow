# Implementation Plans — index

Status: **All legacy work shipped.** Active forward roadmap is defined in `AFTERGLOW_2.0_PLAN.md`.

## Active Roadmap

- **[UI Overhaul: No Stage, One Scroller, Purchases First](UI_OVERHAUL_PLAN.md)** (PR A through PR E; supersedes `FLUID_LAYOUT_PLAN.md`)
  - PR A: Remove the stage panel → 0.16.0 (this branch)
  - PR B: One scroller → 0.16.1
  - PR C: Resource strip + header diet → 0.16.2
  - PR D: Purchase grid + Talent tab → 0.16.3
  - PR E: Night log strip → 0.16.4

## Previous Roadmap (shipped)

- **[Afterglow 2.0: Master Redesign & Agent Implementation Plan](AFTERGLOW_2.0_PLAN.md)** (PR 1 through PR 8)
  - PR 1: Reactive UI Store & Granular DOM Engine
  - PR 2: Responsive Dual-Surface Layout & Mobile Bottom-Cockpit
  - PR 3: Canvas Floorboard & Web Audio Synthesizer
  - PR 4: 4-Phase Operational Shifts & Police Heat Engine
  - PR 5: Station Subsystems (Mixology Bar Inventory & DJ Beat-Sync)
  - PR 6: Club Personas & Named Talent Roster 2.0
  - PR 7: Branching Blueprint Skill Tree & District Syndicate Map
  - PR 8: Pluggable Content Pack Engine & Season 1: Miami Vice '86

## Shipped (details in DESIGN.md / PRESTIGE.md / CHANGELOG)

| Plan | Shipped | Where documented |
|---|---|---|
| Stage tasks 1–3 (width cap, state-driven stage, click feedback) | v0.7.x | DESIGN.md §stage; CHANGELOG 0.7.x |
| Small-screen stacking (the "runner-up" below) | v0.10.7 one-scroller; 0.10.8 no stage art; 0.10.15 `100dvh`; 0.10.16 collapsible Ledger; 0.10.17 tap targets | DESIGN.md §14.1 |
| Replay roadmap PRs 1–8 (achievements, flavor, research tree, challenges, manager levels, Renown, brand perks + third club, endgame horizon) | 0.11.x | REPLAY_ROADMAP.md §12 (all ticked), DESIGN.md §23 |
| Adversarial-UX round GREEN/YELLOW/RED tickets | 0.11.34–0.11.41 | DESIGN.md §14.1, CHANGELOG |
| Mobile scroll fixes (render-defer, scrollbars, overscroll containment) | 0.11.19–0.11.42 | DESIGN.md §14.1 |
