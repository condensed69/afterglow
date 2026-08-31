# Implementation Plans — index

Status: **all planned work shipped.** This file is now an index of what landed
and where each plan's details live, so future work starts from the roadmap
audit instead of a stale brief.

## Shipped (details in DESIGN.md / PRESTIGE.md / CHANGELOG)

| Plan | Shipped | Where documented |
|---|---|---|
| Stage tasks 1–3 (width cap, state-driven stage, click feedback) | v0.7.x | DESIGN.md §stage; CHANGELOG 0.7.x |
| Small-screen stacking (the "runner-up" below) | v0.10.7 one-scroller; 0.10.8 no stage art; 0.10.15 `100dvh`; 0.10.16 collapsible Ledger; 0.10.17 tap targets | DESIGN.md §14.1 |
| Replay roadmap PRs 1–8 (achievements, flavor, research tree, challenges, manager levels, Renown, brand perks + third club, endgame horizon) | 0.11.x | REPLAY_ROADMAP.md §12 (all ticked), DESIGN.md §23 |
| Adversarial-UX round GREEN/YELLOW/RED tickets | 0.11.34–0.11.41 | DESIGN.md §14.1, CHANGELOG |
| Mobile scroll fixes (render-defer, scrollbars, overscroll containment) | 0.11.19–0.11.42 | DESIGN.md §14.1 |

## Historical brief (for reference only — do not execute)

The original stage-improvements brief (written 2026-08-05, executed 0.7.x) is
preserved in git history: see `git log --follow -- IMPLEMENTATION_PLAN.md` for
the pre-0.11.43 version. Its architecture notes that still hold:

- Full-repaint render loop: `render()` replaces `this.root.innerHTML` every
  tick — persistent nodes (FX layer, Look panel) must live **outside `#app`**.
- Handlers bind via `data-h="${this.bind(fn)}"` + one delegated listener;
  handlers receive the original event.
- Motion prefs `html[data-motion="still"|"easy"]` pause CSS animations.
- Stage invariant: no performer figure, ever (AGENTS.md).

## Next work

Start from the content-exhaustion audit (`.hermes/plans/` — 2026-08-30 audit
session) rather than this file. AGENTS.md remains the rulebook.
