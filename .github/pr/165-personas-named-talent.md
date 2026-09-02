### Summary of Changes

Implements **PR 6: "Club Personas & Named Talent Roster 2.0"** of Afterglow 2.0 based on the master roadmap in `AFTERGLOW_2.0_PLAN.md`.

#### Key Deliverables:
1. **Club Personas Catalog & Dynamic Multipliers (`catalogs.js`, `game.js`)**:
   - Added `PERSONAS` catalog:
     - *Techno Bunker* (`techno_bunker`, tags: `techno, cyber, underground`): $+30\%$ Hype Gain, $+5\%$ Cash Flow, $-15\%$ Bar Revenue, $+10\%$ Heat Generation.
     - *Velvet VIP Lounge* (`velvet_lounge`, tags: `vip, lounge, luxury`): $-20\%$ Hype Gain, $+25\%$ Cash Flow, $+20\%$ Bar Revenue, $-10\%$ Heat Generation.
     - *Cyber Speakeasy* (`cyber_speakeasy`, tags: `speakeasy, mixology, stealth`): $-5\%$ Hype Gain, $+15\%$ Cash Flow, $+50\%$ Bar Revenue, $-50\%$ Heat Generation.
   - Added `setPersona(personaId)` to `Game` with live event notifications.
2. **Named Talent Roster & Compounding Synergy Engine (`catalogs.js`, `game.js`)**:
   - Added `TALENT` catalog:
     - *Nova Cyan* (Stage Headliner, Rare, \$250, tags: `techno, cyber`): Trait "Overdrive Beat" (+20% Stage Hype).
     - *Roxie Spark* (Lead Mixologist, Rare, \$200, tags: `mixology, speakeasy`): Trait "Craft Infusion" (+30% Bar Revenue).
     - *Blade Thorne* (Head of Security, Uncommon, \$150, tags: `stealth, underground`): Trait "Discreet Perimeter" (-30% Heat Gain).
     - *Velvet Vixen* (VIP Host, Legendary, \$500, tags: `vip, luxury, lounge`): Trait "Whale Magnet" (+35% Cash Flow).
     - *DJ Klaus* (Resident DJ, Uncommon, \$180, tags: `techno, underground`): Trait "Bass Resonance" (+15% Hype, +10% Cash).
   - Compounding +50% synergy bonus (`synMult = 1.50`) applied to talent output when talent tags match the active club's persona.
   - Added `hireTalent()`, `assignTalent()`, and `unassignTalent()` with 2-slot active capacity limit per club.
3. **Save System & UI View Model Integration (`game.js`)**:
   - Bumped `SAVE_VER` from 13 to 14 with `MIGRATIONS[13]` (backfills `g.roster = []`, `c.persona = null`, `c.activeTalent = []`).
   - Bumped `VERSION` to `0.13.0` (build 270, channel `alpha`, codename `Personas & Talent`).
   - Updated `renderVals(g)`, `renderTemplate(v)`, and `updateDom(v)` to render interactive Persona and Talent Roster sections with synergy indicators and focus-preserving in-place updates.
4. **Test Suite Coverage (`economy.test.mjs`)**:
   - Unit tests for `SAVE_VER 13 -> 14` migration backfills.
   - Unit tests for Persona selection, multipliers, and reset.
   - Unit tests for Talent hiring, slot assignment, unassignment, and synergy bonuses.
   - Unit tests for template rendering of Persona buttons and Talent cards.

#### Verification Gates:
- `node --check game.js`: PASS
- `node --check catalogs.js`: PASS
- `node --check src/core/audio.js`: PASS
- `node --check src/ui/floorboard.js`: PASS
- `node --check src/core/reactive.js`: PASS
- `node economy.test.mjs`: 346 passed, 0 skipped, 0 failed
- `node pacing.mjs`: 100% PASS across all 5 benchmark scenarios (bit-identical).
