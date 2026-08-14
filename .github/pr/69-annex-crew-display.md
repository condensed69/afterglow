# Fix: annex shows first club's dancer count (working-crew display)

## What changed

The second room (annex) shares the account's crew roster, but its Dressing Rooms cap how many can *work* there — excess crew are evicted to Off Shift on switch (SECOND_LOCATION.md §5). The **display** was reading the total shared roster (`g.crew`) instead of the working roster (`crew − Off Shift`), so the annex's "Hire Crew" card and Ledger Crew stat showed the first club's dancer count carried over (e.g. "Hire Crew 43 / 18") instead of the crew actually working there.

- `hireCrew()` — cap check now uses working crew (`crew − off`) instead of total, matching `moveJob()`.
- Hire Crew card `owned` + `room` — report working crew / cap.
- Ledger `Crew` stat — reports working crew / cap.

The data model is unchanged: crew stays shared, and `setActiveClub` still evicts excess working crew to Off Shift. This is purely a display/consistency fix so the UI reports the roster that is actually on the floor.

## Gates (run on `271f95b`)

- `node --check game.js` — pass
- `node economy.test.mjs` — **230 passed, 0 failed** (2 new: working-crew display + `hireCrew` working-cap)
- `node pacing.mjs` — all 3 sections pass (milestone bands, prestige, second-room)

## Docs

- `DESIGN.md` §6.1 — hire cap documented as working crew (`crew − off`), not total.

## SAVE_VER

**Unchanged (9)** — no save-shape change; display and a hire-cap check only.
