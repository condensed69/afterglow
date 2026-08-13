## Remove duplicate ? help icons from cards that already show their description

### The problem

Every card-based surface (Club buildings, Upgrades, Research, Perks, Managers, and Crew job rows) rendered its description text under the card name **and** baked the same text into the inline help icon's tooltip — the `?` repeated the visible text verbatim, adding noise instead of information.

The Ledger resources and stats keep their icons: those tooltips ("Room energy. Multiplies all cash income and click value…") explain mechanics the label does not show, which is the icon's actual job.

### The fix

Dropped `this.helpIcon(name, desc)` from the six card surfaces (7 call sites). The visible `desc` on each card already carries the text; nothing is lost — the DOM text remains for screen readers, and the `helpIcon()` helper itself is untouched for the surfaces where it earns its place.

Bonus fix found while editing: the building-card owned marker was double-escaped (`'\\u00d7'` → rendered the literal text `\u00d7` instead of `×`). Now a clean literal `×` — verified live: rail card renders `owned: "×2"`.

### Verification

- Live render check via the test harness: Tip Rail card = name `"Tip Rail"` (no `?`), owned `"×2"`; Ledger Hype row still carries its `?` with the definition.
- The PR #55-era job test that asserted `name.includes('help')` is updated to assert the inverse (plain text, `name === rawName`).

### Gates

- `node --check game.js` ✅
- `node economy.test.mjs` ✅ (209 passed, 1 skipped, 0 failed)
- `node pacing.mjs` ✅ (all milestones within band, deterministic)

### Docs touched

- `CHANGELOG` entry for `0.10.21`; `VERSION` → 0.10.21 / build 212 (sits above #64's pending 0.10.20/211 and main's 0.10.19/210; if #64 merges first the sequence is clean)

### SAVE_VER

- Unchanged (8) — render-only change, no save shape change
