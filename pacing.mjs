// pacing.mjs — Afterglow Club Idle reference-bot pacing simulator (PLAN-NEXT §C)
// Run: node pacing.mjs
// Dependencies: none (Node built-ins only)
// Exits non-zero when any milestone falls outside its band.

import { readFileSync, writeSync } from 'node:fs';
import { format } from 'node:util';

// Flush every line to stdout synchronously (issue #92): on POSIX console.log to
// a pipe is asynchronous and can buffer, which is exactly how a slow sim reads
// as a "hang with zero output" in CI. writeSync(1, …) lands each line the
// moment it is reached so logs show liveness mid-run.
console.log = (...args) => { writeSync(1, format(...args) + '\n'); };

// ── DOM Prelude (same pattern as economy.test.mjs) ───────────────────────────
const root = {
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  contains: () => false,
  getAttribute: () => null,
  setAttribute: () => {},
  closest: () => null,
  removeChild: () => {},
  appendChild: () => root,
  replaceWith: () => {},
  classList: { contains: () => false, add: () => {}, remove: () => {}, toggle: () => {} },
};
Object.defineProperty(root, 'innerHTML', { set: () => {}, get: () => '' });
Object.defineProperty(root, 'style', { value: {}, writable: true });

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  ResizeObserver: undefined,
};
globalThis.document = {
  getElementById: (id) => {
    if (id === 'stage') {
      return {
        clientHeight: 300,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
      };
    }
    return root;
  },
  createElement: () => ({ ...root }),
  createTextNode: () => ({}),
};
globalThis.localStorage = {
  _data: Object.create(null),
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = Object.create(null); },
};

// Strip page boot so the process can exit cleanly.
const catSrc = readFileSync(new URL('./catalogs.js', import.meta.url), 'utf8');
const src = readFileSync(new URL('./game.js', import.meta.url), 'utf8');
const stripped = src
  .replace(/\nconst game = new Game\(document\.getElementById\('app'\)\);\s*\ngame\.init\(\);\s*(?:\ngame\.mountLook\(\);)?\s*(?:\ngame\.mountFxLayer\(\);)?\n?$/, '');
if (stripped === src) {
  console.error('pacing.mjs: failed to strip game.js boot lines — process may hang');
  process.exit(2);
}
const Game = new Function(catSrc + '\n' + stripped + ';\nreturn Game;')();

// ── Milestone bands (PLAN-NEXT §C.1) ─────────────────────────────────────────
// Where the plan gives a ~center, apply ±band. Where it gives a range
// (night 2–3 ≈ 5–8 min), expand the range ends by the band fraction.
const MILESTONES = [
  {
    id: 'rail',
    label: 'First building (rail)',
    targetLabel: '~2 min ±25%',
    lo: 2 * 60 * 0.75,
    hi: 2 * 60 * 1.25,
    check: (g) => (g.b.rail || 0) >= 1,
  },
  {
    id: 'crew',
    label: 'First crew',
    targetLabel: '5–8 min ±25%',
    lo: 5 * 60 * 0.75,
    hi: 8 * 60 * 1.25,
    check: (g) => (g.crew || 0) >= 1,
  },
  {
    id: 'patrons10',
    label: '10 patrons',
    targetLabel: '~6 min ±25%',
    lo: 6 * 60 * 0.75,
    hi: 6 * 60 * 1.25,
    check: (g) => (g.patrons || 0) >= 10,
  },
  {
    id: 'upgrade',
    label: 'First upgrade (LED)',
    targetLabel: '12–18 min ±30%',
    lo: 12 * 60 * 0.7,
    hi: 18 * 60 * 1.3,
    check: (g) => !!g.u.led,
  },
  {
    id: 'research',
    label: 'First research',
    targetLabel: '~25 min ±30%',
    lo: 25 * 60 * 0.7,
    hi: 25 * 60 * 1.3,
    check: (g) => Object.values(g.r || {}).some(Boolean),
  },
  {
    id: 'allUpgrades',
    label: 'All upgrades owned',
    targetLabel: '~32 min ±30%',
    lo: 32 * 60 * 0.7,
    hi: 32 * 60 * 1.3,
    check: (g) => {
      const u = g.u || {};
      return Object.keys(u).length > 0 && Object.values(u).every(Boolean);
    },
  },
  {
    id: 'allResearch',
    label: 'All research owned',
    targetLabel: '~105 min ±30%',
    lo: 105 * 60 * 0.7,
    hi: 105 * 60 * 1.3,
    check: (g) => {
      const r = g.r || {};
      return Object.keys(r).length > 0 && Object.values(r).every(Boolean);
    },
  },
];

const SIM_HOURS = 8;

function bandRange(m) {
  return { lo: m.lo, hi: m.hi };
}

function fmtMin(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  return (sec / 60).toFixed(2) + 'm';
}

function buildingDef(game, id) {
  return game.BUILDINGS.find((b) => b.id === id);
}

function buildingPrice(def, n) {
  return Math.floor(def.cost * Math.pow(def.growth, n));
}

function tryBuyBuilding(game, id, target) {
  const g = game.state.g;
  const def = buildingDef(game, id);
  if (!def) return false;
  let bought = false;
  while ((g.b[id] || 0) < target) {
    const n = g.b[id] || 0;
    if (def.max != null && n >= def.max) break;
    const price = buildingPrice(def, n);
    if (g.cash < price) break;
    game.buyBuilding(def);
    bought = true;
  }
  return bought;
}

function tryHire(game) {
  const g = game.state.g;
  const cap = game.caps(g).crew;
  const target = Math.min(cap, 3);
  let hired = false;
  while (g.crew < target) {
    const before = g.crew;
    game.hireCrew();
    if (g.crew === before) break;
    hired = true;
  }
  return hired;
}

function cheapestUnboughtUpgrade(game) {
  const g = game.state.g;
  let best = null;
  for (const def of game.UPGRADES) {
    if (g.u[def.id]) continue;
    if (!best || def.cost < best.cost) best = def;
  }
  return best;
}

function upgradeReqMet(g, def) {
  const reqId = Object.keys(def.req)[0];
  return (g.b[reqId] || 0) >= def.req[reqId];
}

/** Buy buildings required by the cheapest unbought upgrade (enables late milestones). */
function tryBuyUpgradeReqs(game) {
  const g = game.state.g;
  // Prefer cheapest upgrade by cost among those not yet owned.
  const candidates = game.UPGRADES
    .filter((d) => !g.u[d.id])
    .slice()
    .sort((a, b) => a.cost - b.cost);
  for (const def of candidates) {
    const reqId = Object.keys(def.req)[0];
    const need = def.req[reqId];
    if ((g.b[reqId] || 0) < need) {
      tryBuyBuilding(game, reqId, need);
      return;
    }
  }
}

function tryBuyCheapestUpgrade(game) {
  const g = game.state.g;
  const owned = game.UPGRADES.filter((d) => !g.u[d.id] && upgradeReqMet(g, d) && g.cash >= d.cost)
    .sort((a, b) => a.cost - b.cost);
  if (owned.length) game.buyUpgrade(owned[0]);
}

function tryBuyCheapestResearch(game) {
  const g = game.state.g;
  // Prerequisite-aware (REPLAY_ROADMAP.md §5): skip nodes whose req isn't owned,
  // so the bot advances the tree instead of repeatedly selecting an affordable
  // locked node. Existence-based (g.r[reqId] truthy), matching buyResearch.
  const avail = game.RESEARCH
    .filter((d) => !g.r[d.id] && (!d.req || !!g.r[d.req]) && g.clout >= d.cost)
    .sort((a, b) => a.cost - b.cost);
  if (avail.length) game.buyResearch(avail[0]);
}

/** Assign: all stage until hype ≥ 40; then 1 stage, rest vipjob if VIP else floor. */
function assignCrew(game) {
  const g = game.state.g;
  if (g.crew <= 0) return;

  // Collapse everyone onto off residual, then place. Catalog-driven (includes
  // any research-unlocked job — the bot never assigns it, so its count stays 0).
  for (const id of game.workingJobIds()) g.jobs[id] = 0;
  g.jobs.off = g.crew;

  if (g.hype < 40) {
    g.jobs.stage = g.crew;
    g.jobs.off = 0;
    return;
  }

  const stageN = Math.min(1, g.crew);
  g.jobs.stage = stageN;
  const rest = g.crew - stageN;
  if (rest <= 0) {
    g.jobs.off = 0;
    return;
  }
  if ((g.b.vip || 0) >= 1) {
    g.jobs.vipjob = rest;
  } else {
    g.jobs.floor = rest;
  }
  g.jobs.off = 0;
}

function workCrowdOnce(game) {
  const fn = game.renderVals().workCrowd;
  if (typeof fn === 'function') fn();
}

function buyRoundIfWanted(game) {
  const g = game.state.g;
  if (g.shiftIdx !== 0) return;
  // Live game price via Game.roundPrice (same expression as renderVals / buyRound).
  const price = game.roundPrice(g);
  if (g.cash > 3 * price) {
    game.renderVals().buyRound();
  }
}

function botSecond(game) {
  const g = game.state.g;
  assignCrew(game);

  // Priority buy list (PLAN-NEXT §C.1)
  tryBuyBuilding(game, 'rail', 2);
  tryBuyBuilding(game, 'flyers', 2);
  tryBuyBuilding(game, 'bar', 1);
  tryHire(game);
  tryBuyBuilding(game, 'dj', 2);

  // Beyond the literal priority list: buy buildings required by the cheapest
  // unbought upgrade, and dress so crew target can reach min(cap, 3). Without
  // these, "all upgrades" / crew-3 are unreachable under the locked bot policy.
  tryBuyUpgradeReqs(game);
  if (game.caps(g).crew < 3) tryBuyBuilding(game, 'dress', 1);
  tryHire(game);

  tryBuyCheapestUpgrade(game);
  tryBuyCheapestResearch(game);

  if (g.cash < 300) workCrowdOnce(game);
  buyRoundIfWanted(game);
}

/**
 * Buy every affordable meta item in deterministic catalog order — perks by
 * PRESTIGE_PERKS order (requirement-aware), then managers by MANAGERS order —
 * looping until nothing more is affordable. Used by renownRun() after each
 * prestige to drive the account toward the franchise gate (all perks maxed +
 * all managers hired). Determinism: no random draws, fixed iteration order.
 */
function buyAllMeta(game) {
  const g = game.state.g;
  let bought = true;
  while (bought) {
    bought = false;
    for (const d of game.PRESTIGE_PERKS) {
      const rank = game.perk(g, d.id);
      if (rank >= d.max) continue;
      const reqMet = !d.req || game.perk(g, d.req) >= 1;
      if (reqMet && g.legacy >= d.cost) {
        game.buyPerk(d);
        bought = true;
      }
    }
    for (const m of game.MANAGERS) {
      if (!g.managers[m.id] && g.legacy >= m.cost) {
        game.buyManager(m);
        bought = true;
      }
    }
  }
}

function newGame() {
  const game = new Game(root);
  game.forceUpdate = () => {};
  // SAVE_VER 9: game.js's own wrapState (club proxy) handles flat-g reads against
  // the ACTIVE club and survives prestige/reset inside the bot run.
  game.state.g = game.wrapState(game.fresh());
  return game;
}

// ── Wall-clock budget + fast mode (issue #92) ────────────────────────────────
// The suites are CPU-bound, not deadlocked — but a real regression is
// indistinguishable from slowness on a runner with a timeout. Each scenario
// runs under a generous per-run wall-clock ceiling (Date.now(), not sim-clock),
// enforced inside the sim loop, so an overrun exits(2) with a clear message
// instead of sitting silent until the job's own timeout. PACING_BUDGET_MS
// overrides the default.
const RUN_BUDGET_MS = Number(process.env.PACING_BUDGET_MS) || 5 * 60 * 1000;
// Endgame probe sits ~1% under the 5-min default; give it headroom so a
// concurrent gate run can't false-positive exit 2. Honors PACING_BUDGET_MS
// when it RAISES the floor; never lowers below 7m (review #110 nit).
const ENDGAME_BUDGET_MS = Math.max(Number(process.env.PACING_BUDGET_MS) || 5 * 60 * 1000, 7 * 60 * 1000);

// --fast (or PACING_FAST=1) skips the three full-cap scenarios — endgameProbe()
// (unconditional 8h cap), renownRun() (franchise gate, ~5.6h sim), and
// midBandRun() (post-polish PR 7: franchise gate + first Brand perk, ~5.2h sim)
// — which dominate wall time. run()/prestigeRun()/secondRoomRun() early-exit at
// their milestones and are cheap, so the core milestone-band gate still runs.
// The full suite (all six scenarios) remains the local gate; CI runs --fast.
const FAST = process.argv.includes('--fast') || process.env.PACING_FAST === '1';

let budgetDeadline = 0;
let budgetName = '';
let budgetMs = 0;

function withBudget(name, ms, fn) {
  budgetName = name;
  budgetMs = ms;
  budgetDeadline = Date.now() + ms;
  try {
    fn();
  } finally {
    budgetName = '';
    budgetMs = 0;
    budgetDeadline = 0;
  }
}

function simulate(game, stopCondition, maxSec = SIM_HOURS * 3600, opts = {}) {
  const stopOnMilestones = opts.stopOnMilestones !== false;
  const hit = Object.create(null);
  for (const m of MILESTONES) hit[m.id] = null;

  // Progress heartbeat (issue #92): a long sim has no lower-level output, so
  // without this the suite sits silent for its whole 8h cap and a hang is
  // indistinguishable from slowness. Print once per simulated hour so CI logs
  // show liveness; the default is cheap (~8 lines per full run).
  const beatEvery = opts.beatEvery || 3600;
  let lastBeat = 0;

  let wall = 0;
  while (wall < maxSec) {
    // Wall-clock budget (issue #92): checked once per simulated second — cheap
    // (a Date.now() vdso read) next to the step(1) it guards. An overrun is a
    // loud, attributable exit(2) instead of the job's own silent timeout.
    if (budgetDeadline && Date.now() > budgetDeadline) {
      console.log(
        `\n❌ ${budgetName}: wall-clock budget ${(budgetMs / 60000).toFixed(0)}m exceeded @ ${fmtMin(wall)} sim — hung or regressed.\n`
      );
      process.exit(2);
    }

    // One bot decision per simulated second, then advance 1s of sim so
    // income/resource changes precede the next decision (not 5 decisions then +5s).
    botSecond(game);
    game.step(1);
    wall += 1;

    if (wall - lastBeat >= beatEvery) {
      console.log(`    … wall ${fmtMin(wall)}/${fmtMin(maxSec)} (night ${game.state.g.night})`);
      lastBeat = wall;
    }

    const g = game.state.g;
    for (const m of MILESTONES) {
      if (hit[m.id] == null && m.check(g)) {
        hit[m.id] = wall;
        // Per-milestone liveness (issue #92): surface each hit as it lands, not
        // only inside reportMilestones() after the whole sim returns — so run()
        // shows progress instead of sitting silent until its first full sim ends.
        console.log(`    ✓ ${m.label} @ ${fmtMin(wall)} (band ${fmtMin(m.lo)}–${fmtMin(m.hi)})`);
      }
    }
    if (stopCondition && stopCondition(g, wall)) break;
    if (stopOnMilestones && MILESTONES.every((m) => hit[m.id] != null)) break;
  }
  return { wall, hit, g: game.state.g };
}

function reportMilestones(hit) {
  console.log(
    'Milestone'.padEnd(28) +
      'Hit'.padStart(10) +
      'Target'.padStart(16) +
      'Band'.padStart(16) +
      '  Status'
  );
  console.log('-'.repeat(78));

  let failed = 0;
  const rows = [];
  for (const m of MILESTONES) {
    const { lo, hi } = bandRange(m);
    const t = hit[m.id];
    let status = 'PASS';
    if (t == null) {
      status = 'MISS';
      failed++;
    } else if (t < lo || t > hi) {
      status = t < lo ? 'EARLY' : 'LATE';
      failed++;
    }
    const bandStr = `${fmtMin(lo)}–${fmtMin(hi)}`;
    console.log(
      m.label.padEnd(28) +
        fmtMin(t).padStart(10) +
        String(m.targetLabel).padStart(16) +
        bandStr.padStart(16) +
        '  ' +
        status
    );
    rows.push({ id: m.id, label: m.label, hit: t, target: m.targetLabel, lo, hi, status });
  }
  return { failed, rows };
}

function run() {
  console.log('\n=== pacing.mjs — PLAN-NEXT §C reference bot ===\n');
  const game = newGame();
  const { wall, hit, g } = simulate(game);

  // ── Report ─────────────────────────────────────────────────────────────────
  const { failed } = reportMilestones(hit);

  console.log('-'.repeat(72));
  console.log(
    `\nFinal @ ${fmtMin(wall)}: cash=$${g.cash.toFixed(0)} crew=${g.crew} ` +
      `patrons=${g.patrons.toFixed(1)} regulars=${g.regulars.toFixed(1)} clout=${g.clout.toFixed(2)} ` +
      `night=${g.night} upgrades=${Object.values(g.u).filter(Boolean).length}/${game.UPGRADES.length} ` +
      `research=${Object.values(g.r).filter(Boolean).length}/${game.RESEARCH.length}`
  );
  console.log(
    'Buildings: ' +
      game.BUILDINGS.map((b) => `${b.id}=${g.b[b.id] || 0}`).join(' ')
  );

  if (failed > 0) {
    console.log(`\n❌ ${failed} milestone(s) outside band (or missed).\n`);
    process.exit(1);
  }
  console.log('\n✅ All milestones within band.\n');
}

function prestigeRun() {
  const totalSec = SIM_HOURS * 3600;

  console.log('\n=== Prestige scenario (PRESTIGE.md §7) ===\n');

  // Run 1: bot plays until prestige gate or wall cap (do not stop at milestones).
  const game1 = newGame();
  const ledMilestone = MILESTONES.find((m) => m.id === 'upgrade');
  let t1 = null;
  const { g: g1, hit: hit1 } = simulate(game1, (g, wall) => {
    if (t1 == null && ledMilestone.check(g)) t1 = wall;
    return g.regulars >= 25 && g.night >= 10;
  }, totalSec, { stopOnMilestones: false });

  if (g1.regulars < 25) {
    console.log(`FAIL: prestige gate not reached (regulars=${g1.regulars.toFixed(1)} < 25 at wall cap ${fmtMin(totalSec)})`);
    console.log('  run2 skipped — gate is locked.\n');
    process.exit(1);
  }

  const gateRegulars = g1.regulars;
  if (t1 == null) t1 = hit1.upgrade; // fallback if LED happened before we started tracking

  // Prestige and buy cash10 rank 1.
  game1.confirmPrestige();
  const g2 = game1.state.g;
  if (g2.legacy < 1) {
    console.log(`FAIL: prestige yielded ${g2.legacy} Legacy, need >= 1 to buy cash10.`);
    process.exit(1);
  }
  const cash10Def = game1.PRESTIGE_PERKS.find((d) => d.id === 'cash10');
  game1.buyPerk(cash10Def);
  if (game1.perk(g2, 'cash10') !== 1) {
    console.log('FAIL: failed to purchase cash10 rank 1 after prestige.');
    process.exit(1);
  }

  // Run 2: same bot from post-prestige start state.
  let t2 = null;
  const { hit: hit2 } = simulate(game1, (g, wall) => {
    if (t2 == null && ledMilestone.check(g)) {
      t2 = wall;
      return true;
    }
    return false;
  }, totalSec);
  if (t2 == null) t2 = hit2.upgrade;

  const delta = (t2 != null && t1 != null) ? t2 - t1 : null;
  console.log(`  run1 gate regulars: ${gateRegulars.toFixed(1)} (need >= 25)`);
  console.log(`  run1 first LED:     ${fmtMin(t1)}`);
  console.log(`  run2 first LED (+10% cash perk): ${fmtMin(t2)}`);
  console.log(`  delta:              ${delta != null ? (delta / 60).toFixed(2) + 'm' : '—'} (must be < 0 wall for run2 − run1)`);

  if (delta == null || delta >= 0) {
    console.log('\n❌ Prestige scenario failed: run2 did not reach first LED faster than run1.\n');
    process.exit(1);
  }
  console.log('\n✅ Prestige scenario passed: run2 first LED is faster.\n');
}

function secondRoomRun() {
  const totalSec = SIM_HOURS * 3600;
  const ledMilestone = MILESTONES.find((m) => m.id === 'upgrade');

  console.log('\n=== Second-room scenario (SECOND_LOCATION.md §12) ===\n');

  // Run 1: fresh club, no perks/research. Capture t1 = first LED — the
  // no-account-progress baseline — then play on to the first prestige gate.
  const game = newGame();
  let t1 = null;
  const g1 = simulate(game, (g, wall) => {
    if (t1 == null && ledMilestone.check(g)) t1 = wall;
    return g.regulars >= 25 && g.night >= 10;
  }, totalSec, { stopOnMilestones: false }).g;
  if (g1.regulars < 25) {
    console.log(`FAIL: prestige gate not reached (regulars=${g1.regulars.toFixed(1)} < 25 at wall cap ${fmtMin(totalSec)})`);
    process.exit(1);
  }

  // Prestige 1 → cash10 rank 1. Run 2 in main (faster with the perk) →
  // prestige 2, which funds cash10 rank 2 + the manager (10 Legacy) the
  // second-room gate requires.
  game.confirmPrestige();
  const cash10Def = game.PRESTIGE_PERKS.find((d) => d.id === 'cash10');
  game.buyPerk(cash10Def);
  const g2 = simulate(game, (g) => g.regulars >= 25 && g.night >= 10, totalSec, { stopOnMilestones: false }).g;
  if (g2.regulars < 25) {
    console.log('FAIL: second prestige gate not reached within the wall cap.');
    process.exit(1);
  }
  game.confirmPrestige();
  game.buyPerk(cash10Def);
  if (game.perk(game.state.g, 'cash10') !== 2) {
    console.log(`FAIL: expected cash10 rank 2 after second purchase, got ${game.perk(game.state.g, 'cash10')}.`);
    process.exit(1);
  }
  const managerDef = game.MANAGERS.find((d) => d.id === 'rail');
  game.buyManager(managerDef);
  if (!game.state.g.managers.rail) {
    console.log('FAIL: could not afford a manager after two prestiges (needs 10 Legacy) — gate unreachable.');
    process.exit(1);
  }

  // Seed research after the final prestige (confirmPrestige resets g.r via
  // fresh()) so the annex measures account progress with research intact.
  // Buy the two cheapest research items to exercise carry-over.
  const researchDefs = game.RESEARCH.filter((d) => !game.state.g.r[d.id]).sort((a, b) => a.cost - b.cost);
  for (const rd of researchDefs.slice(0, 2)) {
    game.state.g.clout += rd.cost; // ensure affordable in the bot harness
    game.buyResearch(rd);
  }
  const seededResearch = Object.keys(game.state.g.r).filter((k) => game.state.g.r[k]);
  if (seededResearch.length < 2) {
    console.log(`FAIL: expected ≥2 research items seeded after prestige, got ${seededResearch.length}.`);
    process.exit(1);
  }

  // Unlock the annex and switch: the second room starts fresh but inherits the
  // account's cash10 perk, research tree, and manager delegation.
  if (!game.canOpenRoom()) {
    console.log('FAIL: second-room gate not met after prestige + manager.');
    process.exit(1);
  }
  game.confirmOpenRoom();
  if (!game.state.g.clubs.annex) {
    console.log('FAIL: confirmOpenRoom did not create the annex.');
    process.exit(1);
  }
  // Pause the rail manager for the measurement: managers auto-buy UNBOUNDED on
  // their building (no max on rail), so an active manager redirects the shared
  // till and the run would measure the manager's spend pattern, not whether
  // account progress makes the fresh room faster. Pausing isolates perks +
  // research carry-over; delegation is exercised in live play.
  game.state.g.managerPaused.rail = true;
  game.setActiveClub('annex');
  // Verify the switch actually landed — without this, a silent no-op would
  // measure the main room (fresh post-prestige) and produce a false pass.
  if (game.state.g.activeClub !== 'annex') {
    console.log(`FAIL: setActiveClub('annex') did not switch (activeClub=${game.state.g.activeClub}).`);
    process.exit(1);
  }
  // Verify the annex starts truly fresh — if confirmOpenRoom ever creates it
  // with the LED upgrade already owned, the milestone predicate fires on tick 1
  // and the scenario passes trivially without measuring anything.
  const annexClub = game.club(game.state.g);
  if (annexClub.u.led) {
    console.log('FAIL: annex created with LED upgrade already owned — not a fresh room.');
    process.exit(1);
  }
  // Verify the hired manager survives the room switch.
  if (!game.state.g.managers.rail) {
    console.log('FAIL: manager lost after setActiveClub(\'annex\') — carry-over broken.');
    process.exit(1);
  }
  // Verify seeded research survived the switch (confirmPrestige resets g.r;
  // we re-seeded above — the annex must see it).
  const annexResearch = Object.keys(game.state.g.r).filter((k) => game.state.g.r[k]);
  if (annexResearch.length < 2) {
    console.log(`FAIL: research not preserved after annex switch (expected ≥2, got ${annexResearch.length}).`);
    process.exit(1);
  }
  // Verify research actually affects annex rates — not just flag persistence.
  // Temporarily set regulars=1 so the loop research has a measurable effect,
  // then compare rates with loop on vs off.
  const savedRegulars = annexClub.regulars;
  annexClub.regulars = 1;
  const rWithLoop = game.rates(game.state.g);
  game.state.g.r.loop = false;
  const rWithoutLoop = game.rates(game.state.g);
  game.state.g.r.loop = true;
  annexClub.regulars = savedRegulars;
  if (rWithLoop.cash <= rWithoutLoop.cash) {
    console.log('FAIL: loop research has no effect on annex cash rate — research is cosmetic.');
    process.exit(1);
  }
  // Verify cash10 perk affects annex rates — not just flag persistence.
  // cashIncomeMult = 1 + 0.15 * rank; toggling rank 2 → 0 must lower the rate.
  // Need a non-zero income source for the multiplier to scale — set patrons=1
  // (door cover = 0.02/s) so the house cut has something to multiply.
  const savedPatrons = annexClub.patrons;
  annexClub.patrons = 1;
  const savedPerks = game.state.g.perks.cash10;
  game.state.g.perks.cash10 = 0;
  const rNoPerk = game.rates(game.state.g);
  game.state.g.perks.cash10 = savedPerks;
  const rWithPerk = game.rates(game.state.g);
  annexClub.patrons = savedPatrons;
  if (rWithPerk.cash <= rNoPerk.cash) {
    console.log('FAIL: cash10 perk has no effect on annex cash rate — perk is cosmetic.');
    process.exit(1);
  }

  // Run 3: the same bot plays the annex to its first LED.
  let t2 = null;
  simulate(game, (g, wall) => {
    if (t2 == null && ledMilestone.check(g)) { t2 = wall; return true; }
    return false;
  }, totalSec, { stopOnMilestones: false });

  const delta = (t1 != null && t2 != null) ? t2 - t1 : null;
  console.log(`  run1 first LED (fresh, no perks):            ${fmtMin(t1)}`);
  console.log(`  annex first LED (cash10×2 + ${seededResearch.length} research seeded, manager paused): ${fmtMin(t2)}`);
  console.log(`  delta: ${delta != null ? (delta / 60).toFixed(2) + 'm' : '—'} (must be < 0: account progress makes the second room faster)`);
  if (delta == null || delta >= 0) {
    console.log('\n❌ Second-room scenario failed: annex did not reach first LED faster than the fresh baseline.\n');
    process.exit(1);
  }
  console.log('\n✅ Second-room scenario passed: annex first LED is faster.\n');
}

/**
 * Renown scenario (REPLAY_ROADMAP.md §8–9). Honest end-to-end: the bot prestige-
 * loops (each cycle: play main to the prestige gate, prestige, buy every
 * affordable perk/manager in order, unlock the annex once a manager exists)
 * until the franchise gate opens — all perks maxed, all managers hired, both
 * clubs owned — then sells, verifies the post-sale state, and plays the §9
 * rooftop: buys the Rooftop Lease brand perk with the sale's Renown, opens the
 * third club, and confirms the location extras move the rooftop economy via
 * direct rates() toggles (per §10 — a fresh-baseline LED comparison would pass
 * on achievement carryover alone) and that the third club plays to its first
 * LED within the wall cap. The bot never buys brand perks or location extras,
 * so the extras cannot move the measured main-run bands.
 *
 * Reference run: gate at ~312 min sim / 12 cycles, renownGain ≈ 14. Band is
 * deliberately wide (2h–8h): it must catch a SLOWDOWN that pushes the gate past
 * the 8h sim cap, not punish a future balance change that makes the journey
 * shorter (a faster gate is a pacing improvement).
 */
function renownRun() {
  const totalSec = SIM_HOURS * 3600;

  console.log(`
=== Renown scenario (REPLAY_ROADMAP.md §8) ===
`);

  const game = newGame();
  let cycles = 0;
  const { g, wall: gateAt } = simulate(game, (cur) => {
    // Unlock the annex as soon as a manager exists (second-room gate: prestiges
    // >= 1 AND at least one manager). The franchise gate requires BOTH clubs.
    if (cur.prestiges >= 1 && !cur.clubs.annex &&
        Object.values(cur.managers || {}).some(Boolean)) {
      game.confirmOpenRoom();
    }
    // Prestige at the standard gate, then buy all affordable meta.
    if ((cur.regulars || 0) >= 25 && (cur.night || 0) >= 10) {
      cycles++;
      game.confirmPrestige();
      buyAllMeta(game);
    }
    return game.franchiseGate(game.state.g);
  }, totalSec, { stopOnMilestones: false });

  console.log(`  gate at:      ${fmtMin(gateAt)} sim, ${cycles} prestige cycles (need < ${fmtMin(totalSec)} cap)`);
  console.log(`  legacyTotal:  ${g.legacyTotal.toFixed(1)}`);
  console.log(`  perks maxed:  ${game.PRESTIGE_PERKS.every((p) => game.perk(g, p.id) >= p.max)}`);
  console.log(`  managers:     ${game.MANAGERS.filter((m) => g.managers[m.id]).length}/${game.MANAGERS.length} hired`);
  console.log(`  renownGain:   +${game.renownGain(g).toFixed(0)} Renown on sale`);
  console.log(`  lifetime:     $${game.fmt(game.lifetimeEarned(g))} earned at gate (below ★1 $${game.fmt(game.VISION_TIERS[0].worth)} — no cash bonus fired on the sale loop)`);
  if (game.lifetimeEarned(g) >= game.VISION_TIERS[0].worth) {
    console.log(`
❌ Renown scenario failed: prestige-loop lifetime $${game.lifetimeEarned(g).toFixed(0)} crossed ★1 ($${game.fmt(game.VISION_TIERS[0].worth)}) — the vision cash bonus fired mid-loop and the bands are no longer the 0.11.14 reference. Re-pin VISION_TIERS[0].worth above the loop's total.
`);
    process.exit(1);
  }

  if (!game.franchiseGate(g)) {
    console.log(`
❌ Renown scenario failed: franchise gate not reached within the ${fmtMin(totalSec)} cap.
`);
    process.exit(1);
  }
  if (gateAt < 2 * 3600 || gateAt >= 8 * 3600) {
    console.log(`
❌ Renown scenario failed: gate at ${fmtMin(gateAt)} is outside the 2h–8h band.
`);
    process.exit(1);
  }
  const gain = game.renownGain(g);
  if (gain < 10) {
    console.log(`
❌ Renown scenario failed: sale yields only ${gain} Renown (< 10 — the layer is token).
`);
    process.exit(1);
  }

  // Sell: two-click armed, then verify the §8.4 reset matrix.
  game.openFranchise();
  game.confirmFranchiseSale(); // arms
  if (!game.state.franchiseArmed) {
    console.log(`
❌ Renown scenario failed: sale did not arm on first click.
`);
    process.exit(1);
  }
  game.confirmFranchiseSale(); // sells
  const a = game.state.g;
  if (game.state.saveState !== 'franchise sold') {
    console.log(`
❌ Renown scenario failed: sale did not complete (saveState=${game.state.saveState}).
`);
    process.exit(1);
  }
  if (a.renown !== gain || a.renownTotal !== gain) {
    console.log(`
❌ Renown scenario failed: renown=${a.renown} renownTotal=${a.renownTotal}, expected ${gain} each.
`);
    process.exit(1);
  }
  if (Object.keys(a.clubs).join(',') !== 'main' || a.activeClub !== 'main') {
    console.log(`
❌ Renown scenario failed: clubs=${Object.keys(a.clubs).join(',')} activeClub=${a.activeClub} — annex must re-lock.
`);
    process.exit(1);
  }
  if (a.prestiges !== 0 || a.legacy !== 2 || a.legacyTotal !== 2) {
    console.log(`
❌ Renown scenario failed: prestige state not wiped (prestiges=${a.prestiges} legacy=${a.legacy} legacyTotal=${a.legacyTotal}). Expected legacy=2 legacyTotal=2 from franchise_1 achievement on first sale.
`);
    process.exit(1);
  }
  if (!game.PRESTIGE_PERKS.every((p) => a.perks[p.id] === 0) ||
      !game.MANAGERS.every((m) => !a.managers[m.id])) {
    console.log(`
❌ Renown scenario failed: perks/managers not wiped by the sale.
`);
    process.exit(1);
  }
  if (!Array.isArray(a.achievements) || !a.achievements.includes('prestige_1')) {
    console.log(`
❌ Renown scenario failed: achievements not preserved by the sale.
`);
    process.exit(1);
  }

  // ── Rooftop scenario (REPLAY_ROADMAP.md §9) ──────────────────────────────
  // The sale leaves spendable Renown. Buying the Rooftop Lease brand perk
  // spends it, unlocks the third club, and the third club plays with its own
  // location extras. The bot never buys brand perks or location extras, so the
  // rooftop's first LED must beat a fresh baseline ONLY via preserved account
  // progress (achievements survive the sale) — the extras are identity, not a
  // bot-path economy shift.
  const lease = game.BRAND_PERKS.find((p) => p.id === 'rooftop');
  const ledMilestone = MILESTONES.find((m) => m.id === 'upgrade');
  if (!lease) {
    console.log('\n❌ Rooftop scenario failed: BRAND_PERKS has no rooftop lease.\n');
    process.exit(1);
  }
  if (a.renown < lease.cost) {
    console.log(`\n❌ Rooftop scenario failed: only ${a.renown} Renown after the sale — cannot afford the ${lease.cost}-Renown lease.\n`);
    process.exit(1);
  }
  const renownBefore = a.renown;
  game.buyBrandPerk(lease);
  if (a.brand.rooftop !== 1 || a.renown !== renownBefore - lease.cost) {
    console.log(`\n❌ Rooftop scenario failed: lease purchase wrong (brand=${a.brand.rooftop} renown=${a.renown}, expected 1 / ${renownBefore - lease.cost}).\n`);
    process.exit(1);
  }
  if (a.renownTotal !== gain) {
    console.log(`\n❌ Rooftop scenario failed: spending Renown moved renownTotal (${a.renownTotal}, expected ${gain}).\n`);
    process.exit(1);
  }
  game.buyBrandPerk(lease); // max rank 1 — must no-op
  if (a.brand.rooftop !== 1 || a.renown !== renownBefore - lease.cost) {
    console.log('\n❌ Rooftop scenario failed: lease bought past max rank.\n');
    process.exit(1);
  }
  if (!game.canOpenRooftop()) {
    console.log('\n❌ Rooftop scenario failed: rooftop gate did not open after the lease.\n');
    process.exit(1);
  }
  game.confirmOpenRooftop();
  if (!a.clubs.rooftop) {
    console.log('\n❌ Rooftop scenario failed: confirmOpenRooftop did not create the rooftop.\n');
    process.exit(1);
  }
  // Own-property read: `game.club(a)` would resolve the ACTIVE club (main)
  // until the switch below — read the rooftop club from the map directly.
  const rtc = a.clubs.rooftop;
  if (rtc.b.heli !== 0 || rtc.u.vista !== false) {
    console.log('\n❌ Rooftop scenario failed: rooftop extras not initialized (heli/vista).\n');
    process.exit(1);
  }
  if (game.canOpenRooftop()) {
    console.log('\n❌ Rooftop scenario failed: rooftop gate still open after creation.\n');
    process.exit(1);
  }
  game.setActiveClub('rooftop');
  if (a.activeClub !== 'rooftop') {
    console.log(`\n❌ Rooftop scenario failed: setActiveClub('rooftop') did not switch (activeClub=${a.activeClub}).\n`);
    process.exit(1);
  }
  // Direct effect assertion (REPLAY_ROADMAP.md §10 — mirrors secondRoomRun()'s
  // research toggle). The extras must move the rooftop economy, not be
  // cosmetic: a fresh-baseline comparison would pass on achievement carryover
  // alone (the sale keeps 30 achievements → +30% cash), so toggle the extras
  // on a fixed rooftop state and require rates() to respond.
  const savedPatrons = rtc.patrons;
  rtc.patrons = 10; // non-zero income so the extra cash building has something to scale
  const rNoHeli = game.rates(a);
  rtc.b.heli = 1;
  const rHeli = game.rates(a);
  rtc.b.heli = 0;
  rtc.patrons = savedPatrons;
  if (rHeli.cash <= rNoHeli.cash) {
    console.log('\n❌ Rooftop scenario failed: Helipad Lounge has no cash effect — the extra is cosmetic.\n');
    process.exit(1);
  }
  rtc.b.dj = 1;
  const hNoVista = game.rates(a).hype;
  rtc.u.vista = true;
  const hVista = game.rates(a).hype;
  rtc.u.vista = false;
  rtc.b.dj = 0;
  if (hVista <= hNoVista) {
    console.log('\n❌ Rooftop scenario failed: Panorama Deck has no hype effect — the extra is cosmetic.\n');
    process.exit(1);
  }
  // ── §10 guard: the third club plays faster than a same-achievements control ──
  // Snapshot the post-sale account BEFORE either run so both measurements start
  // from byte-identical state (same achievements — a no-achievement fresh
  // control would pass on achievement carryover alone, REPLAY_ROADMAP.md §10).
  const prePlay = JSON.parse(JSON.stringify(a));
  // Control: the rooftop played by the standard bot — location extras are NOT
  // in the shared catalog (extraBuildings/extraUpgrades concat at render/init
  // only), so this run never buys them. Faster than a fresh baseline, but only
  // via the preserved achievements.
  let t3Control = null;
  simulate(game, (g, wall) => {
    if (t3Control == null && ledMilestone.check(g)) { t3Control = wall; return true; }
    return false;
  }, totalSec, { stopOnMilestones: false });
  if (t3Control == null) {
    console.log('\n❌ Rooftop scenario failed: control first LED not reached within the wall cap.\n');
    process.exit(1);
  }
  // Extras run: the SAME account (identical achievements), rooftop seeded with
  // its location content (Helipad Lounge + Panorama Deck — the player bought
  // them). Direct toggle of the §9 effect on a fixed state, mirroring
  // secondRoomRun()'s research/perk toggles.
  const gx = newGame();
  gx.state.g = gx.wrapState(prePlay);
  gx.state.g.clubs.rooftop.b.heli = 1;
  gx.state.g.clubs.rooftop.u.vista = true;
  let t3Extras = null;
  simulate(gx, (g, wall) => {
    if (t3Extras == null && ledMilestone.check(g)) { t3Extras = wall; return true; }
    return false;
  }, totalSec, { stopOnMilestones: false });
  if (t3Extras == null) {
    console.log('\n❌ Rooftop scenario failed: extras first LED not reached within the wall cap.\n');
    process.exit(1);
  }
  // Margin assert: the extras must win by at least 15%. The run is
  // deterministic, so strict `<` alone would pass a regression that merely
  // narrows the location content's advantage without inverting it.
  if (!(t3Extras < t3Control * 0.85)) {
    console.log(`\n❌ Rooftop scenario failed: extras run ${fmtMin(t3Extras)} is not ≥15% faster than the same-achievements control ${fmtMin(t3Control)} (needs < ${fmtMin(t3Control * 0.85)}) — the location content is dead weight.\n`);
    process.exit(1);
  }
  console.log(`  rooftop first LED (control, extras unavailable):  ${fmtMin(t3Control)}`);
  console.log(`  rooftop first LED (extras seeded: heli + vista):  ${fmtMin(t3Extras)} (same achievements, must be ≥15% faster)`);

  console.log(`\n✅ Renown scenario passed: franchise sold at ${fmtMin(gateAt)} for +${gain} Renown; ` +
    `${a.achievements.length} achievements kept, annex re-locked, rooftop opened and playing (control ${fmtMin(t3Control)} → extras ${fmtMin(t3Extras)}, extras verified live).`);
}

/**
 * Endgame probe (next-roadmap PR 4). The Vision ladder's ★1 tier must sit
 * above everything the deterministic bot can earn, or the +1% all-cash bonus
 * would fire mid-run and silently shift every band away from the 0.11.14
 * reference. This probe pins the sizing claim from the safe side: the plain
 * reference bot (no prestige, no meta purchases — same botSecond policy as
 * run()) plays the FULL 8h wall cap, and its lifetime gross must stay
 * strictly below VISION_TIERS[0].worth.
 *
 * Why the full cap: run() stops when the last milestone hits (~105 min), but
 * the accumulator is monotonic — the honest bound is the most the bot could
 * ever earn inside the sim window, not what it has earned at the milestone
 * checkpoint. If the full-window bound holds, visionBonus(g) === 0 at every
 * instant of every scenario (run/prestige/second-room share this policy or
 * subsets of it; the prestige-loop bound is asserted separately in
 * renownRun), so the totalCashMult factor is exactly ×1.0 on all bot paths
 * and every band is bit-identical to 0.11.14.
 */
function endgameProbe() {
  const totalSec = SIM_HOURS * 3600;

  console.log(`
=== Endgame probe (next-roadmap PR 4 — Vision tier sizing) ===
`);

  const game = newGame();
  const { wall, g } = simulate(game, null, totalSec, { stopOnMilestones: false });

  const earned = game.lifetimeEarned(g);
  const star1 = game.VISION_TIERS[0].worth;
  const pct = (earned / star1 * 100).toFixed(1);
  console.log(`  plain bot, full ${SIM_HOURS}h cap @ ${fmtMin(wall)}: lifetime earned $${game.fmt(earned)}`);
  console.log(`  ★1 tier worth: $${game.fmt(star1)} — bot reached ${pct}% of it`);
  console.log(`  visionBonus at end: +${(game.visionBonus(g) * 100).toFixed(0)}% (must be exactly 0)`);

  if (!(earned < star1)) {
    console.log(`
❌ Endgame probe failed: the bot's 8h lifetime ($${game.fmt(earned)}) is not strictly below ★1 ($${game.fmt(star1)}) — the vision cash bonus fired on the deterministic path, so the milestone bands measured by this file are no longer the 0.11.14 reference. Re-pin VISION_TIERS[0].worth above the full-cap bound.
`);
    process.exit(1);
  }
  if (game.visionBonus(g) !== 0) {
    console.log(`
❌ Endgame probe failed: visionBonus is nonzero (${game.visionBonus(g)}) below ★1 — the tier boundary or the derived read is broken.
`);
    process.exit(1);
  }
  console.log(`
✅ Endgame probe passed: ★1 sits above the bot's full-cap lifetime — bonus ×1.0 on every bot path, bands bit-identical to 0.11.14.
`);
}

/**
 * Mid-band scenario (post-polish PR 7). The deterministic bot's measured
 * milestones top out at "all research owned" (~105m); nothing is band-measured
 * between there and the first franchise sale (~312m) — the post-polish §1.3
 * dead zone. This scenario plays the prestige loop to the franchise gate, sells
 * for the first Renown, and buys the first Brand perk (the first Renown-sink
 * event) — a finer-grained (±5%) anchor on the post-research progression than
 * renownRun's wide 2h–8h gate band.
 *
 * The bot's standard per-second policy (botSecond / buyAllMeta) never buys
 * Brand perks or Endorsements, so the explicit purchase below cannot shift the
 * other scenarios' bands — the five existing scenarios stay bit-identical.
 */
function midBandRun() {
  const totalSec = SIM_HOURS * 3600;

  console.log(`
=== Mid-band scenario (post-polish PR 7 — first brand perk) ===
`);

  const game = newGame();
  let cycles = 0;
  const { g, wall: gateAt } = simulate(game, (cur) => {
    if (cur.prestiges >= 1 && !cur.clubs.annex &&
        Object.values(cur.managers || {}).some(Boolean)) {
      game.confirmOpenRoom();
    }
    if ((cur.regulars || 0) >= 25 && (cur.night || 0) >= 10) {
      cycles++;
      game.confirmPrestige();
      buyAllMeta(game);
    }
    return game.franchiseGate(game.state.g);
  }, totalSec, { stopOnMilestones: false });

  if (!game.franchiseGate(g)) {
    console.log(`
❌ Mid-band scenario failed: franchise gate not reached within the ${fmtMin(totalSec)} cap.
`);
    process.exit(1);
  }

  // First franchise sale → first Renown → first Brand perk (the first
  // Renown-sink event). Two-click armed, mirroring renownRun's sale. `gain` is
  // computed from the PRE-sale account (g): the sale wipes legacy/prestiges, so
  // renownGain(a) would read 0.
  const gain = game.renownGain(g);
  game.openFranchise();
  game.confirmFranchiseSale(); // arm
  if (!game.state.franchiseArmed) {
    console.log(`
❌ Mid-band scenario failed: sale did not arm on first click.
`);
    process.exit(1);
  }
  game.confirmFranchiseSale(); // sell
  const a = game.state.g;
  // Cheapest Brand perk (offline, 3 Renown) — the first affordable sink spend.
  const cheapest = game.BRAND_PERKS.slice().sort((x, y) => x.cost - y.cost)[0];
  const renownBefore = a.renown;
  game.buyBrandPerk(cheapest);
  if (game.brandRank(a, cheapest.id) !== 1 || a.renown !== renownBefore - cheapest.cost) {
    console.log(`
❌ Mid-band scenario failed: ${cheapest.id} not bought (rank=${game.brandRank(a, cheapest.id)}, renown=${a.renown}, expected ${renownBefore - cheapest.cost}).
`);
    process.exit(1);
  }

  // The first Brand perk is bought the instant Renown exists — at the franchise
  // gate — so the milestone time is the gate time. Pin ±5% around the reference
  // first sale (311.70m). Deterministic, so any drift >5% is a real balance
  // change, not noise.
  const anchor = 311.70 * 60;
  const lo = anchor * 0.95;
  const hi = anchor * 1.05;
  console.log(`  first brand perk @ ${fmtMin(gateAt)} (${cycles} cycles, +${gain} Renown → ${cheapest.name} rank 1)`);
  console.log(`  band ${fmtMin(lo)}–${fmtMin(hi)} (±5% around ${fmtMin(anchor)})`);
  if (gateAt < lo || gateAt > hi) {
    console.log(`
❌ Mid-band scenario failed: first brand perk at ${fmtMin(gateAt)} is outside the ±5% band ${fmtMin(lo)}–${fmtMin(hi)}.
`);
    process.exit(1);
  }
  console.log(`
✅ Mid-band scenario passed: first brand perk lands in the post-research anchor band.
`);
}

if (FAST) {
  console.log('fast mode (--fast): skipping renown + mid-band + endgame full-cap scenarios\n');
}
withBudget('reference bot', RUN_BUDGET_MS, run);
withBudget('prestige scenario', RUN_BUDGET_MS, prestigeRun);
withBudget('second-room scenario', RUN_BUDGET_MS, secondRoomRun);
if (!FAST) {
  withBudget('renown scenario', RUN_BUDGET_MS, renownRun);
  withBudget('mid-band scenario', RUN_BUDGET_MS, midBandRun);
  withBudget('endgame probe', ENDGAME_BUDGET_MS, endgameProbe);
}
// Force exit on success: confirmPrestige()/the franchise sale start an autosave
// setInterval that keeps the event loop alive. On the pre-existing failure path
// process.exit(1) is called; on the success path node otherwise hangs.
process.exit(0);
