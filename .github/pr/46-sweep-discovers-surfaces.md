## test: discover sweep surfaces instead of listing them

Closes the gap #45 left open. That PR's handler sweep only covered surfaces on a
hand-maintained list, so a new modal was protected only if someone remembered to register
it — an honor-system step guarding against a bug whose whole history is people forgetting.

### The list was already wrong

#45 shipped with `{ name: 'upgrades tab', state: { tab: 'upgrades' } }` and the same for
`'research'`. The real tab ids are **`'up'` and `'res'`**. Both entries fell through to the
default tab, so the sweep covered the club tab three times and the Upgrades and Research
tabs zero times — and passed, because a wrong-but-renderable surface looks identical to a
correct one. That is the argument against lists, made by the list itself.

### Discovery

- **Tabs** come from the view model's own `tabs` array, activated by calling each tab's `go`
  action. The test never needs to know a tab id, so it cannot get one wrong.
- **Modals and overlays** come from every boolean flag on `game.state` — each raised alone,
  plus one pass with all raised together to cover dependent pairs like `resetArmed` inside
  the settings modal.

Coverage goes from 12 claimed surfaces (10 real) and ~250 invocations to **13 surfaces and
~565 invocations**, now including the Upgrades and Research tabs and `resetArmed`, none of
which were actually swept before.

A second test, `handler sweep discovers every surface without a hand-maintained list`,
guards the discovery: if a refactor stops exposing tabs on the view model or renames the
state booleans, the sweep would otherwise shrink to nothing and keep passing.

### Verified two ways

**The shipped bug still fails the gates** — reintroduced
`this.bind(() => this.takeGolden(g, 'cash'))`:

```
FAIL  render() never references the bare identifier `g`
FAIL  every bound click handler is invocable without a scope error
```

**A brand-new modal is swept with no test edit** — added a `showFakeModal` boolean to
`state` and a modal template with a bare-`g` handler, exactly how a developer would add one,
and changed nothing in `economy.test.mjs`:

```
FAIL  every bound click handler is invocable without a scope error
      state.showFakeModal handler 43 — g is not defined
```

`game.js` was restored after both; the suite is green at 199.

### What is still not covered

A surface driven by something other than a `game.state` boolean — a URL parameter, say.
Nothing in the current UI works that way. Documented in `DESIGN.md` §14.4 rather than left
implicit.

### Docs touched

| File | Change |
|------|--------|
| `AGENTS.md` | Replaces the "register your surface" instruction with the fact that surfaces sweep themselves. |
| `DESIGN.md` §14.4 | Documents discovery, both verification runs, and the remaining residue. |

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass — 199 tests, 0 failed (198 before; +1) |
| `node pacing.mjs` | pass — all milestones in band |

### Version / save format

No `VERSION` / build / `CHANGELOG` bump: tests and docs only, `game.js` unchanged.
`SAVE_VER` stays 8.
