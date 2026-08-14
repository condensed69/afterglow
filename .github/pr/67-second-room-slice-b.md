# Second room: open the annex (Slice B of SECOND_LOCATION.md)

The player-visible half of the Second Location plan: after their **first franchise deal and at least one manager**, the header offers a second lease. Confirming opens the **annex** — a second club with its own till, crowd, buildings, and shift clock — and a `[ Main ] [ Annex ]` switcher appears. SAVE_VER stays 9 (the clubs map was built for this in 0.11.0; no shape change).

## What changed

- **Gate (locked, SECOND_LOCATION.md §2):** `g.prestiges >= 1` **and** `Object.values(g.managers).some(Boolean)` — evaluated on the account. Below the gate: no second-room chrome. Above: an **Open second room** header control → confirmation modal → `confirmOpenRoom()` creates `g.clubs.annex` from a fresh club state. One-time unlock, **not** a prestige; the first club is untouched. `tabStale` blocks open and confirm (no account progress in memory).
- **Switcher:** `setActiveClub(id)` swaps `g.activeClub` and re-renders instantly; the inactive club pauses (no inactive offline window, no cross-club cash — v1 non-goals).
- **Cap-aware crew rebalance (SECOND_LOCATION.md §5):** crew is shared, so switching to a room with a smaller Dressing Room cap evicts excess crew to `off` — deterministic order **floor → stage → VIP**; no auto-restore on switch-back.
- **Ledger:** resources read the active club (already true via `club(g)`); the ledger now labels the room (**Main Room / Annex**); Clout/Legacy remain account-level.
- **`freshClubState()`** extracted from `fresh()` — one fresh-club template shared by main and the annex (shape unchanged, fresh() v9 partition test still passes).
- Modal follows the existing pattern: `showOpenRoom` state flag + view-model exposure — the interactive-surfaces sweep auto-discovers and clicks it.

## Gates (run on `a6bf197`)

- `node --check game.js` — pass
- `node economy.test.mjs` — **228 passed, 0 failed** (was 218; +10: gate matrix, openRoom→confirm flow + tabStale blocking, setActiveClub working-crew eviction matrix, off-shift no-over-evict, moveJob cap enforcement, golden source-club resolution, tab fallback on switch, hostile club-ID rejection, v9 round-trip preserving the annex, wipe returns to main-only)
- `node pacing.mjs` — all milestones within band; prestige delta **−1.87m** — bit-identical (no economy change; the bot never unlocks or switches)

## Review fixes (round 1, `8b5fdbf`)

- **P1 XSS via club ID** — imported club IDs restricted to `/^[A-Za-z][A-Za-z0-9_-]{0,24}$/` (fail-closed) AND switcher/ledger labels HTML-escaped
- **P1 crew-cap bypass** — `moveJob` assign path + rendered lock state now enforce `working (crew − off) < caps(g).crew`; evicted crew can't be reassigned straight back
- **P1 README** — Second-room controls documented
- **P2 eviction overcount** — rebalance compares **working crew** (`g.crew − g.jobs.off`) against the cap; off-shift crew are never re-evicted
- **P2 header overflow** — ≤900px the header wraps (flex-wrap + auto height over inline styles); shift block and ☰ stay reachable
- **P2 golden cross-club** — offers bind to their source club (`g.golden.club`); `takeGolden` and the badge preview/cap resolve there even after a switch
- **P2 gated-tab desync** — switching to a fresh room falls back to Club when Upgrades is not unlocked

## Docs

- `SECOND_LOCATION.md` — status/scope header, §5 crew-rebalance note (eviction order), §13 checklist (Slice B items [x])
- `DESIGN.md` — new §17 Second room summary, §14.5 header-controls bullet, §14.1 UI-map rows
- `PLAN.md` — Deferred: Slice B shipped note
- VERSION 0.11.1 / build 214 + CHANGELOG entry in `game.js`

## SAVE_VER

**Unchanged (9)** — the clubs map keyed by plain string ids was designed for this; no migration needed, existing saves load untouched.
