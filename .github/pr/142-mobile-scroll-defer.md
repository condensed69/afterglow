## Summary

Mobile dragging "either doesn't work or rubber-bands constantly." Root cause
is in the render path, not the CSS.

`render()` does `this.root.innerHTML = ...` on every throttled frame (~4fps),
rebuilding the entire tree — including the `.shell-grid` scroll container. The
scroll-defer guard added in 0.11.22 (intent: *pause rendering during touch
scroll*) was attached **once at init** to that *transient* `.shell-grid` node.
After the first render the node is detached, so `onScroll` never fires again:
`this.scrolling` stays `false` forever, and `forceUpdate()` never defers.

Consequence: mid-gesture `innerHTML` replacement detaches the element under the
finger → the drag does nothing (native scroll stops), and `scrollSave` snaps
it back to the captured position → rubber-band. That is exactly the reported
symptom. The 0.11.22 pause-render guard was dead code after frame 1.

## Approach

One root-cause change. Attach the scroll listener to the **persistent**
`this.root` in the **capture phase**: scroll events do not bubble, but
ancestors catch them in capture, so a listener on `this.root` survives every
`innerHTML` rebuild. Now `this.scrolling` tracks real scrolls across every
render, `forceUpdate()` defers while `scrolling` is true, and no `innerHTML`
replacement happens mid-gesture. Listener is `passive` with no `preventDefault`,
so desktop behavior is unchanged.

No CSS, no `rates()`/`caps()`/`step()`, no balance, no save-shape change
(SAVE_VER stays 13). Pacing is bit-identical.

## Verification

- `node --check game.js` → PASS
- `node economy.test.mjs` → exit 0 (all non-skipped passed)
- `node pacing.mjs --fast` (CI gate) → exit 0, milestone bands intact
- Static trace: `render()` replaces `this.root.innerHTML` (incl. `.shell-grid`)
  each frame; prior guard sat on the transient node, new guard sits on the
  stable mount node in capture phase, so it survives.

## Save version

**Unchanged (SAVE_VER 13).** `VERSION` advanced 0.11.38 → 0.11.39 / build 252
with a matching `CHANGELOG` entry (mobile scroll render-defer fix only).

## Docs updated

- `game.js` — `VERSION` + `CHANGELOG` top entry.

## Files

- `game.js`
- `.github/pr/142-mobile-scroll-defer.md` (this body, added after open)
