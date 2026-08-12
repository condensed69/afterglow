# Adversarial UX Fixes — Detailed Implementation Plan

**Source:** Adversarial UX test (Barbara persona) — 8 RED tickets + 2 YELLOW notes
**Strategy:** 6 focused PRs, each independently verifiable via CI gates
**Rule:** Every PR must pass all three gates before merge. Docs updated in same PR.

---

## PR 1: Hamburger Menu Crash + Settings Access
**Ticket:** #1 (☰ crashes to blank page), #8 (no manual save/export)
**Files:** `game.js` (render, boot), `index.html` (if needed), `style.css` (menu panel styles)

### Changes
- Fix ☰ click handler: toggle a settings overlay/panel instead of destroying/replacing app root
- Settings panel includes: Export Save, Import Save, Hard Reset, Look & Feel, Close
- Ensure settings panel doesn't unmount the sim; uses existing `renderSettings()` pattern
- Add "Auto-saved {time}" indicator in header (reads `localStorage` timestamp or game state)

### Gates
- `node --check game.js` — syntax
- `node economy.test.mjs` — save/load/export/import still work
- `node pacing.mjs` — no pacing impact (pure UI)

### Docs
- `CHANGELOG`: "Fix: hamburger menu (☰) no longer crashes the tab; Settings panel restored with Export/Import/Reset"
- `README.md`: Document Settings menu access (☰ or `S` key if bound)

---

## PR 2: First-Action Onboarding (Pulse + Sticky Banner)
**Ticket:** #2 (no direction on first load)
**Files:** `game.js` (render, renderVals, step, init)

### Changes
- Detect first-time state: `g.clicks === 0 && g.goals.length === 0 && !g.tutorialSeen`
- Pulse "WORK THE ROOM" button (CSS animation) until `g.clicks >= 5`
- Sticky banner at top of Systems column: "Goal 1 of 14: Work the room 5×" — dismisses on goal complete
- Set `g.tutorialSeen = true` on first click so returning players don't see it
- No new save fields — purely runtime UI state

### Gates
- `node --check game.js`
- `node economy.test.mjs` — save migration unaffected (no new fields)
- `node pacing.mjs` — bot completes "Work the room" goal in same timeband

### Docs
- `CHANGELOG`: "Onboarding: pulse + banner guide new players to first goal (Work the room 5×)"
- `DESIGN.md` §14.4: Note that interactive surface test covers the pulsing button handler

---

## PR 3: Stage "Hire Crew" Button — Tooltip + Affordance
**Ticket:** #3 (silent no-op when unaffordable)
**Files:** `game.js` (renderStage, hireCrew handler), `style.css` (tooltip styles if needed)

### Changes
- Button already has `disabled` attr when `g.cash < 280` — add `title="Need $280 cash to hire crew"` (native tooltip)
- Or: custom tooltip on hover/long-press showing "Need $280 cash" (mobile-friendly)
- Ensure button is *hidden* (not just disabled) until `g.crewCapacity > 0` (after first Dressing Room) — reduces noise
  - Actually: crew capacity starts at 2 (base), so button should be visible but disabled with tooltip
- Click handler on disabled button: show toast "Need $280 cash" (reuses existing toast system)

### Gates
- `node --check game.js`
- `node economy.test.mjs` — hire flow unchanged
- `node pacing.mjs` — no pacing impact

### Docs
- `CHANGELOG`: "UX: Stage 'Hire crew' button shows tooltip/toast when unaffordable instead of silent no-op"

---

## PR 4: Autosave Indicator + Save Timestamp Persistence
**Ticket:** #4 (no visible save feedback)
**Files:** `game.js` (save, render, init), `style.css` (indicator styles)

### Changes
- On every successful `save(auto)`: write `lastAutoSave: Date.now()` to save payload (new field, no SAVE_VER bump — additive)
- On load: read `lastAutoSave`, compute relative time ("Auto-saved 10s ago", "2m ago", "Just now")
- Render in header next to version badge: `💾 Auto-saved {relativeTime}`
- Update every render tick (throttled) so it stays current
- If save fails (quota, non-owner): show "Save failed" in red briefly

### Gates
- `node --check game.js`
- `node economy.test.mjs` — **critical**: verify save payload round-trips, `lastAutoSave` persists, no migration needed
- `node pacing.mjs` — no pacing impact

### Docs
- `CHANGELOG`: "UX: Persistent 'Auto-saved {time}' indicator in header; survives reload"
- `DESIGN.md`: Document `lastAutoSave` field in save schema

---

## PR 5: Inline Help Icons (?) for All Jargon Terms
**Ticket:** #5 (Clout, Legacy, Hype, Buzz, Reputation Loop, etc. undefined)
**Files:** `game.js` (renderLedger, renderResearch, renderPerks, renderUpgrades), `style.css` (help icon + tooltip)

### Changes
- Add reusable `helpIcon(term, definition)` helper → renders `ⓘ` with CSS tooltip on hover/focus
- Apply to every resource row in Ledger: Cash, Hype, Buzz, Patrons, Regulars, Clout, Legacy
- Apply to every Research item: Reputation Loop, Late Kitchen, Promoter Network, Payroll Software
- Apply to every Perk: House cut, Seed roster, Street team, Franchise playbook, Extra bouncer slot, Name recognition
- Apply to every Upgrade: LED Pole, Two-Drink Minimum, Coat Check, House Photographer, Bottle Service, Weekly Residency
- Definitions: 1-sentence, player-facing (e.g., "Clout: Research currency earned from Hype. Spend on permanent upgrades.")
- Mobile: tap to show, tap elsewhere to dismiss (CSS `:focus-visible` + `:hover`)

### Gates
- `node --check game.js`
- `node economy.test.mjs` — no save impact
- `node pacing.mjs` — no pacing impact

### Docs
- `CHANGELOG`: "UX: Inline help icons (ⓘ) on all resources, upgrades, research, perks — hover/tap for plain-English definitions"
- `DESIGN.md` §14: Add "Help tooltip" to interactive surfaces inventory

---

## PR 6: Owner's List Progress Label + False Achievement Fix
**Tickets:** #6 (0/14 unlabeled), #7 (Surprise Hit fires on tutorial)
**Files:** `game.js` (renderGoals, checkAchievements, GOALS), `style.css` (if needed)

### Changes
**6a: Progress label**
- Change "0 / 14" → "Goal 1 of 14" (or "1/14 goals complete")
- Show active goal title: "Goal 1 of 14: Work the room 5×"
- Completed goals: show "✓ Goal 1: Work the room" in muted text

**6b: False `special_1` achievement**
- Root cause: `g.specialsCount` incremented incorrectly during tutorial/first shift
- Audit `advanceShift()` and `checkAchievements()` — ensure `specialsCount` only increments on *actual* special shift (Bachelorette Rush, Midweek Surge, Slow Tuesday), not on normal shift rollover
- Add test in `economy.test.mjs`: fresh game → complete "Work the room" goal → `g.specialsCount === 0`

### Gates
- `node --check game.js`
- `node economy.test.mjs` — **critical**: new test for `specialsCount` not incrementing on tutorial; save migration unaffected
- `node pacing.mjs` — bot still hits milestones in band (no logic change to shift advancement)

### Docs
- `CHANGELOG`: "Fix: 'Surprise Hit' achievement no longer triggers on tutorial completion. Owner's List shows 'Goal X of 14' label."
- `DESIGN.md`: Document goal progress label format
- `ACHIEVEMENTS.md` (if exists) or `DESIGN.md`: Note `specialsCount` semantics

---

## PR 7 (Optional, YELLOW): Gate Tab Visibility Behind Unlocks
**YELLOW note:** CREW/UPGRADES/RESEARCH/PERKS tabs visible but 80% disabled at start
**Files:** `game.js` (renderTabs, tab visibility logic)

### Changes
- CLUB: always visible
- CREW: visible after `g.crew > 0` (first hire)
- UPGRADES: visible after `Object.values(g.b).some(n => n > 0)` (first building)
- RESEARCH: visible after `g.clout > 0` (first Clout earned)
- PERKS: visible after `g.prestiges > 0` (already gated)
- Smooth transition: tabs fade in, don't jump layout

### Gates
- `node --check game.js`
- `node economy.test.mjs` — tab visibility doesn't affect save
- `node pacing.mjs` — no pacing impact

### Docs
- `CHANGELOG`: "UX: Systems tabs (CREW, UPGRADES, RESEARCH) now unlock progressively with first building/crew/clout"

---

## Gate Checklist Per PR

| PR | `node --check game.js` | `node economy.test.mjs` | `node pacing.mjs` | Docs Updated |
|----|------------------------|-------------------------|-------------------|--------------|
| 1  | ✅ | ✅ (save/load/export) | ✅ | CHANGELOG, README |
| 2  | ✅ | ✅ (no new save fields) | ✅ | CHANGELOG, DESIGN.md |
| 3  | ✅ | ✅ | ✅ | CHANGELOG |
| 4  | ✅ | ✅ (**critical**: lastAutoSave round-trip) | ✅ | CHANGELOG, DESIGN.md |
| 5  | ✅ | ✅ | ✅ | CHANGELOG, DESIGN.md |
| 6  | ✅ | ✅ (**critical**: specialsCount test) | ✅ | CHANGELOG, DESIGN.md |
| 7  | ✅ | ✅ | ✅ | CHANGELOG |

---

## Versioning Strategy

- Current: `v0.10.8` build 199 (from live site)
- Each PR bumps build number: 200, 201, 202...
- Minor version bump to `0.11.0` after PR 6 (user-facing UX overhaul)
- `SAVE_VER` stays at 8 (no save shape changes — all additive runtime fields)
- `CHANGELOG` entries cumulative; final PR 6 entry summarizes the UX pass

---

## Branch/PR Workflow

Per AGENTS.md: **Parallel branches collide on VERSION/CHANGELOG.**
- Rebase onto latest `main` before each PR
- Renumber version/build to sit above landed commits
- Use `/opt/data/.git-helpers/new-pr.sh` for push + PR creation
- No `gh CLI` — script uses token URL + API

### Suggested Branch Names
```
ux/fix-hamburger-menu-crash
ux/onboarding-pulse-banner
ux/hire-crew-tooltip
ux/autosave-indicator
ux/inline-help-icons
ux/goals-label-fix-achievement
ux/progressive-tab-unlock (optional)
```

---

## Test Additions Required (in same commit as code)

**PR 4 (autosave indicator):**
- `economy.test.mjs`: Save → reload → verify `lastAutoSave` persists and renders

**PR 6 (false achievement):**
- `economy.test.mjs`: Fresh game → complete Work the room 5× → assert `g.specialsCount === 0`
- `economy.test.mjs`: Trigger actual special shift → assert `g.specialsCount === 1` → achievement unlocks

**PR 2 (onboarding):**
- `economy.test.mjs`: Fresh game → `g.tutorialSeen === true` after 5 clicks (no persistence needed)

---

## Risk Notes

- **PR 1 (menu crash):** Highest risk — touches boot/render cycle. Test manually in browser after gate pass.
- **PR 4 (lastAutoSave):** Additive save field; old saves lack it → render must handle `undefined` gracefully ("Auto-saved: never")
- **PR 6 (specialsCount):** Core shift logic — run `pacing.mjs` twice to confirm no band drift
- **All PRs:** Interactive surface test (DESIGN.md §14.4) auto-discovers new modals/buttons — will catch unbound handlers

---

## Definition of Done Per PR

1. All three gates pass (green checkmarks in CI)
2. Docs updated in same commit (CHANGELOG + relevant DESIGN.md/README.md)
3. Manual browser smoke: load → click ☰ → open Settings → Export → Import → verify state
4. PR opened via `new-pr.sh`, description includes gate results + docs touched
5. CI required status checks pass → merge → delete branch