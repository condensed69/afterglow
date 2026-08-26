# PR A — cold-start goal copy: honest first-purchase hints

## What

Adversarial-UX follow-up (YELLOW: "cold-start economy vs. onboarding hint"). Goal 2
("Brass brings tips") promised *"Click 'Work the room' to afford it"* and Goal 1's
why claimed *"Five solid passes seed the till"* — but the first Tip Rail costs
**$140** against a $20 seed and **$1.15/tap** Work the room. Numbers-checked (probe
against the live sim on `main @ b720f04`):

- Active path: **98 taps** to the first rail (incl. the 5-click $8 goal reward).
- Idle path: **39.1 sim-min** to afford it; 76 idle sim-min ≈ $260.
- Pacing bot (1 tap/s policy) hits first rail at **92s** — the milestone band is
  [90, 150]s. **The economy is exactly at its design target; the copy was the
  defect.** Verified: any material reward bump (e.g. work-goal $8 → $12+) pushes
  the bot under the 90s band floor, so balance was NOT touched.

Copy now sets the true expectation: Goal 2's hint says the rail takes "a long
stretch of taps" (points at the button's per-tap pay) or slow walk-in idle; Goal 3
("Get the word out", Flyer Crew $210 — same defect class, unmentioned funding) gets
the same honesty.

## Scope

- `catalogs.js` — two GOALS hint strings only. No behavior, no balance, no save
  shape, no VERSION/CHANGELOG movement (mirrors the docs-only #108/#109 precedent:
  no behavior change → no version movement).

## Gates

- `node --check catalogs.js` / `node --check game.js` — pass
- `node economy.test.mjs` — **N passed, 0 failed**
- `node pacing.mjs` — full suite, bands bit-identical (hints are not on any bot path)

## Docs

None touched (hint strings are not pinned in DESIGN.md/README.md — verified by
grep; the DESIGN.md §7.3 table lists titles/checks/rewards only).