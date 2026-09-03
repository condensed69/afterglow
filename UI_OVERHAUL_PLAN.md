# Afterglow UI Overhaul Plan: No Stage, One Scroller, Purchases First

Status: proposed 2026-09-03 (operator request). Supersedes `FLUID_LAYOUT_PLAN.md`
(§7) — that plan widened the stage; this one removes it.

## 1. What is wrong (measured, not theorised)

Headless-Chrome screenshots of a fresh save on `main` @ 0.15.0 build 290:

| Viewport | Stage panel height | Nested vertical scrollbars visible | Dead side gutters |
|---|---|---|---|
| 1920×1080 | ~720px of the 1080 (67% of the center column) | 1 (Systems, with only 6 cards) | 230px each side |
| 1366×768 | ~400px | 2 (Ledger cut off at "On stage"; Systems) | 0 |

Root causes, all in the render template (`game.js` `renderShell`, ~5493–5758)
and `style.css`:

1. **The stage is a height sink with no job.** `.stage-col` is
   `grid-template-rows: minmax(190px,1fr) auto 132px`; the `1fr` row is `#stage`,
   which is environment only (DESIGN.md §14.2: lighting, haze, crowd silhouettes,
   neon sign, canvas floorboard). The only information it carries is the Main
   Stage line, the Room energy %, and the golden-ticket VIP badge — and all three
   already have a stage-less rendering (`stageLineEnergyBanner`,
   `goldenTicketBanner`) that the ≤900px layout has used since 0.10.8. The
   stage-less path exists and is proven; desktop just doesn't use it.
2. **Five scroll containers on one screen.** `.shell-grid` (`overflow:auto`),
   `#ledger-aside` (`overflow-y:auto`), the Night log (`overflow-y:auto`), the
   Systems tab body (`overflow-y:auto`), and the tab bar (`overflow-x:auto`).
   Each column is its own viewport, so the player reads the buy list through a
   ~600px window while 720px of empty stage sits next to it. The ≤900px media
   query already fixes this for phones with `overflow: visible !important` on
   the three inner panels ("one scroller, not four", 0.10.7) — desktop never got
   the same treatment.
3. **The buy list is squeezed into 440px.** For an incremental game the purchase
   surface *is* the game. Here it is the narrowest column, and it stacks the
   Owner's List goal card, a four-line tab hint paragraph, 8 building cards,
   the Club Persona picker and the Named Talent roster — all in one column — so
   it scrolls even on a 1080p monitor with a fresh save.
4. **Chrome the player never needs.** Header version badge (label | build |
   channel | autosave) duplicated in the footer; a full-height ticker row for
   "The night is young."; a Ledger that spends 640px of height on six resources
   plus a session strip plus Floor stats.
5. **Fixed 1460px island.** `max-width:1460px; margin-inline:auto` — 460px dead
   at 1920, 1100px at 2560 (already diagnosed in `FLUID_LAYOUT_PLAN.md` §1).

## 2. Target layout (desktop, ≥901px)

Reference points: Cookie Clicker / Kittens Game / Antimatter Dimensions —
resources are a compact strip, purchases dominate, nothing nests a scrollbar.

```
┌─ header (52px) ─────────────────────────────────────────────────────────────┐
│ Afterglow  CASH $20.0 +0/s · HYPE 0 · BUZZ 0 · PATRONS 0/10 · REG 0 · CLOUT 0 │
│                                   Early Doors ▏night 1 ×0.70 ▏🚨0% ▏🔊 ▏☰  │
├─ action bar (sticky, 56px) ──────────────────────────────────────────────────┤
│ [ WORK THE ROOM +$1.15 ] [Buy a round $50] [🍸 Stock 0] [🎧 Beat Drop]      │
│   Main Stage: hire crew to open the stage       Room energy 0%   [🎫 VIP]   │
├─ tabs (sticky) ─  CLUB · CREW · TALENT · UPGRADES · RESEARCH · PERKS ────────┤
│ Goal 1/14 · Work the room  ████░░░░ 0/5                              [▾]     │
│ ┌ Tip Rail ─────────┐ ┌ Back Bar ─────────┐ ┌ DJ Booth ─────────┐            │
│ │ … ×1 ×5 ×10 Max   │ │ …                 │ │ …                 │  ← the ONLY │
│ └───────────────────┘ └───────────────────┘ └───────────────────┘   scroller │
│ ┌ Marquee ──────────┐ ┌ Flyer Crew ───────┐ ┌ VIP Booth ────────┐            │
├─ night log (3 lines, expandable) ────────────────────────────────────────────┤
│ 11:26 Doors open. …                                                    [▴]   │
├─ footer (24px) v0.15.0 · build 290 · save v16 · idle            ticks 61 ────┤
```

Decisions (one recommendation each, not a menu):

- **Stage: removed from the DOM.** Not hidden — removed. The ≤900px
  `#stage{display:none}` rule and its "hidden, not removed" rationale go with it.
- **Canvas floorboard: kept as an ambient background layer** behind the body,
  `position:absolute; inset:0; z-index:0; opacity:.35; pointer-events:none` on
  `.app-root`, driven by the same `floorboard.update()` feed. This preserves the
  neon-noir language (AGENTS.md invariant) and the 0.12.2 canvas work without
  spending a pixel of layout. Look panel gets an "Ambient floor" on/off toggle
  stored in the existing `afterglow.look` prefs. If the operator later says
  "gone entirely", it is one `<canvas>` line and one CSS rule.
- **"Main Stage" the *job* stays.** `jobs.stage`, the Main Stage assignment
  slot, `stageHype`, the "hire crew to open the stage" line — all are sim/save
  concepts and untouched. Only the art panel is removed. Say this in every PR
  body so no reviewer or agent "cleans up" the job.
- **One scroller at every width.** Header, action bar and tab bar are sticky;
  the tab body is the page scroller; nothing else has `overflow-y:auto`. The
  mobile media query collapses to what is still specific to touch (thumb
  cockpit, 44px targets, drawer modals).
- **Ledger becomes a resource strip in the header.** Each resource is a chip:
  value, rate, and a 2px underline that doubles as the cap bar. The (?) help
  stays as a `title` tooltip on the chip. "This session", "House", and "Floor"
  stats move into a **Books** drawer (☰ menu entry, or click the strip),
  collapsed by default. Cash stays leftmost and largest.
- **Purchase grid.** Tab body is `grid-template-columns: repeat(auto-fill,
  minmax(320px, 1fr))` with `gap: 10px`. Eight building cards fit in 3 columns
  at 1366 and 4 at 1920 with no scrolling. Club Persona + Named Talent get their
  own **Talent** tab instead of stacking under Club and Crew. The Owner's List
  goal card compresses to one row (goal name, progress bar, reward) with an
  expand chevron. The tab hint paragraph moves behind a (?) on the tab label.
- **Night log is a 3-line strip** above the footer with an expand toggle
  (expanded = 40vh, still the same page scroller). It is not primary in an
  incremental.
- **Header diet.** Version badge leaves the header (footer already has it; the
  changelog opens from ☰). Ticker row deleted; its text goes in the footer's
  left slot at the same 11px.
- **Fluid width.** `.shell-grid` loses `max-width` and the column caps; the body
  is `width:100%; padding-inline:18px`, with an ultrawide guard at
  `@media (min-width: 2160px) { max-width: 2200px; margin-inline:auto }` — the
  one part of `FLUID_LAYOUT_PLAN.md` that survives.

## 3. Phases (one PR each; every PR is gate-green and shippable alone)

Order matters: A deletes the thing that makes B and D hard.

### PR A — Remove the stage (0.16.0)

Touch points, enumerated from `grep -n "stage" game.js style.css`:

- `game.js` ~5612–5683: delete the `#stage` div (beams, bulbs, neon, sweeps,
  spot, divider, lip, crowd row, stage-line container, energy readout,
  golden wrap). `.stage-col` becomes `grid-template-rows: auto 1fr` (action bar,
  log) — this alone gives the log the height the stage had.
- `game.js` 5567–5573: `#golden-banner-wrap` / `#stage-line-energy-wrap` stay
  where they are; `style.css` 300–303 base rule `display:none` and the ≤900px
  `display:flex` override are replaced by `display:flex` at all widths. Restyle
  the two banners into the action bar's second row (see §2 diagram) rather than
  full-width strips.
- `game.js` 5934–5980 (fine-grained repaint, "5. Stage Column"): delete the
  `#stage-beams … #stage-golden-wrap` repaint block; keep the `floorboard.update`
  call and point it at the new `#ambient-canvas`.
- `game.js` 4966, 4975: the keyboard tip-floater fallback anchor and the click
  brightness pulse both reference `#stage`; retarget to `#cta-work-crowd`.
- `game.js` 3307, 4688: `triggerPulse` computes coordinates against
  `#stage-canvas`'s rect; the ambient canvas covers the app root, so the rect
  math still works unchanged once the id is swapped.
- `style.css`: delete `#stage{container-type}` + the two `@container` neon rules
  (132–141), `.crowd-row` / `.crowd-sil` + their container rules (163–184), the
  ≤900px `#stage{display:none}` block (379–381), the `.stage-col` row override
  (469–471). Retarget `html[data-lights="on"] #stage` (148–155) and
  `html[data-motion="easy"] #stage > div` (157–158) to `#ambient-canvas`, or
  drop the Lights slider from the Look panel if the filter no longer reads well
  on a 35%-opacity backdrop (decide by looking, not by guessing).
- `style.css` 129–130 and AGENTS.md "The stage carries no performer figure"
  invariant: rewrite to "There is no stage panel (removed 0.16.0); the ambient
  canvas carries no figure." The intent (no dancer) survives.
- Keyframes `bulb`, `sweepL`, `sweepR`, `hazeDrift`, `crowdBob` become dead;
  delete them. `neonFlicker` stays (brand wordmark).
- `DESIGN.md` §14.1 table rows for Stage, §14.2 in full, the 0.10.8 "no stage
  art" paragraph, the golden-ticket presentation note in §11.4, the `#stage`
  mentions in the ≤900px paragraphs. `README.md` only if it describes the stage.
- `VERSION` → 0.16.0, build +1, `CHANGELOG` entry. `SAVE_VER` stays 16 — no
  persisted shape changes.

### PR B — One scroller (0.16.1)

- Remove inline `overflow-y:auto` from `#ledger-aside` (5577), the log (5702)
  and the Systems body (5715). Remove `overflow:auto` from `.shell-grid`
  (234) and make the *app root* the scroller: `.app-root{height:100dvh;
  overflow-y:auto}` with header/action bar/tab bar `position:sticky; top:…`.
- Delete the ≤900px "one scroller, not four" block (366–370), the `.sys-col`
  row override (472–474), `.shell-grid` overflow/`grid-auto-rows` lines
  (315–347) — the base layout now does what the override did.
- Scroll save/restore (`game.js` 6213–6240) keys on `data-scroll`; only `main`
  survives. Keep per-tab restore: store `scrollSave['main_' + tab]` so switching
  Club→Crew→Club returns to the same card. The scroll-defer guard (0.11.28,
  capture-phase listener on `this.root`) already works for any scroller under
  the root; verify with the drag test on a phone, not by reading the comment.
- Add `tools/screenshot.sh`: headless Chrome at 1366×768, 1920×1080, 2560×1440,
  390×844, writing to `.github/pr/shots/` — the PR body links them. Command
  that produced the §1 numbers:
  `google-chrome --headless=new --hide-scrollbars=false --window-size=W,H
  --virtual-time-budget=6000 --screenshot=out.png http://127.0.0.1:8765/`.

### PR C — Resource strip + header diet (0.16.2)

- Ledger → header chips (§2). The (?) `helpIcon` markup is reused as a `title`.
  Rate colouring rules (green/red) stay. Cash chip gets the yellow cap bar.
- Books drawer: session strip, house chips, Floor stats. Open state in
  `afterglow.look` prefs (UI pref, not save — `SAVE_VER` stays 16).
- Delete the header version button (5501–5514) and the ticker row
  (5558–5561); ticker text → footer left slot. Changelog stays reachable from ☰.
- `.ledger-toggle`, `.ledger-detail`, `.ledger-collapsed` and the 0.10.16
  mobile-collapse rules (238–240, 403–422, 648–651) all go — the strip is
  compact at every width, so the collapse has nothing to collapse.
- `DESIGN.md` §14.1 Ledger row, the 0.10.16 paragraph, §14.5 header controls.

### PR D — Purchase grid + Talent tab (0.16.3)

- Tab body → `repeat(auto-fill, minmax(320px,1fr))` grid. Cards keep their
  markup; `#cards-container` changes from flex-column to grid.
- `tabDefs` (4068–4078): add `{ id: 'talent', label: 'Talent' }` gated on the
  same condition that currently renders `personasAndTalent`; move that block out
  of Club/Crew. The economy suite's "every bound click handler is invocable"
  sweep discovers tabs from the view model, so the new tab is covered with no
  test edit (AGENTS.md, Verification gates).
- Owner's List goal card → one-row summary + expand (`this.state.goalOpen`,
  transient). Tab hint → (?) tooltip on the tab button; the paragraph div
  (5716) is deleted.
- Multi-buy row: render `Max (0)` disabled instead of `×0` when nothing is
  affordable (carried over from `FLUID_LAYOUT_PLAN.md` §2.D.1).
- `DESIGN.md` §14.1 Systems row, §14.3 buying, §3.3 personas/talent location.

### PR E — Night log strip (0.16.4)

- Log → 3-line strip above footer, `this.state.logOpen` toggle, expanded height
  40vh. Manager-log aggregation (0.11.32) unchanged.
- Retire `FLUID_LAYOUT_PLAN.md`: grep the repo for references first
  (`.github/pr/`, `PLAN.md`, `IMPLEMENTATION_PLAN.md`); replace the file body
  with a two-line "superseded by UI_OVERHAUL_PLAN.md" banner rather than
  deleting, so links keep resolving.

## 4. Acceptance criteria (checked per PR, all in the PR body)

Run `tools/screenshot.sh` on a fresh save **and** on a mid-game save (8
structures, 5 crew, Research unlocked, one talent hired — export one to
`tools/fixtures/midgame-save.json` in PR B and reuse it):

- **Scrollbars:** at 1366×768 and 1920×1080, at most one vertical scrollbar
  visible; zero horizontal scrollbars at any width from 390 to 2560.
- **Above the fold at 1366×768:** Work the room, every currently-buildable
  card, and the full tab bar are visible without scrolling.
- **Dead space:** side gutters ≤ 18px per side at 1920; no empty panel taller
  than 60px anywhere.
- **Gates:** `node --check game.js && node economy.test.mjs && node pacing.mjs`
  green; pacing bit-identical (these PRs are render-only — any pacing delta is
  a bug in the PR, not a balance change).
- **Mobile ≤900px:** thumb cockpit, 44px targets and drawer modals unchanged;
  the drag test (scroll during a render tick) still does not rubber-band.
- **Docs:** `grep -n "stage\|Ledger\|scroll" DESIGN.md AGENTS.md README.md`
  shows no sentence that describes the removed thing as present.
- **Review:** every commit on the branch has its own `/oc review` run, every
  finding has a fix commit, and the HEAD commit's review says Approve (§6.1
  table in the PR body).

## 5. Risks and how each is closed

| Risk | Closed by |
|---|---|
| A reviewer or agent reads "remove the stage" as "remove `jobs.stage`" | §2 decision + explicit line in every PR body; `economy.test.mjs` fails loudly on job-sum drift anyway |
| Ambient canvas at 35% opacity makes card text hard to read | Canvas draws only in the body area's background; cards keep opaque `#100a1a` backgrounds; check contrast in the 1366 screenshot |
| Sticky header + action bar + tab bar eat ~150px of a 768px screen | Measured budget: 52 + 56 + 40 = 148px, leaving 596px for the grid — two full card rows at 1366. If it doesn't fit, the action bar's second row (stage line / energy) collapses to one line first |
| Deleting `overflow:auto` on `.shell-grid` breaks the mobile scroll-defer guard | The guard listens on `this.root` in capture phase (0.11.28), so it sees any descendant scroller; verify on-device in PR B |
| Look-panel Lights slider targets `#stage` | Retargeted or removed in PR A; decide by looking at the result |
| `FLUID_LAYOUT_PLAN.md` still linked from a PR body | Grep before retiring; banner, not delete |

## 6. Process (per AGENTS.md)

- Branch with `.githooks/new-branch.sh ui-overhaul-a-remove-stage` (never
  `checkout -b`); `git config core.hooksPath .githooks` once per clone.
- PR body at `.github/pr/<number>-ui-overhaul-a.md`: what/why, gates run and
  result, docs files touched, `SAVE_VER` unchanged and why, screenshots.
- Rebase and renumber `VERSION`/build if another PR lands first.

### 6.1 Review loop — mandatory for EVERY commit, no exceptions

No commit on a PR branch is finished until it has its own `/oc review` comment
and a review result. Not per PR, not per push batch — **per commit**. A fix-up
commit that answers a review is itself a new commit and gets its own review.
The loop only ends on the reviewer's formal approval line.

```sh
# 1. after each commit
git push
gh pr comment <PR> --body "/oc review"

# 2. wait for the workflow that comment triggered — do not read stale output
gh run watch $(gh run list --workflow opencode --limit 1 --json databaseId -q '.[0].databaseId')

# 3. read the findings
gh pr view <PR> --comments
```

4. Classify every finding — High/Blocking (defects, broken invariants,
   missing docs rows), Medium (catalog divergence, guards, edge cases),
   Low/Nit (typos, style, unused vars) — and **implement the fix for each
   one**, including the nits. Do not reply "won't fix" to a finding without
   the operator's say-so; disagreeing with the reviewer is a question for the
   operator, not a decision for the agent.
5. Re-run the three gates on the fixed tree (`node --check game.js &&
   node economy.test.mjs && node pacing.mjs --fast`), commit the fix with a
   message that names the finding it closes, push.
6. **Go back to step 1 for the new commit.** The previous approval, if any,
   was for a tree that no longer exists.
7. Stop only when the latest commit's review contains:
   > Recommendation: Approve. No blocking defects.
   and that review was run against the current HEAD (check the run's commit
   SHA against `git rev-parse HEAD`).
8. Then `gh pr merge <PR> --squash --delete-branch`, pull `main`, run the full
   gate suite on `main` once more.

**Recording it.** The PR body carries a table with one row per commit:

| commit | `/oc review` run | findings | fixed in |
|---|---|---|---|
| `abc1234` | run 123 | 2 Medium, 1 Nit | `def5678` |
| `def5678` | run 124 | Approve | — |

A PR whose body lacks this table, or whose table has a commit without a run,
is not ready for merge. The `.githooks/pre-push` base check and the CI gates
do not cover this — it is enforced by the body table and the reviewer's
approval line only, so fill it in as you go rather than reconstructing it at
the end.

## 7. Relationship to FLUID_LAYOUT_PLAN.md

That plan kept the three-column shell and widened the stage to `1fr`. The
operator's direction (2026-09-03) is that the stage is not wanted at all and
the nested scrollbars are the primary defect. This plan absorbs its two
survivable items (ultrawide guard, `Max (0)` label) and retires the rest in PR E.
