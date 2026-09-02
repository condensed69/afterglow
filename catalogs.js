// Afterglow — static catalog data (PR 1 of the post-polish roadmap).
// Extracted from game.js so the catalogs live in one file and game.js keeps
// only the Game class. Loaded BEFORE game.js (see index.html).
// Achievement/goal check lambdas that read other catalogs or helpers use
// `this` = the Game instance, bound at the call site (checkAchievements and
// noteGoals invoke them via .call(this, …)). Pure-data catalogs have no `this`.
const AfterglowCatalogs = {
  BUILDINGS: [
    // Costs/growth retuned for PLAN-NEXT §C pacing bands (numbers only).
    { id: 'rail', name: 'Tip Rail', cost: 140, growth: 1.16, desc: 'Brass rail along the stage. Up to 6 patrons per rail tip +$0.06/s.' },
    { id: 'bar', name: 'Back Bar', cost: 150, growth: 1.18, desc: 'Drinks pay the rent. +$0.45/s and +5 floor capacity.' },
    { id: 'dj', name: 'DJ Booth', cost: 180, growth: 1.17, desc: 'Keeps the room moving. +0.10 Hype/s.' },
    { id: 'marquee', name: 'Marquee Sign', cost: 380, growth: 1.22, desc: '+0.07 Buzz/s and +35 Buzz capacity.' },
    { id: 'flyers', name: 'Flyer Crew', cost: 210, growth: 1.16, desc: 'Windshields all over downtown. +0.025 Buzz/s.' },
    { id: 'vip', name: 'VIP Booth', cost: 600, growth: 1.24, desc: 'Private bookings. +$1.25/s and +18% regular conversion.' },
    { id: 'door', name: 'Door Staff', cost: 300, growth: 1.20, max: 6, desc: 'Fewer incidents. Cuts Hype decay by 12% each. (max 6)' },
    { id: 'dress', name: 'Dressing Room', cost: 500, growth: 1.28, desc: '+2 crew capacity.' }
  ],

  UPGRADES: [
    { id: 'led', name: 'LED Pole Lighting', cost: 420, req: { dj: 2 }, desc: 'Hype generation x1.30.' },
    { id: 'twodrink', name: 'Two-Drink Minimum', cost: 1100, req: { bar: 4 }, desc: 'All cash income x1.35.' },
    { id: 'coat', name: 'Coat Check', cost: 850, req: { door: 2 }, desc: '+20 floor capacity.' },
    { id: 'photog', name: 'House Photographer', cost: 1700, req: { marquee: 2 }, desc: 'Buzz generation x1.5.' },
    { id: 'bottle', name: 'Bottle Service', cost: 3800, req: { vip: 3 }, desc: 'VIP cash x2.2.' },
    { id: 'residency', name: 'Weekly Residency', cost: 8000, req: { dress: 2 }, desc: 'Crew output x1.4.' }
  ],

  // Research tree (REPLAY_ROADMAP.md §5): 3 tiers, prerequisites. `req` is an
  // existence-based prerequisite (a research id — `g.r[req]` truthy), mirroring
  // the perk-req shape, NOT the UPGRADES object-req shape (research has no ranks).
  // Tier 1 = cheap multipliers (no req); Tier 2 = mechanic unlocks + stacking
  // multipliers (req-gated); Tier 3 = expensive account-wide bonuses.
  // The cheapest item (loop, 12 Clout) anchors the "first research" pacing band.
  RESEARCH: [
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
  ],

  // Challenge runs (REPLAY_ROADMAP.md §6, next-roadmap PR 2) — opt-in replay
  // modifiers with permanent rewards, now a 3-tier ladder. `mod` = run
  // constraints applied while active (startCash, incomeMult, locked buildings);
  // `tiers` = tier-2/3 mods (self-contained; tier 1 is `mod`). `reward` =
  // permanent account bonus DERIVED from g.challengeTiers × completed tier
  // (no separate reward field — completing tier N grants reward × N). `check` =
  // completion predicate against the merged club view (like achievements).
  // Rewards never grant Clout (Legacy-not-Clout rule — run variance must not
  // feed the deterministic research currency). Challenges are opt-in; the
  // pacing bot never starts one, so the existing bands are untouched.
  CHALLENGES: [
    { id: 'tight', name: 'Tight Till', desc: 'Start with an empty till — no starting cash.', mod: { startCash: 0 }, reward: { cashMult: 0.05 }, check: v => v.regulars >= 25,
      tiers: [
        { mod: { startCash: 0, incomeMult: 0.85 }, desc: '…and the house takes 15% — all income ×0.85.' },
        { mod: { startCash: 0, incomeMult: 0.7 }, desc: '…and the house takes 30% — all income ×0.7.' }
      ] },
    { id: 'slim', name: 'Slim Margins', desc: 'The house takes half — all income ×0.5.', mod: { incomeMult: 0.5 }, reward: { doorMax: 1 }, check: v => v.regulars >= 20,
      tiers: [
        { mod: { incomeMult: 0.4 }, desc: 'The house takes 60% — all income ×0.4.' },
        { mod: { incomeMult: 0.3 }, desc: 'The house takes 70% — all income ×0.3.' }
      ] },
    { id: 'dry', name: 'No Street Team', desc: 'Flyer Crew is locked — word of mouth only.', mod: { locked: ['flyers'] }, reward: { crewOut: 0.05 }, check: v => v.b.dj >= 2,
      tiers: [
        { mod: { locked: ['flyers', 'marquee'] }, desc: 'Flyer Crew and Marquee are locked — no advertising at all.' },
        { mod: { locked: ['flyers', 'marquee', 'door'] }, desc: 'Flyer Crew, Marquee, and Door Staff are locked — bare room.' }
      ] },
    { id: 'lean', name: 'Lean Night', desc: 'The Back Bar is locked — no bar revenue.', mod: { locked: ['bar'] }, reward: { cashMult: 0.05 }, check: v => v.b.vip >= 1,
      tiers: [
        { mod: { locked: ['bar', 'vip'] }, desc: 'Back Bar and VIP Booths are locked — no drinks, no bottles.' },
        { mod: { locked: ['bar', 'vip', 'rail'] }, desc: 'Back Bar, VIP Booths, and Tip Rails are locked — cover only.' }
      ] }
  ],

  // Brand perks (REPLAY_ROADMAP.md §9) — the Renown sink. Bought with Renown,
  // persist through the second prestige (they're the reason to sell again).
  // Mirrors PRESTIGE_PERKS: { id, name, cost, max, desc, req? } (req = brand
  // perk id, rank >= 1). Effects are account-wide; 'rooftop' unlocks the third
  // club. brandRank(g, id) reads g.brand (fail-closed to 0).
  BRAND_PERKS: [
    { id: 'nationwide', name: 'Nationwide Reach', cost: 5, max: 3, desc: 'All cash income +10% per rank, everywhere.' },
    { id: 'loyalty', name: 'Loyalty Program', cost: 4, max: 3, desc: 'Start each run with +1 Regular per rank.' },
    { id: 'rnd', name: 'R&D Lab', cost: 4, max: 3, desc: 'Research costs −10% per rank.' },
    { id: 'offline', name: 'Night Owl Network', cost: 3, max: 3, desc: 'Offline progress +10% per rank.' },
    { id: 'rooftop', name: 'Rooftop Lease', cost: 10, max: 1, desc: 'Unlock the Rooftop — a third location.' }
  ],

  // Location-specific buildings/upgrades (REPLAY_ROADMAP.md §9) — additive
  // identity per club, appended to the shared BUILDINGS/UPGRADES catalog.
  // `kind`: 'b' = building (cost/growth/desc, optional max), 'u' = upgrade
  // (cost/req/desc). Supersedes SECOND_LOCATION.md §11's "no location-specific
  // buildings" non-goal. Extras must be initialized in freshClubState and
  // backfilled by sanitize/import for existing saves.
  LOCATION_EXTRAS: {
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
  },

  // Prestige perks (PRESTIGE.md). Legacy cost, max rank, effect applied in rates()/workCrowd()/catchUp()/fresh().
  // Optional `req: perkId` gates purchase on the prerequisite perk's rank >= 1 (perk tree, PLAN §4.3).
  // Note: unlike UPGRADES.req ({ buildingId: count }), a perk req is a bare perkId string (existence-based,
  // rank >= 1). Reqs gate future purchases only, not past unlocks.
  PRESTIGE_PERKS: [
    { id: 'cash10', name: 'House cut', cost: 1, max: 5, desc: '+15% all cash income per rank.' },
    { id: 'startCrew', name: 'Seed roster', cost: 2, max: 1, desc: 'Start run with 1 crew on Main Stage.' },
    { id: 'startFlyers', name: 'Street team', cost: 3, max: 1, desc: 'Start run with Flyer Crew ×1 built.' },
    { id: 'offline65', name: 'Franchise playbook', cost: 4, max: 1, req: 'cash10', desc: 'Offline / catchUp rate 50% → 65%.' },
    { id: 'doorPlus', name: 'Extra bouncer slot', cost: 5, max: 1, req: 'startCrew', desc: '+1 max Door Staff.' },
    { id: 'clout25', name: 'Name recognition', cost: 6, max: 1, req: 'offline65', desc: '+25% Clout gain.' }
  ],

  // Managers — auto-buyers, one per building type (PLAN.md §4.1).
  // Purchasable with Legacy from the Perks/Prestige panel, max 1 each.
  MANAGERS: [
    { id: 'rail',    name: 'Tip Rail Manager',    desc: 'Auto-buys Tip Rails.',    cost: 10 },
    { id: 'bar',     name: 'Barback Manager',     desc: 'Auto-buys Bars.',         cost: 10 },
    { id: 'dj',      name: 'DJ Manager',          desc: 'Auto-buys DJ Booths.',    cost: 10 },
    { id: 'marquee', name: 'Marquee Manager',     desc: 'Auto-buys Marquees.',     cost: 10 },
    { id: 'flyers',  name: 'Flyer Manager',       desc: 'Auto-buys Flyer Crew.',   cost: 10 },
    { id: 'vip',     name: 'VIP Manager',         desc: 'Auto-buys VIP Booths.',   cost: 10 },
    { id: 'door',    name: 'Door Manager',        desc: 'Auto-buys Door Staff.',   cost: 10 },
    { id: 'dress',   name: 'Dressing Room Manager', desc: 'Auto-buys Dressing Rooms.', cost: 10 }
  ],

  // Flavor layer (REPLAY_ROADMAP.md §4) — ambient ticker lines + named regulars.
  // Pure display: read in renderVals only, never in rates()/step(), so pacing is
  // untouched. Conditions take (g, c) where c is the active club view.
  FLAVOR: [
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
    // Post-polish PR 5 (flavor v2): back-half lines for the 105m–311m dead zone.
    // Keyed on existing counters (night / specialsCount / brandLevel) — no save field.
    { cond: (g, c) => c.night >= 25, text: 'Twenty-five nights in — the regulars have their own booth by now.' },
    { cond: (g, c) => (g.specialsCount || 0) >= 1, text: 'Someone still talks about the Bachelorette Rush.' },
    { cond: (g, c) => (g.brandLevel || 0) >= 1, text: 'The brand is catching on across town.' },
    { cond: () => true, text: 'The night is young.' }
  ],

  // Named regulars pool — one new name every 5 regulars (derived, no save field).
  REGULAR_NAMES: [
    'Margo', 'DeShawn', 'Priya', 'Yuki', 'Marcus', 'Elena', 'Theo', 'Rosa',
    'Jamal', 'Ingrid', 'Felix', 'Naomi', 'Dante', 'Carmen', 'Otis', 'Hana',
    'Leon', 'Tessa', 'Ravi', 'Sylvie'
  ],

  // Achievements — permanent unlocks with small rewards (Clout/Legacy).
  ACHIEVEMENTS: [
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
    { id: 'all_buildings', name: 'Empire', desc: 'Own every structure at least once', check(g) { return this.BUILDINGS.every(b => g.b[b.id] >= 1); }, reward: { legacy: 3 } },
    { id: 'all_upgrades', name: 'Fully Loaded', desc: 'Buy every upgrade', check(g) { return this.UPGRADES.every(u => g.u[u.id]); }, reward: { legacy: 3 } },
    { id: 'all_research', name: 'Scholar', desc: 'Complete all research', check(g) { return this.RESEARCH.every(r => g.r[r.id]); }, reward: { legacy: 2 } },
    { id: 'max_perks', name: 'Perfectionist', desc: 'Max all prestige perks', check(g) { return this.PRESTIGE_PERKS.every(p => this.perk(g, p.id) >= p.max); }, reward: { legacy: 10 } },
    // 0.10.1 density pass (23 → 38): building breadth, higher stat tiers, and the
    // burst-event counters. Legacy rewards below credit legacyTotal via
    // checkAchievements (earned Legacy), matching the 0.9.5 accounting rule.
    { id: 'bar_10', name: 'Two-Thirds Full', desc: 'Own 10 Back Bars', check: g => g.b.bar >= 10, reward: { clout: 2 } },
    { id: 'dj_5', name: 'Beatkeeper', desc: 'Own 5 DJ Booths', check: g => g.b.dj >= 5, reward: { clout: 2 } },
    { id: 'marquee_3', name: 'Bright Lights', desc: 'Own 3 Marquee Signs', check: g => g.b.marquee >= 3, reward: { clout: 3 } },
    { id: 'flyers_5', name: 'Street Team', desc: 'Own 5 Flyer Crews', check: g => g.b.flyers >= 5, reward: { clout: 2 } },
    { id: 'door_max', name: 'Bouncer', desc: 'Max out Door Staff', check(g) { return g.b.door >= this.doorMax(g); }, reward: { clout: 3 } },
    { id: 'dress_3', name: 'Backstage Pass', desc: 'Own 3 Dressing Rooms', check: g => g.b.dress >= 3, reward: { clout: 3 } },
    { id: 'hype_200', name: 'Deafening', desc: 'Reach 200 Hype', check: g => g.hype >= 200, reward: { clout: 3 } },
    { id: 'patrons_100', name: 'Fire Marshal', desc: '100 patrons on floor', check: g => g.patrons >= 100, reward: { clout: 5 } },
    { id: 'regulars_50', name: 'Institution', desc: '50 Regulars', check: g => g.regulars >= 50, reward: { clout: 8 } },
    { id: 'night_25', name: 'A Month In', desc: 'Survive 25 nights', check: g => g.night >= 25, reward: { clout: 3 } },
    { id: 'round_10', name: 'Toast', desc: 'Buy 10 rounds', check: g => g.rounds >= 10, reward: { clout: 1 } },
    { id: 'whale_1', name: 'Big Catch', desc: 'A whale patron spends big', check: g => (g.whalesCount || 0) >= 1, reward: { legacy: 1 }, burst: true },
    { id: 'whale_10', name: 'Whale Watcher', desc: '10 whale patrons', check: g => (g.whalesCount || 0) >= 10, reward: { legacy: 3 }, burst: true },
    { id: 'special_1', name: 'Surprise Hit', desc: 'Ride your first special shift', check: g => (g.specialsCount || 0) >= 1, reward: { legacy: 1 }, burst: true },
    { id: 'special_5', name: 'Event Planner', desc: 'Ride 5 special shifts', check: g => (g.specialsCount || 0) >= 5, reward: { legacy: 2 }, burst: true },
    // Next-roadmap PR 3: Meta achievements — brand/rooftop/challenge/sale coverage
    // All rewards are Legacy only (Legacy-not-Clout rule: deterministic account
    // actions, but Legacy is the safe currency and credits both g.legacy and
    // g.legacyTotal per the 0.9.5 accounting rule).
    { id: 'franchise_1', name: 'First Sale', desc: 'Complete 1 franchise sale', check: g => (g.renownTotal || 0) >= 1, reward: { legacy: 2 } },
    { id: 'franchise_5', name: 'Serial Entrepreneur', desc: 'Earn 30 lifetime Renown', check: g => (g.renownTotal || 0) >= 30, reward: { legacy: 5 } },
    { id: 'franchise_10', name: 'Titan', desc: 'Earn 60 lifetime Renown', check: g => (g.renownTotal || 0) >= 60, reward: { legacy: 8 } },
    { id: 'brand_1', name: 'Brand New', desc: 'Unlock any Brand perk', check: g => Object.values(g.brand || {}).some(r => r >= 1), reward: { legacy: 2 } },
    { id: 'brand_max', name: 'Brand Portfolio', desc: 'Max all 5 Brand perks', check(g) { return (g.brand && this.BRAND_PERKS.every(p => (g.brand[p.id] || 0) >= p.max)); }, reward: { legacy: 5 } },
    { id: 'rooftop_1', name: 'Penthouse', desc: 'Unlock the Rooftop club', check: g => !!g.clubs?.rooftop, reward: { legacy: 3 } },
    { id: 'heli_1', name: 'Sky Hook', desc: 'Build a Helipad at the Rooftop', check: g => (g.clubs?.rooftop?.b?.heli || 0) >= 1, reward: { legacy: 3 } },
    { id: 'challenge_1', name: 'Trailblazer', desc: 'Complete any challenge tier', check: g => (g.challengesDone || []).length >= 1, reward: { legacy: 2 } },
    { id: 'challenge_all', name: 'Completionist', desc: 'Complete each of the 4 challenges', check: g => (g.challengesDone || []).length >= 4, reward: { legacy: 4 } },
    // Post-polish PR 6: challenge-tier-aware achievements — a second collectible
    // axis on top of the flat challenge-done count. These read g.challengeTiers
    // (the post-PR-#80 source of truth), NOT the legacy challengesDone array.
    // Legacy-only; the pacing bot never completes a challenge, so none fire on the
    // bot path and every pacing band stays bit-identical.
    { id: 'challenge_t2_one', name: 'Hardened', desc: 'Complete any challenge at tier 2', check: g => Object.values(g.challengeTiers || {}).some(v => v >= 2), reward: { legacy: 3 } },
    { id: 'challenge_t3_one', name: 'Ironclad', desc: 'Complete any challenge at tier 3', check: g => Object.values(g.challengeTiers || {}).some(v => v >= 3), reward: { legacy: 3 } },
    { id: 'challenge_t2_all', name: 'Gauntlet', desc: 'Complete all 4 challenges at tier 2', check(g) { return this.CHALLENGES.every(c => (g.challengeTiers || {})[c.id] >= 2); }, reward: { legacy: 3 } },
    { id: 'challenge_t3_all', name: 'Legendary', desc: 'Complete all 4 challenges at tier 3', check(g) { return this.CHALLENGES.every(c => (g.challengeTiers || {})[c.id] >= 3); }, reward: { legacy: 3 } },
    { id: 'endorse_5', name: 'Endorsed', desc: 'Reach Brand Endorsement level 5', check: g => (g.brandLevel || 0) >= 5, reward: { legacy: 3 } },
    // Post-polish PR 3: Achievement density — location-extras + endorsement ladder.
    // All bot-unreachable (the pacing bot never opens the Rooftop or buys Brand
    // Endorsement), so pacing bands stay bit-identical. Club-level reads use the
    // full g.clubs.rooftop path (not the active club's b/u view). Legacy rewards
    // credit legacyTotal per the 0.9.5 accounting rule.
    { id: 'vista_1', name: 'Panorama', desc: 'Own the Panorama Deck at the Rooftop', check: g => g.clubs?.rooftop?.u?.vista === true, reward: { legacy: 3 } },
    { id: 'heli_2', name: 'Sky Armada', desc: 'Build 2 Helipads at the Rooftop', check: g => (g.clubs?.rooftop?.b?.heli || 0) >= 2, reward: { legacy: 5 } },
    { id: 'endorse_10', name: 'Sponsored', desc: 'Reach Brand Endorsement level 10', check: g => (g.brandLevel || 0) >= 10, reward: { legacy: 4 } },
    { id: 'endorse_25', name: 'Household Name', desc: 'Reach Brand Endorsement level 25', check: g => (g.brandLevel || 0) >= 25, reward: { legacy: 8 } },
    { id: 'endorse_50', name: 'Icon', desc: 'Reach Brand Endorsement level 50', check: g => (g.brandLevel || 0) >= 50, reward: { legacy: 16 } },
    // Ultra-review W2 (0.11.27): mid-band progression hooks for the 105m–311m dead
    // zone. Keyed on monotonic account counters the plain pacing bot never advances
    // (it doesn't prestige), so the main milestone bands stay bit-identical. Legacy
    // only (Legacy-not-Clout rule); credit both g.legacy AND g.legacyTotal per the
    // 0.9.5 accounting rule. No save field → SAVE_VER stays 13.
    { id: 'prestige_15', name: 'Franchise Habit', desc: 'Sign 15 franchise deals', check: g => (g.prestiges || 0) >= 15, reward: { legacy: 3 } },
    { id: 'prestige_25', name: 'Dynasty', desc: 'Sign 25 franchise deals', check: g => (g.prestiges || 0) >= 25, reward: { legacy: 6 } },
    { id: 'legacy_125', name: 'Century Club', desc: 'Accumulate 125 lifetime Legacy', check: g => (g.legacyTotal || 0) >= 125, reward: { legacy: 4 } },
    { id: 'legacy_250', name: 'Old Money', desc: 'Accumulate 250 lifetime Legacy', check: g => (g.legacyTotal || 0) >= 250, reward: { legacy: 8 } }
  ],

  // Owner's List — sequential onboarding goals (PLAN-NEXT §B). Exactly one active at a time.
  GOALS: [
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
      hint: 'Club tab → Tip Rail. Fund it by tapping Work the room — a long stretch of taps (the button shows each tap\'s pay), or let walk-ins fill the till slowly. Tips then pay +$0.06/s per patron.',
      reward: { cash: 12, clout: 0 },
      check: g => (g.b && g.b.rail || 0) >= 1,
      progress: null
    },
    {
      id: 'word', title: 'Get the word out',
      why: 'Buzz is how strangers find the door. Without it the floor stays empty.',
      hint: 'Club tab → Flyer Crew. Same funding grind — tap Work the room until it\'s in reach. Buzz then ticks up on its own.',
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
      check(g) { return this.RESEARCH.some(d => !!(g.r && g.r[d.id])); },
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
      check(g) { return this.UPGRADES.some(d => !!(g.u && g.u[d.id])); },
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
  ],

  // Police Heat Engine (PR 4 of Afterglow 2.0)
  HEAT: {
    SHIFT_BASE: [0.02, 0.08, 0.05, 0.12], // Early Doors, Peak Hours, Last Call, After Hours
    DOOR_SECURITY: 0.015, // Heat reduction per door staff
    MAX_HEAT: 100,
    BRIBE_REDUCTION: 35,
    RAID_THRESHOLD: 100
  },

  INCIDENTS: [
    { id: 'brawl', name: 'Bar Fight', heat: 8, text: 'Rowdy patrons broke glassware at the bar. +8 Heat.' },
    { id: 'noise', name: 'Noise Complaint', heat: 5, text: 'Neighbors called in the subwoofers. +5 Heat.' },
    { id: 'inspection', name: 'Fire Marshal Check', heat: 12, text: 'Fire Marshal spotted an over-capacity VIP line. +12 Heat.' }
  ],

  // Station Subsystems (PR 5 of Afterglow 2.0)
  BEVERAGES: [
    { id: 'well', name: 'Well Spirits', tier: 1, batchCost: 15, batchSize: 50, revMult: 1.20, reqBar: 1 },
    { id: 'craft', name: 'Craft Cocktails', tier: 2, batchCost: 45, batchSize: 40, revMult: 1.35, reqBar: 3 },
    { id: 'champagne', name: 'Top-Shelf Champagne', tier: 3, batchCost: 120, batchSize: 30, revMult: 1.60, reqBar: 5 }
  ],

  DJ_TRACKS: [
    { id: 'neon_pulse', name: 'Neon Pulse', bpm: 120, hypeBonus: 1.20, duration: 60, reqDj: 1 },
    { id: 'acid_rain', name: 'Acid Rain', bpm: 128, hypeBonus: 1.35, duration: 75, reqDj: 3 },
    { id: 'midnight_storm', name: 'Midnight Laser Storm', bpm: 140, hypeBonus: 1.50, duration: 90, reqDj: 5 }
  ]
};

if (typeof window !== 'undefined') window.AfterglowCatalogs = AfterglowCatalogs;
if (typeof module !== 'undefined' && module.exports) module.exports = AfterglowCatalogs;
