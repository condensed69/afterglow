## feat: flavor layer — news ticker + named regulars

PR 2 of the replay/deepening roadmap (`REPLAY_ROADMAP.md` §4). Gives the club
identity beyond numbers — pure display, **zero economy impact**.

### What this adds

- **News ticker** — a slim `TODAY` strip under the header rotates through a
  `FLAVOR` table of ambient scene lines keyed on your club's state (regulars,
  hype, the crowd, your build, nights) on a ~3s cadence. A catch-all line
  ("The night is young.") guarantees a non-empty ticker.
- **Named regulars** — `REGULAR_NAMES` is a 20-name pool. `regularName(g)` derives
  a featured name from the active club's regulars count (one new name every 5,
  `null` below 5), surfaced in the Ledger's Regulars note ("Margo is a regular").

### Design (locked)

- **Zero pacing impact**: `FLAVOR`/`REGULAR_NAMES` are read only in `renderVals()`
  (via `flavorLine`/`regularName`) — never in `rates()`/`step()`, so the pacing bot
  is bit-identical (verified: milestones unchanged at 1.53/7.70/5.70/14.35/19.85/32.00m).
- **No save-shape change**: ticker and names are derived, so no new `g.*` field and
  no `SAVE_VER` bump. The ticker line is render-only (rotates on the existing
  `state.tick`, which the bot never renders).
- Mobile: the strip is a single truncated line (`.ticker-bar` media-query padding).

### Docs touched

| File | Change |
|------|--------|
| `game.js` | `FLAVOR` + `REGULAR_NAMES` tables, `regularName()`/`flavorLine()` helpers, ticker render + Regulars note; `VERSION` 0.11.5 / build 218; `CHANGELOG` entry. |
| `style.css` | `.ticker-bar` base + narrow-screen rule. |
| `economy.test.mjs` | 3 tests: table well-formedness, `regularName` derivation, `flavorLine` determinism + rotation. |
| `DESIGN.md` | §18 Flavor layer. |

### Verification gates

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | 236 passed, 0 failed |
| `node pacing.mjs` | all milestones within band, **bit-identical** to pre-PR baseline; prestige + second-room scenarios pass |

### Version / save format

- `SAVE_VER` **does not move** — stays **9** (no persisted fields added).
- `VERSION` 0.11.4 → **0.11.5**, build 217 → **218**; `CHANGELOG` gains the 0.11.5
  entry (player-visible behavior change, so they advance together per AGENTS.md).
