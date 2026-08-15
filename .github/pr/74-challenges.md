## feat: challenge runs — opt-in replay modifiers with permanent rewards (PR 4)

AD's #1 replay hook (REPLAY_ROADMAP.md §6): 4 opt-in challenges in the Perks
panel. Starting one resets every club to a fresh run under a modifier;
completing it permanently grants a derived bonus.

### What changed

- **`CHALLENGES` table** (4 entries): Tight Till ($0 till → +5% all cash),
  Slim Margins (income ×0.5 → +1 Door Staff cap), No Street Team (Flyer Crew
  locked → +5% crew output), Lean Night (Back Bar locked → +5% all cash).
- **`startChallenge`** — two-click armed (it resets the run). Resets EVERY
  club to `freshClubState()` and **re-locks the annex** (only `main` survives);
  account meta (Legacy, perks, achievements, managers, `challengesDone`)
  persists; run state (research, Clout, crew, jobs) resets like a franchise
  deal. Persist-before-replace, matching `confirmPrestige`.
- **Modifiers are action invariants:** `incomeMult` flows through
  `totalCashMult` (passive AND active clicks + whale + golden — no click
  bypass); locked buildings are rejected in `buyBuilding`, skipped by
  `autoBuyManagers` (an owned manager can't auto-buy a locked structure), and
  greyed as LOCKED in the card.
- **Rewards are derived, not stored:** `challengeBonus(g)` aggregates
  `challengesDone` + the table into additive `cashMult` (+% all cash via
  `totalCashMult`), `doorMax` (+N cap), `crewOut` (+% crew output). No Clout
  or Legacy rewards (Legacy-not-Clout rule).
- **Completion** runs on the same beats as achievements (`checkAchievements` →
  `checkChallenge`); `endChallenge()` lifts the modifier without reward (mercy
  rule); prestige clears the active challenge but keeps `challengesDone`.

### Gates (all run locally)

| Gate | Result |
|------|--------|
| `node --check game.js` | pass |
| `node economy.test.mjs` | **252 passed** (245 prior + 7 new) |
| `node pacing.mjs` | all in band — 1.53 / 7.70 / 5.70 / 14.35 / 19.85 / 32.00 / **105.18m**, bit-identical to PR 3 |

New tests: table well-formedness (no Clout/Legacy rewards), start resets every
club + re-locks annex + preserves meta (incl. two-click arm), incomeMult hits
passive AND clicks, locked building enforced at all three layers (buy /
manager / card), completion + derived reward, doorMax/crewOut wiring,
endChallenge mercy rule.

### Pacing

**Bit-identical** — challenges are opt-in and the pacing bot never starts one
(`g.challenge` stays null), so every band is untouched. No `pacing.mjs`
changes at all.

### Versioning

`VERSION` 0.11.7 / build 220 · `CHANGELOG` entry · **`SAVE_VER` unchanged (9)**
— `g.challenge`/`g.challengesDone` are additive fields (same pattern as
goals/clicks/managerPaused); sanitize/import fail-closed on unknown ids.

### Docs touched

`DESIGN.md` §20 (challenge runs), `PRESTIGE.md` §10 (challenge runs),
`SECOND_LOCATION.md` §4 (account-level field table + code block), PR body.
