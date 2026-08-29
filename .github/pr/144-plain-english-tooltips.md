## Plain-English `?`-tooltips for Clout + Regulars (GREEN-10)

Completes ticket **GREEN-10** from the 2026-08-29 UX-leftover handoff. The remaining piece after YELLOW-9 (#143): tear down the last of the jargon wall for a phone-only, non-gamer owner persona.

### The change

The Ledger already renders `?` help icons whose tooltips are documented in `README.md` ("Help & tooltips"). The two terms that stayed in developer-speak are reworded to plain speech. Copy-only — no structure, no CSS, no state.

| Term | Before | After |
|---|---|---|
| Regulars | "Loyal patrons who never leave. Each one generates Clout over time. With Reputation Loop, they also pay $0.04/s cash." | "Customers who come back every night and never leave. Each one slowly builds your Clout. With the Reputation Loop upgrade, they also pay $0.04/s cash." |
| Clout | "Research currency. Earned from Regulars. Spent permanently on the Research tab for global upgrades." | "Money for Research. Regulars earn it for you over time. Spent permanently on the Research tab for upgrades that help the whole club." |

"Patrons" → "customers", "generates" → "slowly builds", "currency" → "money", "global upgrades" → "upgrades that help the whole club". The tooltip still carries the same facts (loyalty, Clout accrual, Reputation Loop cash, Research spending); only the register changed.

### Why copy-only stays safe

- No state added, nothing re-rendered differently — `SAVE_VER` stays **13**; existing saves unaffected.
- The sim and the pacing bot never read these strings — bands are bit-identical.
- The `?` pattern itself is untouched, so `PRESTIGE.md` (perk/manager card tooltip note) and `README.md` records stay accurate.

### Gates (all run on this tree)

- `node --check game.js` — PASS
- `node economy.test.mjs` — 323 passed, 0 failed
- `node pacing.mjs --fast` — all milestones in band, prestige + second-room scenarios pass

### Versioning

`VERSION` 0.11.40 → **0.11.41**, build 253 → **254**; `CHANGELOG` top entry added (Title Case, matching sibling style). `DESIGN.md` §1 spec target advanced to 0.11.41 (the `game.js v0.11.38` parenthetical is untouched — it records what was last substantively authored, not the bump). No other doc carries the old strings (grep-verified).

Docs touched: `DESIGN.md` only (spec-target line).