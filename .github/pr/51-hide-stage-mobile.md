## feat: hide the stage art on narrow screens

Operator request, following #50: *"remove stage from mobile."*

#50 flagged this as the thing it deliberately did **not** do — 240px of stage art
on a phone with nothing to press and nothing to read, sitting between the Ledger
and the action buttons. This removes it.

### The change

Below the same **900px** breakpoint that #50 uses:

- `#stage` gets `display: none`.
- `.stage-col` drops from three interior rows to two. A `display:none` grid item
  is removed from layout entirely, so the actions bar and the Night log are the
  only children left to place; leaving three rows would have put the actions bar
  in the row sized for the stage.

Desktop is untouched — the rule lives inside the existing `@media (max-width: 900px)`
block and nothing outside it changed.

### Hidden, not deleted from the markup

The stage is rendered by the same code path as desktop, so dropping it from the
markup would mean branching the renderer on viewport width. CSS is the cheaper and
more honest place for a presentation decision. Two JS references had to survive it:

| Reference | Behaviour with a hidden stage |
|---|---|
| `game.js:2535` — click brightness pulse | Already guarded `if (stage && stage.animate)`. Animating a hidden node is a harmless no-op. |
| `game.js:2527` — keyboard tip-floater anchor | **Needed a fix.** See below. |

The floater anchor read:

```js
const btn = document.querySelector('[data-h] .cta') || document.getElementById('stage');
const r = (btn && btn.getBoundingClientRect()) || { left: innerWidth / 2, ... };
```

That is a *null* check on the element. A `display:none` `#stage` is truthy but
measures `0×0`, so the `||` fallback never fires and the `+$N` floater would be
placed in the top-left corner of the screen. It now size-checks the rect instead:

```js
let r = btn && btn.getBoundingClientRect();
if (!r || (!r.width && !r.height)) r = { left: innerWidth / 2, top: innerHeight / 2, width: 0 };
```

In practice the first selector — the "Work the room" CTA — almost always matches,
so this is a latent path rather than an observed break. It is fixed because the
change is what makes it reachable, not because it was seen failing. Being explicit
about that: I did not reproduce a broken floater.

### Verification

Measured, not screenshotted — #50 is the reason. A 400×900 screenshot of that PR's
broken intermediate version looked entirely correct while two panels were collapsed
to zero height.

At **400×800**:

```
panels: ASIDE[62..709] SECTION[709..836] ASIDE[836..1904]
panelOverlap=false
#stage present=true display=none h=0
stage-col rows: 70px 57.25px
stage-col kids: 0..0 709..779 779..836
first CTA top=722
main   overflowY=auto    scrollable=true
ledger overflowY=visible scrollable=false
log    overflowY=visible scrollable=false
doc scrollable=false
bottom 1219/1219
```

Two rows, no collapsed panels, and **the first action button moves from y≈962 to
y≈722** — the 240px is genuinely gone rather than just invisible. Scrollable extent
drops from 1459 to 1219 for the same reason. `700×420` (landscape phone) is identical
apart from total height.

At **1400×900**, unchanged from #50:

```
#stage present=true display=block h=521
stage-col rows: 521px 70px 132px
first CTA top=596
```

(The probe also prints `panelOverlap=true` at 1400px. That is the check being
meaningless on desktop, not a finding — it tests vertical adjacency, and the three
desktop columns all legitimately occupy `62..785` side by side.)

Probe was a temporary `_probe_scroll.html`, deleted before commit and confirmed
absent from the diff rather than from memory:

```
$ git status --short
 M DESIGN.md
 M game.js
 M style.css
$ git diff | grep -nE "PROBE|_probe|debugger"
(none)
```

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass — 201 passed, 1 skipped, 0 failed (unchanged) |
| `node pacing.mjs` | pass — all milestones within band; run2 first LED faster |

No test added, same reasoning as #50: the gates stub the DOM and have no layout
engine, so a test here could only assert that a CSS string exists — which would
check the stylesheet against itself.

### Docs / version

`DESIGN.md` §14.1 gains a "no stage art" paragraph covering the rule, the
hidden-not-deleted decision, and the rect-size gotcha. §14.2's size-container bullet
is annotated: `#stage`'s container queries (neon sign at 660px, hidden at 300px) now
only ever fire on a narrow *desktop* column, never on a phone.

Player-visible change, so `VERSION` → **0.10.8**, build **199**, plus a `CHANGELOG`
entry in `game.js`. `SAVE_VER` stays **8** — no persisted shape changed.

### What this does not cover

- **The stage is the game's main piece of art, and phone players now never see it.**
  That is what was asked for and it is the right call for playability, but it is a
  real loss. A collapsed-by-default toggle would keep it reachable; not in this PR.
- **Resizing across 900px** shows/hides it live with no transition. Correct, just abrupt.
- **The 900px breakpoint is inherited from #50**, not re-examined here. A tablet in
  portrait at 810px now loses the stage too, which may or may not be wanted.
