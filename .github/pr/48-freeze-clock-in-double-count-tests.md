## test: freeze the clock in the three double-count tests, and assert exactly 0

Follow-up to #47, closing the third item its "What this still does not cover" section left
open: *"Other tests may share the `offline > 0` dependency. Only the two tests that actually
failed were audited."*

This is the sweep. It found three more clock-coupled tests, and it found them without
waiting for CI to flake.

### Method: a deterministic probe, not a stress run

Brute-force repetition is a bad way to find flakes — it only finds the ones whose odds
happen to be high enough, and it says nothing about margin. The actual failure mode in both
#47 flakes was *wall-clock elapsing between two `Date.now()` reads*, so that is what to
simulate directly:

```js
const real = Date.now;
let acc = 0;
Date.now = () => real() + (acc += K);   // every read advances the clock by K ms
```

Any two reads are then guaranteed at least `K` apart. Sweeping `K` measures how much slip
each test tolerates, which is the number that actually matters — a test is fragile in
proportion to how little slip it survives, not to how often it has failed so far.

The probe registered 2194 `Date.now()` calls across the suite, so it genuinely exercises the
paths under test rather than passing vacuously.

### What it found

Three tests failed at `K = 300ms`:

| Test | Assertion |
|------|-----------|
| `init migrate + offline persists; second init does not double-count offline` | `delta < 1` |
| `init setItem throw after migrate skips catch-up` | `no double-count after recover` |
| `init post-catchUp setItem throw still claimed ts` | `reload must not re-apply offline gap` |

All three do the same thing: `init()` twice, then assert the second init did not re-apply the
offline window. All three used a `< 1` tolerance, and the tolerance existed *only* to absorb
however much real time passed between the two inits. The comment on the first said so
outright — "Tiny sub-second offline between inits can tick fractional cash; bound it tightly."

That is a live-clock workaround, and it is the same defect class as both #47 flakes.

### The fix makes the assertions stronger, not just stabler

Each test now runs under `withFrozenNow` (added in #47). With the clock held, the first init
claims `ts` at exactly `t`, so the second init measures a **0-second** window and applies
nothing. The delta is not "small" — it is exactly 0:

```diff
-  ok(delta < 1, `second init must not re-apply ~1h offline (…)`);
+  strictEqual(delta, 0, `second init must not re-apply ~1h offline (…)`);
```

So this is not merely a flake fix. A fractional re-apply — real double-counting, just small —
would have passed the old `< 1` check and now fails. The tolerance was hiding a class of bug
it was never meant to permit.

The signal these tests guard is ~1700 cash (a replayed hour); the old slack was 1; the new
slack is 0.

### Result

| `K` (ms per clock read) | before | after |
|---|---|---|
| 250 | pass | pass |
| 300 | **1 failed** | pass |
| 500 | **2 failed** | pass |
| 1000 | **3 failed** | pass |
| 5000 | **3 failed** | pass |
| 30000 | — | 2 failed (see below) |

Sub-second fragility is gone; the suite now tolerates 5s of slip per clock read.

### What still fails at K = 30000, and why that is correct

Two tests fail at 30s per clock read. Both are time-dependent *by design*, with margins two
orders of magnitude above anything a loaded runner produces:

- `catchUp clears a golden offer whose TTL lapsed offline` — `GOLDEN_TTL = 30` (`game.js:351`).
  It asserts a just-created offer is still fresh. Breaking it requires >30s between two
  adjacent reads.
- `init migrates saveVer 3 from localStorage without wipe` — seeds `ts: Date.now() + 60_000`
  to exercise the future-timestamp guard. Breaking it requires >60s of drift to turn that
  future stamp into a past one.

These are not the same defect: a 30–60 second margin is a deliberate constant under test, not
an accidental dependency on how fast the harness ran. Left alone deliberately. Chasing them
would mean freezing the clock around the very constants the tests exist to measure.

### What this does not do

- **It does not prove the suite is flake-free.** It proves no test depends on sub-5s wall-clock
  slip between clock reads. Nondeterminism from `Math.random()` is a separate axis — that was
  #47's first flake, and `withRandom` is the tool for it. No equivalent sweep was run for RNG.
- **No `game.js` change.** The open question from #47 stands untouched: the load-time achievement
  backfill lives inside `if (offline > 0 && claimed)` (`game.js:1148`), so a save loaded with no
  measurable gap is never backfilled. Whether that is correct is a behavior question, still
  unanswered, still deliberately not widened into a change here.

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | pass — 201 passed, 1 skipped, 0 failed (unchanged counts; 3 assertions tightened) |
| `node pacing.mjs` | pass — prestige scenario, run2 first LED faster |

### Docs / version

No docs touched: no player-visible behavior, no constant, no system changed. No `VERSION`,
build, or `CHANGELOG` bump — tests only, `game.js` unchanged. `SAVE_VER` stays 8.
