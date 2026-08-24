## Summary

Ultra-review fix plan PR 1/3 — docs-only sweep for 1 WARNING (W1) + 6 NITs.
No behavior change, no `game.js`/`catalogs.js`/`pacing.mjs` change, no
`VERSION`/`CHANGELOG`/`SAVE_VER` movement (mirrors PR #108 precedent).

## Changes

- **W1 — DESIGN.md:98** — canonical `totalCashMult(g)` formula pin now shows
  the full 8-factor composition (House cut × milk × Brand Licensing ×
  challenge rewards × Nationwide Reach × Brand Endorsement × Vision ladder ×
  challenge incomeMod), matching `game.js:864-879`. The individual factors were
  already documented in §22; this fixes only the canonical block.

- **N1 — README.md:2** — stale tagline "tip the stripper to show her tits"
  (performer removed v0.7.0) → "A neon-noir nightclub-management idle game.
  Run the room, build the club, and grow a franchise."

- **N2 — REPLAY_ROADMAP.md:3** — "design lock … No code shipped yet" →
  "complete — all 8 PRs shipped (0.11.4–0.11.11); post-polish PRs #102–#108
  extended it further. See the timeline at the bottom."

- **N3 — REPLAY_ROADMAP.md:18** — baseline "4 research, 38 achievements,
  ~10 goals" → "8 buildings, 6 upgrades, 12 research, 6 perks, 8 managers,
  57 achievements, 5 jobs, 14 goals, 4 shifts + 3 specials, 3 clubs."

- **N4 — PRESTIGE.md:188** — parenthetical `cashIncomeMult(g) ×
  achievementMult(g)` → "`totalCashMult(g)` — the single all-cash composition
  point (House cut × milk, plus the brand/endorsement/vision/challenge
  factors; see DESIGN.md §4.2)."

- **N5 — PRESTIGE.md:192** — "Leaving static `max 6` while allowing a seventh
  hire is a bug" → "Shipped: `doorMax(g)` derives the cap (6 + doorPlus +
  challenge doorMax), and the card description dynamically substitutes the
  value for `(max 6)` (game.js)."

- **N6 — DESIGN.md:897** — band order "1.53 / 7.70 / 5.70 …" (crew before
  patrons) → canonical "1.53 / 5.70 / 7.70 / 14.35 / 19.85 / 32.00 m"
  (rail / patrons / crew / LED / research / all-upgrades).

- **N8 — DESIGN.md:492** — 0.11.26 bullet already carried the milk-ceiling
  expansion (+49% → +53%, 53 non-burst of 57 total); verified no edit needed.

## Gates

Docs-only; no behavior change.

- `node --check game.js` — pass (no `game.js` change)
- `node economy.test.mjs` — pass (unchanged from baseline; 307 passed)
- `node pacing.mjs` — pass (bit-identical bands)

## Docs

- `DESIGN.md`, `README.md`, `REPLAY_ROADMAP.md`, `PRESTIGE.md` — same PR
  (docs ship with the feature; PR 1 is the doc half).

## Versioning

No `VERSION`/`SAVE_VER` bump. No `CHANGELOG` entry (docs-only, not a
shipped behavior).

## Plan

`.hermes/plans/2026-08-23_ultra-review-fixes.md` — PR 1/3 (PR 3 next, PR 2
pacing-sensitive last).
