## test: sweep the RNG axis, make `withRandom` throw on script overrun, answer the `offline > 0` question

Closes the last two open items carried in #47 and #48's "what this does not cover" sections:
the unswept `Math.random()` axis, and whether the load-time achievement backfill's
`offline > 0` guard is a real defect.

One is a clean bill of health, one is a real latent bug, and one is a question that turned out
to have a factual answer requiring no behavior change.

### 1. The RNG axis is clean — and the probe proves it, rather than just not failing

#48 swept wall-clock slip. The other nondeterminism axis is `Math.random()`, which caused
#47's first flake. Same approach: don't stress-run, simulate the failure mode.

**Validity gate first.** `withRandom` reassigns `Math.random` wholesale, so a globally
installed PRNG only reaches draws *outside* those blocks. With 30 `withRandom` call sites
already in the file, the global stream could plausibly see almost nothing — and a sweep over
a stream nobody consumes is a vacuous probe. So the first measurement was the counter, not
the sweep:

```
SEED=1 globalDraws=12944 exit=0
```

12,944 draws reach the global stream. The probe has signal.

**Uniform sweep:** 24 seeds, zero failures.

**Bias sweep** — the margin measurement, since a uniform stream rarely visits its own tails.
Every global draw pinned into a narrow band, so every chance event either always fires or
never does:

| band | failures |
|---|---|
| `[0, 0.001)` — everything fires | 0 |
| `[0, 0.01)` | 0 |
| `[0, 0.05)` | 0 |
| `[0, 0.2)` | 0 |
| `[0.5, 1)` | 0 |
| `[0.9, 1)` | 0 |
| `[0.999, 1)` — nothing fires | 0 |

No test outside a `withRandom` block asserts on anything an RNG draw can change. The 12,944
global draws are all consumed by paths no assertion depends on. **No fix needed on this axis** —
that is the finding, and it is now measured instead of assumed.

### 2. `withRandom` silently wrapped its script — one test was already relying on it

The helper cycles: `values[i++ % values.length]`. A block that draws more times than it
supplied wraps back to `values[0]` and re-fires whatever that value was chosen to trigger. The
helper's own comment already warned about this ("supply enough sequence values to cover it"),
which means the hazard was known and enforced by nothing.

That is the same defect shape as #48's `< 1` tolerance: the test passes because an incidental
property of the harness happens to be benign, not because anyone chose it.

Instrumented every call site with a draw counter. Four blocks overran:

| site | draws / supplied | verdict |
|---|---|---|
| `:315` `[1]` | 2 / 1 | benign — single-value list is a constant stream |
| `:809` `[0.0]` | 2 / 1 | benign — same |
| `:1396` `[0.99]` | 178 / 1 | benign — same |
| **`:993` `[0.99, 0.99, 0.99, 0.0]`** | **6 / 4** | **real** |

A one-value list is the deliberate "pin `Math.random` to this constant" idiom, where cycling
is the entire point. A multi-value list is a per-draw script, and wrapping one is a bug.

**`critic fires at night rollover during a live step` was the real one.** Its comment reads
"Rolls per slice: whale, golden, special rollover, critic" — four. Tracing every draw's stack
showed six, with draws #5 and #6 carrying byte-identical stacks to #1 and #2:

```
DRAW#4 -> 0     ...maybeCritic
DRAW#5 -> 0.99  <- identical stack to DRAW#1 (whale)
DRAW#6 -> 0.99  <- identical stack to DRAW#2 (golden)
```

`step(0.1)` runs **two** slices, not one: the test sets `shiftT` to 0.05 short of the shift
length precisely so the shift rolls over, and a second slice runs after it. The wrapped draws
landed on `values[0..1]`, both `0.99` (no-fire), so nothing misbehaved — by luck. Reordering
that list to fire an event first would have made draw #5 fire it a second time.

Now supplied explicitly as six, with a comment describing what actually happens.

### 3. The guard: overrun throws instead of wrapping

The strictly-stronger-harness analogue of #48's `< 1` → `=== 0`:

```js
if (values.length > 1 && i > values.length) {
  throw new Error(`withRandom script overrun: ${i} draws against ${values.length} supplied values. …`);
}
```

Scoped to multi-value lists only, so the constant-pinning idiom keeps working. Under-supplying
(padding a list beyond what gets drawn) stays legal — it is the defensive pattern the helper's
comment recommends, and it is harmless.

Scope checked before landing it, per AGENTS.md *"if a change breaks a large share of the suite
at once, you have violated an invariant"*: the guard fails **exactly one** test, the one above.

```
withRandom script overrun: 6 draws against 4 supplied values. …
Results: 200 passed, 1 skipped, 1 failed
```

### 4. The `offline > 0` question from #47, answered

#47 left this open: the load-time achievement backfill sits inside `if (offline > 0 && claimed)`
(`game.js:1148`), and a frozen-clock test with a zero gap never reached it. Whether that was a
player-facing bug was never determined.

It is not, for two independent reasons:

1. `offline` is a **float**: `Math.min(Math.max(0, (nowMs - g.ts) / 1000), 28800)`. `g.ts` is
   written by the saver interval, so any real reload puts at least a millisecond between that
   write and this read. `offline > 0` is true. A zero gap requires `Date.now()` to return the
   same value twice — a frozen test clock, not a browser.
2. Even if it were zero, it self-heals: `step()` calls `checkAchievements(g)` **every slice**
   (`game.js:1631`), and the live timer starts ~100ms after `init`.

The other paths where the branch is skipped — no `g.ts`, future `g.ts` (clock-skew clamp),
non-owner tab (the `else if (offline > 0)` in-memory path) — are each deliberate and already
commented.

So the honest deliverable is a comment, not a code change. `game.js` gains one comment block
recording the above; no logic changed. **The question is retired, not carried forward again.**

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass — 201 passed, 1 skipped, 0 failed (unchanged counts) |
| `node pacing.mjs` | pass — prestige scenario, run2 first LED faster |

Also re-ran #48's clock-skew sweep: still clean through `K = 5000ms`.

### Probes were not committed

The seed/bias probes live in a scratchpad and import the suite from outside, same as #48. The
per-draw stack tracing and the draw counter were temporary edits to `withRandom`, used to
produce the tables above and then reverted; the only surviving change to the helper is the
`throw`. Same pattern as #47's `vipLounge: 0` insertion — instrument, record, restore.

### Docs / version

No docs touched: no player-visible behavior, no constant, no system changed. No `VERSION`,
build, or `CHANGELOG` bump — the sole `game.js` edit is a comment, and AGENTS.md scopes those
bumps to behavior changes. `SAVE_VER` stays 8.

### What this does not cover

- **The two K=30000 clock failures from #48 are still there and still correct** — `GOLDEN_TTL = 30`
  and the `+60_000` future-ts guard are deliberate constants under test.
- **`_specialShift` / `_whaleCooldown` remain unenforced** by the `CLUB_FIELDS` coverage test
  (carried from #47, unchanged, still an accepted trade-off).
- **Nothing here stops an agent thrashing on a branch.** Still the one failure mode from the
  reverted multi-club WIP that no gate addresses; AGENTS.md "When a gate fails" is still just a
  document.
- **The overrun guard is dynamic, not static.** It fires only on call sites the suite actually
  executes. A `withRandom` block inside a skipped test is unchecked until that test arms.
