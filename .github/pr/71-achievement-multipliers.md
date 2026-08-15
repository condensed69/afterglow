## feat: achievement milk multiplier (+1% cash per achievement)

PR 1 of the replay/deepening roadmap (`REPLAY_ROADMAP.md` §3). Makes the achievement
collection a real progression path instead of a checklist.

### What this adds

`achievementMult(g)` — a Cookie-Clicker-style "milk" multiplier:

```js
achievementMult(g) {
  const owned = new Set(Array.isArray(g.achievements) ? g.achievements : []);
  const count = this.ACHIEVEMENTS.filter(a => !a.burst && owned.has(a.id)).length;
  return 1 + 0.01 * count;
}
```

- Counts **unique, non-burst** achievements: duplicate ids are Set-deduped, and the
  4 live-only burst achievements (`whale_1`, `whale_10`, `special_1`, `special_5` —
  driven by `g.whalesCount`/`g.specialsCount`, which the deterministic pacing bot can
  never earn) are excluded via a `burst: true` flag. Ceiling is **+34%** (34 of 38).
- Applied to **all** cash income through a single composition point
  `totalCashMult(g) = cashIncomeMult(g) × achievementMult(g)`: passive `rates()`,
  active clicks `workCrowd()`, the whale bonus `spawnWhale()`, and the golden-ticket
  tip `takeGolden()` + its preview. The Work-the-room CTA label and grant now both
  derive from the same multiplied `clickGrant`, so the label can't understate the payout.
- **Derived from `g.achievements`** — no save-shape change, no `SAVE_VER` bump. Existing
  saves are unaffected; the multiplier is computed live.

### Pacing re-baseline (required by the doc §3)

The pacing bot earns achievements deterministically as it plays, so the multiplier
grows during a run and shifts the late milestones. Re-measured the full milestone
table (deterministic — the special-shift roll is `_live`-gated, so `pacing.mjs` is
bit-identical across runs). The burst/dedupe fix does **not** change pacing: the bot
never earns burst achievements or duplicates, so its count is unchanged.

| Milestone | Before | After | Band |
|-----------|--------|-------|------|
| First building (rail) | 1.53m | 1.53m | 1.50–2.50m |
| First crew | 7.70m | 7.70m | 3.75–10.00m |
| 10 patrons | 5.70m | 5.70m | 4.50–7.50m |
| First upgrade (LED) | 14.67m | 14.35m | 8.40–23.40m |
| First research | 20.63m | 19.85m | 17.50–32.50m |
| All upgrades owned | 39.97m | **32.00m** | **22.40–41.60m** |

Only "All upgrades owned" shifted materially (~20% faster — the intended effect of
achievements mattering). Its band is re-centered from `~45 min ±30%` to
`~32 min ±30%` in `pacing.mjs`. Early milestones are untouched (no achievements
earned yet); "first research" and "first upgrade" moved <4% and stay well inside
their bands.

### Docs touched

| File | Change |
|------|--------|
| `game.js` | `achievementMult()` (unique non-burst) + `totalCashMult()` composition point + wiring into `rates()`/`workCrowd()`/`spawnWhale()`/`takeGolden()`; `burst` flags on the 4 live-only achievements; `VERSION` 0.11.4 / build 217; `CHANGELOG` entry. |
| `economy.test.mjs` | 3 tests: `achievementMult` unique-non-burst (1.00 @ 0 / 1.34 @ all / dedupe / burst-excluded), `rates().cash` scaling, and whale/golden event-cash scaling. |
| `pacing.mjs` | "All upgrades owned" band re-centered ~45m → ~32m. |
| `DESIGN.md` | §4.2 (shared multipliers + `totalCashMult`), §8.1 (Work the room click), §11.2/§11.4 (whale/golden formulas), §12 (milk multiplier note). |

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | 233 passed, 0 failed |
| `node pacing.mjs` | all milestones within band; prestige + second-room scenarios pass |

### Version / save format

- `SAVE_VER` **does not move** — stays **9** (the multiplier is derived, not stored).
- `VERSION` 0.11.3 → **0.11.4**, build 216 → **217**; `CHANGELOG` gains the 0.11.4
  entry (behavior change, so they advance together per AGENTS.md).

### Review-round note

First review wave (4 findings) is addressed in `5244b82`: the multiplier now counts
unique non-burst achievements (dedupe + burst exclusion), applies to event cash via
`totalCashMult`, and the click label matches the grant. `REPLAY_ROADMAP.md` itself is
introduced by PR #70 (docs-only, merges first); this branch rebases onto it.
