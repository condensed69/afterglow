## fix: one scroller on narrow screens instead of four nested ones

Operator report, playing on a phone: *"it's too hard to use with the 2 scroll bars, super inefficient."*

### The bug

The app root is `height:100vh; overflow:hidden`, and three descendants each declare their
own inline `overflow-y:auto` — `[data-scroll="ledger"]`, `[data-scroll="log"]`, and the
Systems tab body `[data-scroll^="sys_"]`.

As three side-by-side desktop columns that is exactly right: each column owns a full-height
viewport and scrolls independently. Stacked into one column below 900px, the same three
panels share `100vh − header − footer` between them, so each becomes a ~100px window with
its own scrollbar nested inside the shell's. Two visible tracks, and a six-row Ledger you
read three rows at a time.

Nothing regressed to cause this — the ≤900px stacking rule (v0.10.0) never touched the
interior scroll boxes, and its own comment says so: *"Interior grid rows (stage section,
systems aside) are untouched."* It was correct for the columns and wrong for the stack from
the day it landed.

### The fix

Scoped entirely to the existing `@media (max-width: 900px)` block. Desktop CSS is byte-identical.

1. The three inner panels get `overflow: visible !important` and size to content.
   `.shell-grid` becomes the single scroller. It already carries `data-scroll="main"`, so the
   existing scroll save/restore (`game.js:2644`, `:3022`) covers it — no new machinery.
2. `.stage-col` / `.sys-col` (new class hooks; the elements had none) drop their fixed
   interior rows for content-sized ones. The stage gets an explicit `240px` because it is
   lighting and silhouettes with no intrinsic height.
3. `.shell-grid` gets `grid-auto-rows: min-content`.

`!important` throughout: the shell is inline-styled from `game.js` and wins on specificity
otherwise. `overflow` rather than `overflow-y`, so the shorthand resets both longhands.

### Item 3 is the one that matters, and I nearly shipped without it

With items 1–2 only, the layout looked correct in a 400×900 screenshot. It was not. A
measurement pass showed the panels stacking as:

```
ASIDE[62..709]  SECTION[709..709]  ASIDE[709..709]
```

The Stage and Systems panels had collapsed to **zero height**, and their contents were
spilling out and painting on top of each other. The screenshot only covered the first 900px,
which happened to be the one region where the damage was invisible.

Cause: as a scroll container `.shell-grid` has a *definite* block size, so `auto` rows are
shrunk to fit it. The Ledger's content claims the whole ~620px and the remaining two rows
resolve to zero. `min-content` refuses to shrink below content.

Measured across candidates rather than reasoned about, since the first round of reasoning is
what produced the broken version:

| `grid-auto-rows` | panel heights | `scrollHeight` |
|---|---|---|
| `auto` (default) | 647 / **0** / **0** | 1715 |
| `grid-template-rows: auto auto auto` | 647 / **0** / **0** | 1715 |
| `align-content: start` | 647 / **0** / **0** | 1715 |
| `align-items: start` | 647 / 367 / 1068 | 1715 — items sized, rows still 0, still overflowing |
| **`min-content`** | **647 / 367 / 1068** | **2082** |

`align-items:start` is the trap: it reports correct *item* heights while the rows stay
collapsed, so a probe that only measured heights would have called it a pass. `scrollHeight`
is the honest column — it is the only one that says the scroller actually contains the content.

### Verification

The three gates cannot see any of this; both harnesses stub the DOM, and all three passed on
the broken intermediate version. Verified in headless Chrome instead.

At 400×800, after the fix:

```
panels: ASIDE[62..709] SECTION[709..1076] ASIDE[1076..2144]
panelOverlap=false
main    overflowY=auto    scrollable=true
ledger  overflowY=visible scrollable=false
log     overflowY=visible scrollable=false
sys_club overflowY=visible scrollable=false
doc scrollable=false
scrolled to bottom: 1459/1459; last panel bottom reachable=true
```

One scroller, three contiguous non-overlapping panels, and the bottom of the Systems card
list is reachable by scrolling the page — that last line is what proves the inner scroller is
really gone rather than just visually hidden.

At 1400×900, unchanged: `ASIDE[62..785] SECTION[62..785] ASIDE[62..785]`, all three inner
panels back to `overflow-y:auto`, `sys_club` scrollable, shell not. Also checked 700×420
(landscape phone) — single column, one scroller.

Full-page screenshots at 400×2200 and 700×420 confirm the stack visually: Ledger → Floor →
Stage → actions → Night log → Systems tabs → building cards, one continuous scroll.

The probe was a temporary `_probe_scroll.html` in the repo root, deleted before commit and
confirmed absent from the diff rather than from memory:

```
$ git status --short
 M game.js
 M style.css
$ git diff -- game.js style.css | grep -nE "PROBE|_probe|console\.log|debugger"
(no probe residue in diff)
```

No test added. A test asserting that particular CSS strings exist would check the stylesheet
against itself and pass on the zero-height version — the failure mode here is geometric, and
the gates have no layout engine. Recorded in DESIGN.md instead, including the `min-content`
reason, so the next person to touch this block does not revert it.

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass — 201 passed, 1 skipped, 0 failed (unchanged) |
| `node pacing.mjs` | pass — all milestones within band; run2 first LED faster |

### Docs / version

`DESIGN.md` §14.1 gains a "Narrow screens" subsection covering the single-scroller rule and
the `min-content` reason. §14.2's `data-scroll` render-hygiene note still holds unchanged —
that is the machinery this fix reuses.

Player-visible layout change, so `VERSION` → **0.10.7**, build **198**, date 2026-08-09, plus
a `CHANGELOG` entry in `game.js` (this repo has no `CHANGELOG.md`; the changelog is the
in-game array at `game.js:110`). `SAVE_VER` stays **8** — no persisted shape changed.

### What this does not cover

- **The stage is 240px of mostly empty art on a phone.** It reads as dead space above the
  action buttons. Shrinking it or collapsing it behind a toggle is a design call, not a bug
  fix, and is not in this PR.
- **Crossing the 900px boundary mid-session** (rotate, or resize a desktop window) restores a
  `scrollTop` saved while a panel was scrollable into a panel that no longer is, and the
  reverse. Both resolve to a harmless `0`; not worth code, but it is why the landscape check
  is in the verification list.
- **The 900px breakpoint is unchanged and still untested at its edges.** Nothing here says
  900 is the right number — it is the number that was already there.
