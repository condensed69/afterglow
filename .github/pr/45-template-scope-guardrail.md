## test: enforce "templates read the view model, never `g`"

Follow-up to #44. That PR fixed the second occurrence of this bug and wrote the rule into
`DESIGN.md` §14.4 — but a docs checklist is not enforcement, and the rule had already been
ignored once. This makes it a gate.

### The bug class

`render()` has only `v` (the `renderVals()` output) in scope. A template that references the
bare identifier `g` parses fine, renders fine, and then throws
`ReferenceError: g is not defined` inside the delegated click handler. It survives every
render smoke test and fails only when a player actually clicks.

Shipped twice: the prestige modal (#30) and the golden-ticket badge (#43, fixed in #44).

### Two gates, added to `economy.test.mjs`

**1. `render() never references the bare identifier \`g\`.**
Brace-matches `render()` out of the `game.js` source and scans it for `g` used as an
identifier (`(?<![\w.$])g(?![\w$])`). Reports each hit with a line offset into the method,
so the failure names the exact cause rather than a symptom.

**2. `every bound click handler is invocable without a scope error`.**
Renders 12 surfaces — each Systems tab (club / crew / upgrades / research / perks), each
modal (changelog / achievements / settings / prestige), and the golden badge collapsed,
expanded, and on a stale tab — then **calls every handler `bind()` registered** and fails on
`ReferenceError`. This is the click a render smoke test cannot perform. Currently sweeps
~250 handler invocations.

The sweep only treats `ReferenceError` as a failure. A handler is free to throw for
missing-DOM reasons in this harness, and it runs against a throwaway in-memory game, so
destructive actions (wipe, prestige, download) are harmless.

### Verified against the actual bug

Both gates were run against a reintroduced copy of the shipped #43 code
(`this.bind(() => this.takeGolden(g, 'cash'))`). Both fail:

```
FAIL  render() never references the bare identifier `g`
      render() must not reference `g` — build the value in renderVals() and read it off `v`
FAIL  every bound click handler is invocable without a scope error
      handlers threw a scope error on click — the template captured game state render() does not have
Results: 196 passed, 0 skipped, 2 failed
```

`game.js` was then restored; the suite is green at 198.

### The gap, stated plainly

The sweep covers surfaces on its `surfaces` list. **A surface not on that list is not
swept.** Both `AGENTS.md` (verification gates) and `DESIGN.md` §14.4 now say so, and say to
register new modals/overlays/tabs there. That is the one honor-system step left, and it
fails loudly rather than silently once someone adds a surface and a handler regression to
go with it.

### Docs touched

| File | Change |
|------|--------|
| `AGENTS.md` | Verification gates: register new interactive surfaces in the sweep's `surfaces` list. |
| `DESIGN.md` §14.4 | Rule now documents the two enforcing gates rather than a review checklist. |

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass — 198 tests, 0 failed (196 before; +2) |
| `node pacing.mjs` | pass — all milestones in band |

### Version / save format

No `VERSION` / build / `CHANGELOG` bump: tests and docs only, no behavior change and no
`game.js` change. `SAVE_VER` stays 8.
