// pacing.mjs — Afterglow Club Idle reference-bot pacing simulator (PLAN-NEXT §C)
// Run: node pacing.mjs
// Dependencies: none (Node built-ins only)
// Exits non-zero when any milestone falls outside its band.

import { readFileSync } from 'node:fs';

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
const src = readFileSync(new URL('./game.js', import.meta.url), 'utf8');
const stripped = src
  .replace(/\nconst game = new Game\(document\.getElementById\('app'\)\);\s*\ngame\.init\(\);\s*(?:\ngame\.mountLook\(\);\s*)?(?:\ngame\.mountFxLayer\(\);\s*)?$/, '\n');
if (stripped === src) {
  console.error('pacing.mjs: failed to strip game.js boot lines — process may hang');
  process.exit(2);
}
const Game = new Function(stripped + ';\nreturn Game;')();

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
    targetLabel: '~45 min ±30%',
    lo: 45 * 60 * 0.7,
    hi: 45 * 60 * 1.3,
    check: (g) => {
      const u = g.u || {};
      return Object.keys(u).length > 0 && Object.values(u).every(Boolean);
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
  const avail = game.RESEARCH
    .filter((d) => !g.r[d.id] && g.clout >= d.cost)
    .sort((a, b) => a.cost - b.cost);
  if (avail.length) game.buyResearch(avail[0]);
}

/** Assign: all stage until hype ≥ 40; then 1 stage, rest vipjob if VIP else floor. */
function assignCrew(game) {
  const g = game.state.g;
  if (g.crew <= 0) return;

  // Collapse everyone onto off residual, then place.
  g.jobs.stage = 0;
  g.jobs.vipjob = 0;
  g.jobs.floor = 0;
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

function newGame() {
  const game = new Game(root);
  game.forceUpdate = () => {};
  game.state.g = game.fresh();
  return game;
}

function simulate(game, stopCondition, maxSec = SIM_HOURS * 3600, opts = {}) {
  const stopOnMilestones = opts.stopOnMilestones !== false;
  const hit = Object.create(null);
  for (const m of MILESTONES) hit[m.id] = null;

  let wall = 0;
  while (wall < maxSec) {
    // One bot decision per simulated second, then advance 1s of sim so
    // income/resource changes precede the next decision (not 5 decisions then +5s).
    botSecond(game);
    game.step(1);
    wall += 1;

    const g = game.state.g;
    for (const m of MILESTONES) {
      if (hit[m.id] == null && m.check(g)) hit[m.id] = wall;
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
  const game = newGame();
  const { wall, hit, g } = simulate(game);

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log('\n=== pacing.mjs — PLAN-NEXT §C reference bot ===\n');
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

  // Run 1: bot plays until prestige gate or wall cap (do not stop at milestones).
  const game1 = newGame();
  const ledMilestone = MILESTONES.find((m) => m.id === 'upgrade');
  let t1 = null;
  const { g: g1, hit: hit1 } = simulate(game1, (g, wall) => {
    if (t1 == null && ledMilestone.check(g)) t1 = wall;
    return g.regulars >= 25 && g.night >= 10;
  }, totalSec, { stopOnMilestones: false });

  console.log('\n=== Prestige scenario (PRESTIGE.md §7) ===\n');

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

run();
prestigeRun();
// Force exit on success: confirmPrestige() starts an autosave setInterval that
// keeps the event loop alive. On the pre-existing failure path process.exit(1)
// is called; on the success path node otherwise hangs indefinitely.
process.exit(0);
