## fix: golden-ticket claim buttons throw on click (0.10.6, build 197)

**PR #43 already merged the 0.10.5 feature work** (mobile buy-multiple + compact VIP
badge). This branch was the duplicate carrying the *fixed* version of the same commit, so
after rebasing onto `main` what remains is the bugfix, its tests, and the docs pass.

### The bug that is live on `main` right now

The golden-ticket badge built its claim closures inside `render()`:

```js
<button data-h="${this.bind(() => this.takeGolden(g, 'cash'))}" ...>
```

`render()` has only `v` (the `renderVals()` output) in scope — there is no `g`. The template
parses and renders fine, then throws `ReferenceError: g is not defined` inside the delegated
click handler. **Clicking either claim button does nothing: the reward is never granted and
the offer never clears.** It sits there until the 30s TTL expires.

Fixed by building the closures in `renderVals()`, where `g` is in scope, and consuming them
as `v.takeGoldenCash` / `v.takeGoldenCrowd` — the same shape as every other bound action.

Also fixed: `crowdAmount` was interpolated as a raw float. `g.patrons` is fractional in the
sim, so the preview could read `+7.339999999999998 crowd`. Now rounded, matching the claim
log line.

### Why the tests did not catch it

This is the second time this exact bug class has shipped — the first was the prestige modal
in PR #30. It survives a render smoke test, because rendering is not what throws; only an
actual click is. Three tests added:

- `renderVals()` exposes both claim actions and a rounded crowd preview.
- `render()` does not throw with the badge expanded.
- **Click-through** — invoking `v.takeGoldenCash()` / `v.takeGoldenCrowd()` resolves the
  offer. This is the one that would have caught it.

`DESIGN.md` §14.4 now states the rule and requires that pair for any new interactive
surface, so the third occurrence gets caught by the checklist rather than by a player.

### Also in this PR

- Dropped the duplicated Shift-click `title` from the ×5/×10/×Max buy buttons; kept on ×1
  now that a dedicated ×Max button exists.
- The docs pass PR #43 skipped (it shipped player-visible controls and touched no docs).

### Docs touched

| File | Change |
|------|--------|
| `DESIGN.md` §11.4 | Golden-ticket presentation: badge not overlay, `goldenOpen`, rounded crowd preview. |
| `DESIGN.md` §14.3 | New — buy-multiple buttons, shared `buildingMaxAffordable()`, Shift-click behavior. |
| `DESIGN.md` §14.4 | New — templates read the view model, never `g`; the regression-test pair new interactive surfaces require. |

`README.md` untouched — it documents no controls. `PLAN.md` / `PRESTIGE.md` untouched —
nothing here touches prestige or a planned item.

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass — 196 tests, 0 failed (193 before; +3) |
| `node pacing.mjs` | pass — all milestones in band |

Pacing is unaffected by construction: the golden ticket is live-only, and the pacing bot
drives `step()` with `_live = false`, so it never rolls.

### Version / save format

- `VERSION` `0.10.6`, build `197`, and a `CHANGELOG` entry advance together. This is a
  behavior change — a broken button becomes a working one.
- `SAVE_VER` **stays 8**. `goldenOpen` is transient `this.state`, not persisted `g`.
