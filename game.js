'use strict';

// Converts a JS style object (camelCase keys, custom props like '--bpm' pass
// through unchanged) into an inline `style="..."` string.
function css(o) {
  if (!o) return '';
  return Object.entries(o)
    .filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => (k.startsWith('--') ? k : k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())) + ':' + v)
    .join(';');
}

// SAVE_VER 9 compat layer (SECOND_LOCATION.md §5): account fields (clout, crew,
// jobs, r, perks, legacy, ...) live on g; club fields (cash, hype, buzz, patrons,
// regulars, b, u, elapsed, night, shift*, _special*) live in g.clubs[active].
// This proxy forwards flat reads/writes to the ACTIVE club so legacy flat-g code
// and test assertions keep working. Transparent to serialization: ownKeys and
// getOwnPropertyDescriptor forward to the target, so JSON.stringify emits the
// real v9 shape.
function clubProxy(g) {
  const active = () => (g && g.clubs && Object.prototype.hasOwnProperty.call(g.clubs, g.activeClub)) ? g.activeClub : 'main';
  return new Proxy(g, {
    get(t, k) {
      if (k in t) return t[k];
      const c = g && g.clubs && g.clubs[active()];
      return c && k in c ? c[k] : undefined;
    },
    set(t, k, v) {
      if (k in t) { t[k] = v; return true; }
      const c = g && g.clubs && g.clubs[active()];
      if (c && k in c) { c[k] = v; return true; }
      t[k] = v;
      return true;
    }
  });
}

class Game {
  VERSION = { num: '0.11.12', build: 225, channel: 'alpha', date: '2026-08-16', codename: 'Neon Zero' };
  SAVE_VER = 11;
  KEY = 'afterglow.save';
  // Live ownership: sessionStorage holds this tab's unique token while it owns the save.
  // A plain boolean is copied when the browser duplicates a tab, so a duplicate would
  // claim and pause the original. Token is unique per page context (this.tabToken).
  OWNER_KEY = 'afterglow.tabOwner';
  // Set on pagehide only when this tab still owns — survives F5, not present when a live
  // tab is duplicated (pagehide did not run). Consumed once on the next init as wasOwner.
  RELOAD_KEY = 'afterglow.tabOwnerReload';
  // Cross-tab lease in localStorage: { token, at }. Owner refreshes while live.
  // Age-only claim (offline >15s) requires no live foreign lease — disk age alone is not
  // proof the owner is gone (background-throttled tabs may lag autosave).
  LEASE_KEY = 'afterglow.tabOwnerLease';
  // Claimant writes this before an age-only claim so a live owner can refresh its lease
  // via the storage event (handshake). Shape: { token, at }.
  PROBE_KEY = 'afterglow.tabOwnerProbe';
  // Foreign lease younger than this = live peer. Must exceed CLAIM_OFFLINE_SEC (15s) so a
  // throttled owner that still ticks can hold past disk lag; under 60s matches common
  // background timer floors.
  LEASE_TTL_MS = 45000;
  // Min wall time between lease writes from the live timer (saves/mark still write immediately).
  LEASE_REFRESH_MS = 2000;
  // After writing PROBE_KEY, wait this long before age-claim so a live owner can refresh
  // LEASE_KEY via the storage event. Immediate lease re-read races the async owner path.
  PROBE_WAIT_MS = 250;

  // Dev-only tunables the Claude-artifact prop editor used to expose
  // (showDebug / simSpeed / startingCash). Fixed to their defaults now that
  // this runs as a plain page instead of inside that editor.
  props = { showDebug: false, simSpeed: 1, startingCash: 20 };

  // Max seconds of simulated time per catch-up slice (live tick and offline).
  // Re-reading rates() each slice keeps a resumed window from freezing rates
  // across a whole shift. Offline additionally chunks to this many wall-clock
  // seconds per step so long-away windows don't drift from real elapsed time.
  SIM = 0.1;
  OFFLINE_STEP = 1.0;

  // Session-only: tracks strike onset so the unpaid-crew log fires once per strike.
  _onStrike = false;

  // Save-format steps: MIGRATIONS[v] upgrades g from saveVer v → v+1 (PLAN §2.2).
  // On load, apply the chain saveVer → … → SAVE_VER; wipe only when a step is missing.
  MIGRATIONS = {
    // v8 → v9: move club-level run fields into g.clubs.main (SECOND_LOCATION.md §4).
    8(g) {
      if (!g || typeof g !== 'object') return g;
      // sanitizeG (also run inside MIGRATIONS[3] for very old saves) may have
      // already built the clubs map from top-level fields — never clobber it.
      if (g.clubs && typeof g.clubs === 'object' && g.clubs.main) {
        g.activeClub = (typeof g.activeClub === 'string' && Object.prototype.hasOwnProperty.call(g.clubs, g.activeClub)) ? g.activeClub : 'main';
        return g;
      }
      const clubFields = ['cash', 'hype', 'buzz', 'patrons', 'regulars', 'b', 'u',
        'elapsed', 'night', 'shiftIdx', 'shiftT', '_specialShift', '_whaleCooldown'];
      const main = {};
      for (const k of clubFields) {
        main[k] = g[k];
        delete g[k];
      }
      g.clubs = { main };
      g.activeClub = 'main';
      return g;
    },
    // v3 → v4: jobs/crew assignment honesty (was an informal init() fixup).
    3(g) {
      this.sanitizeG(g);
    },
    // v4 → v5: Owner's List fields; backfill completed goals without paying rewards.
    // Credit every satisfied check (no sequential break) so mid-game saves don't get
    // live reward cascades for already-earned state. Holes are fine — activeGoal
    // still returns the first missing id for live play.
    // v4 → v5: goal backfill. sanitizeG (inside [3]) has already moved club
    // fields into clubs.main, so read them through this.club(g) and check goals
    // against the merged view, exactly like live play.
    4(g) {
      g.goals = [];
      g.clicks = 0;
      g.rounds = 0;
      const c = this.club(g);
      const b = c.b || {};
      // v4 never tracked clicks; clubs past the opener clearly finished the click tutorial.
      if (g.crew > 0 || c.patrons > 0 || c.regulars > 0 ||
          Object.values(b).some(n => n > 0)) {
        g.clicks = 5;
      }
      const view = { ...g, ...c, b: c.b, u: c.u };
      for (const goal of this.GOALS) {
        if (goal.check(view)) g.goals.push(goal.id);
      }
    },
    // v5 → v6: prestige meta fields.
    5(g) {
      if (typeof g.legacy !== 'number' || !Number.isFinite(g.legacy)) g.legacy = 0;
      if (typeof g.legacyTotal !== 'number' || !Number.isFinite(g.legacyTotal)) g.legacyTotal = 0;
      // perks must be a plain object map. Arrays pass typeof === 'object' but
      // JSON.stringify omits string-keyed properties on arrays, so ranks would
      // vanish after reload while Legacy spend already stuck — reject/replace.
      if (!g.perks || typeof g.perks !== 'object' || Array.isArray(g.perks)) g.perks = {};
      if (typeof g.prestiges !== 'number' || !Number.isFinite(g.prestiges)) g.prestiges = 0;
      for (const def of this.PRESTIGE_PERKS) {
        let r = g.perks[def.id];
        if (typeof r !== 'number' || r < 0) r = 0;
        g.perks[def.id] = Math.min(def.max, Math.floor(r));
      }
    },
    // v6 → v7: achievements field; backfill already-earned unlocks.
    6(g) {
      if (!Array.isArray(g.achievements)) g.achievements = [];
      this.checkAchievements(g);
    },
    // v7 → v8: managers map (PLAN.md §4.1) — default all to false.
    7(g) {
      if (!g.managers || typeof g.managers !== 'object' || Array.isArray(g.managers)) g.managers = {};
      for (const def of this.MANAGERS) {
        if (typeof g.managers[def.id] !== 'boolean') g.managers[def.id] = false;
      }
    },
    // v9 → v10: Renown + Brand fields (REPLAY_ROADMAP.md §8.5) — the second
    // prestige layer. No-clobber: values that are already finite numbers (or a
    // plain brand object) pass through untouched; only missing/malformed
    // values default. sanitizeG runs after the chain for the same shape.
    9(g) {
      if (typeof g.renown !== 'number' || !Number.isFinite(g.renown)) g.renown = 0;
      if (typeof g.renownTotal !== 'number' || !Number.isFinite(g.renownTotal)) g.renownTotal = 0;
      if (!g.brand || typeof g.brand !== 'object' || Array.isArray(g.brand)) g.brand = {};
    },
    // v10 → v11: Brand Endorsement level (next-roadmap PR 1) — the repeatable
    // Renown sink. No-clobber: a finite number passes through untouched; only
    // a missing/malformed value defaults to 0. sanitizeG/completeImportedG
    // run the same shape after the chain (floor + clamp ≥ 0).
    10(g) {
      if (typeof g.brandLevel !== 'number' || !Number.isFinite(g.brandLevel) || g.brandLevel < 0) g.brandLevel = 0;
      g.brandLevel = Math.floor(g.brandLevel);
    }
  };

  CHANGELOG = [
    { v: '0.11.12', date: '2026-08-16', codename: 'Neon Zero', notes: [
      'BRAND ENDORSEMENTS (next-roadmap PR 1): the Renown sink becomes repeatable. The Perks panel gains a Brand Endorsement card under the Brand perks — +2% all cash per level, forever, at an escalating cost (15 × 1.35^level Renown). The five Brand perks max out after ~5 sales, but the endorsement never does: every franchise sale has a permanent spend target, so the sell loop keeps its reason to reset. Folds into the single totalCashMult composition point (passive AND clicks/whale/golden). Additive g.brandLevel (fail-closed integer ≥ 0) preserved by every reset exactly like brand ranks — ordinary prestige, challenge starts, and the franchise sale all snapshot/restore it. SAVE_VER bumped to 11 with a no-clobber MIGRATIONS[10] (v10 saves default brandLevel to 0). The pacing bot never buys it (buyAllMeta untouched), so every main-run band is bit-identical.'
    ] },
    { v: '0.11.11', date: '2026-08-16', codename: 'Neon Zero', notes: [
      'ENDGAME HORIZON (REPLAY_ROADMAP.md §10): the Owner\'s List gains a "Vision — the long game" readout — a visible goal line of 3 clubs and $1e12 franchise net worth, with a blended progress bar (clubs leg + net-worth leg) and a ★ reached state. Purely a target + progress readout computed from existing state (clubs map + per-club cash): no new mechanic, no save-shape change (SAVE_VER stays 10), no economy coupling, zero pacing impact (render-time only).'
    ] },
    { v: '0.11.10', date: '2026-08-15', codename: 'Neon Zero', notes: [
      'RENOWN UNLOCKS (REPLAY_ROADMAP.md §9): Renown is now a spendable sink — the reason to sell the franchise again. The Perks panel gains 5 Brand perks bought with Renown: Nationwide Reach (+10% all cash per rank, through the single totalCashMult composition point), Loyalty Program (start each run with +1 Regular per rank, restored before start perks on prestige), R&D Lab (−10% research cost per rank via researchCost), Night Owl Network (+10% offline rate per rank), and Rooftop Lease (unlocks the Rooftop, a third location). Brand ranks persist through the franchise sale, ordinary prestige, and challenge starts (startChallenge snapshots the brand map like the managers — a challenge run must not wipe Renown-purchased perks). The third club reuses the g.clubs map and freshClubState(); each location now has its own additive buildings/upgrades (LOCATION_EXTRAS: Neon Pool in the Main Room; Rooftop Bar + Skyline View in the Annex; Helipad Lounge + Panorama Deck on the Rooftop) appended to the shared catalog — superseding SECOND_LOCATION.md §11\'s "no location-specific buildings" non-goal. Existing saves backfill the new ids on load, and a club missing an extra id prices it as 0 owned instead of NaN — fixing a real infinite loop in buy-max. Additive fields only, SAVE_VER stays 10. The pacing bot never buys brand perks or location extras, so every main-run band is bit-identical; renownRun() gains a rooftop scenario (lease → open → extras verified live via rates() toggles → third club plays to its first LED).'
    ] },
    { v: '0.11.9', date: '2026-08-15', codename: 'Neon Zero', notes: [
      'SECOND PRESTIGE LAYER (REPLAY_ROADMAP.md §8): when every prestige perk is maxed, every manager is hired, and both clubs are unlocked, the Perks panel gains a distinct "Sell the franchise" control — a national conglomerate buys your whole operation. Selling resets EVERYTHING (both clubs, Legacy, perks, research, Clout, managers, crew, challenges, run counters) in exchange for Renown, a new permanent meta-currency (floor(√lifetime Legacy + prestiges/3)). Renown and lifetime Renown never wipe; achievements and Brand ranks (g.brand, spent in a later PR) persist — the reason to build and sell again. Two-click armed confirm with a reset-scope preview, persist-before-replace like prestige, and a Renown readout after the first sale. SAVE_VER bumped to 10; v9 saves migrate with the new fields defaulted.'
    ] },
    { v: '0.11.8', date: '2026-08-15', codename: 'Neon Zero', notes: [
      'UPGRADEABLE MANAGERS: automation is now a progression, not a binary hire (REPLAY_ROADMAP.md §7). Each hired manager can be leveled up with Legacy from the Perks panel (10 / 20 / 30 Legacy for levels 1→2→3) — the level scales how many buildings the manager buys per tick: level 1 buys 1, level 2 buys 5, level 3 buys max affordable. Leveling requires the manager to be hired; managerPaused still applies at every level, and challenge-locked buildings stay skipped at any level. Manager levels survive ordinary prestige (only the future franchise sale wipes them). Additive g.managerLevels map — no save-shape change (SAVE_VER stays 9); the pacing bot hires a level-0 manager, so all bands are bit-identical.'
    ] },
    { v: '0.11.7', date: '2026-08-15', codename: 'Neon Zero', notes: [
      'CHALLENGE RUNS: the Perks panel gains 4 opt-in replay challenges with permanent rewards (REPLAY_ROADMAP.md §6). Starting a challenge resets every club to a fresh run under a modifier — Tight Till ($0 till), Slim Margins (all income ×0.5), No Street Team (Flyer Crew locked), Lean Night (Back Bar locked) — and re-locks the annex. Completing one records it in challengesDone and permanently grants a derived bonus: +5% all cash (Tight Till, Lean Night), +1 Door Staff cap (Slim Margins), +5% crew output (No Street Team). Modifiers are action invariants: income cuts flow through totalCashMult (passive AND active clicks), locked buildings are rejected in buyBuilding, skipped by autoBuyManagers, and greyed in the card. Two-click armed start; an active challenge can be ended without reward. Rewards never grant Clout (Legacy-not-Clout rule). Additive g.challenge/g.challengesDone — no save-shape change (SAVE_VER stays 9). Challenges are opt-in, so the pacing bands are untouched.'
    ] },
    { v: '0.11.6', date: '2026-08-15', codename: 'Neon Zero', notes: [
      'DEEP RESEARCH TREE: research expands from 4 flat one-time buys to a 12-node tree across 3 tiers with prerequisites. Tier 1 is cheap multipliers (the existing Reputation Loop / Late Kitchen / Promoter Network / Payroll Software plus Cover Charge); Tier 2 is mechanic unlocks + stacking multipliers (Floor Host — a new research-gated job that adds patron pull — plus Staff Scheduling, VIP Concierge, Franchise Playbook); Tier 3 is expensive account-wide bonuses (Brand Licensing +10% cash, Night School +15% crew output, National Network +25% Clout). Prerequisites are an action invariant: buyResearch rejects a node whose req is not owned, and the card shows "requires X" until it is.',
      'The job catalog is now the single source of truth for the shared roster: fresh(), sanitizeG(), save validation, moveJob(), and club-switch eviction all iterate JOBS instead of a hardcoded four-id list. A research-locked job (Floor Host) holds zero crew until its research is owned, is evicted to Off Shift if a load/reset drops the unlock, and cannot be assigned via moveJob while locked. No save-shape change (SAVE_VER stays 9).',
      'Pacing: a new "all research owned" milestone (~105 min) joins the reference bot, and tryBuyCheapestResearch now filters unmet prerequisites so the bot advances the tree deterministically. The cheapest item (Reputation Loop, 12 Clout) is unchanged, so "first research" and every earlier band stay bit-identical.'
    ] },
    { v: '0.11.5', date: '2026-08-15', codename: 'Neon Zero', notes: [
      'Flavor layer: a slim "TODAY" ticker under the header rotates through ambient scene lines keyed on your club\'s state (regulars, hype, the crowd, your build), and Regulars gain names — one new name every 5, surfaced in the Ledger ("Margo is a regular"). Purely cosmetic: nothing feeds the economy, pacing bands are untouched, and there is no save-shape change.'
    ] },
    { v: '0.11.4', date: '2026-08-15', codename: 'Neon Zero', notes: [
      'Achievements now pay out a milk multiplier: every achievement adds +1% to all cash income (passive + active clicks) via achievementMult(g), folded into the House cut multiplier. It counts unique, non-burst achievements (the 4 live-only burst achievements — whale_1, whale_10, special_1, special_5 — are excluded and duplicate ids are deduped), so the ceiling is +34% at all 34 deterministic achievements — the collection is a real progression path, not a checklist. The multiplier applies to ALL cash income (passive rates, active clicks, whale bonus, golden-ticket tip) through a single totalCashMult(g) composition point. No save-shape change. The pacing bot earns achievements deterministically, so the "all upgrades owned" milestone re-centers from ~45m to ~32m (pacing.mjs band updated).'
    ] },
    { v: '0.11.3', date: '2026-08-14', codename: 'Neon Zero', notes: [
      'Fix: the Hire Crew card and Ledger Crew stat reported the TOTAL shared crew against the active room\'s Dressing Room cap, so switching to the annex showed the first club\'s dancer count carried over (e.g. "Hire Crew 43 / 18") instead of the crew actually working there. They now report WORKING crew (crew − Off Shift), and hireCrew caps working crew rather than the shared total, so dancers parked Off Shift no longer block a hire.'
    ] },
    { v: '0.11.2', date: '2026-08-14', codename: 'Neon Zero', notes: [
      'Second-room pacing scenario added to the reference bot (pacing.mjs): the bot prestiges twice (cash10 ×2 + one manager), unlocks the annex, and proves account progress carries into the fresh room — annex first LED is faster than a no-perk fresh run. No gameplay change.'
    ] },
    { v: '0.11.1', date: '2026-08-14', codename: 'Neon Zero', notes: [
      'SECOND ROOM (Slice B): after your first franchise deal and at least one manager, the header gains "Open second room" — a confirmation modal previews the unlock (fresh till/crowd/build; Clout/Legacy/research/crew/managers stay shared; the first club is untouched). Confirm opens the annex: a second club with its own cash, crowd, buildings, and shift clock. A compact [ Main ] [ Annex ] switcher appears in the header; switching is instant and the inactive club pauses. Crew is shared — switching to a room whose Dressing Room cap is smaller evicts excess working crew to off (floor → stage → VIP), and crew assignment enforces the same cap, so evicted crew can\'t be reassigned straight back. A pending golden-ticket offer stays bound to the room it spawned in, even if you switch before it expires. The Ledger labels the active room (Main Room / Annex). Imported save club IDs are validated to a safe identifier shape.',
      'Mobile: the header wraps to multiple rows on narrow screens (v0.11.1) so the new switcher never pushes the shift block or settings offscreen.'
    ] },
    { v: '0.11.0', date: '2026-08-13', codename: 'Neon Zero', notes: [
      'SAVE FORMAT v9 (second-location groundwork): run state (cash, hype, buzz, patrons, regulars, buildings, upgrades, elapsed, night, shift, special shift, whale cooldown) now lives in g.clubs.main instead of on g directly, with g.activeClub pointing at the club being played. Saves from v8 migrate automatically on load — nothing is lost, and gameplay is unchanged. A compatibility layer keeps every read working through the new shape. This is the foundation for a second room/club; nothing player-visible changed yet.'
    ] },
    { v: '0.10.21', date: '2026-08-13', codename: 'Neon Zero', notes: [
      'UX: removed the duplicate help icons (?) from building, upgrade, research, perk, manager, and job cards — each card already displays its description text under the name, so the icon repeated it verbatim. The icons stay on the Ledger resources and stats, where the tooltip adds a plain-English definition the label does not show. (Also fixed the building-card owned marker, which was double-escaped and rendered as a literal "\\u00d7" instead of ×.)'
    ] },
    { v: '0.10.20', date: '2026-08-13', codename: 'Neon Zero', notes: [
      'Golden-ticket VIP cadence: GOLDEN_CHANCE 0.005 → 0.001 per live tick. The 0.10.2 changelog called it "rare" but 0.5% per tick at the 10Hz sim is ~3 offers a minute — the VIP badge and "VIP booked the booth" log line were on screen roughly 60% of a session (one spawn attempt every ~20s against a 30s TTL). Now ~one offer per ~2 min: still a regular treat, no longer wallpaper. Live-only event, so pacing bands are untouched.'
    ] },
    { v: '0.10.19', date: '2026-08-13', codename: 'Neon Zero', notes: [
      'Patrons now pay the door: the flat $0.08 door trickle is replaced by a per-head cover ($0.02/patron/s), so a packed floor earns more at any size and income no longer flatlines past the rail-tip cap (before, cash was identical from 12 to 72 patrons — the crowd was decorative). An empty room earns ~nothing, so there is no free money, and the patron cap bounds the early game. Supersedes the PLAN §1.6 "no uncapped patrons×0.012" decision, which rejected a flat rate stacked ON TOP of the door; the cover replaces the door instead. Pacing improved: first research ~20m and all upgrades ~39m (both closer to their ~25m/~45m intents), all bands still pass.',
      'Determinism fix: whale and special-shift rolls are now gated behind the _live flag like the critic/golden events. Both were documented as "live only" but the guard was missing: the pacing bot rolled whales AND special shifts, and the offline catchUp loop rolled special shifts (it calls advanceShift but never the whale block) — so pacing.mjs was seed-dependent (milestones varied run to run). Now the bot/offline path draws zero randoms and pacing.mjs is bit-identical across runs. Offline away-time stays on the base 4-shift rotation; whales and specials are live-session texture only.'
    ] },
    { v: '0.10.18', date: '2026-08-13', codename: 'Neon Zero', notes: [
      'Balance pass: first research now lands ~22m (was ~18m, design intent ~25m) and all upgrades ~46m (was ~34m, intent ~45m). Reputation Loop cost 8→12 Clout — the front-loaded achievement Clout made the old 8 reachable in 18m, undercutting the ~25m gate the regulars/clout rates were paced for. Weekly Residency cost 5800→8000 — the last upgrade the pacing bot buys, it now anchors the top of the chain at ~12× a Dressing Room, inside the 10–100× tier-upgrade range, and lands the all-upgrades beat on its ~45m intent. Prestige acceleration unchanged (run2 first LED still ~13m vs ~15m).'
    ] },
    { v: '0.10.17', date: '2026-08-13', codename: 'Neon Zero', notes: [
      'Mobile: every button gets a 44px minimum tap target below 900px — the multi-buy ×1/×5/×10/×Max row was 40×30px (Barbara\'s thumb covered two at once), the tab bar 38px tall, the ☰ menu 34×34, the job steppers 26×26. The shell, header, modals, and Look panel all covered by one rule (min-height/min-width beat the inline sizes). Desktop is untouched.'
    ] },
    { v: '0.10.16', date: '2026-08-13', codename: 'Neon Zero', notes: [
      'Mobile: the Ledger now collapses to the CASH row by default on narrow screens (tap ▸ to expand). The full Ledger — six resource rows plus the Floor block — measured 776px on a 390px phone, taller than the whole viewport, and sat first in the stacked column: Work the room and the Systems tabs were both below the fold. Collapsed it is ~70px, so the primary action and navigation are reachable without a long scroll. Desktop keeps the always-expanded Ledger and never sees the toggle.'
    ] },
    { v: '0.10.15', date: '2026-08-13', codename: 'Neon Zero', notes: [
      'Fix: on phones the app root used height:100vh — the URL-bar-collapsed height — so with the browser chrome visible the footer and the last strip of content sat below the viewport and could not be scrolled into view (the root clips at 100vh with overflow:hidden and the document has nothing left to scroll). Now height:100dvh with a 100vh fallback, so the app tracks the dynamic viewport and the bottom of the page is always reachable.'
    ] },
    { v: '0.10.14', date: '2026-08-12', codename: 'Neon Zero', notes: [
      'Owner\'s List banner now reads "X of Y goals complete" for clarity (was "X / Y complete").',
      'Test: economy.test.mjs adds regression coverage — special_1 (Surprise Hit) only unlocks from real special shifts, never from goal completion.'
    ] },
    { v: '0.10.13', date: '2026-08-12', codename: 'Neon Zero', notes: [
      'UX: Systems tabs (UPGRADES, RESEARCH) now unlock progressively — Upgrades appears after first building, Research after first Clout earned. Club and Crew stay always visible: the Hire Crew card is actionable from the first second and the stage\'s "hire crew to open the stage" CTA routes to it. Addresses Barbara\'s YELLOW note: "Four tabs and I can\'t do anything in any of them."'
    ] },
    { v: '0.10.12', date: '2026-08-12', codename: 'Neon Zero', notes: [
      'UX: Inline help icons (ⓘ) on all resources, stats, buildings, upgrades, research, perks, managers, and job assignments — hover/tap for plain-English definitions. Addresses Barbara\'s jargon complaint from adversarial UX test.'
    ] },
    { v: '0.10.11', date: '2026-08-12', codename: 'Neon Zero', notes: [
      'UX: Stage "hire crew" caption and Crew tab Hire button show tooltip with needed cash when unaffordable, instead of silent no-op.'
    ] },
    { v: '0.10.10', date: '2026-08-12', codename: 'Neon Zero', notes: [
      'Onboarding: sticky "Goal X of 14" banner with progress counter at top of Owner\'s List panel; pulse animation on first 3 goals.'
    ] },
    { v: '0.10.9', date: '2026-08-12', codename: 'Neon Zero', notes: [
      'Fix: hardReset() now clears lastAutoSave so a wiped club does not show the prior club\'s autosave timestamp.',
      'Fix: importSaveFromText() includes lastAutoSave in the written payload so an imported save does not retain the previous session\'s autosave value.',
      'Fix: render() hoists Date.now() to a single const in the header autosave display to avoid multiple calls per frame.',
      'Test: economy.test.mjs adds save/import round-trip coverage for lastAutoSave — auto-save sets it, manual-save preserves it, init() rehydrates it.'
    ] },
    { v: '0.10.8', date: '2026-08-09', codename: 'Neon Zero', notes: [
      'Change: the stage art is hidden on phones and other screens under 900px wide. It is scenery only — lights, haze, crowd — with nothing to press and nothing to read, so on a narrow screen it was a screenful of scrolling to get past before reaching the buttons. Work the room and Buy a round are now the first things under the Ledger. Nothing is hidden on desktop.'
    ] },
    { v: '0.10.7', date: '2026-08-09', codename: 'Neon Zero', notes: [
      'Fix: on phones the page had two scrollbars stacked inside each other and was awkward to play. Ledger, Log and the Systems tab body each carried their own scroll box, which is correct as three side-by-side desktop columns but not when they stack into one column inside a fixed-height screen — every panel became a ~100px window you read a few rows at a time. Below 900px wide the panels now size to their content and the page scrolls once.',
      'Fix: the stage no longer squashes to its minimum height on narrow screens, and the Systems card list no longer collapses to nothing, now that the stacked column sizes to content instead of splitting a screen height it no longer has.'
    ] },
    { v: '0.10.6', date: '2026-08-08', codename: 'Neon Zero', notes: [
      'Fix: the golden-ticket claim buttons threw ReferenceError on click and never granted the reward. The 0.10.5 badge built its claim closures inside render(), which has only the view model in scope — the raw g is not defined there. Closures now live in renderVals() and are consumed as v.takeGoldenCash / v.takeGoldenCrowd, matching every other bound action. Same bug class as the 0.8.0 prestige modal.',
      'Fix: the crowd preview on the badge showed a raw float (e.g. +7.339999999999998 crowd) because g.patrons is fractional in the sim. Now rounded, matching the claim log line.',
      'Tidy: dropped the duplicated Shift-click tooltip from the x5/x10/xMax buy buttons; it stays on x1 now that a dedicated xMax button exists.'
    ] },
    { v: '0.10.5', date: '2026-08-08', codename: 'Neon Zero', notes: [
      'Mobile buy-multiple: building cards now show ×1 / ×5 / ×10 / ×Max buttons so touch players can bulk-buy structures without a Shift key. Desktop Shift-click max still works.',
      'Golden ticket is now a compact, collapsible VIP badge in the top-right of the stage instead of a large centered overlay. The idle sim keeps ticking underneath; tap the badge to open the choice and claim it when you want.'
    ] },
    { v: '0.10.4', date: '2026-08-08', codename: 'Neon Zero', notes: [
      'Render throttle: DOM re-render capped at ~4 fps (250ms) while sim still steps every 100ms. Live tick increments state.tick each frame but only calls forceUpdate() when the throttle window has elapsed. User actions (clicks, purchases, golden ticket) and the catchUp path always render immediately. In a busy state (100 patrons, all buildings), per-call render() cost is ~20ms; at 10 fps that is 200ms/s of CPU, down to ~80ms/s with throttle — a ~60% reduction. No SAVE_VER bump.'
    ] },
    { v: '0.10.3', date: '2026-08-08', codename: 'Neon Zero', notes: [
      'Prestige "House cut" cash perk increased from +10% to +15% per rank. Formula 1 + 0.15 × cash10 rank. Prestige acceleration (run2 ÷ run1 first-LED) moves from ~0.95 to ~0.83, within the 0.7–0.9× target. All pacing milestones in band; prestige delta −2.50m (was −0.70m).',
    ] },
    { v: '0.10.2', date: '2026-08-08', codename: 'Neon Zero', notes: [
      'Burst-event variety: a Critic now reviews each new night when Hype is high (2%/night). Strong room (20+ patrons) → rave: +Hype and +2 Clout. Weak room → pan: −Hype (floor 0). Adds live risk/reward texture around the deterministic building/research curve.',
      'Golden ticket: rare (0.5% per live tick, roll scaled to sim slice) floating offer while Hype is positive — a VIP booked the booth. Take the tip (cash scaled by income) or grow the crowd (+10 patrons, capped). One offer at a time; expires after 30s (live tick or offline catch-up).',
      'Both events are live-only: the pacing bot and offline catchUp drive step() with _live = false, so their random rolls can never shift the deterministic pacing bands. g.golden is additive UI state (null when absent) — no SAVE_VER bump.'
    ] },
    { v: '0.10.1', date: '2026-08-08', codename: 'Neon Zero', notes: [
      'Achievement density pass: 23 → 38. New tiers for buildings (10 Back Bars, 5 DJ Booths, 3 Marquee Signs, 5 Flyer Crews, max Door Staff, 3 Dressing Rooms), stats (200 Hype, 100 patrons, 50 Regulars, 25 nights), 10 rounds, plus burst-event tracking: whales (1 / 10) and special shifts (1 / 5).',
      'Whale and special-shift achievements are driven by two new additive counters (g.whalesCount, g.specialsCount) that default to 0 when absent — no SAVE_VER bump, old saves just earn them from now on. The special-shift counter increments when a special actually triggers (advanceShift), the whale counter on spawnWhale.',
      'New Legacy rewards (Whale Watcher +3, Event Planner +2) credit both spendable Legacy and legacyTotal, matching the 0.9.5 accounting rule for achievement Legacy.'
    ] },
    { v: '0.10.0', date: '2026-08-08', codename: 'Neon Zero', notes: [
      'Small screens: the three-column shell now stacks Ledger / Stage / Systems vertically below 900px instead of forcing horizontal scrolling (the fixed column minimums summed to 872px).',
      'The shell grid moved from an inline style on <main> to a .shell-grid class in style.css with a @media (max-width: 900px) single-column fallback. Interior grid rows and the stage container queries are untouched, and ≥901px layouts are pixel-identical to before.'
    ] },
    { v: '0.9.5', date: '2026-08-08', codename: 'Neon Zero', notes: [
      'Fix: Achievement Legacy rewards (prestige_1, prestige_5, legacy_50) only credited spendable Legacy — lifetime Legacy (legacyTotal) ignored them, so the Legacy Builder achievement and the Perks tab "Total Legacy earned" undercounted real income.',
      'Achievement Legacy now also credits legacyTotal, matching how prestige gains are tracked. No SAVE_VER bump — this only changes a runtime accounting path.'
    ] },
    { v: '0.9.4', date: '2026-08-08', codename: 'Neon Zero', notes: [
      'Fix: Buzz→Patrons conversion was permanently capped at 0.065 — a hard floor meant to protect the early game but never lifted. At high Buzz/Hype the decay term (g.patrons × 0.008) outran capped growth, so Patrons stagnated or went negative no matter how much Buzz climbed.',
      'The cap now scales with cap.buzz (0.0013 × cap.buzz), which grows with Marquee Sign upgrades — at marquee=0 it still equals the original 0.065, preserving early-game pacing, then rises naturally with progression.'
    ] },
    { v: '0.9.3', date: '2026-08-07', codename: 'Neon Zero', notes: [
      'Fix: shift-click-to-buy-max on building cards never actually worked in any browser — the click handler checks el.dataset.buildingId, but the card template never set a data-building-id attribute (only a hover tooltip was added in 0.9.2). Shift-click silently fell back to a normal single buy.',
      'Managers can now be paused/resumed from the Perks tab without firing them — previously a hired manager auto-bought forever with no way to redirect cash toward a different goal once every manager was hired. Click a hired manager\'s card to toggle Pause/Resume; Legacy already spent is not refunded.'
    ] },
    { v: '0.9.2', date: '2026-08-07', codename: 'Neon Zero', notes: [
      'Fix: Franchise offer button threw "g is not defined" on click and crashed every subsequent render — the prestige modal template referenced the game-state variable g directly instead of the view-model v, but render() only has v in scope. Bug predates the perk tree work (introduced with the prestige system, 0.6.0).',
      'Prestige (and therefore the Perks tab, gated on prestiges > 0) was completely unreachable until this fix — anyone who never prestiged has been unable to see Managers, Special Shifts, or the Perk Tree despite all three having shipped.'
    ] },
    { v: '0.9.1', date: '2026-08-07', codename: 'Neon Zero', notes: [
      'Perk Tree: PRESTIGE_PERKS now enforce prerequisites via an optional req field (a bare perkId, unlike UPGRADES\' {buildingId: count}).',
      'Tier 1 (no req): House cut, Seed roster, Street team. Franchise playbook requires House cut rank 1+; Extra bouncer slot requires Seed roster; Name recognition requires Franchise playbook.',
      'buyPerk blocks purchase until the prerequisite rank is met, same enforcement pattern as buyUpgrade (1.8).',
      'Perks panel shows "requires X" in place of the buy button for locked perks.',
      'No SAVE_VER bump: g.perks rank map already encodes unlock state; reqs gate future purchases only, so saves with a later perk already ranked stay valid.'
    ] },
    { v: '0.9.0', date: '2026-08-07', codename: 'Neon Zero', notes: [
      'Managers (auto-buyers): one per building type (rail, bar, dj, marquee, flyers, vip, door, dress), purchasable with Legacy from the Perks tab, max 1 each.',
      'Hired managers auto-buy their building the instant cash >= cost, routed through buyBuilding — respects the strike rule (no auto-buy at cash=0 or on strike).',
      'Away-report gains a line when managers bought buildings during a gap: "Managers bought N buildings while you were away."',
      'Special shifts: low-frequency event shifts (Bachelorette Rush, Midweek Surge, Slow Tuesday) occasionally substitute one shift instance — a pure modifier over the 4-shift rotation, same {name,mult,len,tint} render shape, never two in a row.',
      'Research tune: Reputation Loop cost 6 → 8 Clout to bring "First research" into its ~25 min pacing band (was running ~16.5 m, below the band floor).',
      'SAVE_VER bumped to 8; v7 saves migrate and default g.managers to all false.'
    ] },
    { v: '0.8.1', date: '2026-08-06', codename: 'Neon Zero', notes: [
      'Achievements: 23 permanent unlocks with Clout/Legacy rewards and a modal in Settings.',
      'Number formatting extended to Decillion (Dc, 1e33).',
      'Whale patron burst event: random high-roller spawns when hype is positive.',
      'Shift-click any building card to buy the maximum affordable count.',
      'SAVE_VER bumped to 7; v6 saves migrate and backfill already-earned achievements.'
    ] },
    { v: '0.8.0', date: '2026-08-05', codename: 'Neon Zero', notes: [
      'Prestige system: sell the club at 25+ Regulars to earn Legacy and reopen with permanent perks.',
      'Six starting perks: House cut, Seed roster, Street team, Franchise playbook, Extra bouncer slot, Name recognition.',
      'SAVE_VER bumped to 6; legacy/legacyTotal/perks/prestiges fields migrate in from older saves.',
      'New Perks tab, Legacy ledger row, and Franchise offer header control once the gate is met.'
    ] },
    { v: '0.7.5', date: '2026-08-05', codename: 'Neon Zero', notes: [
      'Added disabled visual states (dimmed text/background, not-allowed cursor) and tooltips to Crew assignment + and - buttons to improve UX when no crew are available or assignable.',
    ] },
    { v: '0.7.3', date: '2026-08-05', codename: 'Neon Zero', notes: [
      'Narrow-stage crowd no longer overflows: container-query rules reduce gap/padding and hide later silhouettes below 420/600px stage widths.',
      'DESIGN.md and IMPLEMENTATION_PLAN.md updated to match shipped stage behavior.'
    ]},
    { v: '0.7.2', date: '2026-08-05', codename: 'Neon Zero', notes: [
      'Stage now reflects room state: crowd grows with patrons, beams/spotlight scale with room energy, neon sign dims when the stage has no crew.',
      'Clicking "Work the room" spawns a +$ floater at the cursor and gives the stage a brief brightness pulse.'
    ]},
    { v: '0.7.1', date: '2026-08-05', codename: 'Neon Zero', notes: [
      'Stage column capped at 720px so the stage stops stretching into dead space on wide monitors.',
      'Shell centers via max-width (1460px) with wider side maxes (ledger 300 / systems 440) than the reverted 0.6.5 cap, so desktop gutters stay modest.',
      'Centering uses margin-inline:auto, not justify-content:center, so narrow screens keep left-anchored overflow scrolling.'
    ]},
    { v: '0.7.0', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Removed the CSS/DOM dancer and pole — the stage is now lighting, haze, crowd silhouettes and the stage lip.',
      'Dropped dancerHTML(), perfStyle, the #performer-stage preservation path, and the stageH ResizeObserver that existed only to fit the figure.',
      'style.css: .performer / .pole rules and the dn* dance keyframes deleted.',
      'Look Motion help: Easy stills the stage (not a dancer); neon-sign hide threshold documented as 300px to match CSS.'
    ]},
    { v: '0.6.6', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Reverted the 660px stage cap — it left dead gutters on desktop; the stage is fluid again with the side columns capped.',
      'Look panel (Settings → Look & feel, or L): House lights, Room mood (Hot Pink / Ultraviolet / Sodium), Motion (Full / Easy / Still).',
      'Look prefs live in localStorage afterglow.look — chrome only, never part of the save.',
      'House-lights slider updates its readout in place instead of repainting the panel, so pointer drag and arrow keys survive.'
    ]},
    { v: '0.6.5', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Stage column is capped at 660px instead of soaking up every spare pixel; side columns take the slack (268 / 392) and the shell centers on wide screens.'
    ]},
    { v: '0.6.4', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Density pass toward mobile: columns 262/420/352 → 232/320/320, stage row min 300 → 190px, log row 146 → 132px.',
      'state.stageH default follows the stage row minimum (190) so first paint and paused tabs fit instead of clipping the performer.',
      'Performer follows the existing perfStyle fit (ResizeObserver + stage height) — no CSS scale override.'
    ]},
    { v: '0.6.3', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Legibility: ledger sub-labels and job descriptions move from #5c4470 to the palette muted #9c86ab — the old value washed out on dim screens.'
    ]},
    { v: '0.6.2', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Stage sign no longer overlaps the Main Stage caption on narrow center columns.',
      'Stage panel is a CSS size container; the girls-girls-girls sign drops below the caption under 660px and hides under 300px.'
    ]},
    { v: '0.6.1', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Balance pass — pacing targets in PLAN-NEXT §C; numbers only, no mechanic changes.',
      'Reference bot simulator pacing.mjs: milestone bands for rail, crew, patrons, LED, research, all upgrades.',
      'Retuned building/upgrade/research costs, click value, goal rewards, hire price, and rates for active-play pacing.',
      'roundPrice() single source for UI and pacing bot (buyRound when cash > 3× live price).',
      'Catch-up evaluates goals each offline slice so threshold goals (patrons/hype) complete if crossed mid-window then decay.',
      'pacing.mjs advances 1s of sim between each bot decision (not five decisions then +5s).',
      'Owner\'s List rail why matches tip rate (+$0.06/s); Floor Work / regulars copy no longer claims conversion.',
      'Live step() evaluates goals each sim slice before shift rollover so Peak-hour hero can complete mid-tick.',
      'Import persists before replacing the live club: setItem failure surfaces import failed, leaves the prior club, and does not clear tabStale or restart autosave.',
      'Import rebuilds buildings/upgrades/research/jobs from known catalog IDs only — unknown keys cannot reach Structures or other Object.values paths.',
      'pacing.mjs First upgrade (LED) milestone requires g.u.led specifically (not any upgrade).',
      'Tab ownership: per-page token + lease/probe handshake; autosave starts only after claim.',
      'save(auto) and save(manual)/Save now no-op while tabStale or non-owner — never clobber a live sibling.',
      'Non-owner tabs are read-only (sim + controls pause) until reload takeover or successful import.',
      'Age-only claim probes first so a live owner can refresh its lease before a second tab steals.',
      'Successful import acquires ownership and starts autosave only after setItem succeeds.',
      'Settings wipe (hardReset) no-ops while tabStale or non-owner — never removeItem a live sibling save.'
    ]},
    { v: '0.6.0', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Owner\'s List: sequential 14-goal onboarding panel at the top of the systems column.',
      'Goals pay cash/clout once on completion; night log records each finish.',
      'New save fields goals / clicks / rounds (SAVE_VER 5); v4 saves migrate with credit, no back-paid rewards.',
      'Migration credits every already-satisfied goal (no sequential break) so mid-game clubs are not re-paid live.',
      'Peak-hour hero (goal 12) completes only on live step/actions — not offline catch-up.',
      'Study/builtin goals check only catalog research/upgrades (orphan r.franchise does not complete study).',
      'Init persists migrate + offline catch-up immediately so a reload cannot double-count elapsed time.',
      'Init claims the offline window (persist + refresh ts) before catch-up; on setItem failure skip catch-up and surface save failed — no silent double-count on reload.',
      'Current-format (v5) saves require sane goals/clicks/rounds; missing fields fail closed (v4 still migrates).',
      'Goal checks after step, catch-up, and player actions so offline progress can complete goals.',
      'Catch-up evaluates goals each offline slice so threshold goals (patrons/hype) complete if crossed mid-window then decay.'
    ]},
    { v: '0.5.6', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Night-log import keeps raw validated text and hex-only colors; HTML escape happens only at render so export→import round-trips stay idempotent.'
    ]},
    { v: '0.5.5', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Import sanitizes night-log text (HTML escaped) and log colors (hex only) before render — closes XSS via crafted save files.',
      'Successful file/clipboard restore clears tabStale and restarts autosave so explicit import takes ownership after a foreign-tab pause.'
    ]},
    { v: '0.5.4', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Settings: Download save (.json) — same payload as clipboard, fixed filename afterglow-save.json.',
      'Settings: Load save from file… — FileReader into existing importSaveFromText (no parallel path).',
      'Files and clipboard are interchangeable; settings order: Save · Download · Load file · clipboard · Wipe.',
      'Import night-log is source-neutral ("Save restored.") — file and clipboard share importSaveFromText.'
    ]},
    { v: '0.5.3', date: '2026-08-04', codename: 'Neon Zero', notes: [
      'Clipboard restore now completes and validates every simulation field before replacing the live club.',
      'Crew stay on strike while non-crew revenue cannot cover payroll, preventing alternating unpaid production ticks.'
    ]},
    { v: '0.5.2', date: '2026-08-03', codename: 'Neon Zero', notes: [
      'Reorganization only — no behavior change.',
      'Section headers in game.js (constants / economy / simulation / actions / render / boot).',
      'Removed dead .performer.idle CSS; DESIGN.md marked superseded (historical 0.3.x canvas prototype).'
    ]},
    { v: '0.5.1', date: '2026-08-03', codename: 'Neon Zero', notes: [
      'Settings: Restore save from clipboard — validate shape, sanitize jobs/crew, fail closed on bad JSON.',
      'Save migration map: saveVer 3 upgrades to 4 in place; wipe only when no path (corrupt JSON still wipes).',
      'Multi-tab guard: foreign localStorage write stops this tab\'s autosave and shows a reload banner (no silent clobber).',
      'Patrons ledger shows whole people (Math.floor); simulation stays fractional.'
    ]},
    { v: '0.5.0', date: '2026-08-03', codename: 'Neon Zero', notes: [
      'Unify catch-up: offline load and large live gaps both use catchUp() at 50% rate (cap 8h).',
      'Live timer routes dt > 2s through catchUp instead of full-rate step slices (no hidden-tab hang).',
      'Remove dt floor speed-up: ticks under 50ms skip instead of advancing 0.1s of sim time.',
      'Strike rule: at $0 cash when wages exceed non-crew income, crew output and wages zero until buildings recover.',
      'Walk-in trickle: baseline +0.02 patrons/s pull so a rail-first opener earns with zero Buzz.',
      'Door Staff capped at 6 (decay floor already there); card shows maxed and buy rejects beyond.',
      'Consolidate patron income: remove uncapped patrons×0.012; cash from patrons flows via tip rail only (flat base covers the door).',
      'Off Shift is display-only: residual roster count, no steppers; dead moveJob(off, +1) branch removed.',
      'buyUpgrade enforces building requirements in the action (not UI-only).',
      'Remove Franchise Binder research until prestige design (orphan r.franchise in old saves is harmless).',
      'Honest away-report: shows gross earned and wages from catchUp (not cash-floor delta); notes if crew struck.'
    ]},
    { v: '0.4.2', date: '2026-08-03', codename: 'Neon Zero', notes: [
      'Main Stage empty-state: hires open on stage, Crew-tab CTA, no ghost idle body.',
      'Click reliability: defer re-renders while the pointer is down so CTAs register normal presses.'
    ]},
    { v: '0.4.1', date: '2026-08-03', codename: 'Neon Zero', notes: [
      'Bottle Service now boosts VIP Room crew income (2.2x).',
      'Offline progression applies across all short & long gaps with per-slice zero-flooring.',
      'Interactive CSS/DOM performer stage dancer with dynamic BPM motion.',
      'UI polish: per-tab scroll preservation and fractional Hype round purchases.'
    ]},
    { v: '0.4.0', date: '2026-08-02', codename: 'Neon Zero', notes: [
      'Full visual overhaul: neon-noir club shell, Monoton / Space Grotesk / IBM Plex Mono type system.',
      'Three-column idle layout — resource ledger, stage, systems panel — replacing the single canvas + button strip.',
      'Strict version tracker: header badge, footer stamp, in-game changelog, save-format versioning with migration wipe.',
      'Economy rebuilt around Cash, Hype, Buzz, Regulars and Clout with per-second rate readouts and soft caps.',
      'Crew system: hire dancers, assign them to Stage / VIP / Floor / Off.',
      'Four-phase shift cycle (Early, Peak, Last Call, After Hours) with per-phase multipliers.',
      'Research tree spending Clout; upgrade tier gated behind owned buildings.',
      'Autosave every 10s, offline progress up to 8h at 50% rate, export save to clipboard.'
    ]},
    { v: '0.3.0', date: '2026-07-18', codename: 'Tip Jar', notes: [
      'Canvas prototype: single performer, three outfit stages, drag-to-spin.',
      'Eight flat upgrade buttons with 1.6–2.2x cost scaling.',
      'WebAudio cha-ching and bass loop.'
    ]},
    { v: '0.2.0', date: '2026-07-05', codename: 'Doorman', notes: [
      'First playable loop: click to tip, passive tick at 150ms.',
      'Money / Tips / Hype / Attention counters.'
    ]},
    { v: '0.1.0', date: '2026-06-28', codename: 'Cold Open', notes: ['Repo created, static canvas sketch.'] }
  ];

  // --- constants (shifts, buildings, upgrades, research, jobs) ---
  SHIFTS = [
    { name: 'Early Doors', mult: 0.7, len: 40, tint: '#22d3ee' },
    { name: 'Peak Hours', mult: 1.6, len: 55, tint: '#ff2d78' },
    { name: 'Last Call', mult: 1.15, len: 35, tint: '#ffc94a' },
    { name: 'After Hours', mult: 0.45, len: 30, tint: '#a855f7' }
  ];

  // Special shifts (PLAN.md §4.2) — low-frequency event shifts that occasionally
  // substitute one instance of the 4-shift rotation. Each entry is shaped exactly
  // like a SHIFTS entry ({name, mult, len, tint}) plus a `weight` for weighted
  // selection. Purely a modifier layer over shift.mult/shift.len: g.shiftIdx keeps
  // advancing the base rotation underneath, so a special never corrupts it.
  SPECIAL_CHANCE = 0.10; // per rollover chance to trigger a special (fixed 10%)
  // 0.10.2 burst events — critic + golden ticket. Both are LIVE-ONLY: the pacing
  // bot and offline catchUp drive step() with _live = false, so these random rolls
  // can never flake pacing.mjs (a hard gate).
  CRITIC_CHANCE = 0.02;  // per night at rollover, requires hype >= 30
  GOLDEN_CHANCE = 0.001; // per live tick at hype > 0 — 0.001/tick at the 10Hz sim ≈ one offer per ~2 min (0.10.20: was 0.005 ≈ one per 20s; the 0.10.2 changelog said "rare" but 0.5%/tick at 10 ticks/s is ~3/min — the VIP badge and log line were up ~60% of a session)
  GOLDEN_TTL = 30;       // seconds a golden offer stays clickable
  _live = false;         // true only inside the live tick interval
  _lastRender = 0;       // 0.10.4: render throttle — forceUpdate only if 250ms since last DOM write
  SPECIAL_SHIFTS = [
    { name: 'Bachelorette Rush', mult: 1.9, len: 26, tint: '#ff2d78', weight: 4 },
    { name: 'Midweek Surge', mult: 1.3, len: 34, tint: '#22d3ee', weight: 3 },
    { name: 'Slow Tuesday', mult: 0.55, len: 40, tint: '#9c86ab', weight: 3 }
  ];

  BUILDINGS = [
    // Costs/growth retuned for PLAN-NEXT §C pacing bands (numbers only).
    { id: 'rail', name: 'Tip Rail', cost: 140, growth: 1.16, desc: 'Brass rail along the stage. Up to 6 patrons per rail tip +$0.06/s.' },
    { id: 'bar', name: 'Back Bar', cost: 150, growth: 1.18, desc: 'Drinks pay the rent. +$0.45/s and +5 floor capacity.' },
    { id: 'dj', name: 'DJ Booth', cost: 180, growth: 1.17, desc: 'Keeps the room moving. +0.10 Hype/s.' },
    { id: 'marquee', name: 'Marquee Sign', cost: 380, growth: 1.22, desc: '+0.07 Buzz/s and +35 Buzz capacity.' },
    { id: 'flyers', name: 'Flyer Crew', cost: 210, growth: 1.16, desc: 'Windshields all over downtown. +0.025 Buzz/s.' },
    { id: 'vip', name: 'VIP Booth', cost: 600, growth: 1.24, desc: 'Private bookings. +$1.25/s and +18% regular conversion.' },
    { id: 'door', name: 'Door Staff', cost: 300, growth: 1.20, max: 6, desc: 'Fewer incidents. Cuts Hype decay by 12% each. (max 6)' },
    { id: 'dress', name: 'Dressing Room', cost: 500, growth: 1.28, desc: '+2 crew capacity.' }
  ];

  UPGRADES = [
    { id: 'led', name: 'LED Pole Lighting', cost: 420, req: { dj: 2 }, desc: 'Hype generation x1.30.' },
    { id: 'twodrink', name: 'Two-Drink Minimum', cost: 1100, req: { bar: 4 }, desc: 'All cash income x1.35.' },
    { id: 'coat', name: 'Coat Check', cost: 850, req: { door: 2 }, desc: '+20 floor capacity.' },
    { id: 'photog', name: 'House Photographer', cost: 1700, req: { marquee: 2 }, desc: 'Buzz generation x1.5.' },
    { id: 'bottle', name: 'Bottle Service', cost: 3800, req: { vip: 3 }, desc: 'VIP cash x2.2.' },
    { id: 'residency', name: 'Weekly Residency', cost: 8000, req: { dress: 2 }, desc: 'Crew output x1.4.' }
  ];

  // Research tree (REPLAY_ROADMAP.md §5): 3 tiers, prerequisites. `req` is an
  // existence-based prerequisite (a research id — `g.r[req]` truthy), mirroring
  // the perk-req shape, NOT the UPGRADES object-req shape (research has no ranks).
  // Tier 1 = cheap multipliers (no req); Tier 2 = mechanic unlocks + stacking
  // multipliers (req-gated); Tier 3 = expensive account-wide bonuses.
  // The cheapest item (loop, 12 Clout) anchors the "first research" pacing band.
  RESEARCH = [
    // Tier 1 — cheap multipliers, no prerequisites.
    { id: 'loop', name: 'Reputation Loop', tier: 1, cost: 12, desc: 'Regulars each add $0.04/s on their own.' },
    { id: 'latemenu', name: 'Late Kitchen', tier: 1, cost: 12, desc: 'After Hours multiplier 0.45 → 0.95.' },
    { id: 'promo', name: 'Promoter Network', tier: 1, cost: 20, desc: 'Buzz converts to patrons 60% faster.' },
    { id: 'cover', name: 'Cover Charge', tier: 1, cost: 24, desc: 'Door cover +50% — patrons pay more at the door.' },
    { id: 'payroll', name: 'Payroll Software', tier: 1, cost: 32, desc: 'Crew wages drop 40%.' },
    // Tier 2 — mechanic unlocks + stacking multipliers (prerequisite-gated).
    { id: 'host', name: 'Floor Host', tier: 2, cost: 45, req: 'promo', desc: 'Unlocks the Floor Host job: +patron pull each.' },
    { id: 'scheduling', name: 'Staff Scheduling', tier: 2, cost: 50, req: 'payroll', desc: 'Wages drop a further 25%.' },
    { id: 'concierge', name: 'VIP Concierge', tier: 2, cost: 55, req: 'cover', desc: 'VIP booth income +50%.' },
    { id: 'playbook', name: 'Franchise Playbook', tier: 2, cost: 60, req: 'loop', desc: 'Regulars convert 25% faster.' },
    // Tier 3 — expensive account-wide bonuses.
    { id: 'brand', name: 'Brand Licensing', tier: 3, cost: 90, req: 'concierge', desc: 'All cash income +10%.' },
    { id: 'school', name: 'Night School', tier: 3, cost: 100, req: 'scheduling', desc: 'Crew output +15%.' },
    { id: 'network', name: 'National Network', tier: 3, cost: 110, req: 'playbook', desc: 'Clout gain +25%.' }
  ];

  // Challenge runs (REPLAY_ROADMAP.md §6) — opt-in replay modifiers with
  // permanent rewards. `mod` = run constraints applied while active (startCash,
  // incomeMult, locked buildings). `reward` = permanent account bonus DERIVED
  // from g.challengesDone + this table (no separate reward field). `check` =
  // completion predicate against the merged club view (like achievements).
  // Rewards never grant Clout (Legacy-not-Clout rule — run variance must not
  // feed the deterministic research currency). Challenges are opt-in; the
  // pacing bot never starts one, so the existing bands are untouched.
  CHALLENGES = [
    { id: 'tight', name: 'Tight Till', desc: 'Start with an empty till — no starting cash.', mod: { startCash: 0 }, reward: { cashMult: 0.05 }, check: v => v.regulars >= 25 },
    { id: 'slim', name: 'Slim Margins', desc: 'The house takes half — all income ×0.5.', mod: { incomeMult: 0.5 }, reward: { doorMax: 1 }, check: v => v.regulars >= 20 },
    { id: 'dry', name: 'No Street Team', desc: 'Flyer Crew is locked — word of mouth only.', mod: { locked: ['flyers'] }, reward: { crewOut: 0.05 }, check: v => v.b.dj >= 2 },
    { id: 'lean', name: 'Lean Night', desc: 'The Back Bar is locked — no bar revenue.', mod: { locked: ['bar'] }, reward: { cashMult: 0.05 }, check: v => v.b.vip >= 1 }
  ];

  // Brand perks (REPLAY_ROADMAP.md §9) — the Renown sink. Bought with Renown,
  // persist through the second prestige (they're the reason to sell again).
  // Mirrors PRESTIGE_PERKS: { id, name, cost, max, desc, req? } (req = brand
  // perk id, rank >= 1). Effects are account-wide; 'rooftop' unlocks the third
  // club. brandRank(g, id) reads g.brand (fail-closed to 0).
  BRAND_PERKS = [
    { id: 'nationwide', name: 'Nationwide Reach', cost: 5, max: 3, desc: 'All cash income +10% per rank, everywhere.' },
    { id: 'loyalty', name: 'Loyalty Program', cost: 4, max: 3, desc: 'Start each run with +1 Regular per rank.' },
    { id: 'rnd', name: 'R&D Lab', cost: 4, max: 3, desc: 'Research costs −10% per rank.' },
    { id: 'offline', name: 'Night Owl Network', cost: 3, max: 3, desc: 'Offline progress +10% per rank.' },
    { id: 'rooftop', name: 'Rooftop Lease', cost: 10, max: 1, desc: 'Unlock the Rooftop — a third location.' }
  ];

  // Location-specific buildings/upgrades (REPLAY_ROADMAP.md §9) — additive
  // identity per club, appended to the shared BUILDINGS/UPGRADES catalog.
  // `kind`: 'b' = building (cost/growth/desc, optional max), 'u' = upgrade
  // (cost/req/desc). Supersedes SECOND_LOCATION.md §11's "no location-specific
  // buildings" non-goal. Extras must be initialized in freshClubState and
  // backfilled by sanitize/import for existing saves.
  LOCATION_EXTRAS = {
    main: [
      { kind: 'b', id: 'pool', name: 'Neon Pool', cost: 700, growth: 1.22, desc: '+$0.60/s and +6 patron cap.' }
    ],
    annex: [
      { kind: 'b', id: 'roofbar', name: 'Rooftop Bar', cost: 900, growth: 1.25, desc: '+$0.90/s and +8 patron cap.' },
      { kind: 'u', id: 'skyline', name: 'Skyline View', cost: 2600, req: { roofbar: 2 }, desc: 'All cash income ×1.25 (annex only).' }
    ],
    rooftop: [
      { kind: 'b', id: 'heli', name: 'Helipad Lounge', cost: 1500, growth: 1.30, desc: '+$1.50/s and +12 patron cap.' },
      { kind: 'u', id: 'vista', name: 'Panorama Deck', cost: 4200, req: { heli: 2 }, desc: 'Hype generation ×1.40 (rooftop only).' }
    ]
  };
  // Prestige perks (PRESTIGE.md). Legacy cost, max rank, effect applied in rates()/workCrowd()/catchUp()/fresh().
  // Optional `req: perkId` gates purchase on the prerequisite perk's rank >= 1 (perk tree, PLAN §4.3).
  // Note: unlike UPGRADES.req ({ buildingId: count }), a perk req is a bare perkId string (existence-based,
  // rank >= 1). Reqs gate future purchases only, not past unlocks.
  PRESTIGE_PERKS = [
    { id: 'cash10', name: 'House cut', cost: 1, max: 5, desc: '+15% all cash income per rank.' },
    { id: 'startCrew', name: 'Seed roster', cost: 2, max: 1, desc: 'Start run with 1 crew on Main Stage.' },
    { id: 'startFlyers', name: 'Street team', cost: 3, max: 1, desc: 'Start run with Flyer Crew ×1 built.' },
    { id: 'offline65', name: 'Franchise playbook', cost: 4, max: 1, req: 'cash10', desc: 'Offline / catchUp rate 50% → 65%.' },
    { id: 'doorPlus', name: 'Extra bouncer slot', cost: 5, max: 1, req: 'startCrew', desc: '+1 max Door Staff.' },
    { id: 'clout25', name: 'Name recognition', cost: 6, max: 1, req: 'offline65', desc: '+25% Clout gain.' }
  ];

  // Managers — auto-buyers, one per building type (PLAN.md §4.1).
  // Purchasable with Legacy from the Perks/Prestige panel, max 1 each.
  MANAGERS = [
    { id: 'rail',    name: 'Tip Rail Manager',    desc: 'Auto-buys Tip Rails.',    cost: 10 },
    { id: 'bar',     name: 'Barback Manager',     desc: 'Auto-buys Bars.',         cost: 10 },
    { id: 'dj',      name: 'DJ Manager',          desc: 'Auto-buys DJ Booths.',    cost: 10 },
    { id: 'marquee', name: 'Marquee Manager',     desc: 'Auto-buys Marquees.',     cost: 10 },
    { id: 'flyers',  name: 'Flyer Manager',       desc: 'Auto-buys Flyer Crew.',   cost: 10 },
    { id: 'vip',     name: 'VIP Manager',         desc: 'Auto-buys VIP Booths.',   cost: 10 },
    { id: 'door',    name: 'Door Manager',        desc: 'Auto-buys Door Staff.',   cost: 10 },
    { id: 'dress',   name: 'Dressing Room Manager', desc: 'Auto-buys Dressing Rooms.', cost: 10 }
  ];

  // Flavor layer (REPLAY_ROADMAP.md §4) — ambient ticker lines + named regulars.
  // Pure display: read in renderVals only, never in rates()/step(), so pacing is
  // untouched. Conditions take (g, c) where c is the active club view.
  FLAVOR = [
    { cond: (g, c) => c.regulars >= 25, text: 'A regular booked the VIP booth for her anniversary.' },
    { cond: (g, c) => c.regulars >= 10, text: 'The regulars know the door staff by name now.' },
    { cond: (g, c) => c.regulars >= 5, text: 'A regular left a five-star review online.' },
    { cond: (g, c) => c.hype >= 150, text: 'The DJ dropped a deep cut and the floor surged.' },
    { cond: (g, c) => c.hype >= 80, text: 'The lights are low and the bass hits just right.' },
    { cond: (g, c) => c.patrons >= 40, text: 'The line at the door stretches down the block.' },
    { cond: (g, c) => c.b.bar >= 5, text: 'The back bar can\'t pour drinks fast enough.' },
    { cond: (g, c) => c.b.dj >= 3, text: 'Three DJs trade sets — the floor never lets up.' },
    { cond: (g, c) => c.b.marquee >= 2, text: 'The marquee out front glows two blocks away.' },
    { cond: (g, c) => c.b.vip >= 2, text: 'The VIP room has a waiting list.' },
    { cond: (g, c) => c.night >= 10, text: 'Ten nights in, the neighborhood knows the name.' },
    { cond: () => true, text: 'The night is young.' }
  ];

  // Named regulars pool — one new name every 5 regulars (derived, no save field).
  REGULAR_NAMES = [
    'Margo', 'DeShawn', 'Priya', 'Yuki', 'Marcus', 'Elena', 'Theo', 'Rosa',
    'Jamal', 'Ingrid', 'Felix', 'Naomi', 'Dante', 'Carmen', 'Otis', 'Hana',
    'Leon', 'Tessa', 'Ravi', 'Sylvie'
  ];

  // Achievements — permanent unlocks with small rewards (Clout/Legacy).
  ACHIEVEMENTS = [
    { id: 'first_rail', name: 'Brass Tax', desc: 'Own 1 Tip Rail', check: g => g.b.rail >= 1, reward: { clout: 1 } },
    { id: 'rail_5', name: 'Rail Yard', desc: 'Own 5 Tip Rails', check: g => g.b.rail >= 5, reward: { clout: 2 } },
    { id: 'rail_10', name: 'Rail Baron', desc: 'Own 10 Tip Rails', check: g => g.b.rail >= 10, reward: { clout: 3 } },
    { id: 'first_vip', name: 'Velvet Rope', desc: 'Build your first VIP Booth', check: g => g.b.vip >= 1, reward: { clout: 2 } },
    { id: 'vip_5', name: 'High Roller Haven', desc: 'Own 5 VIP Booths', check: g => g.b.vip >= 5, reward: { clout: 5 } },
    { id: 'hype_50', name: 'Buzzing', desc: 'Reach 50 Hype', check: g => g.hype >= 50, reward: { clout: 1 } },
    { id: 'hype_100', name: 'Electric', desc: 'Reach 100 Hype', check: g => g.hype >= 100, reward: { clout: 3 } },
    { id: 'patrons_25', name: 'Packed House', desc: '25 patrons on floor', check: g => g.patrons >= 25, reward: { clout: 2 } },
    { id: 'patrons_50', name: 'Standing Room Only', desc: '50 patrons on floor', check: g => g.patrons >= 50, reward: { clout: 3 } },
    { id: 'regulars_5', name: 'Regulars', desc: '5 Regulars', check: g => g.regulars >= 5, reward: { clout: 1 } },
    { id: 'regulars_10', name: 'Locals', desc: '10 Regulars', check: g => g.regulars >= 10, reward: { clout: 2 } },
    { id: 'regulars_25', name: 'Pillars', desc: '25 Regulars', check: g => g.regulars >= 25, reward: { clout: 5 } },
    { id: 'prestige_1', name: 'Franchisee', desc: 'Sign your first franchise deal', check: g => g.prestiges >= 1, reward: { legacy: 1 } },
    { id: 'prestige_5', name: 'Mogul', desc: '5 franchise deals', check: g => g.prestiges >= 5, reward: { legacy: 5 } },
    { id: 'legacy_50', name: 'Legacy Builder', desc: 'Accumulate 50 Legacy', check: g => g.legacyTotal >= 50, reward: { legacy: 2 } },
    { id: 'click_100', name: 'Busy Hands', desc: 'Work the room 100 times', check: g => g.clicks >= 100, reward: { clout: 1 } },
    { id: 'click_1000', name: 'Wrist Action', desc: 'Work the room 1,000 times', check: g => g.clicks >= 1000, reward: { clout: 3 } },
    { id: 'night_5', name: 'Week One', desc: 'Survive 5 nights', check: g => g.night >= 5, reward: { clout: 1 } },
    { id: 'night_10', name: 'Ten Nights', desc: 'Survive 10 nights', check: g => g.night >= 10, reward: { clout: 2 } },
    { id: 'all_buildings', name: 'Empire', desc: 'Own every structure at least once', check: g => this.BUILDINGS.every(b => g.b[b.id] >= 1), reward: { legacy: 3 } },
    { id: 'all_upgrades', name: 'Fully Loaded', desc: 'Buy every upgrade', check: g => this.UPGRADES.every(u => g.u[u.id]), reward: { legacy: 3 } },
    { id: 'all_research', name: 'Scholar', desc: 'Complete all research', check: g => this.RESEARCH.every(r => g.r[r.id]), reward: { legacy: 2 } },
    { id: 'max_perks', name: 'Perfectionist', desc: 'Max all prestige perks', check: g => this.PRESTIGE_PERKS.every(p => this.perk(g, p.id) >= p.max), reward: { legacy: 10 } },
    // 0.10.1 density pass (23 → 38): building breadth, higher stat tiers, and the
    // burst-event counters. Legacy rewards below credit legacyTotal via
    // checkAchievements (earned Legacy), matching the 0.9.5 accounting rule.
    { id: 'bar_10', name: 'Two-Thirds Full', desc: 'Own 10 Back Bars', check: g => g.b.bar >= 10, reward: { clout: 2 } },
    { id: 'dj_5', name: 'Beatkeeper', desc: 'Own 5 DJ Booths', check: g => g.b.dj >= 5, reward: { clout: 2 } },
    { id: 'marquee_3', name: 'Bright Lights', desc: 'Own 3 Marquee Signs', check: g => g.b.marquee >= 3, reward: { clout: 3 } },
    { id: 'flyers_5', name: 'Street Team', desc: 'Own 5 Flyer Crews', check: g => g.b.flyers >= 5, reward: { clout: 2 } },
    { id: 'door_max', name: 'Bouncer', desc: 'Max out Door Staff', check: g => g.b.door >= this.doorMax(g), reward: { clout: 3 } },
    { id: 'dress_3', name: 'Backstage Pass', desc: 'Own 3 Dressing Rooms', check: g => g.b.dress >= 3, reward: { clout: 3 } },
    { id: 'hype_200', name: 'Deafening', desc: 'Reach 200 Hype', check: g => g.hype >= 200, reward: { clout: 3 } },
    { id: 'patrons_100', name: 'Fire Marshal', desc: '100 patrons on floor', check: g => g.patrons >= 100, reward: { clout: 5 } },
    { id: 'regulars_50', name: 'Institution', desc: '50 Regulars', check: g => g.regulars >= 50, reward: { clout: 8 } },
    { id: 'night_25', name: 'A Month In', desc: 'Survive 25 nights', check: g => g.night >= 25, reward: { clout: 3 } },
    { id: 'round_10', name: 'Toast', desc: 'Buy 10 rounds', check: g => g.rounds >= 10, reward: { clout: 1 } },
    { id: 'whale_1', name: 'Big Catch', desc: 'A whale patron spends big', check: g => (g.whalesCount || 0) >= 1, reward: { legacy: 1 }, burst: true },
    { id: 'whale_10', name: 'Whale Watcher', desc: '10 whale patrons', check: g => (g.whalesCount || 0) >= 10, reward: { legacy: 3 }, burst: true },
    { id: 'special_1', name: 'Surprise Hit', desc: 'Ride your first special shift', check: g => (g.specialsCount || 0) >= 1, reward: { legacy: 1 }, burst: true },
    { id: 'special_5', name: 'Event Planner', desc: 'Ride 5 special shifts', check: g => (g.specialsCount || 0) >= 5, reward: { legacy: 2 }, burst: true }
  ];

  // Current rank of a prestige perk (0 if missing/invalid).
  perk(g, id) {
    const p = g && g.perks && g.perks[id];
    return typeof p === 'number' && p > 0 ? p : 0;
  }

  // Current rank of a Brand perk (0 if missing/invalid) — g.brand, Renown sink
  // (REPLAY_ROADMAP.md §9). Mirrors perk() but reads the brand map.
  brandRank(g, id) {
    const b = g && g.brand && g.brand[id];
    return typeof b === 'number' && b > 0 ? b : 0;
  }

  // Current Brand Endorsement level (0 if missing/invalid) — g.brandLevel, the
  // repeatable Renown sink (next-roadmap PR 1). Unlike brandRank there is no
  // max: the cost escalates 15 × 1.35^level, so the sink never exhausts — each
  // level stays a flat +2% all cash while the price outgrows the income.
  brandLevel(g) {
    const n = g && g.brandLevel;
    return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  // Cost of the NEXT Brand Endorsement level (next-roadmap PR 1): the
  // escalating price that keeps the Renown sink meaningful past the five Brand
  // perks. Level 0→1 costs 15, then 20, 27, 37, 50... (15 × 1.35^level).
  // Precision note: the formula exceeds Number.MAX_SAFE_INTEGER (~9e15) around
  // level 140 — unreachable in practice (~2e16 sales at ~14 Renown each), so
  // the "never needs a cap" claim holds well past any plausible play; the
  // integer floor stays exact for every reachable level.
  endorsementCost(g) {
    return Math.floor(15 * Math.pow(1.35, this.brandLevel(g)));
  }

  // Location-specific content for a club id (REPLAY_ROADMAP.md §9): the extras
  // array, its buildings, or its upgrades. Empty for unknown ids — the shared
  // catalog still applies everywhere.
  locationExtras(loc) {
    return (this.LOCATION_EXTRAS && this.LOCATION_EXTRAS[loc]) || [];
  }
  extraBuildings(loc) {
    return this.locationExtras(loc).filter(x => x.kind === 'b');
  }
  extraUpgrades(loc) {
    return this.locationExtras(loc).filter(x => x.kind === 'u');
  }

  // Effective max Door Staff count (base 6 + doorPlus perk).
  doorMax(g) {
    return (this.BUILDINGS.find(b => b.id === 'door').max || 6) + this.perk(g, 'doorPlus') + this.challengeBonus(g).doorMax;
  }

  // All job ids in catalog order (off last — the residual pool).
  jobIds() {
    return this.JOBS.map(j => j.id);
  }

  // Working (non-off) job ids in catalog order.
  workingJobIds() {
    return this.JOBS.filter(j => j.id !== 'off').map(j => j.id);
  }

  // Is a job currently unlocked? A job with `unlock` requires that research id
  // owned (g.r[unlock] truthy); jobs without `unlock` are always available.
  jobUnlocked(g, job) {
    return !job.unlock || !!(g && g.r && g.r[job.unlock]);
  }

  // Zeroed job assignments keyed by catalog id (off included).
  freshJobs() {
    const jobs = {};
    for (const id of this.jobIds()) jobs[id] = 0;
    return jobs;
  }

  // Zeroed manager levels keyed by catalog id (default 0 = base auto-buy).
  freshManagerLevels() {
    const levels = {};
    for (const def of this.MANAGERS) levels[def.id] = 0;
    return levels;
  }

  // Legacy cost to raise a manager from `level` to `level + 1` (PR 5):
  // 10 × (level + 1) — 10 / 20 / 30 Legacy for levels 0→1→2→3.
  managerLevelCost(def, level) {
    return 10 * ((level || 0) + 1);
  }

  // Active challenge def (null when none). Challenges are opt-in replay runs
  // (REPLAY_ROADMAP.md §6); the pacing bot never starts one, so these no-op
  // for the deterministic bands.
  activeChallenge(g) {
    if (!g || !g.challenge) return null;
    return this.CHALLENGES.find(c => c.id === g.challenge) || null;
  }

  // Modifier of the active challenge ({} when none).
  challengeMod(g) {
    const ch = this.activeChallenge(g);
    return (ch && ch.mod) || {};
  }

  // Is a building locked by the active challenge's modifier? Enforced in
  // buyBuilding AND autoBuyManagers AND greyed in the card (an owned manager
  // must not auto-buy a locked structure mid-challenge).
  buildingLocked(g, id) {
    const mod = this.challengeMod(g);
    return Array.isArray(mod.locked) && mod.locked.includes(id);
  }

  // Permanent challenge rewards, DERIVED from g.challengesDone + the table
  // (no separate reward field). Aggregates the additive bonuses: cashMult
  // (all cash +%), doorMax (Door Staff cap +N), crewOut (crew output +%).
  challengeBonus(g) {
    const done = new Set(Array.isArray(g.challengesDone) ? g.challengesDone : []);
    const bonus = { cashMult: 0, doorMax: 0, crewOut: 0 };
    for (const ch of this.CHALLENGES) {
      if (!done.has(ch.id) || !ch.reward) continue;
      bonus.cashMult += ch.reward.cashMult || 0;
      bonus.doorMax += ch.reward.doorMax || 0;
      bonus.crewOut += ch.reward.crewOut || 0;
    }
    return bonus;
  }

  // Human-readable modifier summary for the challenge card.
  challengeModDesc(d) {
    const mod = d.mod || {};
    const parts = [];
    if (typeof mod.startCash === 'number') parts.push('$' + mod.startCash + ' start');
    if (typeof mod.incomeMult === 'number') parts.push('income ×' + mod.incomeMult);
    if (Array.isArray(mod.locked) && mod.locked.length) {
      parts.push('locked: ' + mod.locked.map(id => (this.BUILDINGS.find(b => b.id === id) || {}).name || id).join(', '));
    }
    return parts.length ? parts.join(' · ') : 'modified run';
  }

  // Human-readable reward summary for the challenge card.
  challengeRewardDesc(d) {
    const r = d.reward || {};
    const parts = [];
    if (r.cashMult) parts.push('+ ' + Math.round(r.cashMult * 100) + '% all cash');
    if (r.doorMax) parts.push('+ ' + r.doorMax + ' Door Staff cap');
    if (r.crewOut) parts.push('+ ' + Math.round(r.crewOut * 100) + '% crew output');
    return parts.length ? parts.join(' · ') : 'permanent bonus';
  }

  // Legacy earned on prestige: floor(sqrt(regulars) + night / 7). Regulars and
  // night are per-club — the active club's progress gates the franchise.
  legacyGain(g) {
    const c = this.club(g);
    const reg = Math.max(0, c.regulars || 0);
    const nights = Math.max(0, c.night || 0);
    return Math.floor(Math.sqrt(reg) + nights / 7);
  }

  // Renown earned by selling the franchise (REPLAY_ROADMAP.md §8.3): the
  // second prestige layer. Mirrors legacyGain's shape — sqrt of LIFETIME
  // Legacy (account-wide, not the active club's run) plus a linear term on
  // prestige count. ~105 lifetime Legacy + ~15 prestiges → ~15 Renown.
  renownGain(g) {
    return Math.floor(Math.sqrt(g.legacyTotal || 0) + (g.prestiges || 0) / 3);
  }

  // Franchise-sale gate (REPLAY_ROADMAP.md §8.2): every prestige perk maxed,
  // every manager hired, and both clubs unlocked. Evaluated on the ACCOUNT,
  // not the active club — it ties the second prestige to "you've exhausted
  // the first layer and proven the multi-club model."
  franchiseGate(g) {
    if (!g || typeof g !== 'object') return false;
    const perksMaxed = this.PRESTIGE_PERKS.every(p => this.perk(g, p.id) >= p.max);
    if (!perksMaxed) return false;
    const managersHired = this.MANAGERS.every(m => !!(g.managers && g.managers[m.id]));
    if (!managersHired) return false;
    const clubs = g.clubs && typeof g.clubs === 'object' ? g.clubs : {};
    return Object.prototype.hasOwnProperty.call(clubs, 'main') &&
      Object.prototype.hasOwnProperty.call(clubs, 'annex');
  }

  // Multiplier applied to all cash income (passive + active clicks) from House cut perk.
  cashIncomeMult(g) {
    return 1 + 0.15 * this.perk(g, 'cash10');
  }

  // Milk-style multiplier derived from owned, non-burst achievements (REPLAY_ROADMAP.md §3):
  // each adds +1% to all cash income (passive + active clicks), so the collection is a
  // real progression path, not a checklist. Counts UNIQUE ids (Set-deduped) and EXCLUDES
  // the 4 burst achievements (whale_1/whale_10/special_1/special_5 — driven by live-only
  // counters), so the deterministic pacing bot sees a stable ceiling of 1.34x (34
  // non-burst of 38 total). Applied everywhere via totalCashMult(g).
  achievementMult(g) {
    const owned = new Set(Array.isArray(g.achievements) ? g.achievements : []);
    const count = this.ACHIEVEMENTS.filter(a => !a.burst && owned.has(a.id)).length;
    return 1 + 0.01 * count;
  }

  // Single composition point for ALL cash income: House cut perk × milk
  // (achievement) multiplier × Brand Licensing research (g.r.brand). Every cash
  // grant — passive rates(), active clicks, whale bonus, golden-ticket tip —
  // reads this, so a cash multiplier can't silently skip a source.
  totalCashMult(g) {
    // Single composition point for ALL cash income (passive + clicks + whale +
    // golden). Challenge layer (REPLAY_ROADMAP.md §6): the active challenge's
    // incomeMult modifier applies to EVERY source — routing it through rates()
    // alone would leave active clicking a bypass — and permanent cashMult
    // rewards derive from challengesDone.
    const mod = this.challengeMod(g);
    const incomeMod = typeof mod.incomeMult === 'number' ? mod.incomeMult : 1;
    // Nationwide Reach brand perk (REPLAY_ROADMAP.md §9): +10% all cash per rank.
    // Brand Endorsement (next-roadmap PR 1): +2% all cash per level, repeatable.
    return this.cashIncomeMult(g) * this.achievementMult(g) * (g.r.brand ? 1.10 : 1)
      * (1 + this.challengeBonus(g).cashMult) * (1 + 0.10 * this.brandRank(g, 'nationwide'))
      * (1 + 0.02 * this.brandLevel(g)) * incomeMod;
  }

  // Featured regular name — derived from the active club's regulars count
  // (REPLAY_ROADMAP.md §4). A new name every 5 regulars; null below the first
  // threshold (5). Pure display — never feeds rates()/step().
  regularName(g, c = this.club(g)) {
    const reg = Math.floor(c.regulars || 0);
    if (reg < 5) return null;
    return this.REGULAR_NAMES[Math.min(Math.floor(reg / 5) - 1, this.REGULAR_NAMES.length - 1)];
  }

  // Current ticker line — rotates through the applicable FLAVOR entries on a
  // ~3s cadence (30 sim frames at 10Hz). Pure display; the pacing bot never
  // renders it, so it cannot affect the deterministic bands.
  // The catch-all entry (cond: () => true) guarantees a non-empty pool, so no
  // fallback guard is needed. FLAVOR texts are source-controlled literals;
  // if they ever accept dynamic strings, escape before interpolating.
  flavorLine(g, c, tick) {
    const lines = [];
    for (const f of this.FLAVOR) if (f.cond(g, c)) lines.push(f.text);
    return lines[Math.floor(tick / 30) % lines.length];
  }

  // Job catalog (REPLAY_ROADMAP.md §5) — the single source of truth for the
  // shared roster. `unlock` = research id that gates the job (null = always
  // available); `prio` = eviction order when a club switch caps working crew
  // (lowest evicted first). `off` is the residual pool, never a working role.
  JOBS = [
    { id: 'stage', name: 'Main Stage', desc: '+0.24 Hype/s each', prio: 2 },
    { id: 'vipjob', name: 'VIP Room', desc: '+$1.35/s each', prio: 3 },
    { id: 'floor', name: 'Floor Work', desc: '+0.035 Buzz/s', prio: 1 },
    { id: 'host', name: 'Floor Host', desc: '+0.04 patrons/s each', prio: 0, unlock: 'host' },
    { id: 'off', name: 'Off Shift', desc: 'No wage drain', prio: 99 }
  ];

  // Owner's List — sequential onboarding goals (PLAN-NEXT §B). Exactly one active at a time.
  GOALS = [
    {
      id: 'work', title: 'Work the room',
      why: 'Hands-on cash before the room pays you. Five solid passes seed the till.',
      hint: 'Hit "Work the room" five times. Instant cash, no structures needed.',
      reward: { cash: 8, clout: 0 },
      check: g => (g.clicks || 0) >= 5,
      progress: g => ({ cur: Math.min(g.clicks || 0, 5), max: 5 })
    },
    {
      id: 'rail', title: 'Brass brings tips',
      why: 'Patrons standing at a rail tip +$0.06/s each. Tips are your first real income.',
      hint: 'Club tab → Tip Rail. Click "Work the room" to afford it.',
      reward: { cash: 12, clout: 0 },
      check: g => (g.b && g.b.rail || 0) >= 1,
      progress: null
    },
    {
      id: 'word', title: 'Get the word out',
      why: 'Buzz is how strangers find the door. Without it the floor stays empty.',
      hint: 'Club tab → Flyer Crew. Buzz ticks up on its own after that.',
      reward: { cash: 15, clout: 0 },
      check: g => (g.b && g.b.flyers || 0) >= 1,
      progress: null
    },
    {
      id: 'pulse', title: 'A floor with a pulse',
      why: 'Buzz converts into bodies. Eight patrons means the room feels alive.',
      hint: 'Let Flyer Crew (and walk-ins) fill the floor. Watch Patrons on the ledger.',
      reward: { cash: 20, clout: 0 },
      check: g => (g.patrons || 0) >= 8,
      progress: g => ({ cur: Math.min(g.patrons || 0, 8), max: 8 })
    },
    {
      id: 'contract', title: 'First contract',
      why: 'A body on Main Stage is how Hype starts climbing without you clicking forever.',
      hint: 'Crew tab → Hire. New hires open on Main Stage automatically.',
      reward: { cash: 18, clout: 0 },
      check: g => (g.crew || 0) >= 1,
      progress: null
    },
    {
      id: 'energy', title: 'Room energy',
      why: 'Hype multiplies income, click value, and pull. 25 is the first real gear-up.',
      hint: 'Keep someone on Main Stage. DJ Booth helps. Buy a round if you need a jolt.',
      reward: { cash: 25, clout: 0 },
      check: g => (g.hype || 0) >= 25,
      progress: g => ({ cur: Math.min(g.hype || 0, 25), max: 25 })
    },
    {
      id: 'house', title: 'On the house',
      why: 'Cash → Hype conversion before Peak. A round buys momentum you cannot wait for.',
      hint: 'Center row → "Buy a round" when you can afford it. Best before Peak Hours.',
      reward: { cash: 20, clout: 0 },
      check: g => (g.rounds || 0) >= 1,
      progress: null
    },
    {
      id: 'backstage', title: 'Backstage pass',
      why: 'VIP job is crew cash. Wages are real — this is how payroll starts paying for itself.',
      hint: 'Club → VIP Booth, then Crew → move one dancer to VIP Room.',
      reward: { cash: 35, clout: 0 },
      check: g => (g.b && g.b.vip || 0) >= 1 && (g.jobs && g.jobs.vipjob || 0) >= 1,
      progress: null
    },
    {
      id: 'regulars', title: 'They keep coming back',
      why: 'Regulars mint Clout. Three faces the door knows is the start of a reputation.',
      hint: 'Regulars convert slowly from busy floors. VIP Booths raise the rate; keep patrons high.',
      reward: { cash: 0, clout: 2 },
      check: g => (g.regulars || 0) >= 3,
      progress: g => ({ cur: Math.min(g.regulars || 0, 3), max: 3 })
    },
    {
      id: 'study', title: 'Study the game',
      why: 'Clout spent on research is permanent. Reputation Loop pays regulars forever.',
      hint: 'Research tab → spend Clout on any project (Reputation Loop is the cheap open).',
      reward: { cash: 50, clout: 0 },
      // Only catalog research — orphan r.franchise must not complete study.
      check: g => this.RESEARCH.some(d => !!(g.r && g.r[d.id])),
      progress: null
    },
    {
      id: 'roster', title: 'Grow the roster',
      why: 'Dressing Rooms raise crew capacity. Three on payroll means a real rotation.',
      hint: 'Club → Dressing Room, then Crew → hire until you have three.',
      reward: { cash: 80, clout: 0 },
      check: g => (g.b && g.b.dress || 0) >= 1 && (g.crew || 0) >= 3,
      progress: g => ({ cur: Math.min(g.crew || 0, 3), max: 3 })
    },
    {
      id: 'peak', title: 'Peak-hour hero',
      why: 'Shift timing matters. Riding Peak with real Hype is when the till sings.',
      hint: 'Push Hype to 60, then be in Peak Hours (header shift). Live only — not offline.',
      reward: { cash: 100, clout: 0 },
      check: g => (g.hype || 0) >= 60 && g.shiftIdx === 1,
      progress: g => ({ cur: Math.min(g.hype || 0, 60), max: 60 })
    },
    {
      id: 'builtin', title: 'Built to last',
      why: 'Upgrades are one-time power spikes. Owning one means the club has a spine.',
      hint: 'Upgrades tab — meet the structure requirement, then buy (LED Pole is the usual first).',
      reward: { cash: 120, clout: 0 },
      // Only catalog upgrades — ignore any orphan u.* keys from old saves.
      check: g => this.UPGRADES.some(d => !!(g.u && g.u[d.id])),
      progress: null
    },
    {
      id: 'name', title: 'A name in this town',
      why: 'Word is a franchise man has been asking about you.',
      hint: 'Grow Regulars to 25. VIP Booths and long busy nights compound conversion.',
      reward: { cash: 0, clout: 5 },
      check: g => (g.regulars || 0) >= 25,
      progress: g => ({ cur: Math.min(g.regulars || 0, 25), max: 25 })
    }
  ];

  state = {
    tab: 'club', showChangelog: false, showSettings: false, showPrestige: false, showOpenRoom: false, showFranchise: false, showAchievements: false, tick: 0, saveState: 'idle', resetArmed: false, challengeArmed: null, franchiseArmed: false,
    // Golden-ticket expanded state: badge is small by default; player taps to expand.
    goldenOpen: false,
    // Ledger collapse on narrow screens: mobile players get the CASH row only and
    // tap to expand the rest (the full Ledger is taller than the viewport).
    // Desktop ignores the collapsed class (CSS only hides below 900px).
    ledgerOpen: false,
    // true when another tab wrote KEY — autosave is off until reload (PLAN §2.3).
    tabStale: false,
    g: null
  };

  // Active club accessor (SECOND_LOCATION.md §5). Returns the club object for
  // the given id (default: the active club), falling back to 'main', then to g
  // itself for pre-v9 shapes that sanitizeG has not yet normalized. Every
  // function reading club-level state goes through this — no scattered
  // g.clubs[g.activeClub].
  club(g, id = g && g.activeClub) {
    // Own-property lookup only — inherited Object.prototype keys ('constructor',
    // 'toString', ...) must never resolve to a club entry (fail closed to main).
    const c = g && g.clubs && Object.prototype.hasOwnProperty.call(g.clubs, id) ? g.clubs[id] : undefined;
    return c || (g && g.clubs && g.clubs.main) || g;
  }

  // Merged flat view of account + active club for GOALS/ACHIEVEMENTS checks, whose
  // lambdas read the old flat-g shape (g.patrons, g.b.rail, g.night...). Spread
  // order: club fields win over account fields; b/u point at the club's maps.
  clubView(g) {
    const c = this.club(g);
    return { ...g, ...c, b: c.b, u: c.u };
  }

  // Harness/compat hook: wraps state.g in a club proxy so flat-g reads
  // (g.cash, g.b, g.hype...) fall through to the ACTIVE club. Production uses
  // the same proxy — it is transparent (JSON.stringify / Object.keys forward to
  // the target, so saves serialize as native v9) and lets any code path that
  // still reads flat fields keep working. All state.g replacements route
  // through it so the wrap survives prestige/reset/import.
  wrapState(g) {
    return clubProxy(g);
  }

  constructor(root) {
    this.root = root;
    this.state.g = this.wrapState(this.fresh());
    this.handlers = [];
    // Unique per page context — not copied across tab duplicates the way a
    // sessionStorage boolean is. Paired with OWNER_KEY / RELOAD_KEY for claim.
    this.tabToken = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : String(Date.now()) + '-' + Math.random().toString(36).slice(2, 10);
    // In-memory ownership (sessionStorage can fail in private mode). Autosave
    // and save('auto') require this; set by markTabOwner after a successful claim/write.
    this._ownsSave = false;
    this.saver = null;
    this.timer = null;
    // Full innerHTML re-renders replace every button node. If that happens
    // between mousedown and mouseup the browser cancels the click, so pink
    // CTAs (and every other button) feel dead under a normal press. Defer
    // paints while the pointer is down, then catch up after the click.
    this.pointerDown = false;
    this.needsRender = false;
    this.pointerHoldTimer = null;
    const flush = () => {
      if (this.pointerHoldTimer) {
        clearTimeout(this.pointerHoldTimer);
        this.pointerHoldTimer = null;
      }
      this.pointerDown = false;
      if (this.needsRender) {
        this.needsRender = false;
        this.render();
      }
    };
    const armFlush = (ms) => {
      if (this.pointerHoldTimer) clearTimeout(this.pointerHoldTimer);
      this.pointerHoldTimer = setTimeout(flush, ms);
    };
    const hold = () => {
      if (this.pointerHoldTimer) clearTimeout(this.pointerHoldTimer);
      this.pointerDown = true;
      // Failsafe: never freeze the UI if mouseup/click is lost.
      this.pointerHoldTimer = setTimeout(flush, 1500);
    };
    // Delegate clicks so handlers stay valid across the render cycle.
    this.root.addEventListener('click', (e) => {
      const el = e.target.closest && e.target.closest('[data-h]');
      if (!el || el.disabled || !this.root.contains(el)) return;
      const fn = this.handlers[Number(el.getAttribute('data-h'))];
      if (fn) {
        // Shift-click on building card = buy max
        if (e.shiftKey && el.dataset.buildingId) {
          e.preventDefault();
          const def = this.BUILDINGS.find(b => b.id === el.dataset.buildingId);
          if (def) this.buyBuildingMax(def);
        } else {
          fn(e);
        }
      }
    });
    // Prefer flushing after click (bubble). mouseup alone is only a fallback
    // because some paths (CDP, trackpads) deliver click on a later task.
    window.addEventListener('click', () => {
      if (this.pointerDown || this.needsRender) armFlush(0);
    }, false);
    window.addEventListener('pointerdown', hold, true);
    window.addEventListener('mousedown', hold, true);
    window.addEventListener('pointerup', () => { if (this.pointerDown) armFlush(75); }, true);
    window.addEventListener('mouseup', () => { if (this.pointerDown) armFlush(75); }, true);
    window.addEventListener('pointercancel', () => armFlush(0), true);
    window.addEventListener('dragstart', () => armFlush(0), true);
    window.addEventListener('blur', () => armFlush(0));
  }

  fresh() {
    const r = {}, perks = {}, managers = {}, managerPaused = {};
    this.RESEARCH.forEach(x => r[x.id] = false);
    this.PRESTIGE_PERKS.forEach(x => perks[x.id] = 0);
    this.MANAGERS.forEach(x => { managers[x.id] = false; managerPaused[x.id] = false; });
    // The clubs map is keyed by plain id ('main', future 'annex'...) so new
    // rooms never need a SAVE_VER bump (SECOND_LOCATION.md §4).
    const g = {
      clubs: { main: this.freshClubState() },
      activeClub: 'main',
      // Account-level (shared across clubs, persists through prestige):
      clout: 0,
      // Shared roster (top-level, resets on prestige like today).
      crew: 0, jobs: this.freshJobs(),
      r, log: [], ts: Date.now(),
      // Owner's List (SAVE_VER 5) — not required by isValidSavePayload (v4 imports lack them).
      goals: [], clicks: 0, rounds: 0,
      // Challenge runs (PR 4, additive) — active challenge id + completed ids.
      challenge: null, challengesDone: [],
      // Burst-event counters (0.10.1, additive) — whalesCount/specialsCount drive
      // whale/special achievements. Not required by isValidSavePayload, so they
      // never force a SAVE_VER bump on their own.
      whalesCount: 0, specialsCount: 0,
      // Golden-ticket offer (0.10.2, additive UI state) — { at } while active.
      golden: null,
      // Prestige meta (SAVE_VER 6) — defaults for first run; perks/prestiges persist.
      legacy: 0, legacyTotal: 0, perks, prestiges: 0,
      // Achievements (SAVE_VER 7)
      achievements: [],
      // Managers (SAVE_VER 8) — auto-buyers, one per building type.
      managers,
      // Manager pause state — additive, like goals/clicks (not required by isValidSavePayload).
      managerPaused,
      // Manager levels (PR 5, additive) — level scales auto-buy quantity in
      // autoBuyManagers (1 / 5 / max per tick). Preserved by ordinary prestige.
      managerLevels: this.freshManagerLevels(),
      // Second prestige layer (PR 6, SAVE_VER 10) — Renown meta-currency,
      // earned only by selling the franchise (REPLAY_ROADMAP.md §8). Never
      // wipes; brand is the Brand-perk rank map (PR 7 spends Renown there).
      renown: 0, renownTotal: 0, brand: {},
      // Brand Endorsement level (next-roadmap PR 1) — the repeatable Renown
      // sink: +2% all cash per level, cost escalates 15 × 1.35^level. Additive;
      // persists through every reset like brand ranks.
      brandLevel: 0
    };
    this.applyStartPerks(g);
    return g;
  }

  // Fresh per-club run state (SECOND_LOCATION.md §4): local till, local crowd,
  // local build stack, local shift clock. `loc` selects the location's extra
  // building/upgrade ids (REPLAY_ROADMAP.md §9) — shared catalog + extras.
  // fresh() uses it for 'main'; confirmOpenRoom for 'annex'; rooftop later.
  freshClubState(loc = 'main') {
    const b = {}, u = {};
    this.BUILDINGS.forEach(x => b[x.id] = 0);
    this.UPGRADES.forEach(x => u[x.id] = false);
    for (const x of this.locationExtras(loc)) {
      if (x.kind === 'b') b[x.id] = 0;
      else u[x.id] = false;
    }
    return {
      cash: (this.props && this.props.startingCash) ?? 20, hype: 0, buzz: 0, patrons: 0, regulars: 0,
      b, u, elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0,
      _specialShift: null, _whaleCooldown: 0
    };
  }

  // Apply start-of-run perks (seed crew / flyers) after a fresh candidate is built.
  // Flyers build into the ACTIVE club's buildings; crew/jobs are account-level.
  applyStartPerks(g) {
    const c = this.club(g);
    if (this.perk(g, 'startFlyers')) c.b.flyers = 1;
    if (this.perk(g, 'startCrew')) {
      g.crew = 1;
      g.jobs.stage = 1;
    }
    // Loyalty Program brand perk (REPLAY_ROADMAP.md §9): start with regulars.
    const loyal = this.brandRank(g, 'loyalty');
    if (loyal > 0) c.regulars = (c.regulars || 0) + loyal;
  }

  setState(update, cb) {
    const patch = typeof update === 'function' ? update(this.state) : update;
    Object.assign(this.state, patch);
    this.forceUpdate();
    if (cb) cb();
  }

  forceUpdate() {
    if (this.pointerDown) {
      this.needsRender = true;
      return;
    }
    this.render();
  }

  // Escape text before interpolating into root.innerHTML (night log, etc.).
  escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Hex colors only for inline log style — blocks css/js injection via color.
  safeLogColor(c) {
    if (typeof c !== 'string') return '#b9a5c9';
    const s = c.trim();
    if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(s)) return s;
    return '#b9a5c9';
  }

  // Jobs/crew fixups shared by load, migrations, and clipboard import (PLAN §2.1 / §2.2).
  sanitizeG(g) {
    if (!g || typeof g !== 'object') return g;
    // Jobs are catalog-driven (REPLAY_ROADMAP.md §5): initialize/iterate from
    // this.JOBS, never a hardcoded four-id list. A locked job (unlock research
    // not owned) is forced to 0 and its crew evicted to off, so a load/reset
    // that drops the unlock can't leave phantom working crew.
    if (!g.jobs || typeof g.jobs !== 'object' || Array.isArray(g.jobs)) g.jobs = this.freshJobs();
    g.crew = Math.max(0, g.crew | 0);
    // Keep assignment totals honest after old saves / partial migrations.
    for (const id of this.jobIds()) g.jobs[id] = Math.max(0, g.jobs[id] | 0);
    for (const j of this.JOBS) {
      if (j.unlock && !this.jobUnlocked(g, j) && (g.jobs[j.id] || 0) > 0) {
        g.jobs.off = (g.jobs.off || 0) + g.jobs[j.id];
        g.jobs[j.id] = 0;
      }
    }
    let jobSum = 0;
    for (const id of this.jobIds()) jobSum += g.jobs[id] || 0;
    if (jobSum < g.crew) g.jobs.off += g.crew - jobSum;
    else if (jobSum > g.crew) {
      let over = jobSum - g.crew;
      // Evict from off first, then working roles least-valuable-first (prio asc).
      const evictOrder = ['off'].concat(
        this.JOBS.filter(j => j.id !== 'off').sort((a, b) => a.prio - b.prio).map(j => j.id)
      );
      for (const k of evictOrder) {
        const take = Math.min(g.jobs[k] || 0, over);
        g.jobs[k] -= take;
        over -= take;
        if (!over) break;
      }
    }
    // Clubs map (SAVE_VER 9): fail-closed. If missing/malformed, rebuild the
    // main club from leftover top-level fields (pre-v9 saves that skipped the
    // migration, or hand-edited payloads) before normalizing per-club fields.
    if (!g.clubs || typeof g.clubs !== 'object' || Array.isArray(g.clubs)) {
      const main = {};
      const clubFields = ['cash', 'hype', 'buzz', 'patrons', 'regulars', 'b', 'u',
        'elapsed', 'night', 'shiftIdx', 'shiftT', '_specialShift', '_whaleCooldown'];
      for (const k of clubFields) {
        main[k] = g[k];
        delete g[k];
      }
      g.clubs = { main };
    }
    g.activeClub = (typeof g.activeClub === 'string' && Object.prototype.hasOwnProperty.call(g.clubs, g.activeClub)) ? g.activeClub : 'main';
    // Normalize every club's run fields (numbers, maps, fail-closed specials).
    for (const clubId of Object.keys(g.clubs)) {
      const c = g.clubs[clubId];
      if (!c || typeof c !== 'object') { g.clubs[clubId] = this.club(this.fresh()); continue; }
      for (const k of ['cash', 'hype', 'buzz', 'patrons', 'regulars', 'elapsed', 'night', 'shiftT']) {
        if (typeof c[k] !== 'number' || !Number.isFinite(c[k])) c[k] = 0;
        if (k === 'cash' || k === 'hype' || k === 'buzz' || k === 'patrons' || k === 'regulars') c[k] = Math.max(0, c[k]);
      }
      if (c.night < 1) c.night = 1;
      if (!c.b || typeof c.b !== 'object' || Array.isArray(c.b)) c.b = {};
      for (const def of this.BUILDINGS) {
        let n = c.b[def.id];
        if (typeof n !== 'number' || !Number.isFinite(n)) n = 0;
        c.b[def.id] = Math.max(0, Math.floor(n));
      }
      if (!c.u || typeof c.u !== 'object' || Array.isArray(c.u)) c.u = {};
      for (const def of this.UPGRADES) c.u[def.id] = c.u[def.id] === true;
      // Location extras (REPLAY_ROADMAP.md §9): backfill missing ids for
      // existing saves — an uninitialized extra reads undefined, prices as NaN.
      for (const x of this.locationExtras(clubId)) {
        if (x.kind === 'b') {
          let n = c.b[x.id];
          if (typeof n !== 'number' || !Number.isFinite(n)) n = 0;
          c.b[x.id] = Math.max(0, Math.floor(n));
        } else {
          c.u[x.id] = c.u[x.id] === true;
        }
      }
      if (c._specialShift != null && (!Number.isInteger(c._specialShift) || !this.SPECIAL_SHIFTS[c._specialShift])) c._specialShift = null;
      if (typeof c._whaleCooldown !== 'number' || !Number.isFinite(c._whaleCooldown)) c._whaleCooldown = 0;
    }
    // Defense: arrays as perks collapse on JSON round-trip.
    if (!g.perks || typeof g.perks !== 'object' || Array.isArray(g.perks)) g.perks = {};
    for (const def of this.PRESTIGE_PERKS) {
      let r = g.perks[def.id];
      if (typeof r !== 'number' || r < 0) r = 0;
      g.perks[def.id] = Math.min(def.max, Math.floor(r));
    }
    // Managers map: reject arrays/bad shapes; clamp known ids to boolean.
    if (!g.managers || typeof g.managers !== 'object' || Array.isArray(g.managers)) g.managers = {};
    for (const def of this.MANAGERS) {
      g.managers[def.id] = g.managers[def.id] === true;
    }
    if (!g.managerPaused || typeof g.managerPaused !== 'object' || Array.isArray(g.managerPaused)) g.managerPaused = {};
    for (const def of this.MANAGERS) {
      g.managerPaused[def.id] = g.managerPaused[def.id] === true;
    }
    // Manager levels (PR 5): known ids, integer 0–3, fail-closed.
    if (!g.managerLevels || typeof g.managerLevels !== 'object' || Array.isArray(g.managerLevels)) g.managerLevels = {};
    for (const def of this.MANAGERS) {
      const lv = g.managerLevels[def.id];
      g.managerLevels[def.id] = (typeof lv === 'number' && Number.isFinite(lv) && lv >= 0) ? Math.min(3, Math.floor(lv)) : 0;
    }
    // Renown + Brand (PR 6, SAVE_VER 10) — fail-closed: non-numeric Renown → 0
    // (a malformed value would render NaN in the Perks readout and gate math);
    // a non-object brand map → {} (PR 7 normalizes known perk ids).
    if (typeof g.renown !== 'number' || !Number.isFinite(g.renown)) g.renown = 0;
    if (typeof g.renownTotal !== 'number' || !Number.isFinite(g.renownTotal)) g.renownTotal = 0;
    g.renown = Math.max(0, g.renown);
    g.renownTotal = Math.max(0, g.renownTotal);
    if (!g.brand || typeof g.brand !== 'object' || Array.isArray(g.brand)) g.brand = {};
    // 0.10.2 golden offer: fail-closed to null unless a plain object with a
    // finite at. A malformed at would make the TTL expiry check NaN >= … → never
    // auto-expire; import/load normalizes instead of leaving a stuck offer.
    if (!g.golden || typeof g.golden !== 'object' || Array.isArray(g.golden) || !Number.isFinite(g.golden.at)) g.golden = null;
    // Challenge state (PR 4, additive) — fail-closed on unknown ids (old saves
    // or hand-edited payloads start with no active challenge).
    g.challenge = (typeof g.challenge === 'string' && this.CHALLENGES.some(c => c.id === g.challenge)) ? g.challenge : null;
    if (!Array.isArray(g.challengesDone)) g.challengesDone = [];
    g.challengesDone = g.challengesDone.filter(id => typeof id === 'string' && this.CHALLENGES.some(c => c.id === id));
    // Brand perks (PR 7): known ids, integer 0–max, fail-closed. Rebuild so
    // unknown keys are dropped — parity with completeImportedG (an unknown
    // brand id is not a real perk and brandRank would fail closed on it).
    if (!g.brand || typeof g.brand !== 'object' || Array.isArray(g.brand)) g.brand = {};
    const brandNext = Object.create(null);
    for (const def of this.BRAND_PERKS) {
      const r = g.brand[def.id];
      brandNext[def.id] = (typeof r === 'number' && Number.isFinite(r) && r >= 0) ? Math.min(def.max, Math.floor(r)) : 0;
    }
    g.brand = brandNext;
    // Brand Endorsement level (next-roadmap PR 1) — additive repeatable sink:
    // integer ≥ 0, fail-closed (a NaN/fractional level would poison the
    // endorsementCost exponent and the renderVals readout).
    if (typeof g.brandLevel !== 'number' || !Number.isFinite(g.brandLevel) || g.brandLevel < 0) g.brandLevel = 0;
    g.brandLevel = Math.floor(g.brandLevel);
    return g;
  }

  // Apply MIGRATIONS chain from fromVer up to SAVE_VER. Returns false when a step is missing
  // (including future saveVer > SAVE_VER or non-finite fromVer) — caller should wipe.
  migrateFrom(g, fromVer) {
    if (!g || typeof g !== 'object') return false;
    if (typeof fromVer !== 'number' || !Number.isFinite(fromVer)) return false;
    if (fromVer > this.SAVE_VER) return false;
    if (fromVer === this.SAVE_VER) return true;
    if (fromVer < 1) return false;
    for (let v = fromVer; v < this.SAVE_VER; v++) {
      const step = this.MIGRATIONS[v];
      if (typeof step !== 'function') return false;
      step.call(this, g);
    }
    return true;
  }

  // Fail-closed shape check for clipboard restore (PLAN §2.1).
  isValidSavePayload(p) {
    if (!p || typeof p !== 'object') return false;
    if (typeof p.saveVer !== 'number' || !Number.isFinite(p.saveVer)) return false;
    const g = p.g;
    if (!g || typeof g !== 'object') return false;
    // SAVE_VER 9: club-level fields live under g.clubs.<id>; pre-v9 exports carry
    // them at top level. Accept either — migration/sanitize normalize the rest.
    // For v9, read club resources from the ACTIVE club (own-property lookup, so
    // inherited keys can't pass), falling back to main, then any own club —
    // completeImportedG resolves activeClub to an existing entry afterwards.
    // (v8 flat payloads have no clubs map: fall back to top-level g[k].)
    let club = null;
    if (g.clubs && typeof g.clubs === 'object' && !Array.isArray(g.clubs)) {
      if (typeof g.activeClub === 'string' && Object.prototype.hasOwnProperty.call(g.clubs, g.activeClub)) club = g.clubs[g.activeClub];
      else if (Object.prototype.hasOwnProperty.call(g.clubs, 'main')) club = g.clubs.main;
      else {
        const first = Object.keys(g.clubs)[0];
        if (first !== undefined) club = g.clubs[first];
      }
    }
    for (const k of ['cash', 'hype', 'buzz', 'patrons', 'regulars']) {
      const v = (club && club[k]) ?? g[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    }
    for (const k of ['clout', 'crew']) {
      if (typeof g[k] !== 'number' || !Number.isFinite(g[k])) return false;
    }
    if (!g.jobs || typeof g.jobs !== 'object') return false;
    return true;
  }

  // Complete optional fields from a fresh save, while rejecting values that
  // would make rates(), simulation, or rendering unsafe. This runs on the
  // parsed candidate before state.g is replaced, so a bad import cannot poison
  // either the current session or localStorage.
  // opts.requireGoals: true for already-current SAVE_VER payloads (fail closed on
  // missing/malformed goals/clicks/rounds). false after migration, which supplies them.
  completeImportedG(g, opts = {}) {
    const requireGoals = !!opts.requireGoals;
    const defaults = this.fresh();
    // Account-level numerics. Club-level run fields (cash/hype/buzz/patrons/
    // regulars/elapsed/night/shiftIdx/shiftT) validate per club below.
    const numeric = ['clout', 'crew', 'ts', 'legacy', 'legacyTotal', 'prestiges', 'renown', 'renownTotal'];
    for (const k of numeric) {
      if (g[k] === undefined) g[k] = defaults[k];
      if (typeof g[k] !== 'number' || !Number.isFinite(g[k])) return false;
    }
    // Clubs map (SAVE_VER 9): require a plain object with at least one club.
    // Normalize every club's run fields so a hand-edited club can't break the sim.
    // Lenient-shape repair: a saveVer-9 envelope carrying a pre-v9 FLAT body (no
    // clubs map) is rebuilt into clubs.main from the top-level club fields before
    // validation — same recovery sanitizeG performs, so v8-style payloads keep
    // importing regardless of envelope version.
    if (!g.clubs || typeof g.clubs !== 'object' || Array.isArray(g.clubs)) {
      if (typeof g.cash !== 'number') return false;
      const main = {};
      for (const k of ['cash', 'hype', 'buzz', 'patrons', 'regulars', 'elapsed', 'night', 'shiftIdx', 'shiftT', '_specialShift', '_whaleCooldown']) {
        if (g[k] !== undefined) main[k] = g[k];
        delete g[k];
      }
      main.b = g.b; delete g.b;
      main.u = g.u; delete g.u;
      // Backfill fields the flat body omitted (shiftIdx/shiftT/night/b/u...) from
      // fresh defaults so a minimal payload still simulates safely.
      for (const k of Object.keys(defaults.clubs.main)) {
        if (main[k] === undefined) main[k] = defaults.clubs.main[k];
      }
      g.clubs = { main };
    } else {
      // A v9 body must not ALSO carry flat leftovers — hybrid shapes are malformed
      // (fail closed) rather than silently preferring one level.
      const stray = ['cash', 'hype', 'buzz', 'patrons', 'regulars', 'b', 'u',
        'elapsed', 'night', 'shiftIdx', 'shiftT', '_specialShift', '_whaleCooldown']
        .filter(k => g[k] !== undefined);
      if (stray.length) return false;
      // A v9 body with an EMPTY clubs map performs zero validations and then
      // makes club(g) fall back to the account object (missing c.b) — abort
      // startup instead of crashing in the first caps()/render.
      if (!Object.keys(g.clubs).length) return false;
    }
    // Resolve activeClub to an EXISTING own club entry. Normalizing a map that
    // lacks 'main' (e.g. clubs: { annex: {...} }) to 'main' would pass validation
    // and then make club(g) fall back to the account object (missing c.b) — pick
    // the first own club instead; the map is guaranteed nonempty here.
    g.activeClub = (typeof g.activeClub === 'string' && Object.prototype.hasOwnProperty.call(g.clubs, g.activeClub))
      ? g.activeClub
      : Object.keys(g.clubs)[0];
    for (const clubId of Object.keys(g.clubs)) {
      // Reject club IDs that collide with Object.prototype members ('__proto__',
      // 'constructor', 'toString', ...) — writing such a key on a plain-object
      // map invokes inherited setters or poisons lookups instead of creating an
      // own entry, silently dropping the club on prestige. Fail closed.
      if (Object.prototype.hasOwnProperty.call(Object.prototype, clubId)) return false;
      // Club IDs render into header buttons (label + title) — restrict to a
      // safe identifier shape so imported saves cannot smuggle markup through
      // innerHTML (XSS via a crafted id like '<img onerror=...>').
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,24}$/.test(clubId)) return false;
      const c = g.clubs[clubId];
      if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
      for (const k of ['cash', 'hype', 'buzz', 'patrons', 'regulars', 'elapsed', 'night', 'shiftT']) {
        if (c[k] === undefined) c[k] = defaults.clubs.main[k];
        if (typeof c[k] !== 'number' || !Number.isFinite(c[k])) return false;
      }
      if (c.cash < 0 || c.hype < 0 || c.buzz < 0 || c.patrons < 0 || c.regulars < 0) return false;
      if (!Number.isInteger(c.shiftIdx) || !this.SHIFTS[c.shiftIdx]) return false;
      // A special shift may be longer than the base shift it overrides (e.g. Slow
      // Tuesday len 40 over Last Call len 35). Validate shiftT against the ACTIVE
      // shift's length (the special if one is set, else the base), so a legitimate
      // in-progress special past the base length isn't rejected and wiped. Also drop
      // any _specialShift that isn't a valid SPECIAL_SHIFTS index (fail-closed).
      if (Number.isInteger(c._specialShift) && this.SPECIAL_SHIFTS[c._specialShift]) {
        if (c.shiftT < 0 || c.shiftT >= this.SPECIAL_SHIFTS[c._specialShift].len) return false;
      } else {
        c._specialShift = null;
        if (c.shiftT < 0 || c.shiftT >= this.SHIFTS[c.shiftIdx].len) return false;
      }
      if (c.elapsed < 0 || c.night < 1) return false;

      // Rebuild from known IDs only — unknown keys (e.g. string-valued XSS bait under
      // c.b) must not survive into Object.values(c.b) / Structures or other paths.
      // Location extras (REPLAY_ROADMAP.md §9) join the catalog per club id.
      for (const [key, defs, fallback] of [
        ['b', this.BUILDINGS.concat(this.extraBuildings(clubId)), 0],
        ['u', this.UPGRADES.concat(this.extraUpgrades(clubId)), false]
      ]) {
        if (c[key] === undefined) c[key] = {};
        if (!c[key] || typeof c[key] !== 'object' || Array.isArray(c[key])) return false;
        const next = Object.create(null);
        for (const def of defs) {
          let value = c[key][def.id];
          if (value === undefined) value = fallback;
          if (key === 'b') {
            if (!Number.isInteger(value) || value < 0) return false;
          } else if (typeof value !== 'boolean') return false;
          next[def.id] = value;
        }
        c[key] = next;
      }
      if (typeof c._whaleCooldown !== 'number' || !Number.isFinite(c._whaleCooldown)) c._whaleCooldown = 0;
    }

    // Research stays account-level (shared tree across clubs).
    {
      const key = 'r', defs = this.RESEARCH, fallback = false;
      if (g[key] === undefined) g[key] = {};
      if (!g[key] || typeof g[key] !== 'object' || Array.isArray(g[key])) return false;
      const next = Object.create(null);
      for (const def of defs) {
        let value = g[key][def.id];
        if (value === undefined) value = fallback;
        if (typeof value !== 'boolean') return false;
        next[def.id] = value;
      }
      g[key] = next;
    }

    if (!g.jobs || typeof g.jobs !== 'object' || Array.isArray(g.jobs)) return false;
    const jobsNext = Object.create(null);
    for (const id of this.jobIds()) {
      let value = g.jobs[id];
      if (value === undefined) value = 0;
      if (!Number.isFinite(value) || value < 0) return false;
      jobsNext[id] = value;
    }
    g.jobs = jobsNext;

    // Prestige perks map — reject arrays (string-keyed ranks vanish on JSON round-trip).
    if (!g.perks || typeof g.perks !== 'object' || Array.isArray(g.perks)) g.perks = {};
    const perksNext = Object.create(null);
    for (const def of this.PRESTIGE_PERKS) {
      let value = g.perks[def.id];
      if (value === undefined) value = 0;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) value = 0;
      perksNext[def.id] = Math.min(def.max, Math.floor(value));
    }
    g.perks = perksNext;

    // Managers map (SAVE_VER 8) — known ids, boolean values.
    if (!g.managers || typeof g.managers !== 'object' || Array.isArray(g.managers)) g.managers = {};
    const managersNext = Object.create(null);
    for (const def of this.MANAGERS) {
      managersNext[def.id] = g.managers[def.id] === true;
    }
    g.managers = managersNext;

    // Manager pause state — additive field, defaults false for known ids.
    if (!g.managerPaused || typeof g.managerPaused !== 'object' || Array.isArray(g.managerPaused)) g.managerPaused = {};
    const managerPausedNext = Object.create(null);
    for (const def of this.MANAGERS) {
      managerPausedNext[def.id] = g.managerPaused[def.id] === true;
    }
    g.managerPaused = managerPausedNext;

    // Manager levels (PR 5) — additive, known ids, integer 0–3, fail-closed.
    if (!g.managerLevels || typeof g.managerLevels !== 'object' || Array.isArray(g.managerLevels)) g.managerLevels = {};
    const managerLevelsNext = Object.create(null);
    for (const def of this.MANAGERS) {
      const lv = g.managerLevels[def.id];
      managerLevelsNext[def.id] = (typeof lv === 'number' && Number.isFinite(lv) && lv >= 0) ? Math.min(3, Math.floor(lv)) : 0;
    }
    g.managerLevels = managerLevelsNext;

    // Brand map (PR 6, SAVE_VER 10) — plain-object default; PR 7 normalizes
    // known Brand-perk ids. Lenient fill (not reject): an absent/malformed
    // brand is a fresh account, same as the migration default.
    if (!g.brand || typeof g.brand !== 'object' || Array.isArray(g.brand)) g.brand = {};

    // Challenge state (PR 4, additive) — fail-closed on unknown ids.
    g.challenge = (typeof g.challenge === 'string' && this.CHALLENGES.some(c => c.id === g.challenge)) ? g.challenge : null;
    if (!Array.isArray(g.challengesDone)) g.challengesDone = [];
    g.challengesDone = g.challengesDone.filter(id => typeof id === 'string' && this.CHALLENGES.some(c => c.id === id));

    // Brand perks (PR 7) — known ids, integer 0–max, fail-closed.
    if (!g.brand || typeof g.brand !== 'object' || Array.isArray(g.brand)) g.brand = {};
    const brandNext = Object.create(null);
    for (const def of this.BRAND_PERKS) {
      const r = g.brand[def.id];
      brandNext[def.id] = (typeof r === 'number' && Number.isFinite(r) && r >= 0) ? Math.min(def.max, Math.floor(r)) : 0;
    }
    g.brand = brandNext;

    // Brand Endorsement level (next-roadmap PR 1) — parity with sanitizeG:
    // integer ≥ 0, fail-closed.
    if (typeof g.brandLevel !== 'number' || !Number.isFinite(g.brandLevel) || g.brandLevel < 0) g.brandLevel = 0;
    g.brandLevel = Math.floor(g.brandLevel);

    if (!Array.isArray(g.log)) g.log = [];
    // Keep raw validated t/msg (length-capped) so export→import is idempotent.
    // Escape only at the render() innerHTML boundary; restrict color to hex.
    g.log = g.log.filter(x => x && typeof x === 'object' &&
      typeof x.t === 'string' && typeof x.msg === 'string').slice(0, 40).map(x => ({
      t: x.t.slice(0, 32),
      msg: x.msg.slice(0, 500),
      color: this.safeLogColor(x.color)
    }));

    // Owner's List fields (SAVE_VER 5). Not in isValidSavePayload (v4 lacks them).
    const knownGoalIds = new Set(this.GOALS.map(x => x.id));
    if (requireGoals) {
      // Current-format payload: require sane goals / clicks / rounds (no soft-reset re-pay).
      if (!Array.isArray(g.goals)) return false;
      const seen = new Set();
      for (const id of g.goals) {
        if (typeof id !== 'string' || !knownGoalIds.has(id) || seen.has(id)) return false;
        seen.add(id);
      }
      if (typeof g.clicks !== 'number' || !Number.isFinite(g.clicks) || g.clicks < 0) return false;
      if (typeof g.rounds !== 'number' || !Number.isFinite(g.rounds) || g.rounds < 0) return false;
    } else {
      // Post-migration / incomplete: fill defaults; keep only known unique ids.
      if (!Array.isArray(g.goals)) g.goals = defaults.goals.slice();
      else {
        const seen = new Set();
        g.goals = g.goals.filter(id => {
          if (typeof id !== 'string' || !knownGoalIds.has(id) || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      }
      if (typeof g.clicks !== 'number' || !Number.isFinite(g.clicks) || g.clicks < 0) g.clicks = 0;
      if (typeof g.rounds !== 'number' || !Number.isFinite(g.rounds) || g.rounds < 0) g.rounds = 0;
    }

    // Achievements field (new in this version) — filter to known ids.
    const knownAchievementIds = new Set(this.ACHIEVEMENTS.map(x => x.id));
    if (!Array.isArray(g.achievements)) g.achievements = [];
    else {
      g.achievements = g.achievements.filter(id => {
        if (typeof id !== 'string' || !knownAchievementIds.has(id)) return false;
        return true;
      });
    }

    this.sanitizeG(g);
    return true;
  }

  // Parse + validate + migrate + sanitize a save blob. On success persists then replaces state.g.
  // On any failure (including setItem throw): saveState 'import failed', current club unchanged.
  // Ownership (tabStale clear + autosave restart) only after a successful disk write.
  importSaveFromText(text) {
    try {
      const p = JSON.parse(text);
      if (!this.isValidSavePayload(p)) {
        this.setState({ saveState: 'import failed' });
        return false;
      }
      const g = p.g;
      let migrated = false;
      if (p.saveVer !== this.SAVE_VER) {
        if (!this.migrateFrom(g, p.saveVer)) {
          this.setState({ saveState: 'import failed' });
          return false;
        }
        migrated = true;
      }
      // Current SAVE_VER requires goals/clicks/rounds; post-migration supplies them.
      if (!this.completeImportedG(g, { requireGoals: !migrated })) {
        this.setState({ saveState: 'import failed' });
        return false;
      }
      // Stamp now so the next tick does not treat export age as offline progress.
      g.ts = Date.now();
      // Source-neutral: file and clipboard both use this path (PLAN-NEXT §A).
      // Log on the candidate g before write so disk and memory share the restore line.
      this.push(g, 'Save restored.', '#22d3ee');
      try {
        localStorage.setItem(this.KEY, JSON.stringify({
          saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g, lastAutoSave: this.state.lastAutoSave
        }));
      } catch (e) {
        // Persist failed: leave live club, tabStale, and autosave ownership untouched.
        this.setState({ saveState: 'import failed' });
        return false;
      }
      // Disk write succeeded — only now replace live state and take ownership.
      if (this._probeTimer) {
        clearTimeout(this._probeTimer);
        this._probeTimer = null;
      }
      this._onStrike = false;
      this.state.g = this.wrapState(g);
      // Successful persist is an explicit ownership take (import path):
      // a non-claiming second tab must start autosave and mark owner so later
      // progress is not lost after pausing siblings via the storage event.
      this.state.tabStale = false;
      this.markTabOwner();
      this.startAutosave();
      // Imported g may not have the current tab's unlock (Upgrades/Research/Perks
      // gate on buildings/clout/prestiges) — fall back to Club like doPrestige.
      this.setState({ tabStale: false, saveState: 'imported', tab: 'club' });
      return true;
    } catch (e) {
      this.setState({ saveState: 'import failed' });
      return false;
    }
  }

  init() {
    let g = null, wiped = false, upgraded = false, prevVer = null, fromSaveVer = null, lastAutoSave = null;
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        const p = JSON.parse(raw);
        prevVer = p.ver || null;
        fromSaveVer = p.saveVer;
        if (typeof p.lastAutoSave === 'number') lastAutoSave = p.lastAutoSave;
        if (p.saveVer === this.SAVE_VER && p.g && typeof p.g === 'object') {
          g = p.g;
        } else if (p.g && typeof p.g === 'object' && typeof p.saveVer === 'number' && p.saveVer < this.SAVE_VER) {
          // Upgrade path: apply MIGRATIONS chain; wipe only if a step is missing.
          if (this.migrateFrom(p.g, p.saveVer)) {
            g = p.g;
            upgraded = true;
          } else {
            wiped = true;
          }
        } else {
          // Future saveVer, missing g, or non-numeric version — no path.
          wiped = true;
        }
      }
    } catch (e) { wiped = true; }
    // Recover safely from a previously persisted malformed clipboard import.
    // Current SAVE_VER requires goals fields; post-migration fills them.
    // Missing/malformed current-format goal state wipes rather than soft-reset re-pay.
    if (g && !this.completeImportedG(g, { requireGoals: !upgraded })) {
      g = null;
      wiped = true;
    }
    // Offline catch-up only for a successfully loaded save — not a brand-new / wiped club
    // (fresh() stamps ts:now; a few ms later would otherwise apply a spurious offline slice).
    const resumeExisting = !!g;
    if (!g) g = this.fresh();
    this.sanitizeG(g);
    g.log = [];

    // Clamp: future ts (clock skew / corrupt save) must not yield a negative gap
    // that freezes the live timer until wall time catches up.
    const nowMs = Date.now();
    const futureTs = !!(resumeExisting && g.ts && g.ts > nowMs);
    const offline = (resumeExisting && g.ts && !futureTs)
      ? Math.min(Math.max(0, (nowMs - g.ts) / 1000), 28800)
      : 0;
    this.state.g = this.wrapState(g);
    this.state.lastAutoSave = wiped ? undefined : (lastAutoSave ?? undefined);
    this.push(g, 'Doors open. ' + this.VERSION.codename + ' build ' + this.VERSION.build + '.', '#22d3ee');
    if (wiped) this.push(g, 'Save format changed — previous save reset.', '#ff2d78');
    else if (upgraded) {
      this.push(g, 'Save migrated from format v' + fromSaveVer + ' → v' + this.SAVE_VER + '.', '#ffc94a');
      if (fromSaveVer < 5) this.push(g, "Owner's list updated.", '#ffc94a');
    }
    if (prevVer && prevVer !== this.VERSION.num) this.push(g, 'Updated ' + prevVer + ' → ' + this.VERSION.num + '.', '#ffc94a');

    // Claim the offline window on disk BEFORE catch-up. Order matters:
    // catchUp then failed setItem left the prior blob (old ts) on disk; reload
    // re-migrated and re-applied the same gap (elapsed-time double-count).
    // Claim first: persist + refresh ts. Only then apply catch-up. If claim fails,
    // skip catch-up and surface save failed — memory may still run, but a reload
    // re-reads the prior blob once (no silent progress that cannot be written).
    // If claim succeeds and the post-catchUp write fails, disk already has the
    // claimed ts so reload cannot re-apply the gap (offline may be lost once).
    //
    // Do NOT claim unconditionally: a second tab that setItem's the last on-disk
    // snapshot with a refreshed ts fires storage → onForeignSave on a live
    // sibling, stealing ownership and discarding up to one autosave interval of
    // progress. Under a live tab, disk ts lags by at most ~10s (autosave).
    // Claim when this tab must take ownership: fresh/wiped club, migration,
    // same-tab reload (RELOAD_KEY set on pagehide), future/corrupt ts, or a
    // large offline gap with no live foreign lease (age alone is not proof).
    //
    // Short multi-tab / non-owner open (offline ≤15s, no reload intent): do not
    // setItem (avoids stealing). Still apply the preserved gap via catchUp in
    // memory and advance g.ts so the live timer cannot full-rate step pre-load
    // time or award live-only Peak for it. Disk stays untouched until this tab
    // explicitly acquires ownership (claim path, reload takeover, or import).
    const CLAIM_OFFLINE_SEC = 15;
    let wasOwner = false;
    try {
      // Same-tab F5: pagehide wrote RELOAD_KEY. Tab-duplicate of a live owner
      // copies OWNER_KEY but not RELOAD_KEY (pagehide never ran) → wasOwner false.
      if (sessionStorage.getItem(this.RELOAD_KEY)) {
        wasOwner = true;
        sessionStorage.removeItem(this.RELOAD_KEY);
        // Drop the previous page instance's owner token; we re-mark after claim.
        sessionStorage.removeItem(this.OWNER_KEY);
      }
    } catch (e) { /* private mode */ }
    // Hard claims always proceed. Age-only claim is gated by cross-tab lease:
    // a background-throttled owner may lag autosave past 15s while still live.
    // When age-claim would run, write PROBE_KEY and wait PROBE_WAIT_MS before
    // deciding — an immediate lease re-read races the owner's async storage handler.
    const hardClaim = !resumeExisting || upgraded || wasOwner || futureTs;
    const ageClaimCandidate = resumeExisting && !hardClaim && offline > CLAIM_OFFLINE_SEC;
    let ageClaimDeferred = false;
    if (ageClaimCandidate) {
      // Handshake: announce probe so a live owner refreshes LEASE_KEY via storage.
      try {
        localStorage.setItem(this.PROBE_KEY, JSON.stringify({
          token: this.tabToken, at: Date.now()
        }));
      } catch (e) { /* private / quota */ }
      if (this.hasLiveForeignLease()) {
        // Already a live peer — do not claim.
      } else {
        // Lease absent/stale: owner may still respond to the probe. Defer claim.
        ageClaimDeferred = true;
      }
    }
    const needsClaim = hardClaim;
    let claimed = false;
    if (needsClaim) {
      g.ts = Date.now();
      try {
        localStorage.setItem(this.KEY, JSON.stringify({
          saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g
        }));
        claimed = true;
        this.markTabOwner();
      } catch (e) {
        this.setState({ saveState: 'save failed' });
      }
      // `offline > 0` reads like it could skip the achievement backfill below, but it
      // cannot for a player: `offline` is a float from (nowMs - g.ts)/1000, and any real
      // reload puts at least a millisecond between the saver's last write and this read.
      // A zero gap needs Date.now() to return the same value twice — which is a frozen
      // test clock, not a browser. Even then it self-heals: step() runs checkAchievements
      // every slice, and the live timer starts ~100ms later. The remaining false cases
      // (no g.ts, future g.ts, non-owner tab) are all deliberate and documented above.
      // Verified rather than assumed; see .github/pr/49.
      if (offline > 0 && claimed) {
        const report = this.catchUp(g, offline);
        if (offline > 60) this.push(g, this.awayMsg(offline, report), '#ffc94a');
        // Offline: peak (goal 12) must not complete here — live-only.
        this.noteGoals(g, { live: false });
        this.checkAchievements(g);
        try {
          localStorage.setItem(this.KEY, JSON.stringify({
            saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g
          }));
          this.refreshLease();
        } catch (e) {
          this.setState({ saveState: 'save failed' });
        }
      }
    } else if (offline > 0) {
      // Non-claiming path: offline catch-up in memory only (no setItem / no steal).
      // Includes: short multi-tab open, ageClaim blocked by live lease, and deferred probe.
      const report = this.catchUp(g, offline);
      if (offline > 60) this.push(g, this.awayMsg(offline, report), '#ffc94a');
      this.noteGoals(g, { live: false });
      this.checkAchievements(g);
      g.ts = Date.now();
    }

    this.timer = setInterval(() => {
      const g = this.state.g; if (!g) return;
      // Non-owner / foreign-tab pause: do not advance the sim (progress would be lost).
      if (this.state.tabStale || !this.isTabOwner()) return;
      // Keep cross-tab lease fresh so age-only claimers see a live peer.
      this.refreshLeaseThrottled();
      const now = Date.now();
      const dt = Math.max(0, (now - (g.ts || now)) / 1000);
      // Skip sub-50ms ticks; leave g.ts untouched so elapsed time accrues to the next tick.
      // (Previously floored dt to 0.1, which ran the sim faster than real time.)
      if (dt < 0.05) return;
      // Large gaps (tab hidden / suspended) use catchUp at 50% rate — same path as load-time offline.
      if (dt > 2) {
        const gap = Math.min(dt, 28800);
        const report = this.catchUp(g, gap);
        if (dt > 60) this.push(g, this.awayMsg(gap, report), '#ffc94a');
        // Large-gap catchUp is offline rate — peak stays live-only.
        this.noteGoals(g, { live: false });
        this.checkAchievements(g);
        g.ts = Date.now();
        this.setState(s => ({ tick: s.tick + 1 }));
      } else {
        this.liveStep(g, Math.min(dt, 28800));
      }
    }, 100);
    // Autosave only for the owning tab. A non-claiming second/duplicated tab
    // must not start the 10s timer — the first auto write would setItem a stale
    // snapshot, fire storage → onForeignSave on the live sibling, and pause it.
    // Non-owners are also read-only (tabStale) until reload takeover or import.
    if (ageClaimDeferred) {
      this.state.tabStale = true;
      this.state.saveState = 'checking ownership…';
      if (this._probeTimer) clearTimeout(this._probeTimer);
      this._probeTimer = setTimeout(() => this.finishAgeClaim(), this.PROBE_WAIT_MS);
    } else if (this.isTabOwner()) {
      this.startAutosave();
    } else if (!needsClaim) {
      // Short multi-tab open or live foreign lease: visibly read-only.
      // Do not overwrite saveState when a hard claim attempted and setItem failed.
      this.state.tabStale = true;
      this.state.saveState = 'paused (other tab)';
    }
    // needsClaim && !owner: claim setItem failed — keep 'save failed', no fake peer-pause.
    // storage only fires in *other* tabs — stop autosave so we don't clobber their write (PLAN §2.3).
    // Bind once: init() may re-run in tests; page boot calls it a single time.
    if (!this._storageBound) {
      this._storageBound = true;
      window.addEventListener('storage', (e) => {
        if (e.key === this.KEY) {
          this.onForeignSave();
          return;
        }
        // Lease handshake: a peer probing to age-claim — refresh so they see us live.
        if (e.key === this.PROBE_KEY && e.newValue && this.isTabOwner()) {
          this.refreshLease();
        }
      });
    }
    this.forceUpdate();
  }

  // After PROBE_WAIT_MS: claim only if no live foreign lease appeared (owner refreshed).
  // Offline catch-up already ran in memory on the deferred path; this persists it.
  finishAgeClaim() {
    this._probeTimer = null;
    if (this.isTabOwner()) return;
    if (this.hasLiveForeignLease()) {
      this.state.tabStale = true;
      this.setState({ tabStale: true, saveState: 'paused (other tab)' });
      return;
    }
    const g = this.state.g;
    if (!g) return;
    try {
      g.ts = Date.now();
      localStorage.setItem(this.KEY, JSON.stringify({
        saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g
      }));
      this.markTabOwner();
      this.state.tabStale = false;
      this.startAutosave();
      this.setState({ tabStale: false, saveState: 'claimed' });
    } catch (e) {
      this.state.tabStale = true;
      this.setState({ tabStale: true, saveState: 'save failed' });
    }
  }

  // Another tab wrote/removed KEY. Freeze autosave + sim; banner offers reload to adopt their save.
  onForeignSave() {
    if (this._probeTimer) {
      clearTimeout(this._probeTimer);
      this._probeTimer = null;
    }
    if (this.state.tabStale && !this.isTabOwner()) {
      // Already non-owner paused; still ensure autosave is off and owner cleared.
      if (this.saver) { clearInterval(this.saver); this.saver = null; }
      this.clearTabOwner();
      this.setState({ tabStale: true, saveState: 'paused (other tab)' });
      return;
    }
    if (this.saver) {
      clearInterval(this.saver);
      this.saver = null;
    }
    this.clearTabOwner();
    this.setState({ tabStale: true, saveState: 'paused (other tab)' });
  }

  isTabOwner() {
    return !!this._ownsSave;
  }

  markTabOwner() {
    this._ownsSave = true;
    try { sessionStorage.setItem(this.OWNER_KEY, this.tabToken); } catch (e) { /* private mode */ }
    this.refreshLease();
    this.ensureOwnerLifecycle();
  }

  clearTabOwner() {
    this._ownsSave = false;
    try {
      sessionStorage.removeItem(this.OWNER_KEY);
      sessionStorage.removeItem(this.RELOAD_KEY);
    } catch (e) { /* private mode */ }
    // Drop our lease so age-claimers can take over; leave a foreign lease alone.
    try {
      const raw = localStorage.getItem(this.LEASE_KEY);
      if (raw) {
        const lease = JSON.parse(raw);
        if (lease && lease.token === this.tabToken) localStorage.removeItem(this.LEASE_KEY);
      }
    } catch (e) { /* private / corrupt */ }
  }

  // Publish / refresh this tab's cross-tab lease. Call when ownership is taken
  // or reaffirmed (save, timer). Age-only claimers treat a fresh foreign lease
  // as proof a live peer still owns the save.
  refreshLease() {
    if (!this._ownsSave) return;
    try {
      localStorage.setItem(this.LEASE_KEY, JSON.stringify({
        token: this.tabToken, at: Date.now()
      }));
      this._leaseAt = Date.now();
    } catch (e) { /* private / quota */ }
  }

  refreshLeaseThrottled() {
    if (!this._ownsSave) return;
    if (this._leaseAt && (Date.now() - this._leaseAt) < this.LEASE_REFRESH_MS) return;
    this.refreshLease();
  }

  // True when another tab's lease is still within LEASE_TTL_MS (live peer).
  hasLiveForeignLease() {
    try {
      const raw = localStorage.getItem(this.LEASE_KEY);
      if (!raw) return false;
      const lease = JSON.parse(raw);
      if (!lease || typeof lease.token !== 'string' || typeof lease.at !== 'number') return false;
      if (lease.token === this.tabToken) return false;
      if (!Number.isFinite(lease.at)) return false;
      return (Date.now() - lease.at) < this.LEASE_TTL_MS;
    } catch (e) {
      return false;
    }
  }

  // Start the 10s autosave interval once. No-op if already running.
  startAutosave() {
    if (this.saver) return;
    this.saver = setInterval(() => this.save('auto'), 10000);
  }

  // pagehide fires on F5 / navigation / close / BFCache freeze. Write reload
  // intent only if this page context still owns — a live tab that is merely
  // duplicated never runs pagehide, so the duplicate does not inherit wasOwner.
  // pageshow clears RELOAD_KEY on resume (incl. BFCache) so a restored live
  // page does not leave a stealable marker for a later tab-duplicate.
  ensureOwnerLifecycle() {
    if (this._ownerLifecycleBound) return;
    this._ownerLifecycleBound = true;
    if (typeof window === 'undefined' || !window.addEventListener) return;
    window.addEventListener('pagehide', () => {
      try {
        if (sessionStorage.getItem(this.OWNER_KEY) === this.tabToken) {
          sessionStorage.setItem(this.RELOAD_KEY, this.tabToken);
        }
      } catch (e) { /* private mode */ }
    });
    window.addEventListener('pageshow', () => {
      // Normal load: init already consumed RELOAD_KEY. BFCache restore: init does
      // not re-run, so clear the pagehide marker left when we entered the cache.
      try { sessionStorage.removeItem(this.RELOAD_KEY); } catch (e) { /* private mode */ }
    });
  }

  push(g, msg, color) {
    const d = new Date();
    const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    g.log.unshift({ t, msg, color: this.safeLogColor(color || '#b9a5c9') });
    if (g.log.length > 40) g.log.pop();
  }

  fmt(n) {
    if (n === undefined || n === null || isNaN(n)) return '0';
    const a = Math.abs(n);
    if (a >= 1e33) return (n / 1e33).toFixed(2) + 'Dc';
    if (a >= 1e30) return (n / 1e30).toFixed(2) + 'No';
    if (a >= 1e27) return (n / 1e27).toFixed(2) + 'Oc';
    if (a >= 1e24) return (n / 1e24).toFixed(2) + 'Sp';
    if (a >= 1e21) return (n / 1e21).toFixed(2) + 'Sx';
    if (a >= 1e18) return (n / 1e18).toFixed(2) + 'Qi';
    if (a >= 1e15) return (n / 1e15).toFixed(2) + 'Qa';
    if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    if (a >= 100) return Math.floor(n).toString();
    if (a >= 10) return n.toFixed(1);
    return n.toFixed(2);
  }

  // --- economy (caps, rates) ---
  caps(g, cl) {
    const c = cl || this.club(g);
    return {
      patrons: 10 + c.b.bar * 5 + (c.u.coat ? 20 : 0) + c.b.vip * 4
        + (c.b.pool || 0) * 6 + (c.b.roofbar || 0) * 8 + (c.b.heli || 0) * 12,
      buzz: 50 + c.b.marquee * 35,
      hype: 100 + c.b.dj * 25,
      crew: 2 + c.b.dress * 2
    };
  }

  // Effective shift for the current instance: a triggered special overrides the
  // base SHIFTS[g.shiftIdx] entry (same {name,mult,len,tint} shape) so the render
  // path needs zero changes beyond reading this override. g._specialShift is an
  // index into SPECIAL_SHIFTS (null/undefined = normal shift). Like _whaleCooldown
  // it lives on g and therefore round-trips through disk saves — a save mid-special
  // resumes it correctly via catchUp()/rates(). g.shiftIdx keeps advancing the base
  // 4-shift rotation regardless, so a special never corrupts it. Bad/foreign values
  // fall through to the base shift (fail-closed).
  effectiveShift(g) {
    const c = this.club(g);
    if (c._specialShift != null && Number.isInteger(c._specialShift) && this.SPECIAL_SHIFTS[c._specialShift]) {
      return this.SPECIAL_SHIFTS[c._specialShift];
    }
    return this.SHIFTS[c.shiftIdx];
  }

  // Weighted pick from SPECIAL_SHIFTS using each entry's `weight` (default 1).
  // g is currently unused but kept for signature consistency with the other
  // shift methods, and so future weighting can vary by state (e.g. night/regulars).
  pickSpecialShift(g) {
    const table = this.SPECIAL_SHIFTS;
    let total = 0;
    for (const s of table) total += (s.weight || 1);
    let roll = Math.random() * total;
    for (let i = 0; i < table.length; i++) {
      roll -= (table[i].weight || 1);
      if (roll < 0) return i;
    }
    return table.length - 1;
  }

  // Advance to the next base shift at a shift boundary. Shared by live step() and
  // offline catchUp() so the special-shift trigger follows one code path. Handles
  // the night increment and the special-shift trigger:
  // - A special that just ended is cleared and never re-rolls → no two in a row.
  // - A normal shift that just ended rolls SPECIAL_CHANCE to start a special on the
  //   next instance. g.shiftIdx advances (mod 4) in both cases, so the base 4-shift
  //   rotation resumes exactly where it would have been without the special.
  advanceShift(g) {
    const c = this.club(g);
    const specialJustEnded = c._specialShift != null;
    c.shiftT = 0;
    c.shiftIdx = (c.shiftIdx + 1) % 4;
    if (c.shiftIdx === 0) c.night++;
    c._specialShift = null;
    // 0.10.19: the special roll is live-only like the critic/golden/whale rolls —
    // without this, the pacing bot and offline catchUp (which drive step() with
    // _live = false) rolled special shifts and made pacing.mjs seed-dependent.
    // Gating here keeps offline away-time on the base 4-shift rotation.
    if (!specialJustEnded && this._live && Math.random() < this.SPECIAL_CHANCE) {
      c._specialShift = this.pickSpecialShift(g);
      // 0.10.1: lifetime special-shift counter (drives special_1/special_5).
      g.specialsCount = (g.specialsCount || 0) + 1;
    }
    return this.effectiveShift(g);
  }

  rates(g) {
    const c = this.club(g);
    const cap = this.caps(g);
    const shift = this.effectiveShift(g);
    let sm = shift.mult;
    if (c._specialShift == null && c.shiftIdx === 3 && g.r.latemenu) sm = 0.95;
    const hypeMult = 1 + c.hype / 140;
    // Research tree (REPLAY_ROADMAP.md §5): school boosts all crew output. Brand
    // is folded into totalCashMult — the single all-cash composition point — so
    // it covers passive income AND clicks/whale/golden (see totalCashMult()).
    const crewMult = (c.u.residency ? 1.4 : 1) * (g.r.school ? 1.15 : 1) * (1 + this.challengeBonus(g).crewOut);
    const cashMult = (c.u.twodrink ? 1.35 : 1) * hypeMult * sm * (c.u.skyline ? 1.25 : 1);
    const bottle = c.u.bottle ? 2.2 : 1;

    const railCap = c.b.rail * 6;
    // Non-crew cash: door cover + tip rail + bar + VIP rooms + regulars loop.
    // 0.10.19: the door take scales with the crowd (cover = patrons × 0.02) instead
    // of the old flat 0.08 — a packed floor pays more, an empty room ~nothing, and
    // income never flatlines against patron count. This supersedes PLAN §1.6's
    // "no uncapped patrons×0.012" (that rejected a flat rate ON TOP of the door;
    // here the cover REPLACES the door trickle, so an empty room earns less, not
    // more, and the patron cap bounds the early game). Patron tips still only via
    // rail (PLAN §1.6). House cut prestige perk multiplies all cash income.
    const houseCut = this.totalCashMult(g);
    const coverRate = g.r.cover ? 0.03 : 0.02;
    let nonCrewCash = (c.patrons * coverRate + Math.min(c.patrons, railCap) * 0.06 + c.b.bar * 0.45) * cashMult * houseCut;
    nonCrewCash += c.b.vip * 1.25 * (g.r.concierge ? 1.5 : 1) * bottle * cashMult * houseCut;
    // Location extras (REPLAY_ROADMAP.md §9): per-location cash buildings.
    nonCrewCash += ((c.b.pool || 0) * 0.60 + (c.b.roofbar || 0) * 0.90 + (c.b.heli || 0) * 1.50) * cashMult * houseCut;
    if (g.r.loop) nonCrewCash += c.regulars * 0.04 * cashMult * houseCut;

    let wage = (g.crew - g.jobs.off) * 0.20 * (g.r.payroll ? 0.6 : 1) * (g.r.scheduling ? 0.75 : 1);
    let vipCrewCash = g.jobs.vipjob * 1.35 * crewMult * bottle * cashMult * houseCut;
    let stageHype = g.jobs.stage * 0.24 * crewMult;
    let floorBuzz = g.jobs.floor * 0.035 * crewMult;

    // Strike: crew only work when the club's non-crew revenue covers payroll.
    // Do not use cash > 0 as the recovery condition: strike ticks earn a small
    // door trickle, which otherwise causes alternating strike/production ticks.
    let strike = false;
    if (nonCrewCash < wage) {
      vipCrewCash = 0;
      stageHype = 0;
      floorBuzz = 0;
      wage = 0;
      strike = true;
    }

    const cash = nonCrewCash + vipCrewCash - wage;

    const hypeGain = (c.b.dj * 0.10 + stageHype) * (c.u.led ? 1.3 : 1) * (c.u.vista ? 1.4 : 1);
    const decay = c.hype * 0.014 * Math.max(0.25, 1 - c.b.door * 0.12);
    const hype = hypeGain - decay;

    const buzz = (c.b.marquee * 0.07 + c.b.flyers * 0.025 + floorBuzz) * (c.u.photog ? 1.5 : 1);
    const promoMult = g.r.promo ? 1.6 : 1;
    // Buzz→patron conversion paced for §C (numbers only; walk-in 0.02 stays fixed).
    // Cap scales with cap.buzz (which grows with Marquee Sign), so buying Buzz-cap
    // upgrades legitimately raises the pull ceiling instead of being permanently
    // clamped at the launch-day floor (issue #29).
    const basis = (c.buzz > 0 ? Math.min(c.buzz, cap.buzz * 0.0013) : 0) * promoMult;
    // Walk-in trickle: flat +0.02 patrons/s, unscaled by Hype (PLAN §1.4).
    // Floor Hosts (research-unlocked job) add a flat patron pull each.
    const hostPull = (g.jobs.host || 0) * 0.04 * crewMult;
    const pull = basis * (1 + c.hype / 200) + 0.02 + hostPull;
    const space = Math.max(0, cap.patrons - c.patrons);
    const admitted = Math.min(pull, space);
    const buzzSpent = basis > 0 && pull > 0 ? basis * (admitted / pull) : 0;
    const patrons = admitted - c.patrons * 0.008;
    // Regulars / Clout paced for first-research ~25 min under the §C reference bot.
    const regulars = c.patrons * 0.00045 * (1 + c.b.vip * 0.18) * sm * (g.r.playbook ? 1.25 : 1);
    const clout = c.regulars * 0.0011 * (1 + 0.25 * this.perk(g, 'clout25')) * (g.r.network ? 1.25 : 1);
    return { cash, hype, buzz, patrons, regulars, clout, wage, cap, shift, sm, pull, buzzSpent, strike };
  }

  // Edge-triggered strike log: one line on onset, not per tick.
  noteStrike(g, strike) {
    if (strike && !this._onStrike) {
      this.push(g, 'Crew unpaid — on strike.', '#ff2d78');
    }
    this._onStrike = !!strike;
  }

  // Format load/live away log from catchUp accumulators (PLAN §1.10).
  // Uses gross earned + wages, not cash-floor delta (which collapsed losses to +$0).
  awayMsg(seconds, { earned = 0, wagesPaid = 0, struck = false, managerBought = 0 } = {}) {
    let msg = 'Away ' + Math.round(seconds / 60) + 'm — earned $' + this.fmt(earned) + ', wages −$' + this.fmt(wagesPaid) + '.';
    if (managerBought > 0) msg += ' Managers bought ' + managerBought + ' buildings while you were away.';
    if (struck) msg += ' Crew struck while you were gone.';
    return msg;
  }

  // --- simulation (step, catchUp) ---
  // Offline / large-gap simulation at 50% rate. Wall time advances fully;
  // resource accrual uses dt = wall * 0.5. Silent shift/night rollover.
  // Returns gross cash earned, wages paid, and whether a strike occurred (1.10).
  catchUp(g, seconds) {
    if (!g || !(seconds > 0)) return { earned: 0, wagesPaid: 0, struck: false, managerBought: 0 };
    const c = this.club(g);
    seconds = Math.min(seconds, 28800);
    // 0.10.2: a golden offer that lapsed while away must not render on return.
    this.expireGolden(g);
    let remaining = seconds;
    let earned = 0;
    let wagesPaid = 0;
    let struck = false;
    let managerBought = 0;
    while (remaining > 0) {
      const rates = this.rates(g);
      if (rates.strike) struck = true;
      this.noteStrike(g, rates.strike);
      const cap = rates.cap;
      const left = rates.shift.len - c.shiftT;
      const wall = Math.min(remaining, left, this.OFFLINE_STEP);
      const dt = wall * (this.perk(g, 'offline65') ? 0.65 : 0.5)
        * (1 + 0.10 * this.brandRank(g, 'offline'));
      // rates.cash is net of wage; reconstruct gross for reporting.
      earned += (rates.cash + rates.wage) * dt;
      wagesPaid += rates.wage * dt;
      c.cash = Math.max(0, c.cash + rates.cash * dt);
      c.hype = Math.max(0, Math.min(cap.hype, c.hype + rates.hype * dt));
      c.buzz = Math.max(0, Math.min(cap.buzz, c.buzz + rates.buzz * dt - rates.buzzSpent * dt));
      c.patrons = Math.max(0, Math.min(cap.patrons, c.patrons + rates.patrons * dt));
      c.regulars = Math.max(0, c.regulars + rates.regulars * dt);
      g.clout = Math.max(0, g.clout + rates.clout * dt);
      c.shiftT += wall;
      c.elapsed += wall;
      remaining -= wall;
      if (c.shiftT >= rates.shift.len) {
        // Silent rollover (special-shift trigger uses the same path as live step()).
        this.advanceShift(g);
      }
      // Managers auto-buy buildings (PLAN.md §4.1) — respects strike rule (§1.3).
      managerBought += this.autoBuyManagers(g, { strike: rates.strike });
      // Per-slice goal check: threshold goals (patrons/hype) may peak mid-window
      // then decay before catch-up ends — post-only noteGoals would miss them.
      // live:false keeps peak-hour hero offline-ineligible.
      this.noteGoals(g, { live: false });
      // Per-slice achievement check for stat/night thresholds reached offline.
      this.checkAchievements(g);
    }
    return { earned, wagesPaid, struck, managerBought };
  }

  // Live-tick step with the _live flag held for exactly the duration of the
  // call. try/finally so a thrown error can never leave _live stuck true —
  // it gates the live-only burst events, and pacing determinism depends on it.
  liveStep(g, dt) {
    this._live = true;
    try {
      this.step(dt);
    } finally {
      this._live = false;
    }
  }

  step(dt) {
    const g = this.state.g;
    if (!g) return;
    const c = this.club(g);
    dt *= (this.props.simSpeed ?? 1);
    dt = Math.min(dt, 28800);
    let remaining = dt;
    while (remaining > 0) {
      const r = this.rates(g);
      this.noteStrike(g, r.strike);
      const cap = r.cap;
      const left = r.shift.len - c.shiftT;
      const chunk = Math.min(remaining, left, this.SIM);
      const chatty = remaining <= 0.5;
      c.cash = Math.max(0, c.cash + r.cash * chunk);
      c.hype = Math.max(0, Math.min(cap.hype, c.hype + r.hype * chunk));
      c.buzz = Math.max(0, Math.min(cap.buzz, c.buzz + r.buzz * chunk - r.buzzSpent * chunk));
      c.patrons = Math.max(0, Math.min(cap.patrons, c.patrons + r.patrons * chunk));
      c.regulars += r.regulars * chunk;
      g.clout += r.clout * chunk;
      c.elapsed += chunk;
      c.shiftT += chunk;
      remaining -= chunk;
      // Managers auto-buy buildings (PLAN.md §4.1) — after cash accrues for this slice,
      // respects strike rule (no auto-buy at cash=0 or on strike).
      // Ordered before noteGoals/checkAchievements to match catchUp() slice ordering,
      // so a building-count achievement completed by a manager auto-buy is picked
      // up in the same slice (not lagged to the next tick).
      this.autoBuyManagers(g, { strike: r.strike, log: true });
      // Per-slice goals before shift rollover: a live tick (dt ≤ 2) can finish Peak
      // Hours mid-loop; post-loop noteGoals would see the next shift and miss peak.
      this.noteGoals(g, { live: true });
      // Per-slice achievement check so stat/night thresholds reached mid-window unlock.
      this.checkAchievements(g);
      // Whale event: ~1 per 3 min at base, scales with hype. 0.10.19: the roll is
      // gated behind _live like the other burst events (comment said "live only"
      // but the guard was missing) — without it the pacing bot rolled whales and
      // cash bonuses made pacing.mjs seed-dependent. The cooldown decrement stays
      // ungated (deterministic), so a return to live resumes the window correctly.
      if (!c._whaleCooldown) c._whaleCooldown = 0;
      c._whaleCooldown -= chunk;
      if (this._live && c.hype > 0 && c._whaleCooldown <= 0 && Math.random() < 0.0008 * chunk * (1 + c.hype / 200)) {
        this.spawnWhale(g);
        c._whaleCooldown = 120 + Math.random() * 180; // 2-5 min
      }
      // 0.10.2 burst events — live only (see CRITIC_CHANCE note). Offline catchUp
      // and the pacing bot drive step() with _live = false and stay deterministic.
      if (this._live) {
        this.expireGolden(g);
        this.maybeGolden(g, chunk);
      }
      if (c.shiftT >= r.shift.len) {
        this.advanceShift(g);
        // 0.10.2: a critic may review each new night (live only).
        if (this._live && c.shiftIdx === 0) this.maybeCritic(g);
        if (chatty) {
          const eff = this.effectiveShift(g);
          const isSpecial = c._specialShift != null;
          // Always announce a special even on a night-wrap rollover; otherwise the
          // special would be silently swallowed by the "Night N begins." line.
          if (isSpecial) {
            this.push(g, eff.name + ' — x' + eff.mult.toFixed(2) + ' take.', eff.tint);
          }
          if (c.shiftIdx === 0) this.push(g, 'Night ' + c.night + ' begins.', '#a855f7');
          else if (!isSpecial) {
            const logMult = (c.shiftIdx === 3 && g.r.latemenu) ? 0.95 : eff.mult;
            this.push(g, eff.name + ' — x' + logMult.toFixed(2) + ' take.', eff.tint);
          }
        }
      }
    }
    g.ts = Date.now();
    // 0.10.4 render throttle: increment tick every frame (10 Hz sim),
    // but re-render the DOM at most every 250ms (~4 fps). The non-live
    // catchUp path calls setState directly (always renders). User actions
    // call forceUpdate() in handlers and are never throttled.
    this.state.tick++;
    const now = Date.now();
    if (!this._lastRender || now - this._lastRender >= 250) {
      this._lastRender = now;
      this.forceUpdate();
    }
  }

  // --- Owner's List (PLAN-NEXT §B) ---
  activeGoal(g) {
    if (!g) return null;
    const done = Array.isArray(g.goals) ? g.goals : [];
    return this.GOALS.find(goal => !done.includes(goal.id)) || null;
  }

  // Evaluate the single active goal. opts.live (default true): peak-hour hero only
  // completes when live is true — offline catchUp / load must pass { live: false }.
  // Club-level fields (patrons/hype/regulars/b/shiftIdx) are evaluated through a
  // merged view so goal checks keep their flat-g shape (SECOND_LOCATION.md §6);
  // cash rewards credit the ACTIVE club, clout rewards the account.
  noteGoals(g, opts = {}) {
    if (!g) return;
    const live = opts.live !== false;
    if (!Array.isArray(g.goals)) g.goals = [];
    if (typeof g.clicks !== 'number' || !Number.isFinite(g.clicks)) g.clicks = 0;
    if (typeof g.rounds !== 'number' || !Number.isFinite(g.rounds)) g.rounds = 0;
    const c = this.club(g);
    const view = { ...g, ...c, b: c.b, u: c.u };
    const goal = this.activeGoal(g);
    if (!goal || typeof goal.check !== 'function' || !goal.check(view)) return;
    // Goal 12 (peak): live play only — not offline catch-up or load-time evaluation.
    if (goal.id === 'peak' && !live) return;
    const rew = goal.reward || {};
    if (rew.cash) c.cash = (c.cash || 0) + rew.cash;
    if (rew.clout) g.clout = (g.clout || 0) + rew.clout;
    g.goals.push(goal.id);
    const parts = [];
    if (rew.cash) parts.push('$' + this.fmt(rew.cash));
    if (rew.clout) parts.push(this.fmt(rew.clout) + ' Clout');
    this.push(g, "Owner's list: " + goal.title + ' — ' + (parts.join(', ') || 'done') + '.', '#4ade80');
  }

  // Check achievements after any goal evaluation. Club-level fields are read
  // through the same merged view as noteGoals; rewards split club cash / account
  // clout+legacy the same way.
  checkAchievements(g) {
    if (!Array.isArray(g.achievements)) return;
    const c = this.club(g);
    for (const ach of this.ACHIEVEMENTS) {
      // Fresh merged view per check: achievement rewards (Legacy → legacyTotal)
      // credit DURING the pass, and later checks must see the updated values.
      if (!g.achievements.includes(ach.id) && ach.check(this.clubView(g))) {
        g.achievements.push(ach.id);
        if (ach.reward) {
          if (ach.reward.cash) c.cash = (c.cash || 0) + ach.reward.cash;
          if (ach.reward.clout) g.clout = (g.clout || 0) + ach.reward.clout;
          if (ach.reward.legacy) {
            g.legacy = (g.legacy || 0) + ach.reward.legacy;
            // Achievement Legacy is earned Legacy: credit the lifetime counter too,
            // so legacy_50 (Legacy Builder) and the Perks tab "Total Legacy earned"
            // reflect achievement income, not just prestige gains.
            g.legacyTotal = (g.legacyTotal || 0) + ach.reward.legacy;
          }
        }
        this.push(g, 'Achievement: ' + ach.name + ' — ' + ach.desc, '#ffd700');
      }
    }
    // Challenge completion runs on the same progress beats (live step, actions,
    // offline catch-up) — folding it in keeps one call site per beat.
    this.checkChallenge(g);
  }

  // Challenge completion (REPLAY_ROADMAP.md §6): when the active challenge's
  // check passes, record it in challengesDone (the permanent reward is DERIVED
  // from the table — no separate grant step) and clear the active challenge.
  checkChallenge(g) {
    const ch = this.activeChallenge(g);
    if (!ch || !ch.check) return;
    if ((g.challengesDone || []).includes(ch.id)) return;
    if (!ch.check(this.clubView(g))) return;
    if (!Array.isArray(g.challengesDone)) g.challengesDone = [];
    g.challengesDone.push(ch.id);
    g.challenge = null;
    this.push(g, 'Challenge complete: ' + ch.name + ' — permanent bonus granted!', '#ffd700');
  }

  save(kind) {
    const g = this.state.g;
    if (!g) return;
    // Non-owner / foreign-tab pause: never write (auto or manual). Settings
    // "Save now" must not persist a paused tab's stale state.g, call
    // markTabOwner(), clear tabStale, and discard a live sibling's progress.
    // Takeover is reload (takeOverTab) or successful import only.
    if (this.state.tabStale || !this.isTabOwner()) return;
    try {
      // A manual save must not erase the autosave timestamp -- carry the
      // previous value through rather than writing undefined over it.
      const lastAutoSave = kind === 'auto' ? Date.now() : (this.state.lastAutoSave ?? undefined);
      const payload = { saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g, lastAutoSave };
      localStorage.setItem(this.KEY, JSON.stringify(payload));
      this.markTabOwner();
      this.state.tabStale = false;
      this.startAutosave();
      this.setState({ tabStale: false, lastAutoSave, saveState: kind === 'auto' ? 'autosaved' : 'saved ✓' });
    } catch (e) { this.setState({ saveState: 'save failed' }); }
  }

  // --- actions (buy*, hire, moveJob) ---
  // Non-owner / foreign-tab pause: actions are no-ops so progress cannot be "played" without persistence.
  // Buy `count` buildings (default 1), respecting caps and cash. Used by both
  // the desktop single-build button and the mobile ×1/×5/×10/×Max quartet.
  buyBuilding(def, count = 1) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    const c = this.club(g);
    // Challenge lock (REPLAY_ROADMAP.md §6): a locked building can't be bought —
    // action invariant, not just a greyed card.
    if (this.buildingLocked(g, def.id)) return;
    if (!count || count < 1) count = 1;
    let bought = 0;
    let lastPrice = 0;
    for (let i = 0; i < count; i++) {
      // `|| 0`: fail-safe for clubs missing this location's extra id (NaN price
      // would make the cash check never break and spin).
      const n = c.b[def.id] || 0;
      const max = def.id === 'door' ? this.doorMax(g) : def.max;
      if (max != null && n >= max) break;
      const price = Math.floor(def.cost * Math.pow(def.growth, n));
      if (c.cash < price) break;
      c.cash -= price;
      c.b[def.id] = n + 1;
      bought++;
      lastPrice = price;
    }
    if (bought > 0) {
      this.push(g, 'Built ' + def.name + (bought === 1 ? ' #' + c.b[def.id] + ' for $' + this.fmt(lastPrice) : ' \u00d7' + bought) + '.', '#22d3ee');
      this.noteGoals(g);
      this.checkAchievements(g);
      this.forceUpdate();
    }
  }
  // Maximum affordable count for a building, capped by building max.
  // Extracted so the UI and the buy button can agree on the number.
  buildingMaxAffordable(def, cash = this.club(this.state.g).cash) {
    const g = this.state.g;
    const c = this.club(g);
    if (this.buildingLocked(g, def.id)) return 0;
    // `|| 0`: a club whose map lacks this location's extra id (e.g. a test-built
    // club) must price as 0 owned, not undefined → NaN price → infinite loop.
    let n = c.b[def.id] || 0;
    const cap = def.id === 'door' ? this.doorMax(g) : def.max;
    let count = 0;
    while (true) {
      if (cap != null && n >= cap) break;
      const price = Math.floor(def.cost * Math.pow(def.growth, n));
      if (cash < price) break;
      cash -= price;
      n++;
      count++;
    }
    return count;
  }
  buyBuildingMax(def) {
    const count = this.buildingMaxAffordable(def);
    if (count > 0) this.buyBuilding(def, count);
  }
  buyUpgrade(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    const c = this.club(g);
    if (c.u[def.id] || c.cash < def.cost) return;
    // Enforce building req in the action (UI already gates; do not trust UI alone).
    const reqId = Object.keys(def.req)[0];
    if (c.b[reqId] < def.req[reqId]) return;
    c.cash -= def.cost;
    c.u[def.id] = true;
    this.push(g, 'Installed ' + def.name + '.', '#ffc94a');
    this.noteGoals(g);
    this.checkAchievements(g);
    this.forceUpdate();
  }
  // Effective research cost — R&D Lab brand perk discounts it (REPLAY_ROADMAP.md
  // §9): −10% per rank, floored at 1 Clout. Single source for the action and card.
  researchCost(g, def) {
    const disc = 0.10 * this.brandRank(g, 'rnd');
    return Math.max(1, Math.floor(def.cost * (1 - disc)));
  }

  buyResearch(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    const cost = this.researchCost(g, def);
    if (g.r[def.id] || g.clout < cost) return;
    // Prerequisite is an action invariant (REPLAY_ROADMAP.md §5): existence-based
    // (g.r[req] truthy), not rank-based. Reject a node whose req isn't owned —
    // do not trust the UI alone.
    if (def.req && !g.r[def.req]) return;
    g.clout -= cost;
    g.r[def.id] = true;
    this.push(g, 'Researched ' + def.name + '.', '#a855f7');
    this.noteGoals(g);
    this.checkAchievements(g);
    this.forceUpdate();
  }
  buyPerk(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    const rank = this.perk(g, def.id);
    if (rank >= def.max || g.legacy < def.cost) return;
    // Enforce prerequisite perk rank in the action (mirrors buyUpgrade §1.8; do not trust UI alone).
    if (def.req && this.perk(g, def.req) < 1) return;
    g.legacy -= def.cost;
    g.perks[def.id] = rank + 1;
    this.push(g, 'Perk: ' + def.name + ' rank ' + (rank + 1) + '/' + def.max + '.', '#ffc94a');
    this.checkAchievements(g);
    this.forceUpdate();
  }
  buyManager(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    if (g.managers[def.id]) return;
    if (g.legacy < def.cost) return;
    g.legacy -= def.cost;
    g.managers[def.id] = true;
    this.push(g, 'Hired manager: ' + def.name + '.', '#a855f7');
    this.forceUpdate();
  }
  // Pause/resume a hired manager's auto-buy without firing them (Legacy already spent stays spent).
  toggleManager(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    if (!g.managers[def.id]) return;
    if (!g.managerPaused || typeof g.managerPaused !== 'object') g.managerPaused = {};
    const next = !g.managerPaused[def.id];
    g.managerPaused[def.id] = next;
    this.push(g, (next ? 'Paused' : 'Resumed') + ' manager: ' + def.name + '.', '#a855f7');
    this.forceUpdate();
  }
  // Raise a hired manager's level (PR 5, Legacy purchase, Perks panel). Levels
  // scale the auto-buy quantity in autoBuyManagers: 1 / 5 / max per tick.
  // managerPaused still applies at every level.
  buyManagerLevel(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    if (!(g.managers && g.managers[def.id])) return;
    if (!g.managerLevels || typeof g.managerLevels !== 'object') g.managerLevels = this.freshManagerLevels();
    const level = g.managerLevels[def.id] || 0;
    if (level >= 3) return;
    const cost = this.managerLevelCost(def, level);
    if ((g.legacy || 0) < cost) return;
    g.legacy -= cost;
    g.managerLevels[def.id] = level + 1;
    const qty = level + 1 >= 3 ? 'max' : (level + 1 >= 2 ? '5' : '1');
    this.push(g, def.name + ' upgraded to level ' + (level + 1) + ' — buys ' + qty + ' per tick.', '#a855f7');
    this.checkAchievements(g);
    this.forceUpdate();
  }

  // Auto-buy buildings for hired managers (PLAN.md §4.1).
  // Mutates g directly (does NOT route through buyBuilding, which reads this.state.g).
  // This keeps auto-buy correct when g is a standalone offline candidate (e.g. catchUp).
  // Growth/cap logic is replicated inline (same formulas as buyBuilding) so we don't
  // pay for push/noteGoals/checkAchievements/forceUpdate per slice — the caller's
  // existing per-slice noteGoals/checkAchievements calls cover bookkeeping.
  // Respects the strike rule (§1.3): no auto-buy while g.cash <= 0 and crew on strike.
  // opts.log: when true, push() a log line per purchase (for live step() visibility;
  // omitted during catchUp to avoid per-slice log spam — catchUp's away-report covers it).
  // Returns the count of buildings bought on this call.
  autoBuyManagers(g, opts = {}) {
    if (!g.managers) return 0;
    const c = this.club(g);
    // Strike gate: don't auto-buy while cash is depleted and crew is on strike.
    const strike = opts.strike != null ? opts.strike : this.rates(g).strike;
    if (c.cash <= 0 && strike) return 0;
    let bought = 0;
    for (const def of this.MANAGERS) {
      if (!g.managers[def.id]) continue;
      if (g.managerPaused && g.managerPaused[def.id]) continue;
      const bdef = this.BUILDINGS.find(b => b.id === def.id);
      if (!bdef) continue;
      // Challenge lock (REPLAY_ROADMAP.md §6): an owned manager must not
      // auto-buy a structure the active challenge locks.
      if (this.buildingLocked(g, bdef.id)) continue;
      // Manager level (PR 5) scales the per-tick quantity: 1 / 5 / max affordable.
      const level = (g.managerLevels && g.managerLevels[def.id]) || 0;
      const qtyCap = level >= 3 ? Infinity : (level >= 2 ? 5 : 1);
      let here = 0;
      let lastPrice = 0;
      while (here < qtyCap) {
        const n = c.b[def.id];
        const max = def.id === 'door' ? this.doorMax(g) : bdef.max;
        if (max != null && n >= max) break;
        const price = Math.floor(bdef.cost * Math.pow(bdef.growth, n));
        if (c.cash < price) break;
        c.cash -= price;
        c.b[def.id] = n + 1;
        bought++;
        here++;
        lastPrice = price;
      }
      if (here > 0 && opts.log) {
        this.push(g, here === 1
          ? 'Manager built ' + bdef.name + ' #' + c.b[def.id] + ' for $' + this.fmt(lastPrice) + '.'
          : 'Manager built ' + bdef.name + ' ×' + here + ' for $' + this.fmt(lastPrice) + '.', '#a855f7');
      }
    }
    return bought;
  }
  // Second room (SECOND_LOCATION.md §2): the backer offers a second lease once
  // the account has franchised once AND delegated at least one building.
  // Evaluated on the ACCOUNT (prestiges, managers) — not the active club.
  canOpenRoom() {
    const g = this.state.g;
    return !g.clubs.annex && (g.prestiges || 0) >= 1 && Object.values(g.managers || {}).some(Boolean);
  }

  openRoom() {
    // Same multi-tab rule as prestige: never unlock account progress in memory
    // on a paused tab — the write would evaporate on reload.
    if (this.state.tabStale) return;
    if (!this.canOpenRoom()) return;
    this.setState({ showOpenRoom: true });
  }

  confirmOpenRoom() {
    if (this.state.tabStale) return;
    if (!this.canOpenRoom()) return;
    const g = this.state.g;
    // One-time account unlock: NOT a prestige — the first club is untouched.
    g.clubs.annex = this.freshClubState('annex');
    this.push(g, 'Opened the annex — second location unlocked.', '#22d3ee');
    this.setState({ showOpenRoom: false });
  }

  // Instant active-club switch (SECOND_LOCATION.md §5): the previously active
  // club pauses; the new one resumes. Crew is SHARED, so if the new club's
  // Dressing Rooms cap the working roster below current crew, evict the excess
  // to off (floor → stage → vipjob: least-valuable roles first). The evicted
  // crew stay in off until manually reassigned (non-goal: no auto-restore).
  setActiveClub(id) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    if (!Object.prototype.hasOwnProperty.call(g.clubs, id) || g.activeClub === id) return;
    g.activeClub = id;
    // Cap-aware crew rebalance (SECOND_LOCATION.md §5): crew is shared; the new
    // active club's Dressing Rooms cap WORKING crew (all non-off jobs — off
    // shift is not working). Evict excess working crew to off, least-valuable
    // roles first (prio asc). Evicted crew stay in off until manually
    // reassigned (non-goal: no auto-restore).
    const cap = this.caps(g).crew;
    const working = g.crew - (g.jobs.off || 0);
    if (working > cap) {
      let excess = working - cap;
      const evictOrder = this.JOBS.filter(j => j.id !== 'off')
        .sort((a, b) => a.prio - b.prio)
        .map(j => j.id);
      for (const k of evictOrder) {
        const drop = Math.min(g.jobs[k] || 0, excess);
        g.jobs[k] -= drop;
        g.jobs.off = (g.jobs.off || 0) + drop;
        excess -= drop;
        if (excess <= 0) break;
      }
    }
    // A fresh room may not unlock the current tab (Upgrades gates on buildings,
    // club-level) — mirror the hardReset/prestige fallback so the bar never
    // renders content with no selected tab.
    const c = this.club(g);
    if (this.state.tab === 'up' && !Object.values(c.b || {}).some(n => n > 0)) {
      this.setState({ tab: 'club' });
      return;
    }
    this.forceUpdate();
  }

  confirmPrestige() {
    // Candidate → setItem must succeed → live replace (fail-closed).
    if (this.state.tabStale) return;
    const g = this.state.g;
    const c = this.club(g);
    if ((c.regulars || 0) < 25) return;
    const gain = this.legacyGain(g);

    // Snapshot meta that persists.
    const snapshot = {
      legacy: (g.legacy || 0),
      legacyTotal: (g.legacyTotal || 0),
      perks: {},
      prestiges: (g.prestiges || 0),
      managers: {},
      managerPaused: {},
      managerLevels: {},
      brand: {},
      brandLevel: this.brandLevel(g)
    };
    for (const def of this.PRESTIGE_PERKS) snapshot.perks[def.id] = this.perk(g, def.id);
    for (const def of this.MANAGERS) snapshot.managers[def.id] = g.managers && g.managers[def.id] === true;
    for (const def of this.MANAGERS) snapshot.managerPaused[def.id] = g.managerPaused && g.managerPaused[def.id] === true;
    for (const def of this.MANAGERS) snapshot.managerLevels[def.id] = g.managerLevels && g.managerLevels[def.id] || 0;
    // Brand ranks (PR 7) are permanent Renown-sink meta — ordinary prestige does
    // not wipe them (only the franchise sale keeps them as its own sink).
    for (const def of this.BRAND_PERKS) snapshot.brand[def.id] = this.brandRank(g, def.id);

    // Build post-prestige candidate from fresh() defaults.
    const next = this.fresh();
    // Preserve every club (v9 multi-club saves): reset each non-main club's run
    // fields exactly like fresh() does for main, and keep activeClub pointing at
    // its club — prestige resets run state, it does not delete rooms.
    for (const id of Object.keys(g.clubs)) {
      if (id === 'main') continue;
      const b2 = {}, u2 = {};
      this.BUILDINGS.forEach(x => b2[x.id] = 0);
      this.UPGRADES.forEach(x => u2[x.id] = false);
      // Location extras (REPLAY_ROADMAP.md §9) survive prestige reset, zeroed.
      for (const x of this.locationExtras(id)) {
        if (x.kind === 'b') b2[x.id] = 0;
        else u2[x.id] = false;
      }
      next.clubs[id] = {
        cash: (this.props && this.props.startingCash) ?? 20, hype: 0, buzz: 0, patrons: 0, regulars: 0,
        b: b2, u: u2, elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0,
        _specialShift: null, _whaleCooldown: 0
      };
    }
    if (typeof g.activeClub === 'string' && Object.prototype.hasOwnProperty.call(next.clubs, g.activeClub)) {
      next.activeClub = g.activeClub;
    }
    next.legacy = snapshot.legacy + gain;
    next.legacyTotal = snapshot.legacyTotal + gain;
    next.perks = snapshot.perks;
    next.prestiges = snapshot.prestiges + 1;
    next.achievements = Array.isArray(g.achievements) ? g.achievements.slice() : [];
    // Completed challenges persist (permanent rewards derive from them); the
    // ACTIVE challenge ends on prestige — fresh() clears g.challenge.
    next.challengesDone = Array.isArray(g.challengesDone) ? g.challengesDone.slice() : [];
    next.managers = snapshot.managers;
    next.managerPaused = snapshot.managerPaused;
    // Manager levels survive ordinary prestige (PR 5) — only the PR 6
    // franchise sale wipes them.
    next.managerLevels = snapshot.managerLevels;
    // Brand ranks (PR 7) survive ordinary prestige — restore BEFORE start perks
    // so loyalty (fresh-regulars) applies to the new run.
    next.brand = snapshot.brand;
    // Brand Endorsement level (next-roadmap PR 1) survives too — the repeatable
    // Renown sink is account meta, same class as the ranks.
    next.brandLevel = snapshot.brandLevel;
    this.applyStartPerks(next);
    // Start-perk state can satisfy building achievements.
    this.checkAchievements(next);

    // Push the franchise line onto the candidate so disk/memory share it.
    this.push(next, 'Signed the franchise deal: +' + gain + ' Legacy.', '#ffc94a');

    // Persist before replacing live state.
    try {
      localStorage.setItem(this.KEY, JSON.stringify({
        saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g: next
      }));
    } catch (e) {
      this.setState({ saveState: 'prestige failed' });
      return;
    }

    this._onStrike = false;
    this.state.g = this.wrapState(next);
    this.markTabOwner();
    this.startAutosave();
    this.setState({ tab: 'club', saveState: 'prestige saved' });
  }
  // Sell the franchise (REPLAY_ROADMAP.md §8) — the second prestige layer.
  // Opening the modal is gate-checked; the sale itself is TWO-CLICK ARMED
  // (state.franchiseArmed, mirroring the reset button): it resets EVERYTHING
  // account-level except renown/renownTotal/achievements/brand. Persist-
  // before-replace, exactly like confirmPrestige — a setItem failure leaves
  // the live club untouched.
  openFranchise() {
    if (this.state.tabStale) return;
    if (!this.franchiseGate(this.state.g)) return;
    this.setState({ showFranchise: true, franchiseArmed: false });
  }
  confirmFranchiseSale() {
    if (this.state.tabStale) return;
    // Defensive: the sale is only reachable from the open modal (card button
    // opens it; closing disarms). Guards against future call paths selling
    // without the player ever seeing the reset-scope preview.
    if (!this.state.showFranchise) return;
    const g = this.state.g;
    if (!this.franchiseGate(g)) return;
    if (!this.state.franchiseArmed) {
      this.setState({ franchiseArmed: true });
      return;
    }
    const gain = this.renownGain(g);

    // Snapshot the permanent layers (REPLAY_ROADMAP.md §8.4): Renown never
    // wipes, achievements are permanent unlocks, Brand ranks persist.
    const snapshot = {
      renown: (g.renown || 0),
      renownTotal: (g.renownTotal || 0),
      achievements: Array.isArray(g.achievements) ? g.achievements.slice() : [],
      brand: (g.brand && typeof g.brand === 'object' && !Array.isArray(g.brand)) ? { ...g.brand } : {},
      brandLevel: this.brandLevel(g)
    };

    // Build the post-sale candidate from fresh() defaults — wipes both clubs
    // (annex re-locks), Legacy/perks/research/Clout, managers/levels, crew/
    // jobs, challenges, and all run counters, exactly per the §8.4 matrix.
    const next = this.fresh();
    next.renown = snapshot.renown + gain;
    next.renownTotal = snapshot.renownTotal + gain;
    next.achievements = snapshot.achievements;
    next.brand = snapshot.brand;
    // Brand Endorsement level (next-roadmap PR 1) — permanent like brand ranks:
    // the repeatable Renown sink is the reason the NEXT sale has a spend.
    next.brandLevel = snapshot.brandLevel;
    this.applyStartPerks(next);
    // Start-perk state can satisfy building achievements (parity with prestige).
    this.checkAchievements(next);

    this.push(next, 'Sold the franchise: +' + gain + ' Renown. The brand grows.', '#22d3ee');

    // Persist before replacing live state.
    try {
      localStorage.setItem(this.KEY, JSON.stringify({
        saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g: next
      }));
    } catch (e) {
      this.setState({ saveState: 'franchise failed' });
      return;
    }

    this._onStrike = false;
    this.state.g = this.wrapState(next);
    this.markTabOwner();
    this.startAutosave();
    this.setState({ tab: 'club', saveState: 'franchise sold', showFranchise: false, franchiseArmed: false });
  }
  // Buy a Brand perk (REPLAY_ROADMAP.md §9) with Renown — the reason to sell
  // the franchise again. Ranks persist through the sale (they're the sink).
  buyBrandPerk(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    const rank = this.brandRank(g, def.id);
    if (rank >= def.max || (g.renown || 0) < def.cost) return;
    // Prerequisite brand perk (rank >= 1), mirroring the prestige perk tree.
    if (def.req && this.brandRank(g, def.req) < 1) return;
    g.renown -= def.cost;
    if (!g.brand || typeof g.brand !== 'object' || Array.isArray(g.brand)) g.brand = {};
    g.brand[def.id] = rank + 1;
    this.push(g, 'Brand perk: ' + def.name + ' rank ' + (rank + 1) + '/' + def.max + '.', '#d4af37');
    this.checkAchievements(g);
    this.forceUpdate();
  }
  // Buy a Brand Endorsement (next-roadmap PR 1) with Renown — the repeatable
  // sink that keeps the sell loop meaningful after the five Brand perks max
  // out. +2% all cash per level; the cost escalates 15 × 1.35^level so the
  // sink is never exhausted, only steeper. Persists through every reset
  // (prestige, challenge start, franchise sale) like brand ranks.
  buyBrandEndorsement() {
    if (this.state.tabStale) return;
    const g = this.state.g;
    const cost = this.endorsementCost(g);
    if ((g.renown || 0) < cost) return;
    g.renown -= cost;
    g.brandLevel = this.brandLevel(g) + 1;
    this.push(g, 'Brand endorsement #' + g.brandLevel + ': +2% all cash. The name travels.', '#d4af37');
    this.checkAchievements(g);
    this.forceUpdate();
  }
  // Rooftop (REPLAY_ROADMAP.md §9): a third club unlocked by the Rooftop Lease
  // brand perk. Same account-level unlock pattern as the annex — creates the
  // club via freshClubState('rooftop') with its location extras.
  canOpenRooftop() {
    const g = this.state.g;
    return !!g && !g.clubs.rooftop && this.brandRank(g, 'rooftop') >= 1;
  }
  confirmOpenRooftop() {
    if (this.state.tabStale) return;
    if (!this.canOpenRooftop()) return;
    const g = this.state.g;
    g.clubs.rooftop = this.freshClubState('rooftop');
    this.push(g, 'Opened the rooftop — third location unlocked.', '#22d3ee');
    this.forceUpdate();
  }
  hireCrew() {
    if (this.state.tabStale) return;
    const g = this.state.g;
    const c = this.club(g);
    const cap = this.caps(g).crew;
    if (g.crew - g.jobs.off >= cap) return;
    const price = Math.floor(280 * Math.pow(1.38, g.crew));
    if (c.cash < price) return;
    c.cash -= price;
    g.crew++;
    // New hires open on Main Stage so the room doesn't stay empty after a hire.
    g.jobs.stage++;
    this.push(g, 'Hired crew member #' + g.crew + ' for $' + this.fmt(price) + ' — on Main Stage.', '#ff2d78');
    this.noteGoals(g);
    this.checkAchievements(g);
    this.forceUpdate();
  }
  // Start a challenge (REPLAY_ROADMAP.md §6): a fresh run under the challenge's
  // modifier. Resets EVERY club to freshClubState() — a developed annex must not
  // satisfy the completion condition instantly — and re-locks the annex (fresh()
  // builds main only). Account meta (legacy/perks/brand/achievements/managers/
  // challengesDone) persists; run state (research/clout/crew/jobs) resets like
  // prestige. Persist-before-replace, matching confirmPrestige.
  startChallenge(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    if (g.challenge || (g.challengesDone || []).includes(def.id)) return;
    // Two-click arm: starting a challenge resets the run — first click arms.
    if (this.state.challengeArmed !== def.id) {
      this.setState({ challengeArmed: def.id });
      return;
    }
    const snapshot = {
      legacy: (g.legacy || 0), legacyTotal: (g.legacyTotal || 0),
      perks: {}, prestiges: (g.prestiges || 0), managers: {}, managerPaused: {}, managerLevels: {},
      brand: {}, brandLevel: this.brandLevel(g)
    };
    for (const p of this.PRESTIGE_PERKS) snapshot.perks[p.id] = this.perk(g, p.id);
    for (const m of this.MANAGERS) {
      snapshot.managers[m.id] = !!(g.managers && g.managers[m.id]);
      snapshot.managerPaused[m.id] = !!(g.managerPaused && g.managerPaused[m.id]);
      snapshot.managerLevels[m.id] = (g.managerLevels && g.managerLevels[m.id]) || 0;
    }
    // Brand ranks (PR 7) are Renown-sink account meta — a challenge start must
    // not wipe them (only the franchise sale does). Same class as managers.
    for (const def of this.BRAND_PERKS) snapshot.brand[def.id] = this.brandRank(g, def.id);
    const next = this.fresh(); // fresh() builds main only — the annex is re-locked
    next.challenge = def.id;
    next.challengesDone = Array.isArray(g.challengesDone) ? g.challengesDone.slice() : [];
    next.legacy = snapshot.legacy;
    next.legacyTotal = snapshot.legacyTotal;
    next.perks = snapshot.perks;
    next.prestiges = snapshot.prestiges;
    next.achievements = Array.isArray(g.achievements) ? g.achievements.slice() : [];
    next.managers = snapshot.managers;
    next.managerPaused = snapshot.managerPaused;
    // Manager levels survive challenge starts too (PR 5) — same class of
    // Legacy-purchased account meta as the hire itself; only the PR 6
    // franchise sale wipes them.
    next.managerLevels = snapshot.managerLevels;
    // Brand ranks (PR 7) survive challenge starts too — restore BEFORE start
    // perks so loyalty (fresh-regulars) seeds the challenge run.
    next.brand = snapshot.brand;
    // Brand Endorsement level (next-roadmap PR 1) — same class as the ranks:
    // the repeatable Renown sink must not wipe on a challenge start either.
    next.brandLevel = snapshot.brandLevel;
    // Modifier startCash overrides the default starting till.
    const mod = def.mod || {};
    if (typeof mod.startCash === 'number') next.clubs.main.cash = mod.startCash;
    this.applyStartPerks(next);
    // Challenge locks override start perks: a seeded structure (e.g. the
    // startFlyers perk's free Flyer Crew) must not bypass a challenge's
    // building lock — the lock is a modifier, not just purchase prevention
    // (REPLAY_ROADMAP.md §6).
    for (const lid of (Array.isArray(mod.locked) ? mod.locked : [])) {
      if (next.clubs.main.b[lid]) next.clubs.main.b[lid] = 0;
    }
    this.checkAchievements(next);
    this.push(next, 'Challenge started: ' + def.name + ' — ' + def.desc, '#e879f9');
    try {
      localStorage.setItem(this.KEY, JSON.stringify({
        saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g: next
      }));
    } catch (e) {
      this.setState({ saveState: 'challenge failed' });
      return;
    }
    this._onStrike = false;
    this.state.g = this.wrapState(next);
    this.markTabOwner();
    this.startAutosave();
    this.setState({ tab: 'club', challengeArmed: null });
    this.forceUpdate();
  }

  // End the active challenge without reward: the run continues as-is, the
  // modifier lifts. Mercy rule — a challenge the player can't complete must
  // not lock its modifier on forever.
  endChallenge() {
    if (this.state.tabStale) return;
    const g = this.state.g;
    if (!g.challenge) return;
    g.challenge = null;
    this.push(g, 'Challenge ended — no reward.', '#ff2d78');
    this.setState({ challengeArmed: null });
    this.forceUpdate();
  }
  moveJob(id, d) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    // Off Shift is the residual pool (display-only); never assign to it directly.
    if (id === 'off') return;
    // Locked job: its unlock research isn't owned, so it can't receive crew
    // (REPLAY_ROADMAP.md §5). This is an action invariant, not just a UI hint.
    const job = this.JOBS.find(j => j.id === id);
    if (!job || !this.jobUnlocked(g, job)) return;
    if (d > 0) {
      if (g.jobs.off < 1) return;
      // Crew capacity (SECOND_LOCATION.md §5): the active room's Dressing Rooms
      // cap WORKING crew (crew − off). Without this check, crew evicted by a
      // club switch could be reassigned right back, bypassing the new room's
      // smaller cap and flattening its progression.
      const cap = this.caps(g).crew;
      if (g.crew - g.jobs.off >= cap) return;
      g.jobs.off--;
      g.jobs[id]++;
    } else {
      if (g.jobs[id] < 1) return;
      g.jobs[id]--;
      g.jobs.off++;
    }
    this.noteGoals(g);
    this.checkAchievements(g);
    this.forceUpdate();
  }

  // Round price — single source for UI and pacing.mjs reference bot (PLAN-NEXT §C).
  roundPrice(g) {
    const c = this.club(g);
    return Math.floor(50 + (c.patrons || 0) * 7);
  }

  // --- render values ---
  bar(pct, color) {
    return { width: Math.max(0, Math.min(100, pct)) + '%', height: '100%', background: color, borderRadius: '3px', transition: 'width .18s linear' };
  }

  // Help icon tooltip for jargon terms — hover/tap for plain-English definition.
  // Native title tooltips aren't reliably exposed to screen readers or reachable by keyboard,
  // so we also add aria-label + tabindex="0" for keyboard/AT users.
  helpIcon(term, def) {
    const safeTerm = this.escapeHtml(term);
    const safeDef = this.escapeHtml(def);
    return `<span tabindex="0" style="display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-left:4px;border:1px solid #3a2350;border-radius:50%;background:#100a19;color:#9c86ab;font-size:10px;font-weight:700;cursor:help;flex-shrink:0;position:relative" title="${safeDef}" aria-label="${safeTerm}: ${safeDef}">?</span>`;
  }

  renderVals() {
    const g = this.state.g;
    const V = this.VERSION;
    const base = {
      verLabel: 'v' + V.num, verBuild: V.build, verChannel: V.channel,
      verFull: 'v' + V.num + ' · build ' + V.build + ' · ' + V.channel + ' · ' + V.codename + ' · ' + V.date,
      saveVer: this.SAVE_VER, changelog: this.CHANGELOG.map(c => ({ ...c })),
      showChangelog: this.state.showChangelog, showSettings: this.state.showSettings, showPrestige: this.state.showPrestige, showOpenRoom: this.state.showOpenRoom, showFranchise: this.state.showFranchise, franchiseArmed: this.state.franchiseArmed,
      resetHint: this.state.resetArmed ? '⚠ Click "Wipe save and restart" again to confirm — this is permanent.' : '',
      resetLabel: this.state.resetArmed ? '⚠ Confirm — click again to wipe' : 'Wipe save and restart',
      saveState: this.state.saveState,
      lastAutoSave: this.state.lastAutoSave,
      resetStyle: {
        background: this.state.resetArmed ? '#4a0f1e' : '#22060f', border: '1px solid ' + (this.state.resetArmed ? '#ff2d78' : '#6b1130'),
        borderRadius: '7px', color: this.state.resetArmed ? '#fff' : '#ff7aa8', padding: '11px', cursor: 'pointer',
        fontSize: '12px', fontWeight: 700, textAlign: 'left'
      },
      toggleChangelog: () => this.setState(s => ({ showChangelog: !s.showChangelog })),
      toggleSettings: () => this.setState(s => ({ showSettings: !s.showSettings, resetArmed: false })),
      togglePrestige: () => this.setState(s => ({ showPrestige: !s.showPrestige })),
      toggleFranchise: () => this.setState(s => ({ showFranchise: !s.showFranchise, franchiseArmed: false })),
      ledgerOpen: this.state.ledgerOpen,
      toggleLedger: () => this.setState(s => ({ ledgerOpen: !s.ledgerOpen })),
      saveNow: () => this.save('manual'),
      openLook: () => { this.setState({ showSettings: false }); this.toggleLook(true); },
      // File + clipboard share one payload shape so either restore path accepts either export.
      downloadSave: () => {
        try {
          const json = JSON.stringify({ saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g: this.state.g });
          const blob = new Blob([json], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'afterglow-save.json';
          a.click();
          URL.revokeObjectURL(a.href);
          this.setState({ saveState: 'downloaded' });
        } catch (e) {
          this.setState({ saveState: 'download failed' });
        }
      },
      importSaveFile: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = () => {
          const file = input.files && input.files[0];
          if (!file) {
            this.setState({ saveState: 'import failed' });
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            this.importSaveFromText(String(reader.result || '').trim());
          };
          reader.onerror = () => {
            this.setState({ saveState: 'import failed' });
          };
          reader.readAsText(file);
        };
        input.click();
      },
      exportSave: async () => { try { await navigator.clipboard.writeText(JSON.stringify({ saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g: this.state.g })); this.setState({ saveState: 'copied' }); } catch (e) { this.setState({ saveState: 'clipboard failed' }); } },
      importSave: async () => {
        let text = '';
        try {
          if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
            text = await navigator.clipboard.readText();
          } else {
            text = window.prompt('Paste save JSON to restore:') || '';
          }
        } catch (e) {
          text = window.prompt('Paste save JSON to restore:') || '';
        }
        if (!text || !String(text).trim()) {
          this.setState({ saveState: 'import failed' });
          return;
        }
        this.importSaveFromText(String(text).trim());
      },
      hardReset: () => {
        // Same class as save(manual): a paused / non-owner tab must not mutate KEY.
        // Wipe is neither reload takeover nor import — no-op until this tab owns.
        if (this.state.tabStale || !this.isTabOwner()) return;
        if (!this.state.resetArmed) { this.setState({ resetArmed: true }); return; }
        localStorage.removeItem(this.KEY);
        this.state.g = this.wrapState(this.fresh());
        this.state.lastAutoSave = undefined;
        this.push(this.state.g, 'Save wiped. Fresh club.', '#ff2d78');
        // Fresh g may not have the current tab's unlock (Upgrades/Research/Perks
        // gate on buildings/clout/prestiges) — fall back to Club like doPrestige.
        this.setState({ showSettings: false, resetArmed: false, tab: 'club' });
      },
      tickCount: this.state.tick, saveState: this.state.saveState, ticker: '',
      tabStale: this.state.tabStale,
      // Reload adopts the other tab's save from localStorage (last-explicit-wins via reload).
      takeOverTab: () => { window.location.reload(); }
    };
    if (!g) return base;

    const c = this.club(g);
    const r = this.rates(g), cap = r.cap;
    const sign = v => (v >= 0 ? '+' : '') + this.fmt(v) + '/s';
    // Flavor layer (REPLAY_ROADMAP.md §4): ticker line + featured regular name.
    // Ticker text interpolates FLAVOR/REGULAR_NAMES source-controlled literals
    // (no escaping needed); escape first if they are ever fed dynamic strings.
    const ticker = this.flavorLine(g, c, this.state.tick);
    const regName = this.regularName(g, c);
    // Regulars ledger note: featured name when available, loop suffix when owned.
    const regularsNote = g.r.loop
      ? (regName ? regName + ' is a regular · $0.04/s each' : '$0.04/s each')
      : (regName ? regName + ' is a regular' : 'unlock Reputation Loop');

    const resources = [
      { name: 'Cash' + this.helpIcon('Cash', 'Money in the till. Used to hire crew, buy structures, upgrades, and rounds.'), val: '$' + this.fmt(c.cash), rate: sign(r.cash), pct: 100, color: '#ffc94a', note: r.strike ? 'crew unpaid — on strike' : (r.wage > 0 ? 'wages −$' + this.fmt(r.wage) + '/s' : 'no payroll yet') },
      { name: 'Hype' + this.helpIcon('Hype', 'Room energy. Multiplies all cash income and click value. Decays over time — feed it with DJ Booths and the stage crew.'), val: this.fmt(c.hype), rate: sign(r.hype), pct: c.hype / cap.hype * 100, color: '#ff2d78', note: 'cap ' + cap.hype + ' · x' + (1 + c.hype / 140).toFixed(2) + ' income' },
      { name: 'Buzz' + this.helpIcon('Buzz', 'Street awareness. Converts into patrons entering the club. Marquee Signs and Flyer Crews generate it.'), val: this.fmt(c.buzz), rate: sign(r.buzz - r.buzzSpent), pct: c.buzz / cap.buzz * 100, color: '#22d3ee', note: 'cap ' + cap.buzz + ' · pulls patrons in' },
      // Display whole people; sim keeps fractional c.patrons (PLAN §2.4).
      { name: 'Patrons' + this.helpIcon('Patrons', 'Bodies on the floor. They pay cover at the door ($0.02/head), tip at Tip Rails, and slowly become Regulars. Cap grows with structures.'), val: this.fmt(Math.floor(c.patrons)), rate: sign(r.patrons), pct: c.patrons / cap.patrons * 100, color: '#a855f7', note: 'floor cap ' + cap.patrons },
      { name: 'Regulars' + this.helpIcon('Regulars', 'Loyal patrons who never leave. Each one generates Clout over time. With Reputation Loop, they also pay $0.04/s cash.'), val: this.fmt(c.regulars), rate: sign(r.regulars), pct: Math.min(100, c.regulars), color: '#4ade80', note: regularsNote },
      { name: 'Clout' + this.helpIcon('Clout', 'Research currency. Earned from Regulars. Spent permanently on the Research tab for global upgrades.'), val: this.fmt(g.clout), rate: sign(r.clout), pct: Math.min(100, g.clout * 2), color: '#e879f9', note: 'spent on research' }
    ];
    // Legacy appears in the ledger only once meta is unlocked (first prestige or any lifetime Legacy).
    const metaUnlocked = (g.prestiges || 0) > 0 || (g.legacyTotal || 0) > 0 || Object.values(g.perks || {}).some(r => r > 0) || (g.renownTotal || 0) > 0;
    if (metaUnlocked) {
      resources.push({ name: 'Legacy' + this.helpIcon('Legacy', 'Prestige meta-currency. Earned by selling the club (franchise deal). Spent on permanent perks and managers that persist across runs.'), val: this.fmt(Math.floor(g.legacy || 0)), rate: 'perk shop', pct: Math.min(100, (g.legacy || 0) / 25 * 100), color: '#d4af37', note: 'spent on permanent perks' });
    }
    const resourcesOut = resources.map(x => ({
      name: x.name, val: x.val, rate: x.rate, note: x.note,
      valStyle: { fontFamily: "'IBM Plex Mono',monospace", fontSize: '15px', fontWeight: 600, color: x.color },
      barStyle: this.bar(x.pct, x.color)
    }));

    const stats = [
      { k: 'Crew' + this.helpIcon('Crew', 'Hired dancers, bartenders, and hosts. Assign them to Main Stage (Hype), VIP (cash), or Floor (buzz + regulars). Wages tick every second.'), v: (g.crew - g.jobs.off) + ' / ' + cap.crew },
      { k: 'On stage' + this.helpIcon('On stage', 'Crew assigned to Main Stage. Each one generates Hype. More Hype = higher income multiplier.'), v: String(g.jobs.stage) },
      // Sum only known building IDs (defense in depth vs unknown keys).
      { k: 'Structures' + this.helpIcon('Structures', 'Total buildings owned. Tip Rails, Back Bars, DJ Booths, Marquee Signs, Flyer Crews, VIP Booths, Door Staff, Dressing Rooms.'), v: String(this.BUILDINGS.reduce((a, d) => a + (c.b[d.id] || 0), 0)) },
      { k: 'Night time' + this.helpIcon('Night time', 'Total time played this run. Shifts cycle: Early Doors → Peak Hours → Last Call → After Hours. After Hours is weak unless you research Late Kitchen.'), v: Math.floor(c.elapsed / 60) + 'm ' + Math.floor(c.elapsed % 60) + 's' }
    ];

    const tabDefs = [
      { id: 'club', label: 'Club' },
      // Crew is always visible: the Hire Crew card is actionable from the first
      // second, and the stage's "hire crew to open the stage" CTA routes here —
      // gating it on g.crew > 0 would strand a new player on a hidden tab.
      { id: 'crew', label: 'Crew' }
    ];
    if (Object.values(c.b || {}).some(n => n > 0)) tabDefs.push({ id: 'up', label: 'Upgrades' });
    if ((g.clout || 0) > 0) tabDefs.push({ id: 'res', label: 'Research' });
    if (metaUnlocked) tabDefs.push({ id: 'perks', label: 'Perks' });
    const tabs = tabDefs.map(t => ({
      label: t.label, go: () => this.setState({ tab: t.id }),
      style: {
        flex: 1, padding: '11px 4px', background: this.state.tab === t.id ? '#170e22' : 'transparent',
        border: 0, borderBottom: '2px solid ' + (this.state.tab === t.id ? '#ff2d78' : 'transparent'),
        color: this.state.tab === t.id ? '#fff' : '#7b5f90', cursor: 'pointer',
        fontSize: '11px', fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase'
      }
    }));

    const cardWrap = ok => ({ border: '1px solid ' + (ok ? '#2f1c42' : '#1c1129'), borderRadius: '8px', background: ok ? '#100a1a' : '#0c0714', padding: '10px 11px', opacity: ok ? 1 : 0.6 });
    const btn = (ok, tone) => ({
      background: ok ? (tone || '#ff2d78') : '#1a1226', border: 0, borderRadius: '6px',
      color: ok ? '#fff' : '#9c86ab', padding: '8px 12px', cursor: ok ? 'pointer' : 'not-allowed',
      fontSize: '11px', fontWeight: 700, letterSpacing: '.6px', minWidth: '104px'
    });

    let cards = [], tabHint = '';
    if (this.state.tab === 'club') {
      tabHint = 'Structures are permanent and scale in price. Everything on this tab is bought with cash. A few regulars wander in on their own; Buzz fills the floor faster. Use the ×1 / ×5 / ×10 / ×Max buttons (or Shift-click a Build button on desktop) to buy multiple at once.';
      // Location extras (REPLAY_ROADMAP.md §9) join the shared catalog per club.
      cards = this.BUILDINGS.concat(this.extraBuildings(g.activeClub)).map(d => {
        const n = c.b[d.id] || 0, price = Math.floor(d.cost * Math.pow(d.growth, n));
        const chLocked = this.buildingLocked(g, d.id);
        const max = d.id === 'door' ? this.doorMax(g) : d.max;
        const maxed = max != null && n >= max;
        const ok = !maxed && !chLocked && c.cash >= price;
        const affordable = maxed ? 0 : this.buildingMaxAffordable(d);
        const can5 = !maxed && affordable >= 5;
        const can10 = !maxed && affordable >= 10;
        const canMax = affordable > 1;
        let desc = d.desc;
        if (d.id === 'door') desc = desc.replace('(max 6)', '(max ' + max + ')');
        return {
          name: d.name, desc: desc, owned: chLocked ? 'LOCKED' : (n > 0 ? '×' + n : '—'),
          btn: chLocked ? 'Locked' : (maxed ? 'Maxed' : 'Build $' + this.fmt(price)),
          meta: chLocked ? 'locked by the active challenge' : (maxed ? 'maxed' : (ok ? 'affordable' : 'need $' + this.fmt(price - c.cash))),
          locked: !ok, wrapStyle: cardWrap(!maxed && !chLocked), btnStyle: btn(ok),
          act: () => this.buyBuilding(d, 1),
          buildingId: d.id,
          multi: {
            maxed,
            x1: { act: () => this.buyBuilding(d, 1), locked: !ok, style: btn(ok, '#ff2d78') },
            x5: { act: () => this.buyBuilding(d, 5), locked: !can5, label: '×5', style: btn(can5, '#ff2d78') },
            x10: { act: () => this.buyBuilding(d, 10), locked: !can10, label: '×10', style: btn(can10, '#ff2d78') },
            max: { act: () => this.buyBuildingMax(d), locked: !canMax, label: '×' + affordable, style: btn(canMax, '#ff2d78') }
          }
        };
      });
    } else if (this.state.tab === 'crew') {
      tabHint = 'Hire dancers, then assign them to Main Stage (Hype), VIP, or Floor. Wages tick every second — park extras Off Shift when the room is dead.';
      const price = Math.floor(280 * Math.pow(1.38, g.crew));
      const working = g.crew - g.jobs.off;
      const room = working < cap.crew, ok = room && c.cash >= price;
      cards = [{ name: 'Hire Crew', desc: 'Dancers, bartenders, hosts. New hires start on Main Stage — reassign below. Capacity comes from Dressing Rooms.',
        owned: working + ' / ' + cap.crew, btn: room ? 'Hire $' + this.fmt(price) : 'At capacity',
        meta: room ? (ok ? 'affordable' : 'need $' + this.fmt(price - c.cash)) : 'build a Dressing Room',
        locked: !ok, wrapStyle: cardWrap(true), btnStyle: btn(ok), act: () => this.hireCrew(),
        btnTooltip: !ok && room ? 'Need $' + this.fmt(price - c.cash) + ' cash to hire' : '' }];
    } else if (this.state.tab === 'up') {
      tabHint = 'One-time purchases. Each unlocks once you own enough of the required structure.';
      // Location extras (REPLAY_ROADMAP.md §9) join the shared catalog per club.
      cards = this.UPGRADES.concat(this.extraUpgrades(g.activeClub)).map(d => {
        const reqId = Object.keys(d.req)[0], need = d.req[reqId];
        const have = c.b[reqId] >= need, bought = c.u[d.id], ok = !bought && have && c.cash >= d.cost;
        const rn = (this.BUILDINGS.concat(this.extraBuildings(g.activeClub)).find(b => b.id === reqId) || {}).name || reqId;
        return { name: d.name, desc: d.desc, owned: bought ? 'owned' : '',
          btn: bought ? 'Installed' : 'Buy $' + this.fmt(d.cost),
          meta: bought ? '' : (have ? (ok ? 'affordable' : 'need $' + this.fmt(d.cost - c.cash)) : 'requires ' + rn + ' ×' + need),
          locked: !ok, wrapStyle: cardWrap(have && !bought), btnStyle: btn(ok, '#ffc94a'), act: () => this.buyUpgrade(d) };
      });
    } else if (this.state.tab === 'perks') {
      tabHint = 'Perks and Managers are bought with Legacy and persist across franchise deals. Total Legacy earned: ' + this.fmt(g.legacyTotal || 0) + '.';
      const perkCards = this.PRESTIGE_PERKS.map(d => {
        const rank = this.perk(g, d.id);
        const maxed = rank >= d.max;
        // Perk tree prerequisite gate (PLAN §4.3): locked until req perk has rank >= 1.
        const reqMet = !d.req || this.perk(g, d.req) >= 1;
        const reqDef = d.req ? this.PRESTIGE_PERKS.find(p => p.id === d.req) : null;
        const ok = !maxed && reqMet && g.legacy >= d.cost;
        return { name: d.name, desc: d.desc, owned: rank > 0 ? rank + '/' + d.max : '—',
          btn: maxed ? 'Maxed' : d.cost + ' Legacy',
          meta: maxed ? 'maxed' : (!reqMet ? '' : (ok ? 'ready' : this.fmt(d.cost - g.legacy) + ' Legacy short')),
          reqLocked: !reqMet,
          reqName: reqDef ? reqDef.name : (d.req || ''),
          locked: !ok, wrapStyle: cardWrap(!maxed && reqMet), btnStyle: btn(ok, '#d4af37'), act: () => this.buyPerk(d) };
      });
      const managerCards = this.MANAGERS.map(d => {
        const hired = g.managers && g.managers[d.id];
        const paused = hired && g.managerPaused && g.managerPaused[d.id];
        const level = (g.managerLevels && g.managerLevels[d.id]) || 0;
        const maxed = level >= 3;
        const bdef = this.BUILDINGS.find(b => b.id === d.id);
        const n = c.b[d.id];
        const price = bdef ? Math.floor(bdef.cost * Math.pow(bdef.growth, n)) : 0;
        const max = bdef && bdef.id === 'door' ? this.doorMax(g) : bdef ? bdef.max : null;
        const atCap = max != null && n >= max;
        const ok = !hired && g.legacy >= d.cost;
        const lvCost = this.managerLevelCost(d, level);
        const lvOk = hired && !maxed && (g.legacy || 0) >= lvCost;
        const qty = maxed ? 'max' : (level >= 2 ? '5' : '1');
        return { name: d.name, desc: d.desc, owned: hired ? (paused ? 'paused · Lv ' + level + '/3' : 'hired · Lv ' + level + '/3') : '—',
          btn: hired ? (paused ? 'Resume' : 'Pause') : d.cost + ' Legacy',
          meta: hired
            ? (paused ? 'paused — click to resume auto-buying ' + (bdef ? bdef.name : d.id)
              : (atCap ? 'auto-buys ' + (bdef ? bdef.name : d.id) + ' ×' + qty + '/tick (capped — no more builds)' : 'auto-buys ' + (bdef ? bdef.name : d.id) + ' ×' + qty + '/tick (next $' + this.fmt(price) + ')'))
            : (ok ? 'ready' : this.fmt(d.cost - g.legacy) + ' Legacy short'),
          locked: !hired && !ok, wrapStyle: cardWrap(true), btnStyle: btn(hired || ok, '#a855f7'),
          act: () => hired ? this.toggleManager(d) : this.buyManager(d),
          // Level-up sub-button (PR 5): Legacy purchase, only while hired.
          subBtn: hired ? (maxed ? 'Maxed' : 'Level up ' + lvCost + ' Legacy') : '',
          subAct: hired && !maxed ? () => this.buyManagerLevel(d) : null,
          subLocked: hired && !maxed && !lvOk,
          subStyle: btn(maxed || lvOk, '#d4af37') };
      });
      // Challenge runs (REPLAY_ROADMAP.md §6): opt-in replay modifiers with
      // permanent, derived rewards. Start is two-click armed (it resets the run).
      const challengeCards = this.CHALLENGES.map(d => {
        const done = (g.challengesDone || []).includes(d.id);
        const active = g.challenge === d.id;
        const armed = this.state.challengeArmed === d.id;
        return {
          name: d.name, desc: d.desc, owned: done ? 'done' : (active ? 'ACTIVE' : '—'),
          btn: done ? 'Completed' : (active ? 'Active' : (armed ? 'Confirm start?' : 'Start')),
          meta: done ? 'reward: ' + this.challengeRewardDesc(d)
            : (active ? this.challengeModDesc(d) + ' · ' + this.challengeRewardDesc(d)
              : this.challengeModDesc(d) + ' → ' + this.challengeRewardDesc(d)),
          locked: done || active, wrapStyle: cardWrap(!done && !active), btnStyle: btn(!done && !active, '#e879f9'),
          act: () => this.startChallenge(d)
        };
      });
      // Mercy rule: an active challenge can be ended without reward.
      if (g.challenge) {
        challengeCards.push({
          name: 'End challenge', desc: 'Stop the active challenge without reward. The run continues; the modifier lifts.', owned: '',
          btn: 'End challenge', meta: 'no reward', locked: false, wrapStyle: cardWrap(true), btnStyle: btn(true, '#ff2d78'),
          act: () => this.endChallenge()
        });
      }
      // Second prestige layer (REPLAY_ROADMAP.md §8): the Renown readout after
      // the first sale, and the gate-aware "Sell the franchise" control — a
      // BIGGER reset than prestige, styled distinctly (cyan border/button).
      const franchiseCards = [];
      if ((g.renownTotal || 0) > 0) {
        franchiseCards.push({
          name: 'Renown', desc: "Your brand's national footprint. Earned by selling the franchise — it never wipes.",
          owned: Math.floor(g.renown || 0) + ' spare · ' + Math.floor(g.renownTotal || 0) + ' lifetime',
          btn: '—', meta: 'spent on Brand perks below', locked: true,
          wrapStyle: cardWrap(true), btnStyle: btn(false), act: () => {}
        });
      }
      if (this.franchiseGate(g)) {
        franchiseCards.push({
          name: 'Sell the franchise', desc: 'A national conglomerate wants your whole operation. Reset EVERYTHING — both clubs, Legacy, perks, research, managers, crew — for permanent Renown. Achievements and Brand ranks survive.',
          owned: '', btn: 'Sell the franchise',
          meta: '+ ' + this.renownGain(g) + ' Renown · a bigger reset than the franchise deal',
          locked: false, wrapStyle: { ...cardWrap(true), border: '1px solid #22d3ee' }, btnStyle: btn(true, '#22d3ee'),
          act: () => this.openFranchise()
        });
      }
      cards = perkCards.concat(managerCards, challengeCards, franchiseCards);
      // Brand perks (REPLAY_ROADMAP.md §9): the Renown sink, bought from the
      // Perks panel. Only meaningful after the first franchise sale, but always
      // visible — "N Renown short" is itself a goal line.
      const brandCards = this.BRAND_PERKS.map(d => {
        const rank = this.brandRank(g, d.id);
        const maxed = rank >= d.max;
        const reqMet = !d.req || this.brandRank(g, d.req) >= 1;
        const ok = !maxed && reqMet && (g.renown || 0) >= d.cost;
        const reqDef = d.req ? this.BRAND_PERKS.find(p => p.id === d.req) : null;
        return { name: d.name, desc: d.desc, owned: rank > 0 ? rank + '/' + d.max : '—',
          btn: maxed ? 'Maxed' : d.cost + ' Renown',
          meta: maxed ? 'maxed' : (!reqMet ? '' : (ok ? 'ready' : this.fmt(d.cost - (g.renown || 0)) + ' Renown short')),
          reqLocked: !reqMet,
          reqName: reqDef ? reqDef.name : (d.req || ''),
          locked: !ok, wrapStyle: cardWrap(!maxed && reqMet), btnStyle: btn(ok, '#d4af37'), act: () => this.buyBrandPerk(d) };
      });
      // Brand Endorsement (next-roadmap PR 1) — the repeatable Renown sink:
      // +2% all cash per level, cost escalates 15 × 1.35^level. Renders under
      // the five Brand perks; always visible, so the next endorsement is a
      // goal line even before the first sale ("15 Renown short").
      const bl = this.brandLevel(g);
      const ec = this.endorsementCost(g);
      const eok = (g.renown || 0) >= ec;
      brandCards.push({
        name: 'Brand Endorsement', desc: 'All cash income +2% per level, forever.',
        owned: bl > 0 ? bl + ' level' + (bl === 1 ? '' : 's') : '—',
        btn: ec + ' Renown',
        meta: eok ? 'ready' : this.fmt(ec - (g.renown || 0)) + ' Renown short',
        locked: !eok, wrapStyle: cardWrap(true), btnStyle: btn(eok, '#d4af37'),
        act: () => this.buyBrandEndorsement()
      });
      // Rooftop Lease bought → the third location can be opened.
      if (this.canOpenRooftop()) {
        brandCards.push({
          name: 'Open the rooftop', desc: 'A third location — fresh till, its own Helipad Lounge and Panorama Deck.', owned: '',
          btn: 'Open', meta: 'third location', locked: false, wrapStyle: cardWrap(true), btnStyle: btn(true, '#22d3ee'),
          act: () => this.confirmOpenRooftop()
        });
      }
      cards = cards.concat(brandCards);
    } else {
      tabHint = 'Research is paid in Clout, which accrues slowly from Regulars. Permanent, global effects.';
      cards = this.RESEARCH.map(d => {
        const bought = g.r[d.id];
        const cost = this.researchCost(g, d);
        // Prerequisite gate (REPLAY_ROADMAP.md §5): existence-based, mirrors the
        // perk tree's reqLocked/reqName presentation.
        const reqMet = !d.req || !!g.r[d.req];
        const reqDef = d.req ? this.RESEARCH.find(x => x.id === d.req) : null;
        const ok = !bought && reqMet && g.clout >= cost;
        return { name: d.name, desc: d.desc, owned: bought ? 'done' : '',
          btn: bought ? 'Researched' : cost + ' Clout',
          meta: bought ? '' : (!reqMet ? '' : (ok ? 'ready' : this.fmt(cost - g.clout) + ' Clout short')),
          reqLocked: !reqMet,
          reqName: reqDef ? reqDef.name : (d.req || ''),
          locked: !ok, wrapStyle: cardWrap(!bought && reqMet), btnStyle: btn(ok, '#a855f7'), act: () => this.buyResearch(d) };
      });
    }

    const jobs = this.JOBS.map(j => {
      if (j.id === 'off') {
        // Passive roster row: count only, no steppers (PLAN §1.7).
        return { name: j.name, rawName: j.name, desc: j.desc, n: g.jobs.off, passive: true };
      }
      const unlocked = this.jobUnlocked(g, j);
      return {
        name: j.name, rawName: j.name, desc: j.desc, n: g.jobs[j.id], passive: false,
        locked: !unlocked,
        unlockName: j.unlock ? (this.RESEARCH.find(x => x.id === j.unlock) || {}).name : '',
        inc: () => this.moveJob(j.id, 1), dec: () => this.moveJob(j.id, -1),
        incLocked: !unlocked || g.jobs.off < 1 || (g.crew - g.jobs.off) >= cap.crew,
        decLocked: g.jobs[j.id] < 1,
        stepStyle: (locked) => ({ width: '26px', height: '26px', border: '1px solid ' + (locked ? '#1f1430' : '#3a2350'), borderRadius: '5px', background: locked ? '#120c1c' : '#170e22', color: locked ? '#4a3860' : '#e7d8f2', cursor: locked ? 'not-allowed' : 'pointer', fontSize: '14px', lineHeight: 1 })
      };
    });

    // Click / round numbers retuned for PLAN-NEXT §C pacing (active-play early curve).
    const clickVal = 1.15 + c.b.rail * 0.65 + c.hype * 0.07;
    // Single grant for Work the room: base click × totalCashMult — the same
    // composition point rates()/spawnWhale/takeGolden use, so the click payout
    // can't drift from the displayed value.
    const clickGrant = clickVal * this.totalCashMult(g);
    const roundPrice = this.roundPrice(g);
    const hypeRoom = Math.max(0, cap.hype - c.hype);
    const roundGain = Math.min(14, hypeRoom);
    const roundOk = c.cash >= roundPrice && roundGain > 0;

    // Prestige gate and preview data.
    const prestigeGate = (c.regulars || 0) >= 25;
    const prestigeGain = prestigeGate ? this.legacyGain(g) : 0;
    const prestigeRegulars = this.fmt(c.regulars);
    const prestigeNight = c.night;

    return {
      ...base,
      resources: resourcesOut, stats, tabs, cards, tabHint, jobs, ticker, crewOpen: this.state.tab === 'crew' && g.crew > 0,
      metaUnlocked,
      // Second room (SECOND_LOCATION.md §8): unlock control before annex exists,
      // compact switcher after. activeClubLabel names the room in the ledger.
      canOpenRoom: this.canOpenRoom(),
      clubSwitcher: Object.keys(g.clubs || {}).map(id => ({
        id,
        label: this.escapeHtml(id === 'main' ? 'Main' : id[0].toUpperCase() + id.slice(1)),
        active: id === g.activeClub,
        go: () => this.setActiveClub(id)
      })),
      activeClubLabel: this.escapeHtml(g.activeClub === 'main' ? 'Main Room' : g.activeClub[0].toUpperCase() + g.activeClub.slice(1)),
      openRoom: () => this.openRoom(),
      confirmOpenRoom: () => this.confirmOpenRoom(),
      closeOpenRoom: () => this.setState({ showOpenRoom: false }),
      prestigeGate,
      prestigeGain,
      prestigeRegulars,
      prestigeNight,
      confirmPrestige: () => this.confirmPrestige(),
      // Second prestige layer (REPLAY_ROADMAP.md §8): franchise sale gate +
      // Renown readout for the modal and the Perks panel.
      franchiseGate: this.franchiseGate(g),
      franchiseGain: this.franchiseGate(g) ? this.renownGain(g) : 0,
      renown: Math.floor(g.renown || 0),
      renownTotal: Math.floor(g.renownTotal || 0),
      confirmFranchiseSale: () => this.confirmFranchiseSale(),
      // Escape t/msg at the HTML boundary only (g.log stays raw for save round-trips).
      log: g.log.map(l => ({
        t: this.escapeHtml(l.t),
        msg: this.escapeHtml(l.msg),
        style: { color: this.safeLogColor(l.color) }
      })),
      shiftName: r.shift.name, nightNo: c.night, shiftMultLabel: 'x' + r.sm.toFixed(2),
      shiftBar: this.bar(c.shiftT / r.shift.len * 100, r.shift.tint),
      stageLine: g.jobs.stage > 0
        ? g.jobs.stage + ' on rotation'
        : (g.crew === 0
          ? 'hire crew to open the stage'
          : (g.jobs.off > 0 ? 'assign crew · Crew tab' : 'nobody on stage')),
      // Tooltip for the empty-stage caption when unaffordable
      stageLineTooltip: g.jobs.stage === 0 && g.crew === 0 && c.cash < 280
        ? 'Need $' + this.fmt(280 - c.cash) + ' cash to hire first crew'
        : '',
      // Empty-stage badge jumps to Crew so the next action is one click away.
      stageLineAct: g.jobs.stage > 0 ? null : () => this.setState({ tab: 'crew' }),
      energyPct: Math.round(c.hype / cap.hype * 100) + '%',
      // Stage visuals derived from live state (Task 2).
      crowdN: Math.min(14, 2 + Math.floor(c.patrons / 2)),
      crowdBobDur: (2.4 + 1.2 * (1 - Math.min(1, c.hype / cap.hype))).toFixed(2) + 's',
      beamOpacity: (0.25 + 0.55 * Math.min(1, c.hype / cap.hype)).toFixed(2),
      spotOpacity: (0.14 + 0.46 * Math.min(1, c.hype / cap.hype)).toFixed(2),
      signLit: g.jobs.stage > 0,
      clickValue: '$' + this.fmt(clickGrant),
      workCrowd: (e) => {
        if (this.state.tabStale) return;
        const val = clickGrant;
        c.cash += val;
        c.buzz = Math.min(cap.buzz, c.buzz + 0.12);
        g.clicks = (g.clicks || 0) + 1;
        this.noteGoals(g);
        this.checkAchievements(g);
        this.forceUpdate();
        this.spawnTipFloater(e, val);
      },
      roundLabel: 'Buy a round $' + this.fmt(roundPrice),
      roundLocked: !roundOk || this.state.tabStale,
      roundStyle: {
        background: roundOk && !this.state.tabStale ? '#170e22' : '#120c1c', border: '1px solid ' + (roundOk && !this.state.tabStale ? '#3a2350' : '#1f1430'),
        borderRadius: '8px', color: roundOk && !this.state.tabStale ? '#e7d8f2' : '#4a3860', padding: '13px 16px',
        cursor: roundOk && !this.state.tabStale ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 700, minWidth: '190px'
      },
      buyRound: () => {
        if (this.state.tabStale || !roundOk) return;
        c.cash -= roundPrice;
        c.hype = Math.max(0, Math.min(cap.hype, c.hype + 14));
        g.rounds = (g.rounds || 0) + 1;
        this.push(g, 'Bought the room a round. +' + this.fmt(roundGain) + ' Hype.', '#ffc94a');
        this.noteGoals(g);
        this.checkAchievements(g);
        this.forceUpdate();
      },
      // 0.10.2 golden ticket: compact side badge on the stage. The badge is
      // small, stays to the side, and lets the player open it when they want.
      // It no longer blocks the stage with a large modal; the idle sim keeps
      // ticking underneath. Buttons grey out on a stale tab.
      golden: g.golden ? (() => {
        // Preview resolves against the offer's SOURCE club so switching rooms
        // mid-TTL shows the real gain (and cap) where the ticket will land.
        const gc = this.club(g, g.golden.club);
        return {
          cashAmount: Math.floor(25 * this.totalCashMult(g)),
          crowdAmount: Math.round(Math.min(10, this.caps(g, gc).patrons - gc.patrons)),
          locked: this.state.tabStale
        };
      })() : null,
      goldenOpen: this.state.goldenOpen,
      openGolden: () => this.setState(s => ({ goldenOpen: true })),
      closeGolden: () => this.setState(s => ({ goldenOpen: false })),
      takeGoldenCash: () => this.takeGolden(g, 'cash'),
      takeGoldenCrowd: () => this.takeGolden(g, 'crowd'),
      debugLine: (this.props.showDebug ?? false) ? 'cash ' + r.cash.toFixed(3) + '/s · hype ' + r.hype.toFixed(3) + '/s · buzz ' + r.buzz.toFixed(3) + '/s · pull ' + r.pull.toFixed(2) : '',
      ownersList: (() => {
        const total = this.GOALS.length;
        const done = Array.isArray(g.goals) ? g.goals.length : 0;
        const goal = this.activeGoal(g);
        if (!goal) {
          return {
            done: true, n: total, total,
            title: 'Club runs itself',
            why: 'Word is a franchise man has been asking about you.',
            hint: 'Onboarding complete — keep the room humming.',
            reward: '', progress: null, flash: false, goalIdx: total, totalGoals: total
          };
        }
        const rew = goal.reward || {};
        const rparts = [];
        if (rew.cash) rparts.push('+$' + this.fmt(rew.cash));
        if (rew.clout) rparts.push('+' + this.fmt(rew.clout) + ' Clout');
        let progress = null;
        if (typeof goal.progress === 'function') {
          const p = goal.progress(g);
          if (p && p.max > 0) progress = { cur: Math.max(0, p.cur), max: p.max, pct: Math.min(100, (p.cur / p.max) * 100) };
        }
        // Onboarding pulse: true for first 3 goals (done < 3)
        const onboardingPulse = done < 3;
        return {
          done: false, n: done, total,
          title: goal.title,
          why: goal.why,
          hint: goal.hint,
          reward: rparts.join(' '),
          progress,
          flash: done > 0 && this.state.tick > 0,
          goalIdx: done,
          totalGoals: total,
          onboardingPulse
        };
      })(),
      // Endgame horizon (REPLAY_ROADMAP.md §10): a visible goal line — 3 clubs
      // and $1e12 franchise net worth — in the Owner's List "Vision" block.
      // Purely a target + progress readout computed from existing state; no new
      // mechanic, no save-shape change, and no economy coupling (read-only).
      horizon: (() => {
        const clubIds = Object.keys(g.clubs || {});
        const TARGET = 1e12;
        let worth = 0;
        for (const id of clubIds) worth += (g.clubs[id].cash || 0);
        const nClubs = clubIds.length;
        const done = nClubs >= 3 && worth >= TARGET;
        // Both legs must finish; the blended bar keeps one leg from hiding the
        // other (clubs 3/3 alone reads 50%).
        const pct = Math.round((Math.min(100, (nClubs / 3) * 100) + Math.min(100, (worth / TARGET) * 100)) / 2);
        return { nClubs, clubMax: 3, worth, target: TARGET, done, pct };
      })(),
      achievements: this.ACHIEVEMENTS.map(a => ({
        id: a.id,
        name: a.name,
        desc: a.desc,
        unlocked: (g.achievements || []).includes(a.id),
        reward: a.reward ? (a.reward.clout ? '+' + a.reward.clout + ' Clout' : '') + (a.reward.legacy ? ' +' + a.reward.legacy + ' Legacy' : '') : ''
      })),
      showAchievements: this.state.showAchievements,
      toggleAchievements: () => this.setState(s => ({ showAchievements: !s.showAchievements })),
    };
  }

  // --- render ---
  // Turns renderVals() into markup, mirroring the original template's
  // {{ interpolations }}, sc-for loops and sc-if branches with plain
  // template literals + a click-handler registry (data-h index).

  // --- look & feel (chrome prefs; separate key, never part of the save) ---
  LOOK_KEY = 'afterglow.look';
  LOOK_DEFAULT = { lights: 0, mood: 'pink', motion: 'full' };
  MOODS = {
    pink: { label: 'Hot Pink', deg: 0, sat: 1 },
    uv: { label: 'Ultraviolet', deg: 46, sat: 1.06 },
    sodium: { label: 'Sodium', deg: -32, sat: 0.84 }
  };
  MOTIONS = { full: 'Full', easy: 'Easy', still: 'Still' };

  loadLook() {
    let l = null;
    try { l = JSON.parse(localStorage.getItem(this.LOOK_KEY) || 'null'); } catch (e) { l = null; }
    const d = this.LOOK_DEFAULT;
    l = l && typeof l === 'object' ? l : {};
    this.look = {
      lights: Math.min(1, Math.max(0, Number(l.lights) || d.lights)),
      mood: this.MOODS[l.mood] ? l.mood : d.mood,
      motion: this.MOTIONS[l.motion] ? l.motion : d.motion
    };
  }

  saveLook() {
    try { localStorage.setItem(this.LOOK_KEY, JSON.stringify(this.look)); } catch (e) {}
  }

  applyLook() {
    const r = document.documentElement, l = this.look, m = this.MOODS[l.mood];
    r.style.setProperty('--lights', String(l.lights));
    r.style.setProperty('--mood-deg', m.deg + 'deg');
    r.style.setProperty('--mood-sat', String(m.sat));
    r.dataset.lights = l.lights > 0.02 ? 'on' : 'off';
    r.dataset.mood = l.mood;
    r.dataset.motion = l.motion;
  }

  // repaint:false is the continuous-input path — a full innerHTML repaint would
  // destroy the range input under the pointer and kill the drag on the first event.
  setLook(patch, repaint) {
    Object.assign(this.look, patch);
    this.applyLook();
    this.saveLook();
    if (!this.lookPanel) return;
    if (repaint === false) {
      const out = this.lookPanel.querySelector('[data-lk-out="lights"]');
      if (out) out.textContent = Math.round(this.look.lights * 100) + '%';
    } else {
      this.paintLookPanel();
    }
  }

  mountLook() {
    this.loadLook();
    this.applyLook();
    const p = document.createElement('div');
    // Lives outside #app so the 10fps innerHTML render cannot destroy a slider mid-drag.
    p.id = 'look-panel';
    p.style.cssText = 'position:fixed;right:16px;bottom:56px;width:250px;z-index:70;display:none;' +
      'background:#0e0918;border:1px solid #3a2350;border-radius:11px;box-shadow:0 24px 70px rgba(0,0,0,.72);' +
      "font-family:'Space Grotesk',system-ui,sans-serif;color:#f2e8f7";
    document.body.appendChild(p);
    this.lookPanel = p;
    p.addEventListener('input', (e) => {
      if (e.target.id === 'lk-lights') this.setLook({ lights: Number(e.target.value) / 100 }, false);
    });
    p.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-lk]');
      if (!b) return;
      const [k, val] = b.getAttribute('data-lk').split(':');
      if (k === 'close') this.toggleLook(false);
      else if (k === 'reset') this.setLook({ ...this.LOOK_DEFAULT });
      else this.setLook({ [k]: val });
    });
    this.paintLookPanel();
    window.addEventListener('keydown', (e) => {
      if (e.key === 'l' && !e.metaKey && !e.ctrlKey && !/input|textarea/i.test((e.target.tagName || ''))) this.toggleLook();
    });
  }

  toggleLook(force) {
    const p = this.lookPanel;
    if (!p) return;
    const open = force === undefined ? p.style.display === 'none' : !!force;
    p.style.display = open ? 'block' : 'none';
    if (open) this.paintLookPanel();
  }

  paintLookPanel() {
    const l = this.look;
    const seg = (key, map) => Object.keys(map).map(k => {
      const on = l[key] === k, lab = typeof map[k] === 'string' ? map[k] : map[k].label;
      return '<button data-lk="' + key + ':' + k + '" class="lk-seg" style="flex:1;min-width:0;padding:7px 4px;cursor:pointer;font-family:inherit;' +
        'font-size:10px;font-weight:700;letter-spacing:.4px;border-radius:6px;border:1px solid ' + (on ? '#ff2d78' : '#311d44') + ';' +
        'background:' + (on ? 'rgba(255,45,120,.16)' : '#150d21') + ';color:' + (on ? '#ff8bb4' : '#9c86ab') + ';' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + lab + '</button>';
    }).join('');
    const label = (t, v, out) => '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">' +
      '<span style="font-size:9px;letter-spacing:2.6px;text-transform:uppercase;color:#7b5f90;font-weight:700">' + t + '</span>' +
      '<span ' + (out ? 'data-lk-out="' + out + '" ' : '') + 'style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#6f5885">' + v + '</span></div>';
    this.lookPanel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #241536">' +
        '<span style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700">Look</span>' +
        '<button data-lk="close:1" style="width:24px;height:24px;border:1px solid #3a2350;border-radius:5px;background:#160d22;color:#9c86ab;cursor:pointer;font-size:12px;font-family:inherit">✕</button>' +
      '</div>' +
      '<div style="padding:13px 14px;display:flex;flex-direction:column;gap:15px">' +
        '<div>' + label('House lights', Math.round(l.lights * 100) + '%', 'lights') +
          '<input id="lk-lights" type="range" min="0" max="100" step="1" value="' + Math.round(l.lights * 100) + '" style="width:100%;accent-color:#ffc94a;cursor:pointer">' +
          '<div style="font-size:10px;color:#9c86ab;line-height:1.45;margin-top:5px">Kill the mystique. 0% is 1am, 100% is closing time with the lights up.</div>' +
        '</div>' +
        '<div>' + label('Room mood', this.MOODS[l.mood].label) +
          '<div style="display:flex;gap:6px">' + seg('mood', this.MOODS) + '</div>' +
        '</div>' +
        '<div>' + label('Motion', this.MOTIONS[l.motion]) +
          '<div style="display:flex;gap:6px">' + seg('motion', this.MOTIONS) + '</div>' +
          '<div style="font-size:10px;color:#9c86ab;line-height:1.45;margin-top:5px">Easy stills the stage but keeps the UI badges. Still freezes everything.</div>' +
        '</div>' +
        '<button data-lk="reset:1" style="background:#170e22;border:1px solid #311d44;border-radius:6px;color:#9c86ab;padding:8px;cursor:pointer;font-size:10.5px;font-family:inherit;font-weight:700">Reset look</button>' +
      '</div>';
  }

  mountFxLayer() {
    const fx = document.createElement('div');
    // Lives outside #app so the 1s innerHTML render cannot destroy transient floaters.
    fx.id = 'fx-layer';
    fx.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:80;overflow:hidden;';
    document.body.appendChild(fx);
    this.fxLayer = fx;
  }

  spawnTipFloater(e, clickVal) {
    if (!this.fxLayer) return;
    const f = document.createElement('span');
    f.className = 'tip-floater';
    f.textContent = '+$' + this.fmt(clickVal);
    if (e && e.clientX) {
      f.style.left = (e.clientX - 10) + 'px';
      f.style.top = (e.clientY - 24) + 'px';
    } else {
      // Keyboard activation (Enter/Space): clientX may be 0 — anchor to the CTA button.
      // Size-check the rect, don't just null-check the element: #stage is
      // display:none below 900px (v0.10.8), so it is truthy but measures 0×0 and
      // would drop the floater in the top-left corner.
      const btn = document.querySelector('[data-h] .cta') || document.getElementById('stage');
      let r = btn && btn.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) r = { left: innerWidth / 2, top: innerHeight / 2, width: 0 };
      f.style.left = (r.left + r.width / 2) + 'px';
      f.style.top = (r.top - 8) + 'px';
    }
    f.addEventListener('animationend', () => f.remove());
    this.fxLayer.appendChild(f);

    const stage = document.getElementById('stage');
    if (stage && stage.animate) {
      stage.animate(
        [{ filter: 'brightness(1.35)' }, { filter: 'brightness(1)' }],
        { duration: 140, easing: 'ease-out' }
      );
    }
  }

  spawnWhale(g) {
    const c = this.club(g);
    const mult = 1 + c.hype / 100;
    const bonus = Math.floor(50 * mult * this.totalCashMult(g));
    c.cash += bonus;
    // 0.10.1: lifetime whale counter (drives whale_1/whale_10).
    g.whalesCount = (g.whalesCount || 0) + 1;
    this.push(g, '\uD83D\uDC0B Whale spotted! +$' + this.fmt(bonus), '#ffd700');
    this.noteGoals(g);
    this.checkAchievements(g);
    // Visual: reuse fxLayer with whale emoji
    if (this.fxLayer) {
      const f = document.createElement('span');
      f.className = 'whale-floater';
      f.textContent = '\uD83D\uDC0B +$' + this.fmt(bonus);
      f.style.left = (innerWidth / 2 - 40) + 'px';
      f.style.top = (innerHeight / 2 - 100) + 'px';
      f.style.fontSize = '28px';
      f.addEventListener('animationend', () => f.remove());
      this.fxLayer.appendChild(f);
    }
    this.forceUpdate();
  }

  // 0.10.2: a reviewer visits at the start of a night during Peak (hype >= 30).
  // Strong room (patrons >= 20) → rave: +Hype bonus, +2 Clout. Weak room → pan:
  // −Hype. Live-only — the pacing bot and offline catchUp never call it.
  maybeCritic(g) {
    const c = this.club(g);
    if (!g || c.hype < 30) return;
    if (Math.random() >= this.CRITIC_CHANCE) return;
    if (c.patrons >= 20) {
      const bonus = Math.floor(8 + c.hype * 0.08);
      c.hype = Math.min(this.caps(g).hype, c.hype + bonus);
      g.clout = (g.clout || 0) + 2;
      this.push(g, 'A critic raves — +' + bonus + ' Hype, +2 Clout.', '#4ade80');
    } else {
      const penalty = Math.floor(12 + c.hype * 0.06);
      c.hype = Math.max(0, c.hype - penalty);
      this.push(g, 'A critic pans the room — ' + penalty + ' Hype.', '#ff2d78');
    }
    // Match the spawnWhale/takeGolden handler pattern: a rave's +Hype/+Clout can
    // cross a goal or achievement threshold — resolve it here, not next tick.
    this.noteGoals(g);
    this.checkAchievements(g);
  }

  // 0.10.2: rare floating offer — "VIP booked the booth". Spawns per live tick at
  // hype > 0, one at a time; resolved via takeGolden (stage overlay buttons).
  // g.golden is additive UI state (null when absent), so no SAVE_VER bump.
  // Roll scales by slice time like the whale roll (chunk / SIM): a lag spike that
  // packs several chunks into one step() call must not inflate the spawn rate,
  // and a trailing partial chunk (dt not a multiple of SIM) rolls proportionally.
  maybeGolden(g, chunk = this.SIM) {
    const cl = this.club(g);
    if (!g || cl.hype <= 0 || g.golden) return;
    const c = typeof chunk === 'number' && chunk > 0 ? chunk : this.SIM;
    if (Math.random() >= this.GOLDEN_CHANCE * (c / this.SIM)) return;
    // Bind the pending offer to the club it spawned in (SECOND_LOCATION.md §5):
    // switching rooms before the 30s TTL must not let the ticket's cash/patrons
    // cross the no-transfer boundary into another club.
    g.golden = { at: Date.now(), club: g.activeClub };
    this.push(g, 'VIP booked the booth — golden ticket!', '#ffc94a');
  }

  // 0.10.2: clear a golden offer whose 30s TTL has lapsed (wall-clock). Called
  // from live step() and catchUp() so a reload after offline never renders a dead
  // offer. Deterministic — no random roll, pacing-bot safe.
  expireGolden(g) {
    if (g && g.golden && Date.now() - g.golden.at >= this.GOLDEN_TTL * 1000) {
      g.golden = null;
      this.state.goldenOpen = false;
    }
  }

  // Resolve the active golden offer: 'cash' (income-scaled tip) or 'crowd'
  // (+patrons, capped). Idempotent — returns false when no offer is active.
  // Stale-tab guard matches every other mutating action: a paused duplicate tab
  // must not mutate local state that save() (no-op there) would silently discard.
  takeGolden(g, choice) {
    if (!g || !g.golden) return false;
    if (this.state.tabStale) return false;
    // Resolve against the club the offer spawned in (own-property fallback in
    // club() keeps a crafted/old {at}-only golden on a real club).
    const c = this.club(g, g.golden.club);
    if (choice === 'crowd') {
      const before = c.patrons;
      c.patrons = Math.min(this.caps(g, c).patrons, c.patrons + 10);
      const added = Math.round(c.patrons - before);
      this.push(g, 'Golden ticket: VIP brought friends. +' + added + ' patrons.', '#ffc94a');
    } else {
      const amount = Math.floor(25 * this.totalCashMult(g));
      c.cash += amount;
      this.push(g, 'Golden ticket: VIP tipped $' + this.fmt(amount) + '.', '#ffc94a');
    }
    g.golden = null;
    this.state.goldenOpen = false;
    // Match the whale/tip handler pattern: a patrons/cash change can complete a
    // goal or achievement — resolve it here, not one tick later.
    this.noteGoals(g);
    this.checkAchievements(g);
    this.forceUpdate();
    return true;
  }

  bind(fn) {
    this.handlers.push(fn);
    return this.handlers.length - 1;
  }

  render() {
    this.handlers = [];
    if (!this.scrollSave) this.scrollSave = {};
    this.root.querySelectorAll('[data-scroll]').forEach(el => {
      this.scrollSave[el.getAttribute('data-scroll')] = [el.scrollTop, el.scrollLeft];
    });
    const v = this.renderVals();

    const resRow = r => `
      <div style="border:1px solid #221434;border-radius:7px;background:#0f0a18;padding:8px 9px">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:6px">
          <span style="font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:#9c86ab;font-weight:700">${r.name}</span>
          <span style="${css(r.valStyle)}">${r.val}</span>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-top:4px">
          <div style="flex:1;height:4px;background:#1c1129;border-radius:3px;overflow:hidden">
            <div style="${css(r.barStyle)}"></div>
          </div>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#6f5885;min-width:56px;text-align:right">${r.rate}</span>
        </div>
        <div style="font-size:10px;color:#9c86ab;margin-top:3px">${r.note}</div>
      </div>`;
    // CASH stays visible when the Ledger is collapsed on narrow screens (mobile
    // players always see the money); the rest folds behind the tap-to-expand.
    const cashRow = v.resources[0] ? resRow(v.resources[0]) : '';
    const ledgerDetailRows = v.resources.slice(1).map(resRow).join('');

    const statRows = v.stats.map(s => `
      <div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:11px">
        <span style="color:#9c86ab">${s.k}</span>
        <span style="font-family:'IBM Plex Mono',monospace;color:#e7d8f2;font-weight:500">${s.v}</span>
      </div>`).join('');

    const logRows = v.log.map(l => `
      <div style="display:flex;gap:9px;font-size:11.5px;line-height:1.5">
        <span style="font-family:'IBM Plex Mono',monospace;color:#4a3860;min-width:46px">${l.t}</span>
        <span style="${css(l.style)}">${l.msg}</span>
      </div>`).join('');

    const tabRows = v.tabs.map(tb => `
      <button data-h="${this.bind(tb.go)}" style="${css(tb.style)}">${tb.label}</button>`).join('');

    const cardRows = v.cards.map(cd => `
      <div style="${css(cd.wrapStyle)}">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
          <span style="font-size:13px;font-weight:700;color:#f2e8f7">${cd.name}</span>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#22d3ee">${cd.owned}</span>
        </div>
        <div style="font-size:11px;color:#8b76a0;line-height:1.45;margin:4px 0 8px">${cd.desc}</div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${cd.reqLocked
            ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#6f5885;font-weight:600;min-width:104px;text-align:center;padding:8px 12px">requires ${cd.reqName}</span>`
            : cd.multi && !cd.multi.maxed
              ? `<div style="display:flex;gap:6px;align-items:center">
                  <button data-h="${this.bind(cd.multi.x1.act)}" ${cd.buildingId ? `data-building-id="${cd.buildingId}"` : ''} ${cd.multi.x1.locked ? 'disabled' : ''} title="Shift-click to buy the maximum affordable" style="${css({ ...cd.multi.x1.style, minWidth: '40px', padding: '8px 6px' })}">×1</button>
                  <button data-h="${this.bind(cd.multi.x5.act)}" ${cd.buildingId ? `data-building-id="${cd.buildingId}"` : ''} ${cd.multi.x5.locked ? 'disabled' : ''} style="${css({ ...cd.multi.x5.style, minWidth: '40px', padding: '8px 6px' })}">${cd.multi.x5.label}</button>
                  <button data-h="${this.bind(cd.multi.x10.act)}" ${cd.buildingId ? `data-building-id="${cd.buildingId}"` : ''} ${cd.multi.x10.locked ? 'disabled' : ''} style="${css({ ...cd.multi.x10.style, minWidth: '40px', padding: '8px 6px' })}">${cd.multi.x10.label}</button>
                  <button data-h="${this.bind(cd.multi.max.act)}" ${cd.buildingId ? `data-building-id="${cd.buildingId}"` : ''} ${cd.multi.max.locked ? 'disabled' : ''} style="${css({ ...cd.multi.max.style, minWidth: '48px', padding: '8px 6px' })}">${cd.multi.max.label}</button>
                </div>`
              : `<button data-h="${this.bind(cd.act)}" ${cd.buildingId ? `data-building-id="${cd.buildingId}"` : ''} ${cd.locked ? 'disabled' : ''} title="${cd.buildingId ? 'Shift-click to buy the maximum affordable' : (cd.btnTooltip || '')}" style="${css(cd.btnStyle)}">${cd.btn}</button>
        ${cd.subAct ? `<button data-h="${this.bind(cd.subAct)}" ${cd.subLocked ? 'disabled' : ''} style="${css(cd.subStyle)}">${cd.subBtn}</button>` : ''}`}
          <span style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#6f5885;text-align:right;flex:1">${cd.meta}</span>
        </div>
      </div>`).join('');

    const jobRows = v.jobs.map(j => j.passive ? `
      <div style="display:flex;align-items:center;gap:9px;border:1px solid #1a1228;border-radius:7px;background:#0c0814;padding:8px 9px;opacity:0.88">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:#9c86ab">${j.name}</div>
          <div style="font-size:10px;color:#9c86ab">${j.desc}</div>
        </div>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#6f5885;min-width:20px;text-align:center;font-weight:600">${j.n}</span>
      </div>` : `
      <div style="display:flex;align-items:center;gap:9px;border:1px solid #221434;border-radius:7px;background:#0f0a18;padding:8px 9px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:#e7d8f2">${j.name}</div>
          <div style="font-size:10px;color:#6f5885">${j.desc}</div>
        </div>
        ${j.locked
          ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#6f5885;font-weight:600;text-align:right">requires ${j.unlockName}</span>`
          : `<button data-h="${this.bind(j.dec)}" ${j.decLocked ? 'disabled' : ''} title="${j.decLocked ? 'No crew assigned here' : `Remove crew from ${j.rawName}`}" style="${css(j.stepStyle(j.decLocked))}">−</button>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#ffc94a;min-width:20px;text-align:center;font-weight:600">${j.n}</span>
        <button data-h="${this.bind(j.inc)}" ${j.incLocked ? 'disabled' : ''} title="${j.incLocked ? 'No free crew available' : `Assign crew to ${j.rawName}`}" style="${css(j.stepStyle(j.incLocked))}">+</button>`}
      </div>`).join('');

    const assignments = v.crewOpen ? `
      <div style="margin-top:14px;border-top:1px solid #221434;padding-top:12px">
        <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700;margin-bottom:9px">Assignments</div>
        <div style="display:flex;flex-direction:column;gap:7px">${jobRows}</div>
      </div>` : '';

    const changelogModal = v.showChangelog ? `
      <div style="position:fixed;inset:0;background:rgba(5,3,9,.82);display:flex;align-items:center;justify-content:center;z-index:60;padding:32px">
        <div style="width:560px;max-height:78vh;overflow-y:auto;background:#0e0918;border:1px solid #3a2350;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.7)">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #241536;position:sticky;top:0;background:#0e0918">
            <div>
              <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700">Version history</div>
              <div style="font-family:'IBM Plex Mono',monospace;font-size:15px;color:#ffc94a;font-weight:600">${v.verFull}</div>
            </div>
            <button data-h="${this.bind(v.toggleChangelog)}" class="hv-pink" style="width:30px;height:30px;border:1px solid #3a2350;border-radius:6px;background:#160d22;color:#9c86ab;cursor:pointer;font-size:14px">✕</button>
          </div>
          <div style="padding:16px 18px;display:flex;flex-direction:column;gap:16px">
            ${v.changelog.map(c => `
              <div>
                <div style="display:flex;align-items:baseline;gap:9px;margin-bottom:6px">
                  <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;font-weight:600;color:#ff2d78">v${c.v}</span>
                  <span style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#9c86ab">${c.date}</span>
                  <span style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#7b5f90;font-weight:700">${c.codename}</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:4px">
                  ${c.notes.map(n => `
                    <div style="display:flex;gap:8px;font-size:11.5px;line-height:1.5;color:#b9a5c9">
                      <span style="color:#3f2b56">—</span>
                      <span>${n}</span>
                    </div>`).join('')}
                </div>
              </div>`).join('')}
          </div>
        </div>
      </div>` : '';

    const prestigeModal = v.showPrestige ? `
      <div style="position:fixed;inset:0;background:rgba(5,3,9,.82);display:flex;align-items:center;justify-content:center;z-index:60;padding:32px">
        <div style="width:480px;background:#0e0918;border:1px solid #3a2350;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.7)">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #241536">
            <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700">Franchise offer</div>
            <button data-h="${this.bind(v.togglePrestige)}" class="hv-pink" style="width:30px;height:30px;border:1px solid #3a2350;border-radius:6px;background:#160d22;color:#9c86ab;cursor:pointer;font-size:14px">✕</button>
          </div>
          <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px">
            <div style="font-size:12px;color:#b9a5c9;line-height:1.5">Sign the club over. Keep the know-how as <strong style="color:#d4af37">Legacy</strong>. Reopen under the banner.</div>
            <div style="border:1px solid #2f1c42;border-radius:8px;background:#100a1a;padding:12px;display:flex;flex-direction:column;gap:8px">
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-size:11px;color:#9c86ab">You will earn</span>
                <span style="font-family:'IBM Plex Mono',monospace;font-size:16px;color:#d4af37;font-weight:700">+${v.prestigeGain} Legacy</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-size:11px;color:#9c86ab">You keep</span>
                <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#e7d8f2">Legacy bank, perks, prestige count</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-size:11px;color:#9c86ab">You reset</span>
                <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#e7d8f2">cash, room, buildings, upgrades, research, crew, goals</span>
              </div>
              <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#6f5885;margin-top:2px">regulars ${v.prestigeRegulars} · night ${v.prestigeNight}</div>
            </div>
            <button data-h="${this.bind(v.confirmPrestige)}" ${v.tabStale ? 'disabled' : ''} style="background:${v.tabStale ? '#1a1226' : 'linear-gradient(180deg,#ff3d85,#d81259)'};border:0;border-radius:8px;color:${v.tabStale ? '#9c86ab' : '#fff'};font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:13px 16px;cursor:${v.tabStale ? 'not-allowed' : 'pointer'}">${v.tabStale ? 'Reload to adopt fresh save before signing' : 'Sign the deal'}</button>
            <button data-h="${this.bind(v.togglePrestige)}" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700">Not yet</button>
          </div>
        </div>
      </div>` : '';

    const franchiseModal = v.showFranchise ? `
      <div style="position:fixed;inset:0;background:rgba(5,3,9,.82);display:flex;align-items:center;justify-content:center;z-index:60;padding:32px">
        <div style="width:480px;background:#0e0918;border:1px solid #22d3ee;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.7)">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #241536">
            <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#22d3ee;font-weight:700">Sell the franchise</div>
            <button data-h="${this.bind(v.toggleFranchise)}" class="hv-pink" style="width:30px;height:30px;border:1px solid #3a2350;border-radius:6px;background:#160d22;color:#9c86ab;cursor:pointer;font-size:14px">✕</button>
          </div>
          <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px">
            <div style="font-size:12px;color:#b9a5c9;line-height:1.5">The chain wants your name on every marquee in the country. Cash out, keep the brand, and build something bigger. <strong style="color:#22d3ee">Renown</strong> is the brand's national footprint — it never wipes.</div>
            <div style="border:1px solid #2f1c42;border-radius:8px;background:#100a1a;padding:12px;display:flex;flex-direction:column;gap:8px">
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-size:11px;color:#9c86ab">You will earn</span>
                <span style="font-family:'IBM Plex Mono',monospace;font-size:16px;color:#22d3ee;font-weight:700">+${v.franchiseGain} Renown</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-size:11px;color:#9c86ab">You keep</span>
                <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#e7d8f2">Renown (${v.renown} spare · ${v.renownTotal} lifetime) · achievements · Brand ranks</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-size:11px;color:#9c86ab">You reset</span>
                <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#ff7aa8">EVERYTHING else — both clubs, Legacy, perks, research, Clout, managers, crew, challenges</span>
              </div>
            </div>
            <button data-h="${this.bind(v.confirmFranchiseSale)}" ${v.tabStale ? 'disabled' : ''} style="background:${v.tabStale ? '#1a1226' : v.franchiseArmed ? '#0e3b45' : 'linear-gradient(180deg,#22d3ee,#0e7490)'};border:1px solid ${v.tabStale ? '#1a1226' : '#22d3ee'};border-radius:8px;color:${v.tabStale ? '#9c86ab' : '#fff'};font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:13px 16px;cursor:${v.tabStale ? 'not-allowed' : 'pointer'}">${v.tabStale ? 'Reload to adopt fresh save before selling' : v.franchiseArmed ? '⚠ Confirm sale — click again. This cannot be undone.' : 'Sell the franchise'}</button>
            <button data-h="${this.bind(v.toggleFranchise)}" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700">Not yet</button>
          </div>
        </div>
      </div>` : '';

    const openRoomModal = v.showOpenRoom ? `
      <div style="position:fixed;inset:0;background:rgba(5,3,9,.82);display:flex;align-items:center;justify-content:center;z-index:60;padding:32px">
        <div style="width:480px;background:#0e0918;border:1px solid #3a2350;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.7)">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #241536">
            <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700">Open second room</div>
            <button data-h="${this.bind(v.closeOpenRoom)}" class="hv-pink" style="width:30px;height:30px;border:1px solid #3a2350;border-radius:6px;background:#160d22;color:#9c86ab;cursor:pointer;font-size:14px">✕</button>
          </div>
          <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px">
            <div style="font-size:12px;color:#b9a5c9;line-height:1.5">The backer offers a lease on a second room. Same neon, different zip code. <strong style="color:#22d3ee">Cash is local; reputation is not.</strong></div>
            <div style="border:1px solid #2f1c42;border-radius:8px;background:#100a1a;padding:12px;display:flex;flex-direction:column;gap:8px">
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-size:11px;color:#9c86ab">New room</span>
                <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#e7d8f2">fresh till, fresh crowd, fresh build</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-size:11px;color:#9c86ab">Stays shared</span>
                <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#e7d8f2">Clout · Legacy · research · crew · managers</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:baseline">
                <span style="font-size:11px;color:#9c86ab">First club</span>
                <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#e7d8f2">untouched — switch anytime</span>
              </div>
            </div>
            <button data-h="${this.bind(v.confirmOpenRoom)}" ${v.tabStale ? 'disabled' : ''} style="background:${v.tabStale ? '#1a1226' : 'linear-gradient(180deg,#22d3ee,#0e7490)'};border:0;border-radius:8px;color:${v.tabStale ? '#9c86ab' : '#fff'};font-weight:700;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:13px 16px;cursor:${v.tabStale ? 'not-allowed' : 'pointer'}">${v.tabStale ? 'Reload to adopt fresh save first' : 'Open the annex'}</button>
            <button data-h="${this.bind(v.closeOpenRoom)}" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700">Not now</button>
          </div>
        </div>
      </div>` : '';

    const settingsModal = v.showSettings ? `
      <div style="position:fixed;inset:0;background:rgba(5,3,9,.82);display:flex;align-items:center;justify-content:center;z-index:60;padding:32px">
        <div style="width:420px;background:#0e0918;border:1px solid #3a2350;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.7)">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #241536">
            <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700">Settings</div>
            <button data-h="${this.bind(v.toggleSettings)}" class="hv-pink" style="width:30px;height:30px;border:1px solid #3a2350;border-radius:6px;background:#160d22;color:#9c86ab;cursor:pointer;font-size:14px">✕</button>
          </div>
          <div style="padding:16px 18px;display:flex;flex-direction:column;gap:10px">
            <button data-h="${this.bind(v.saveNow)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Save now</button>
            <button data-h="${this.bind(v.downloadSave)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Download save (.json)</button>
            <button data-h="${this.bind(v.importSaveFile)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Load save from file…</button>
            <button data-h="${this.bind(v.exportSave)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Copy save to clipboard</button>
            <button data-h="${this.bind(v.importSave)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Restore save from clipboard</button>
            <button data-h="${this.bind(v.openLook)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Look &amp; feel…  <span style="color:#6f5885;font-weight:400">(L)</span></button>
            <button data-h="${this.bind(v.toggleAchievements)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Achievements… <span style="color:#6f5885;font-weight:400">${v.achievements.filter(a => a.unlocked).length}/${v.achievements.length}</span></button>
            <button data-h="${this.bind(v.hardReset)}" style="${css(v.resetStyle)}">${v.resetLabel}</button>
            <div style="font-size:10.5px;color:#9c86ab;line-height:1.5;font-family:'IBM Plex Mono',monospace">${v.resetHint} Files and clipboard saves are the same format — either restores either way. ${v.verFull} · save format v${v.saveVer}</div>
          </div>
        </div>
      </div>` : '';

    const achievementsModal = v.showAchievements ? `
      <div style="position:fixed;inset:0;background:rgba(5,3,9,.82);display:flex;align-items:center;justify-content:center;z-index:60;padding:32px">
        <div style="width:560px;max-height:78vh;overflow-y:auto;background:#0e0918;border:1px solid #3a2350;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.7)">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #241536;position:sticky;top:0;background:#0e0918">
            <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700">Achievements</div>
            <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#ffd700">${v.achievements.filter(a => a.unlocked).length} / ${v.achievements.length}</div>
            <button data-h="${this.bind(v.toggleAchievements)}" class="hv-pink" style="width:30px;height:30px;border:1px solid #3a2350;border-radius:6px;background:#160d22;color:#9c86ab;cursor:pointer;font-size:14px">✕</button>
          </div>
          <div style="padding:16px 18px;display:flex;flex-direction:column;gap:8px">
            ${v.achievements.map(a => `
              <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid ${a.unlocked ? '#2f1c42' : '#1c1129'};border-radius:8px;background:${a.unlocked ? '#100a1a' : '#0c0714'};opacity:${a.unlocked ? 1 : 0.55}">
                <span style="font-size:20px">${a.unlocked ? '🏆' : '🔒'}</span>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:700;color:${a.unlocked ? '#ffd700' : '#9c86ab'}">${a.name}</div>
                  <div style="font-size:10.5px;color:#6f5885">${a.desc}</div>
                  ${a.reward ? `<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#ffc94a;margin-top:2px">${a.reward}</div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>` : '';

    this.root.innerHTML = `
<div style="height:100vh;height:100dvh;display:grid;grid-template-rows:auto auto 1fr auto;grid-template-columns:minmax(0,1fr);background:radial-gradient(1200px 700px at 50% -10%,#1a0e26 0%,#07050c 62%);overflow:hidden">

  <header style="display:flex;align-items:center;gap:20px;padding:0 18px;height:62px;border-bottom:1px solid #2a1738;background:linear-gradient(180deg,#140b1f,#0b0712);position:relative;z-index:20">
    <div style="display:flex;align-items:baseline;gap:12px">
      <span style="font-family:'Monoton',cursive;font-size:24px;color:#ff2d78;letter-spacing:1px;text-shadow:0 0 12px rgba(255,45,120,.75),0 0 34px rgba(255,45,120,.35);animation:neonFlicker 7s infinite">Afterglow</span>
      <span style="font-size:10px;letter-spacing:3.5px;text-transform:uppercase;color:#7b5f90;font-weight:700">Club Idle</span>
    </div>

    <button data-h="${this.bind(v.toggleChangelog)}" title="Version history" class="hv-pink" style="display:flex;align-items:center;gap:9px;background:#170e22;border:1px solid #3a2350;border-radius:6px;padding:6px 11px;cursor:pointer;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#d6c2e6">
      <span style="width:6px;height:6px;border-radius:50%;background:#22d3ee;box-shadow:0 0 7px #22d3ee;animation:pulseDot 2.2s infinite"></span>
      <span style="color:#ffc94a;font-weight:600">${v.verLabel}</span>
      <span style="color:#9c86ab">|</span>
      <span>build ${v.verBuild}</span>
      <span style="color:#9c86ab">|</span>
      <span style="text-transform:uppercase;letter-spacing:1px;color:#ff2d78">${v.verChannel}</span>
      <span style="font-size:9px;color:#9c86ab;white-space:nowrap">${(n => v.lastAutoSave
                ? (n - v.lastAutoSave < 1000 ? 'Just now' :
                   n - v.lastAutoSave < 60000 ? Math.floor((n - v.lastAutoSave) / 1000) + 's ago' :
                   n - v.lastAutoSave < 3600000 ? Math.floor((n - v.lastAutoSave) / 60000) + 'm ago' :
                   Math.floor((n - v.lastAutoSave) / 3600000) + 'h ago')
                : 'never')(Date.now())}</span>
    </button>

    <div style="flex:1"></div>

    ${v.prestigeGate ? `
    <button data-h="${this.bind(v.togglePrestige)}" class="cta" style="background:linear-gradient(180deg,#a855f7,#7c3aed);border:0;border-radius:8px;color:#fff;font-weight:700;font-size:12px;letter-spacing:1px;text-transform:uppercase;padding:8px 14px;cursor:pointer;box-shadow:0 0 18px rgba(168,85,247,.35)">Franchise offer</button>` : ''}

    ${v.canOpenRoom ? `
    <button data-h="${this.bind(v.openRoom)}" class="cta hv-cyan" style="background:linear-gradient(180deg,#22d3ee,#0e7490);border:0;border-radius:8px;color:#fff;font-weight:700;font-size:12px;letter-spacing:1px;text-transform:uppercase;padding:8px 14px;cursor:pointer;box-shadow:0 0 18px rgba(34,211,238,.3)">Open second room</button>` : ''}

    ${v.clubSwitcher.length > 1 ? `
    <div style="display:flex;gap:6px">
      ${v.clubSwitcher.map(cl => `<button data-h="${this.bind(cl.go)}" title="${cl.label}" style="background:${cl.active ? '#170e22' : 'transparent'};border:1px solid ${cl.active ? '#ff2d78' : '#2f1c42'};border-radius:6px;padding:7px 12px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${cl.active ? '#fff' : '#7b5f90'}">${cl.label}</button>`).join('')}
    </div>` : ''}

    <div style="display:flex;align-items:center;gap:14px">
      <div style="text-align:right;line-height:1.15">
        <div style="font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:#7b5f90;font-weight:700">Shift</div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#22d3ee;font-weight:600">${v.shiftName}</div>
      </div>
      <div style="width:112px;height:34px;border:1px solid #2f1c42;border-radius:6px;background:#100a19;padding:4px;display:flex;flex-direction:column;justify-content:space-between">
        <div style="height:5px;background:#241635;border-radius:3px;overflow:hidden">
          <div style="${css(v.shiftBar)}"></div>
        </div>
        <div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#9c86ab;display:flex;justify-content:space-between">
          <span>night ${v.nightNo}</span>
          <span style="color:#ffc94a">${v.shiftMultLabel}</span>
        </div>
      </div>
      <button data-h="${this.bind(v.toggleSettings)}" class="hv-pink" style="width:34px;height:34px;border:1px solid #2f1c42;border-radius:6px;background:#100a19;color:#9c86ab;cursor:pointer;font-size:15px">☰</button>
    </div>
  </header>

  <div class="ticker-bar" style="display:flex;align-items:center;gap:9px;padding:3px 18px;background:#0d0814;border-bottom:1px solid #2a1738;overflow:hidden;white-space:nowrap">
    <span style="font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:2px;color:#ff2d78;font-weight:700;flex-shrink:0">TODAY</span>
    <span class="ticker-text" style="font-size:11px;color:#9c86ab;text-overflow:ellipsis;overflow:hidden">${v.ticker}</span>
  </div>

  <main data-scroll="main" class="shell-grid">

    <aside data-scroll="ledger" class="${v.ledgerOpen ? '' : 'ledger-collapsed'}" style="border-right:1px solid #2a1738;background:#0a0611;overflow-y:auto;padding:14px 12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700">Ledger</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#22d3ee;font-weight:700;letter-spacing:1px;text-transform:uppercase">${v.activeClubLabel}</span>
          <button data-h="${this.bind(v.toggleLedger)}" class="ledger-toggle hv-pink" title="${v.ledgerOpen ? 'Collapse ledger' : 'Expand ledger'}" style="width:44px;height:44px;border:1px solid #2f1c42;border-radius:8px;background:#100a19;color:#9c86ab;cursor:pointer;font-size:16px;line-height:1">${v.ledgerOpen ? '▾' : '▸'}</button>
        </div>
      </div>
      <div class="ledger-cash" style="display:flex;flex-direction:column;gap:9px">${cashRow}</div>
      <div class="ledger-detail">
        <div style="display:flex;flex-direction:column;gap:9px">${ledgerDetailRows}</div>
        <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700;margin:18px 0 8px">Floor</div>
        <div style="border:1px solid #221434;border-radius:7px;background:#0f0a18;padding:9px">${statRows}</div>
      </div>
    </aside>

    <section class="stage-col" style="display:grid;grid-template-rows:minmax(190px,1fr) auto 132px;min-height:0;min-width:0">

      <div id="stage" style="position:relative;overflow:hidden;min-height:0;background:linear-gradient(180deg,#12081c 0%,#1a0b26 55%,#0d0715 100%);border-bottom:1px solid #2a1738">
        <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,45,120,.05) 0 2px,transparent 2px 62px);opacity:${v.beamOpacity}"></div>
        <div style="position:absolute;top:0;left:0;right:0;height:22px;display:flex;justify-content:center;gap:16px;align-items:center;background:linear-gradient(180deg,#1e1029,transparent);opacity:${v.signLit ? 1 : 0.35}">
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite 0s;opacity:${v.signLit ? 1 : 0.45}"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite .2s;opacity:${v.signLit ? 1 : 0.45}"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite .4s;opacity:${v.signLit ? 1 : 0.45}"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite .6s;opacity:${v.signLit ? 1 : 0.45}"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite .8s;opacity:${v.signLit ? 1 : 0.45}"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite 1s;opacity:${v.signLit ? 1 : 0.45}"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite 1.2s;opacity:${v.signLit ? 1 : 0.45}"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite 1.4s;opacity:${v.signLit ? 1 : 0.45}"></span>
        </div>

        <div class="stage-neon" style="position:absolute;top:25px;left:50%;transform:translateX(-50%);white-space:nowrap;font-family:'Monoton',cursive;font-size:13px;color:${v.signLit ? '#22d3ee' : '#5c3a52'};letter-spacing:2px;text-shadow:${v.signLit ? '0 0 10px rgba(34,211,238,.8),0 0 30px rgba(34,211,238,.4)' : 'none'};animation:${v.signLit ? 'neonFlicker 9s infinite' : 'none'};opacity:${v.signLit ? .9 : .55};transition:color .4s,opacity .4s,text-shadow .4s">girls girls girls</div>

        <div style="position:absolute;top:-10%;left:26%;width:120px;height:78%;transform-origin:50% 0;background:linear-gradient(180deg,rgba(255,45,120,.42),rgba(255,45,120,0));filter:blur(14px);animation:sweepL 9s ease-in-out infinite;opacity:${v.beamOpacity}"></div>
        <div style="position:absolute;top:-10%;right:26%;width:120px;height:78%;transform-origin:50% 0;background:linear-gradient(180deg,rgba(34,211,238,.34),rgba(34,211,238,0));filter:blur(14px);animation:sweepR 11s ease-in-out infinite;opacity:${v.beamOpacity}"></div>

        <div style="position:absolute;left:50%;bottom:26%;transform:translateX(-50%);width:230px;height:56px;border-radius:50%;background:radial-gradient(closest-side,rgba(255,232,180,.34),rgba(255,232,180,0));filter:blur(6px);opacity:${v.spotOpacity}"></div>

        <div style="position:absolute;left:0;right:0;bottom:24%;height:1px;background:linear-gradient(90deg,transparent,#ff2d78,transparent);opacity:${Math.max(0.25, v.beamOpacity * 0.75).toFixed(2)}"></div>
        <div style="position:absolute;left:0;right:0;bottom:0;height:24%;background:linear-gradient(180deg,#1b1027,#0a0611);border-top:1px solid #38204d"></div>

        <div class="crowd-row">
          ${Array.from({ length: v.crowdN }, (_, i) => {
            const h = 34 + (i % 5) * 6;
            const w = 22 + (i % 4) * 3;
            const del = (i * 0.31) % 1.4;
            const cols = ['#160d20','#120a1b','#180e23','#150c1f','#110919','#170d21'];
            return `<span class="crowd-sil" style="--crowd-dur:${v.crowdBobDur};--crowd-del:${del.toFixed(2)}s;width:${w}px;height:${h}px;background:${cols[i % cols.length]}"></span>`;
          }).join('')}
        </div>

        <div style="position:absolute;left:14px;top:14px;display:flex;flex-direction:column;gap:5px">
          <div style="font-size:9px;letter-spacing:2.6px;text-transform:uppercase;color:#7b5f90;font-weight:700">Main Stage</div>
          ${v.stageLineAct
            ? `<button data-h="${this.bind(v.stageLineAct)}" class="hv-pink" title="${v.stageLineTooltip || 'Open Crew tab'}" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#ff2d78;background:transparent;border:0;padding:0;cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:3px">${v.stageLine}</button>`
            : `<div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#ff2d78">${v.stageLine}</div>`}
        </div>

        <div style="position:absolute;right:14px;top:14px;text-align:right">
          <div style="font-size:9px;letter-spacing:2.6px;text-transform:uppercase;color:#7b5f90;font-weight:700">Room energy</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:26px;color:#ffc94a;font-weight:600;line-height:1.1">${v.energyPct}</div>
        </div>

        ${v.golden ? `
        <div style="position:absolute;right:10px;top:10px;z-index:5;display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          ${v.goldenOpen ? `
          <div style="background:linear-gradient(180deg,#38260a,#1c1105);border:1px solid #ffc94a;border-radius:10px;padding:10px 12px;text-align:left;box-shadow:0 0 28px rgba(255,201,74,.35);min-width:170px;max-width:220px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <div style="font-size:9px;letter-spacing:2.4px;text-transform:uppercase;color:#ffc94a;font-weight:700">Golden ticket</div>
              <button data-h="${this.bind(v.closeGolden)}" style="background:transparent;border:0;color:#8b7355;font-size:14px;line-height:1;cursor:pointer;padding:0 0 0 8px">×</button>
            </div>
            <div style="font-size:11px;color:#f3e2c2;margin-bottom:8px">VIP booked the booth.</div>
            <div style="display:flex;gap:6px">
              <button data-h="${this.bind(v.takeGoldenCash)}" ${v.golden.locked ? 'disabled' : ''} style="flex:1;background:${v.golden.locked ? '#2a1d0a' : 'linear-gradient(180deg,#ffc94a,#b8860b)'};border:0;border-radius:6px;color:${v.golden.locked ? '#6b5212' : '#1c1105'};font-weight:700;font-size:10px;padding:6px 8px;cursor:${v.golden.locked ? 'not-allowed' : 'pointer'}">+$${this.fmt(v.golden.cashAmount)}</button>
              <button data-h="${this.bind(v.takeGoldenCrowd)}" ${v.golden.locked ? 'disabled' : ''} style="flex:1;background:${v.golden.locked ? '#1a1226' : '#170e22'};border:1px solid ${v.golden.locked ? '#2a1738' : '#ffc94a'};border-radius:6px;color:${v.golden.locked ? '#5a3a70' : '#ffc94a'};font-weight:700;font-size:10px;padding:6px 8px;cursor:${v.golden.locked ? 'not-allowed' : 'pointer'}">+${v.golden.crowdAmount} crowd</button>
            </div>
          </div>` : `
          <button data-h="${this.bind(v.openGolden)}" style="background:linear-gradient(180deg,#ffc94a,#b8860b);border:0;border-radius:20px;padding:6px 10px;box-shadow:0 0 18px rgba(255,201,74,.45);display:flex;align-items:center;gap:6px;cursor:pointer;animation:pulseDot 1.6s ease-in-out infinite">
            <span style="font-size:13px">🎫</span>
            <span style="font-size:9px;letter-spacing:1.2px;text-transform:uppercase;color:#1c1105;font-weight:800">VIP</span>
          </button>`}
        </div>` : ''}
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:10px;padding:12px 14px;background:#0b0712;border-bottom:1px solid #2a1738;align-items:center">
        <button data-h="${this.bind(v.workCrowd)}" class="cta" style="flex:1 1 240px;background:linear-gradient(180deg,#ff3d85,#d81259);border:0;border-radius:8px;color:#fff;font-weight:700;font-size:13px;letter-spacing:1.2px;text-transform:uppercase;padding:13px 16px;cursor:pointer;box-shadow:0 0 22px rgba(255,45,120,.35)">Work the room <span style="font-family:'IBM Plex Mono',monospace;opacity:.85;text-transform:none;letter-spacing:0">+${v.clickValue}</span></button>
        <button data-h="${this.bind(v.buyRound)}" ${v.roundLocked ? 'disabled' : ''} style="${css(v.roundStyle)}">${v.roundLabel}</button>
      </div>

      <div data-scroll="log" style="background:#080510;overflow-y:auto;padding:10px 14px">
        <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700;margin-bottom:7px">Night log</div>
        <div style="display:flex;flex-direction:column;gap:3px">${logRows}</div>
      </div>
    </section>

    <aside class="sys-col" style="border-left:1px solid #2a1738;background:#0a0611;display:grid;grid-template-rows:auto auto minmax(0,1fr);min-height:0">
      <div style="display:flex;border-bottom:1px solid #2a1738;background:#0d0814">${tabRows}</div>

      ${v.ownersList ? (() => {
        const ol = v.ownersList;
        const prog = ol.progress
          ? `<div style="margin-top:7px">
              <div style="display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:10px;color:#6f5885;margin-bottom:3px">
                <span>${this.fmt(ol.progress.cur)} / ${this.fmt(ol.progress.max)}</span>
                <span>${Math.floor(ol.progress.pct)}%</span>
              </div>
              <div style="height:4px;background:#1c1129;border-radius:3px;overflow:hidden">
                <div style="width:${ol.progress.pct}%;height:100%;background:#22d3ee;border-radius:3px;transition:width .18s linear"></div>
              </div>
            </div>`
          : '';
        // Sticky onboarding banner: "Goal X of 14: Title" - more prominent for first few goals
        // Wrapped in single outer div to preserve the 3-row grid in sys-col (tab bar, ownersList, scrollable)
        const banner = ol.done ? '' : `
          <div style="border-bottom:1px solid #2a1738;background:linear-gradient(180deg,#1a1028,#120c1c);padding:8px 12px;${ol.onboardingPulse ? 'animation:onboardPulse 2.5s ease-in-out infinite' : ''}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <span style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:#ffc94a;font-weight:700;letter-spacing:.3px">
                Goal ${ol.goalIdx + 1} of ${ol.totalGoals}
              </span>
              <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#6f5885">
                ${ol.n} of ${ol.total} goals complete
              </span>
            </div>
          </div>
        `;
        return `<div style="border-bottom:1px solid #2a1738;background:#0d0814;padding:10px 12px">${banner}
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px">
            <div style="display:flex;align-items:center;gap:7px;min-width:0">
              <span style="width:6px;height:6px;border-radius:50%;background:${ol.done ? '#4ade80' : '#ff2d78'};box-shadow:0 0 7px ${ol.done ? '#4ade80' : '#ff2d78'};flex-shrink:0;animation:pulseDot 2.2s infinite"></span>
              <span style="font-size:12px;font-weight:700;color:#f2e8f7;line-height:1.25">${ol.title}</span>
            </div>
            <div style="display:flex;align-items:center;gap:7px;flex-shrink:0">
              ${ol.reward ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#ffc94a;font-weight:600">${ol.reward}</span>` : ''}
            </div>
          </div>
          <div style="font-size:10.5px;color:#6f5885;font-style:italic;line-height:1.4;margin-bottom:4px">${ol.why}</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#22d3ee;line-height:1.4">${ol.hint}</div>
          ${prog}
          ${(() => {
            const h = v.horizon;
            if (!h) return '';
            // Endgame horizon (REPLAY_ROADMAP.md §10): readout only — the goal
            // line is 3 clubs + $1e12 net worth; progress is computed, not a
            // mechanic. Rendered under the active goal so it never steals the
            // onboarding banner's place.
            return `<div style="margin-top:9px;padding-top:8px;border-top:1px dashed #2a1738">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px">
                <span style="font-size:9px;letter-spacing:2.5px;text-transform:uppercase;color:#7b5f90;font-weight:700">Vision — the long game</span>
                ${h.done ? '<span style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#ffd700;font-weight:700">★ reached</span>' : ''}
              </div>
              <div style="display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:10px;color:#c4a8e0;margin-bottom:3px">
                <span>Clubs ${h.nClubs}/${h.clubMax} · Net worth ${this.fmt(h.worth)} / ${this.fmt(h.target)}</span>
                <span>${h.pct}%</span>
              </div>
              <div style="height:4px;background:#1c1129;border-radius:3px;overflow:hidden">
                <div style="width:${h.pct}%;height:100%;background:linear-gradient(90deg,#ffc94a,#22d3ee);border-radius:3px;transition:width .18s linear"></div>
              </div>
              ${h.done ? '<div style="font-family:\'IBM Plex Mono\',monospace;font-size:10px;color:#ffc94a;margin-top:4px">The empire is built. Sell it, and build again.</div>' : ''}
            </div>`;
          })()}
        </div>`;
      })() : ''}

      <div data-scroll="sys_${this.state.tab}" style="overflow-y:auto;padding:12px">
        <div style="font-size:10.5px;color:#6f5885;line-height:1.5;margin-bottom:11px">${v.tabHint}</div>

        <div style="display:flex;flex-direction:column;gap:8px">${cardRows}</div>

        ${assignments}
      </div>
    </aside>
  </main>

  <div>
    ${v.tabStale ? (v.saveState === 'checking ownership…'
      ? `<div style="display:block;width:100%;border:0;border-top:1px solid #3a2350;background:linear-gradient(180deg,#1a1028,#120c1c);color:#c4a8e0;font-family:'IBM Plex Mono',monospace;font-size:11.5px;font-weight:700;letter-spacing:.3px;padding:9px 14px;text-align:center">Checking for another open tab…</div>`
      : `<button data-h="${this.bind(v.takeOverTab)}" class="cta" style="display:block;width:100%;border:0;border-top:1px solid #6b1130;background:linear-gradient(180deg,#3a0f1e,#22060f);color:#ffc94a;font-family:'IBM Plex Mono',monospace;font-size:11.5px;font-weight:700;letter-spacing:.3px;padding:9px 14px;cursor:pointer;text-align:center">Another tab owns this save — click to reload and take over</button>`) : ''}
    <footer style="display:flex;align-items:center;gap:16px;height:28px;padding:0 14px;border-top:1px solid #2a1738;background:#0b0712;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#9c86ab">
      <span style="color:#ffc94a">${v.verFull}</span>
      <span>save v${v.saveVer}</span>
      <span>${v.saveState}</span>
      <div style="flex:1"></div>
      <span>${v.debugLine}</span>
      <span>ticks ${v.tickCount}</span>
    </footer>
  </div>

  ${changelogModal}
  ${settingsModal}
  ${prestigeModal}
  ${franchiseModal}
  ${openRoomModal}
  ${achievementsModal}
</div>`;

    this.root.querySelectorAll('[data-scroll]').forEach(el => {
      const saved = this.scrollSave[el.getAttribute('data-scroll')];
      if (saved) { el.scrollTop = saved[0]; el.scrollLeft = saved[1]; }
    });
    // Clicks are handled via delegation on this.root (see constructor).
    // data-h indices still index into this.handlers rebuilt each render.
  }
}

// --- boot ---
const game = new Game(document.getElementById('app'));
game.init();
game.mountLook();
game.mountFxLayer();
