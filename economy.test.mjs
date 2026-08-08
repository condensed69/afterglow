// economy.test.mjs — Afterglow Club Idle economy test harness
// Run: node economy.test.mjs
// Dependencies: none (Node built-ins only)
// PLAN.md §1.0 — guards Phase 1 correctness fixes

import { ok, strictEqual } from 'node:assert';
import { readFileSync } from 'node:fs';

// ── DOM Prelude ──────────────────────────────────────────────────────────────
// Stub browser globals so game.js can parse and construct without a DOM.
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
// Real setter (not a pure no-op) so smoke tests can assert on emitted markup;
// the getter still returns '' by default to keep unrelated tests unaffected.
let lastInnerHTML = '';
Object.defineProperty(root, 'innerHTML', { set: v => { lastInnerHTML = v; }, get: () => '' });
Object.defineProperty(root, 'style', { value: {}, writable: true });

// Capture listeners so ownership lifecycle (pagehide/pageshow/storage) is testable.
const windowListeners = Object.create(null);
globalThis.window = {
  addEventListener: (type, fn) => {
    if (!windowListeners[type]) windowListeners[type] = [];
    windowListeners[type].push(fn);
  },
  removeEventListener: (type, fn) => {
    if (!windowListeners[type]) return;
    windowListeners[type] = windowListeners[type].filter(f => f !== fn);
  },
  dispatchEvent: (type, event) => {
    for (const fn of (windowListeners[type] || [])) fn(event || {});
  },
  ResizeObserver: undefined,
};
function clearWindowListeners() {
  for (const k of Object.keys(windowListeners)) delete windowListeners[k];
}
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
  createElement: () => ({ ...root, click: () => {}, files: null }),
  createTextNode: () => ({}),
  documentElement: { style: {} },
};
// Blob / object-URL / FileReader shims for PLAN-NEXT §A download + load-file paths.
// Keep the real URL constructor (Node uses it for import.meta.url); only add blob helpers.
globalThis.Blob = class Blob {
  constructor(parts, opts) {
    this.parts = parts;
    this.type = (opts && opts.type) || '';
  }
};
globalThis.URL.createObjectURL = () => 'blob:test';
globalThis.URL.revokeObjectURL = () => {};
globalThis.FileReader = class FileReader {
  constructor() {
    this.result = null;
    this.onload = null;
    this.onerror = null;
  }
  readAsText(file) {
    try {
      this.result = file && file._text != null ? file._text : '';
      if (typeof this.onload === 'function') this.onload();
    } catch (e) {
      if (typeof this.onerror === 'function') this.onerror(e);
    }
  }
};
globalThis.localStorage = {
  _data: Object.create(null),
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = Object.create(null); },
};
// Per-tab ownership (game.OWNER_KEY) — same shape as localStorage; not shared across tabs in browsers.
globalThis.sessionStorage = {
  _data: Object.create(null),
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = Object.create(null); },
};

// ── Load Game class (never run page boot) ────────────────────────────────────
// game.js ends with `const game = new Game(...); game.init();` which starts
// setInterval timers. Strip that boot so the process can exit cleanly.
const src = readFileSync(new URL('./game.js', import.meta.url), 'utf8');
const stripped = src
  .replace(/\nconst game = new Game\(document\.getElementById\('app'\)\);\s*\ngame\.init\(\);\s*(?:\ngame\.mountLook\(\);\s*)?(?:\ngame\.mountFxLayer\(\);\s*)?$/, '\n');
if (stripped === src) {
  console.error('economy.test.mjs: failed to strip game.js boot lines — process may hang');
  process.exit(2);
}
const Game = new Function(stripped + ';\nreturn Game;')();

// ── Test Harness ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0;

function test(label, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    console.error(`  FAIL  ${label}`);
    console.error(`        ${e.message}`);
    failed++;
  }
}

function xfail(label, fn, reason) {
  try {
    fn();
    console.error(`  FAIL  ${label} (expected to fail — ${reason || 'not yet implemented'})`);
    failed++;
  } catch (_) {
    console.log(`  ok    ${label} # TODO (xfail): ${reason || 'not yet implemented'}`);
    skipped++;
  }
}

function skip(label, reason) {
  console.log(`  skip  ${label} # ${reason}`);
  skipped++;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function jobSum(g) {
  return g.jobs.stage + g.jobs.vipjob + g.jobs.floor + g.jobs.off;
}

function resourceNames() {
  return ['cash', 'hype', 'buzz', 'patrons', 'regulars', 'clout'];
}

function newGame(startingCash) {
  // Isolate tab-owner session flag between tests (simulates a fresh tab by default).
  sessionStorage.clear();
  clearWindowListeners();
  // Drop cross-tab lease/probe left by prior tests so age-only claim is not blocked
  // by a stale foreign heartbeat from another Game instance.
  try {
    localStorage.removeItem('afterglow.tabOwnerLease');
    localStorage.removeItem('afterglow.tabOwnerProbe');
  } catch (e) { /* ignore */ }
  const game = new Game(root);
  // Suppress render() during tests (actions call forceUpdate → render).
  game.forceUpdate = () => {};
  if (startingCash !== undefined) game.props.startingCash = startingCash;
  game.state.g = game.fresh();
  return game;
}

function buildingById(game, id) {
  return game.BUILDINGS.find(b => b.id === id);
}

// Temporarily stub Math.random to a fixed sequence (cycles). Returns fn()'s result.
// Used to make the special-shift trigger deterministic. Careful: step()'s whale
// check also consumes Math.random when hype > 0, so tests that drive step() keep
// hype at 0 (no stage worker) or supply enough sequence values to cover it.
function withRandom(values, fn) {
  const orig = Math.random;
  let i = 0;
  Math.random = () => values[i++ % values.length];
  try { return fn(); } finally { Math.random = orig; }
}

const SECONDS_PER_NIGHT = 160; // 40+55+35+30

// ──────────────────────────────────────────────────────────────────────────────
// Test Suite
// ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== economy.test.mjs — Afterglow Club Idle Economy Harness ===\n');

// ── 1. Fresh state invariants ────────────────────────────────────────────────

console.log('1. Fresh state');
test('fresh() produces expected resource keys', () => {
  const game = newGame();
  const g = game.state.g;
  for (const k of resourceNames()) ok(k in g, `missing key: ${k}`);
  ok('jobs' in g, 'missing jobs');
  ok('b' in g, 'missing buildings map');
  ok('u' in g, 'missing upgrades map');
  ok('r' in g, 'missing research map');
  ok('elapsed' in g, 'missing elapsed');
  ok('night' in g, 'missing night');
});

test('fresh() starts with 0 crew and 0 job assignments', () => {
  const game = newGame();
  const g = game.state.g;
  strictEqual(g.crew, 0);
  strictEqual(jobSum(g), 0);
});

test('fresh() respects startingCash prop', () => {
  const game = newGame(50);
  strictEqual(game.state.g.cash, 50);
});

// ── 1b. Prestige meta invariants ─────────────────────────────────────────────

console.log('\n1b. Prestige meta');

test('fresh() includes legacy, legacyTotal, perks map, and prestiges', () => {
  const game = newGame();
  const g = game.state.g;
  strictEqual(g.legacy, 0);
  strictEqual(g.legacyTotal, 0);
  ok(g.perks && typeof g.perks === 'object' && !Array.isArray(g.perks), 'perks is a plain object');
  for (const def of game.PRESTIGE_PERKS) strictEqual(g.perks[def.id], 0, `${def.id} starts at 0`);
  strictEqual(g.prestiges, 0);
});

test('legacyGain() matches floor(sqrt(regulars) + night / 7)', () => {
  const game = newGame();
  const cases = [
    [{ regulars: 0, night: 1 }, 0],
    [{ regulars: 25, night: 1 }, 5],
    [{ regulars: 25, night: 14 }, 7],
    [{ regulars: 60, night: 30 }, 12],
    [{ regulars: 100, night: 1 }, 10],
    [{ regulars: 0, night: 100 }, 14],
    [{ regulars: 24, night: 7 }, 5],
    [{ regulars: 49, night: 7 }, 8],
  ];
  for (const [input, expected] of cases) {
    const g = { regulars: input.regulars, night: input.night };
    strictEqual(game.legacyGain(g), expected, `regulars=${input.regulars}, night=${input.night}`);
  }
});

test('cash10 multiplier scales rates().cash and cashIncomeMult()', () => {
  const game = newGame(1000);
  const g = game.state.g;
  g.b.rail = 2;
  g.b.bar = 1;
  g.patrons = 10;
  const base = game.rates(g).cash;
  const baseMult = game.cashIncomeMult(g);
  strictEqual(baseMult, 1);
  g.perks.cash10 = 5;
  const boosted = game.rates(g).cash;
  const boostedMult = game.cashIncomeMult(g);
  strictEqual(boostedMult, 1.5);
  ok(Math.abs(boosted - base * 1.5) < 0.0001, 'rates().cash scales by 1.5x at cash10 rank 5');
});

test('clout25 multiplier scales rates().clout', () => {
  const game = newGame();
  const g = game.state.g;
  g.regulars = 100;
  const base = game.rates(g).clout;
  g.perks.clout25 = 1;
  const boosted = game.rates(g).clout;
  ok(Math.abs(boosted - base * 1.25) < 0.0001, 'clout scales by 1.25x with clout25');
});

test('offline65 increases catchUp earnings over the same window', () => {
  const game = newGame(500);
  const base = game.state.g;
  base.b.rail = 2;
  base.b.bar = 1;
  base.patrons = 10;
  base.regulars = 5;
  const baseReport = game.catchUp(base, 60);

  const boosted = game.fresh();
  boosted.b.rail = 2;
  boosted.b.bar = 1;
  boosted.patrons = 10;
  boosted.regulars = 5;
  boosted.perks.offline65 = 1;
  const boostedReport = game.catchUp(boosted, 60);
  ok(boostedReport.earned > baseReport.earned, 'offline65 earns more over same window');
});

test('doorPlus raises effective Door Staff max to 7', () => {
  const game = newGame(5000);
  const g = game.state.g;
  const doorDef = game.BUILDINGS.find(b => b.id === 'door');
  strictEqual(game.doorMax(g), doorDef.max || 6);
  g.perks.doorPlus = 1;
  strictEqual(game.doorMax(g), (doorDef.max || 6) + 1);
  g.cash = 99999;
  for (let i = 0; i < 7; i++) game.buyBuilding(doorDef);
  strictEqual(g.b.door, 7, 'can buy up to 7 Door Staff with doorPlus');
});

test('confirmPrestige() resets run fields and persists meta', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.cash = 1234;
  g.hype = 50;
  g.buzz = 20;
  g.patrons = 30;
  g.regulars = 30;
  g.clout = 10;
  g.night = 10;
  g.b.rail = 2;
  g.b.bar = 1;
  g.crew = 3;
  g.jobs.stage = 3;
  g.perks.cash10 = 2;
  g.legacy = 5;
  g.legacyTotal = 12;
  g.prestiges = 1;

  game.confirmPrestige();
  const next = game.state.g;
  const gain = Math.floor(Math.sqrt(30) + 10 / 7);
  strictEqual(next.cash, game.props.startingCash, 'cash reset');
  strictEqual(next.hype, 0, 'hype reset');
  strictEqual(next.buzz, 0, 'buzz reset');
  strictEqual(next.patrons, 0, 'patrons reset');
  strictEqual(next.regulars, 0, 'regulars reset');
  strictEqual(next.clout, 0, 'clout reset');
  strictEqual(next.night, 1, 'night reset');
  strictEqual(next.b.rail, 0, 'buildings reset');
  strictEqual(next.b.bar, 0, 'buildings reset');
  strictEqual(next.crew, 0, 'crew reset');
  strictEqual(next.perks.cash10, 2, 'perks preserved');
  // legacy gain + prestige_1 achievement reward (+1 Legacy)
  strictEqual(next.legacy, 5 + gain + 1, 'legacy incremented by gain + achievement');
  strictEqual(next.legacyTotal, 12 + gain + 1, 'legacyTotal incremented by gain + achievement (achievement Legacy counts as earned)');
  strictEqual(next.prestiges, 2, 'prestiges incremented');
  ok(next.log.some(x => x.msg.includes('franchise deal')), 'prestige logged');
  ok(Array.isArray(next.achievements), 'achievements array persists');
  ok(next.achievements.includes('prestige_1'), 'prestige_1 achievement credited');
});

test('achievement legacy reward credits both spendable legacy and legacyTotal', () => {
  const game = newGame();
  const g = game.state.g;
  g.legacy = 3;
  g.legacyTotal = 7;
  g.prestiges = 1; // prestige_1: reward { legacy: 1 }
  game.checkAchievements(g);
  strictEqual(g.legacy, 4, 'spendable legacy credited');
  strictEqual(g.legacyTotal, 8, 'legacyTotal credited — achievement Legacy is earned Legacy');
  ok(g.achievements.includes('prestige_1'), 'prestige_1 unlocked');
});

test('achievement legacy rewards feed legacy_50 in the same pass', () => {
  const game = newGame();
  const g = game.state.g;
  g.legacyTotal = 49; // one short of Legacy Builder
  g.prestiges = 1;    // prestige_1 (+1 Legacy) fires first, pushing legacyTotal to 50
  game.checkAchievements(g);
  ok(g.achievements.includes('prestige_1'), 'prestige_1 unlocked');
  ok(g.achievements.includes('legacy_50'), 'legacy_50 unlocked in the same pass');
  strictEqual(g.legacyTotal, 49 + 1 + 2, 'both achievement rewards credited to legacyTotal');
});

test('confirmPrestige() preserves hired managers across prestige', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.cash = 99999;
  g.regulars = 30;
  g.legacy = 50;
  g.legacyTotal = 60;
  g.crew = 3;
  g.jobs.stage = 3;
  // Hire two managers.
  g.legacy = 200;
  game.buyManager(game.MANAGERS.find(m => m.id === 'rail'));
  game.buyManager(game.MANAGERS.find(m => m.id === 'bar'));
  ok(g.managers.rail === true, 'rail manager hired');
  ok(g.managers.bar === true, 'bar manager hired');

  game.confirmPrestige();
  const next = game.state.g;
  // Managers survive the franchise deal (like perks).
  strictEqual(next.managers.rail, true, 'rail manager persists across prestige');
  strictEqual(next.managers.bar, true, 'bar manager persists across prestige');
  // Buildings are reset (managers auto-buy next, but starting from 0).
  strictEqual(next.b.rail, 0, 'buildings reset');
  strictEqual(next.b.bar, 0, 'buildings reset');
});

test('confirmPrestige() is no-op below 25 regulars', () => {
  const game = newGame(500);
  const g = game.state.g;
  g.regulars = 10;
  g.legacy = 3;
  g.prestiges = 1;
  const before = game.state.g;
  game.confirmPrestige();
  strictEqual(game.state.g, before, 'state.g reference unchanged');
  strictEqual(game.state.g.legacy, 3);
  strictEqual(game.state.g.prestiges, 1);
});

// Regression: prestige modal template read the raw game-state `g` directly
// (g.regulars, g.night) instead of the view-model `v` that render() actually
// has in scope, throwing "g is not defined" on every render once the modal
// was open — see PR #30. renderVals() is the fast assertion; render() is the
// actual smoke test, since the bug only manifested while building markup.
test('renderVals() exposes prestigeRegulars/prestigeNight for the modal template', () => {
  const game = newGame(500);
  const g = game.state.g;
  g.regulars = 30;
  g.night = 7;
  const v = game.renderVals();
  strictEqual(v.prestigeRegulars, game.fmt(g.regulars), 'prestigeRegulars mirrors g.regulars');
  strictEqual(v.prestigeNight, g.night, 'prestigeNight mirrors g.night');
});

test('render() does not throw with the prestige modal open past the gate', () => {
  const game = newGame(500);
  const g = game.state.g;
  g.regulars = 30; // clears the 25-regulars prestige gate
  game.state.showPrestige = true;
  game.render(); // the assertion is that this call does not throw — see test()
});

test('MIGRATIONS[5] rejects array perks and clamps out-of-range ranks', () => {
  const game = newGame();
  const g = game.fresh();
  g.legacy = 'bad';
  g.legacyTotal = null;
  g.prestiges = NaN;
  // Array perks must be replaced with a valid map (ranks would vanish on JSON round-trip).
  g.perks = ['cash10'];
  game.migrateFrom(g, 5);
  strictEqual(g.legacy, 0);
  strictEqual(g.legacyTotal, 0);
  strictEqual(g.prestiges, 0);
  ok(typeof g.perks === 'object' && !Array.isArray(g.perks), 'array perks replaced with map');
  strictEqual(g.perks.cash10, 0, 'array perks lose ranks safely');

  // Out-of-range ranks are clamped.
  g.perks = { cash10: 99, doorPlus: -3 };
  game.migrateFrom(g, 5);
  strictEqual(g.perks.cash10, 5, 'cash10 clamped to max');
  strictEqual(g.perks.doorPlus, 0, 'negative rank clamped to 0');
});

// ── Achievements (SAVE_VER 7) ────────────────────────────────────────────────

console.log('\nAchievements');

test('fmt() suffixes reach Dc at 1e33', () => {
  const game = newGame();
  strictEqual(game.fmt(1e15), '1.00Qa');
  strictEqual(game.fmt(1e18), '1.00Qi');
  strictEqual(game.fmt(1e21), '1.00Sx');
  strictEqual(game.fmt(1e24), '1.00Sp');
  strictEqual(game.fmt(1e27), '1.00Oc');
  strictEqual(game.fmt(1e30), '1.00No');
  strictEqual(game.fmt(1e33), '1.00Dc');
});

test('buyBuilding() unlocks building achievements', () => {
  const game = newGame(500);
  const rail = buildingById(game, 'rail');
  game.buyBuilding(rail);
  ok(game.state.g.achievements.includes('first_rail'), 'single buy triggers first_rail');
});

test('buyBuildingMax() unlocks building achievements', () => {
  const game = newGame(5000);
  const rail = buildingById(game, 'rail');
  game.buyBuildingMax(rail);
  ok(game.state.g.achievements.includes('first_rail'), 'buy max triggers first_rail');
});

test('stat achievements unlock during live step', () => {
  const game = newGame(20);
  const g = game.state.g;
  // Set values below thresholds and provide strong growth so step crosses them.
  g.hype = 45;
  g.patrons = 20;
  g.regulars = 4.995;
  g.b.dj = 10;
  g.b.bar = 4;
  g.b.marquee = 5;
  g.buzz = 10;
  g.crew = 5;
  g.jobs = { stage: 5, vipjob: 0, floor: 0, off: 0 };
  game.step(5);
  ok(g.achievements.includes('hype_50'), 'hype_50 unlocks mid-step');
  ok(g.achievements.includes('regulars_5'), 'regulars_5 unlocks mid-step');
});

test('patrons_25 unlocks when threshold is reached during step', () => {
  const game = newGame(20);
  const g = game.state.g;
  // Simulate a club that already crossed 25 patrons; per-slice checkAchievements should unlock.
  g.patrons = 26;
  g.b.bar = 4;
  game.step(0.1);
  ok(g.achievements.includes('patrons_25'), 'patrons_25 unlocks when threshold is present during step');
});

test('stat achievements unlock during catchUp', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 30;
  g.buzz = 10;
  g.patrons = 20;
  g.regulars = 4.995;
  g.shiftIdx = 0;
  g.shiftT = 0;
  // Provide income so regulars grows over offline time.
  g.b.rail = 5;
  g.b.bar = 1;
  g.crew = 2;
  g.jobs = { stage: 1, vipjob: 0, floor: 1, off: 0 };
  const before = g.clout;
  game.catchUp(g, 120);
  ok(g.achievements.includes('regulars_5'), 'regulars_5 unlocks offline');
  ok(g.clout >= before, 'achievement clout credited during catchUp');
});

test('spawnWhale() does not increment clicks', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 50;
  g.clicks = 0;
  game.spawnWhale(g);
  strictEqual(g.clicks, 0, 'whale is not a click');
  ok(g.cash > 0, 'whale grants bonus cash');
});

// ── 0.10.1 density pass (23 → 38) ────────────────────────────────────────────

test('whalesCount increments on spawnWhale and unlocks Big Catch', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 50;
  game.spawnWhale(g);
  strictEqual(g.whalesCount, 1, 'whalesCount incremented');
  ok(g.achievements.includes('whale_1'), 'whale_1 (Big Catch) unlocked');
});

test('whale_10 unlocks at 10 whales and its Legacy credits legacyTotal', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 50;
  g.whalesCount = 9;
  g.legacy = 0;
  g.legacyTotal = 0;
  game.spawnWhale(g);
  strictEqual(g.whalesCount, 10, 'whalesCount reached 10');
  ok(g.achievements.includes('whale_10'), 'whale_10 (Whale Watcher) unlocked');
  // whale_1 (+1) and whale_10 (+3) both fire in the same pass.
  strictEqual(g.legacy, 4, 'whale_1 + whale_10 Legacy credited to spendable');
  strictEqual(g.legacyTotal, 4, 'whale Legacy credited to legacyTotal (earned Legacy)');
});

test('specialsCount increments when a special shift triggers', () => {
  const game = newGame(20);
  const g = game.state.g;
  g._specialShift = null;
  g.shiftIdx = 0;
  g.shiftT = 0;
  withRandom([0.0], () => game.advanceShift(g)); // roll 0 < SPECIAL_CHANCE (0.10) → special
  strictEqual(g.specialsCount, 1, 'specialsCount incremented');
  // In the real game the per-slice step() calls checkAchievements after advanceShift.
  game.checkAchievements(g);
  ok(g.achievements.includes('special_1'), 'special_1 (Surprise Hit) unlocked');
});

test('specialsCount does not increment on a normal shift rollover', () => {
  const game = newGame(20);
  const g = game.state.g;
  g._specialShift = null;
  g.shiftIdx = 0;
  g.shiftT = 0;
  withRandom([0.99], () => game.advanceShift(g)); // roll 0.99 ≥ 0.10 → no special
  strictEqual(g.specialsCount || 0, 0, 'no special → no count');
});

test('special_5 unlocks at 5 specials and its Legacy credits legacyTotal', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.specialsCount = 5;
  g.legacy = 2;
  g.legacyTotal = 10;
  game.checkAchievements(g);
  ok(g.achievements.includes('special_5'), 'special_5 (Event Planner) unlocked');
  // special_1 (+1) and special_5 (+2) both fire in the same pass.
  strictEqual(g.legacy, 5, 'special_1 + special_5 Legacy credited to spendable');
  strictEqual(g.legacyTotal, 13, 'special Legacy credited to legacyTotal');
});

test('new building achievements unlock via buyBuildingMax', () => {
  // Each building gets a fresh game — a shared cash pool is drained by the
  // earlier buyBuildingMax loops (growth costs), starving the later ones.
  const cases = [
    ['bar', 'bar_10', 'Two-Thirds Full'],
    ['dj', 'dj_5', 'Beatkeeper'],
    ['marquee', 'marquee_3', 'Bright Lights'],
    ['flyers', 'flyers_5', 'Street Team'],
    ['dress', 'dress_3', 'Backstage Pass'],
    ['door', 'door_max', 'Bouncer'],
  ];
  for (const [id, achId, label] of cases) {
    const game = newGame(1000000);
    game.buyBuildingMax(buildingById(game, id));
    ok(game.state.g.achievements.includes(achId), `${achId} (${label})`);
  }
});

test('stat achievements unlock at thresholds (hype_200, patrons_100, regulars_50, night_25)', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 200;
  g.patrons = 100;
  g.regulars = 50;
  g.night = 25;
  game.checkAchievements(g);
  ok(g.achievements.includes('hype_200'), 'hype_200 (Deafening)');
  ok(g.achievements.includes('patrons_100'), 'patrons_100 (Fire Marshal)');
  ok(g.achievements.includes('regulars_50'), 'regulars_50 (Institution)');
  ok(g.achievements.includes('night_25'), 'night_25 (A Month In)');
});

test('round_10 unlocks after 10 rounds', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.rounds = 10;
  game.checkAchievements(g);
  ok(g.achievements.includes('round_10'), 'round_10 (Toast)');
});

test('achievement catalog is 38 entries with unique ids', () => {
  const game = newGame();
  const ids = game.ACHIEVEMENTS.map(a => a.id);
  strictEqual(ids.length, 38, 'catalog grew 23 → 38');
  strictEqual(new Set(ids).size, 38, 'ids unique');
});

// ── 0.10.2 burst events (critic + golden ticket) ─────────────────────────────
// Both events are LIVE-ONLY: the pacing bot and offline catchUp drive step()
// directly with _live = false, so their random rolls can never flake pacing.mjs.

test('critic raves when the room is strong (hype ≥ 30, patrons ≥ 20)', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 50;
  g.patrons = 20;
  g.clout = 0;
  withRandom([0.0], () => game.maybeCritic(g)); // roll < CRITIC_CHANCE
  ok(g.hype > 50, 'hype increased by the rave');
  strictEqual(g.clout, 2, 'rave grants +2 Clout');
  ok(g.log.some(l => /critic raves/i.test(l.msg)), 'rave logged');
});

test('critic pans when the room is weak (patrons < 20)', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 50;
  g.patrons = 5;
  withRandom([0.0], () => game.maybeCritic(g));
  ok(g.hype < 50, 'hype dropped by the pan');
  ok(g.hype >= 0, 'hype never goes negative');
  ok(g.log.some(l => /critic pans/i.test(l.msg)), 'pan logged');
});

test('critic only visits during Peak (hype ≥ 30) and on a successful roll', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 10; g.patrons = 20; g.clout = 0;
  withRandom([0.0], () => game.maybeCritic(g));
  strictEqual(g.clout, 0, 'no visit below hype 30');
  g.hype = 50;
  withRandom([0.99], () => game.maybeCritic(g)); // ≥ CRITIC_CHANCE
  strictEqual(g.clout, 0, 'no visit when the roll misses');
});

test('golden offer spawns on a hit when hype > 0 and never double-fires', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 10;
  withRandom([0.0], () => game.maybeGolden(g));
  ok(g.golden && typeof g.golden.at === 'number', 'offer active with timestamp');
  const first = g.golden;
  withRandom([0.0], () => game.maybeGolden(g));
  strictEqual(g.golden, first, 'no second offer while one is active');
});

test('golden does not spawn at hype 0 or when the roll misses', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 0;
  withRandom([0.0], () => game.maybeGolden(g));
  strictEqual(g.golden, null, 'no offer at hype 0');
  g.hype = 10;
  withRandom([0.99], () => game.maybeGolden(g));
  strictEqual(g.golden, null, 'no offer when the roll misses');
});

test('takeGolden cash pays an income-scaled tip and clears the offer', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.golden = { at: 0 };
  const mult = game.cashIncomeMult(g);
  const before = g.cash;
  ok(game.takeGolden(g, 'cash'), 'offer resolved');
  strictEqual(g.cash - before, Math.floor(25 * mult), 'tip scaled by cashIncomeMult');
  strictEqual(g.golden, null, 'offer cleared');
  strictEqual(game.takeGolden(g, 'cash'), false, 'second resolve is a no-op');
});

test('takeGolden crowd adds patrons (capped) and clears the offer', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.golden = { at: 0 };
  const cap = game.caps(g).patrons;
  g.patrons = cap - 3;
  ok(game.takeGolden(g, 'crowd'), 'offer resolved');
  strictEqual(g.patrons, cap, 'patrons capped at the floor cap');
  strictEqual(g.golden, null, 'offer cleared');
});

test('stale golden offer expires during a live step', () => {
  const game = newGame(20);
  const g = game.state.g;
  game._live = true;
  g.hype = 0; // no new offers at hype 0
  g.golden = { at: Date.now() - 100000 };
  game.step(0.1);
  strictEqual(g.golden, null, 'expired offer cleared');
});

test('critic fires at night rollover during a live step', () => {
  const game = newGame(20);
  const g = game.state.g;
  game._live = true;
  g.hype = 50;
  g.b.bar = 4; // cap.patrons = 10 + 4*5 = 30; patrons=25 stays clear of the ≥20 rave line after per-slice decay (0.008/s)
  g.patrons = 25;
  g.clout = 0;
  g.shiftIdx = 3; // After Hours → wraps to Night (shiftIdx 0)
  const r = game.rates(g);
  g.shiftT = r.shift.len - 0.05;
  // Rolls per slice: whale (0.99 no), golden (0.99 no), special rollover (0.99 no), critic (0.0 yes).
  withRandom([0.99, 0.99, 0.99, 0.0], () => game.step(0.1));
  strictEqual(g.shiftIdx, 0, 'rolled into a new night');
  // Background clout income (regulars * 0.0011) accrues during step, so assert ≥ 2.
  ok(g.clout >= 2, 'critic rave granted +2 Clout');
  ok(g.log.some(l => /critic/i.test(l.msg)), 'critic logged');
});

test('burst events stay off when not live (pacing-bot determinism)', () => {
  const game = newGame(20);
  const g = game.state.g;
  strictEqual(game._live, false, 'not live by default');
  g.hype = 50;
  g.b.bar = 4; // keep patrons=20 above the fresh-game cap (10 + bar*5)
  g.patrons = 20;
  g.clout = 0;
  g.shiftIdx = 3;
  const r = game.rates(g);
  g.shiftT = r.shift.len - 0.05;
  // All rolls miss (0.99) — golden/critic never even roll without _live, and the
  // pre-existing special-shift roll is allowed to miss cleanly.
  withRandom([0.99, 0.99, 0.99, 0.99], () => game.step(0.1));
  strictEqual(g.golden, null, 'no golden offer in bot path');
  ok(g.clout < 0.001, 'no critic clout in bot path');
  strictEqual(g._specialShift, null, 'no special shift in bot path');
});

test('takeGolden is a no-op on a stale (non-owning) tab', () => {
  const game = newGame(20);
  const g = game.state.g;
  game.state.tabStale = true;
  g.golden = { at: 0 };
  g.cash = 100;
  strictEqual(game.takeGolden(g, 'cash'), false, 'refused on stale tab');
  strictEqual(g.cash, 100, 'cash untouched');
  ok(g.golden && g.golden.at === 0, 'offer left intact for the owning tab');
});

test('sanitizeG normalizes malformed golden offers (fail-closed)', () => {
  const game = newGame();
  const g = game.state.g;
  g.golden = { at: 'soon' };
  game.sanitizeG(g);
  strictEqual(g.golden, null, 'non-numeric at cleared');
  g.golden = [1, 2, 3];
  game.sanitizeG(g);
  strictEqual(g.golden, null, 'array golden cleared');
  g.golden = { at: 12345 };
  game.sanitizeG(g);
  ok(g.golden && g.golden.at === 12345, 'valid offer preserved');
});

test('achievements persist through prestige', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.regulars = 30;
  g.prestiges = 1;
  g.achievements = ['first_rail', 'rail_5'];
  game.confirmPrestige();
  const next = game.state.g;
  ok(next.achievements.includes('first_rail'), 'pre-prestige achievement kept');
  ok(next.achievements.includes('rail_5'), 'pre-prestige achievement kept');
  ok(next.achievements.includes('prestige_1'), 'prestige_1 credited on new run');
});

test('init backfills achievements on existing current-format save', () => {
  localStorage.clear();
  localStorage.setItem('afterglow.save', JSON.stringify({
    saveVer: 8,
    ver: '0.9.0',
    build: 184,
    g: {
      cash: 500, hype: 0, buzz: 0, patrons: 0, regulars: 0, clout: 0,
      crew: 0, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      b: { rail: 5, bar: 0, vip: 0, dj: 0, marquee: 0, flyers: 0, door: 0, dress: 0 },
      u: {}, r: {},
      elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now(),
      goals: [], clicks: 0, rounds: 0,
      legacy: 0, legacyTotal: 0, perks: {}, prestiges: 0, achievements: [],
      managers: { rail: false, bar: false, dj: false, marquee: false, flyers: false, vip: false, door: false, dress: false }
    }
  }));
  const game = new Game(root);
  game.forceUpdate = () => {};
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  ok(game.state.g.achievements.includes('first_rail'), 'load backfills first_rail');
  ok(game.state.g.achievements.includes('rail_5'), 'load backfills rail_5');
  strictEqual(game.state.g.clout, 3, 'first_rail (+1) + rail_5 (+2) clout credited');
});

// ── 2. Job invariant: sum always equals crew ─────────────────────────────────

console.log('\n2. Job assignments always sum to crew');

test('after hireCrew: crew=1, stage=1 → sum=1', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.b.dress = 1; // cap = 4
  game.hireCrew();
  strictEqual(g.crew, 1);
  strictEqual(g.jobs.stage, 1);
  strictEqual(g.jobs.vipjob, 0);
  strictEqual(g.jobs.floor, 0);
  strictEqual(g.jobs.off, 0);
  strictEqual(jobSum(g), g.crew);
});

test('after hireCrew x4: crew=4, stage=4 → sum=4', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.b.dress = 2; // cap = 6
  game.hireCrew();
  game.hireCrew();
  game.hireCrew();
  game.hireCrew();
  strictEqual(g.crew, 4);
  strictEqual(g.jobs.stage, 4);
  strictEqual(jobSum(g), g.crew);
});

test('moveJob stage→vip via off: sum stays equal', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.b.dress = 2;
  game.hireCrew();
  game.moveJob('stage', -1); // stage → off
  game.moveJob('vipjob', 1); // off → vipjob
  strictEqual(g.jobs.stage, 0);
  strictEqual(g.jobs.vipjob, 1);
  strictEqual(jobSum(g), g.crew);
});

test('moveJob to floor: sum stays equal', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.b.dress = 2;
  game.hireCrew();
  game.moveJob('stage', -1);
  game.moveJob('floor', 1);
  strictEqual(g.jobs.floor, 1);
  strictEqual(jobSum(g), g.crew);
});

test('after step: job sum remains equal to crew', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.b.dress = 2;
  game.hireCrew();
  game.hireCrew();
  const crew = g.crew;
  game.step(10);
  strictEqual(jobSum(g), crew, 'step must not change crew or jobs');
  strictEqual(g.crew, crew);
});

test('hire/move/step sequence keeps sum === crew', () => {
  const game = newGame(10000);
  const g = game.state.g;
  g.b.dress = 3;
  game.hireCrew();
  game.hireCrew();
  game.hireCrew();
  game.moveJob('stage', -1);
  game.moveJob('floor', 1);
  game.moveJob('stage', -1);
  game.moveJob('vipjob', 1);
  game.step(5);
  game.hireCrew();
  game.step(20);
  game.moveJob('floor', -1);
  game.moveJob('stage', 1);
  strictEqual(jobSum(g), g.crew, `jobs sum ${jobSum(g)} !== crew ${g.crew}`);
});

test('moveJob(+1) on full assignment is no-op', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.b.dress = 2;
  game.hireCrew();
  game.moveJob('stage', 1); // off empty → no-op
  strictEqual(g.jobs.stage, 1);
  strictEqual(jobSum(g), g.crew);
});

test('moveJob(off, ±1) is no-op (Off Shift display-only)', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.b.dress = 2;
  game.hireCrew();
  game.moveJob('stage', -1);
  strictEqual(g.jobs.off, 1);
  game.moveJob('off', -1);
  strictEqual(g.jobs.off, 1, 'moveJob(off, -1) must be no-op');
  game.moveJob('off', 1);
  strictEqual(g.jobs.off, 1, 'moveJob(off, +1) must be no-op');
  strictEqual(jobSum(g), g.crew);
});

// ── 3. No resource goes negative (10-night run) ──────────────────────────────

console.log('\n3. No resource goes negative across simulated run');

function simulateNights(game, nights) {
  game.step(nights * SECONDS_PER_NIGHT);
}

test('10-night run with buildings, crew, and purchases: all resources >= 0', () => {
  const game = newGame(8000);
  const g = game.state.g;

  // Purchases: buildings via buyBuilding where affordable, plus direct counts
  const rail = buildingById(game, 'rail');
  const bar = buildingById(game, 'bar');
  const dress = buildingById(game, 'dress');
  game.buyBuilding(rail);
  game.buyBuilding(rail);
  game.buyBuilding(bar);
  game.buyBuilding(dress);

  // Seed remaining economy state for a lively club
  g.b.dj = Math.max(g.b.dj, 1);
  g.b.marquee = Math.max(g.b.marquee, 1);
  g.b.dress = Math.max(g.b.dress, 1);

  game.hireCrew();
  game.hireCrew();
  game.moveJob('stage', -1);
  game.moveJob('floor', 1);
  strictEqual(jobSum(g), g.crew);

  // Mid-run cash can be tight; keep enough runway that wages don't wipe everything
  // but still exercise purchase + sim paths.
  if (g.cash < 100) g.cash = 100;

  // Spot-check non-negativity every night, not only at the end
  for (let n = 0; n < 10; n++) {
    simulateNights(game, 1);
    for (const k of resourceNames()) {
      ok(g[k] >= 0, `night+${n + 1}: ${k} is ${g[k]} (must be >= 0)`);
    }
    strictEqual(jobSum(g), g.crew, `night+${n + 1}: jobs sum !== crew`);
  }

  ok(g.night >= 10, `expected night >= 10, got ${g.night}`);
});

test('10-night run with zero buildings: still no negative resources', () => {
  const game = newGame(20);
  const g = game.state.g;
  simulateNights(game, 10);
  for (const k of resourceNames()) {
    ok(g[k] >= 0, `${k} is ${g[k]} (must be >= 0)`);
  }
});

// ── 4. Door Staff cap (7th purchase) — PLAN §1.5 ─────────────────────────────

console.log('\n4. Door Staff purchase limit (PLAN §1.5)');

test('door entry exists in BUILDINGS', () => {
  const game = newGame();
  const door = buildingById(game, 'door');
  ok(door, 'door BUILDINGS entry must exist');
  strictEqual(door.name, 'Door Staff');
});

{
  const doorProbe = buildingById(newGame(), 'door');
  const hasMax = doorProbe && typeof doorProbe.max === 'number';
  if (hasMax) {
    test('7th Door Staff purchase is rejected (max cap)', () => {
      const game = newGame(1e9);
      const g = game.state.g;
      const door = buildingById(game, 'door');
      for (let i = 0; i < 6; i++) game.buyBuilding(door);
      strictEqual(g.b.door, 6);
      game.buyBuilding(door);
      strictEqual(g.b.door, 6, '7th door purchase must not increase count');
    });
  } else {
    xfail('7th Door Staff purchase is rejected (max cap)', () => {
      const game = newGame(1e9);
      const g = game.state.g;
      const door = buildingById(game, 'door');
      for (let i = 0; i < 6; i++) game.buyBuilding(door);
      strictEqual(g.b.door, 6);
      game.buyBuilding(door);
      strictEqual(g.b.door, 6, '7th door purchase must not increase count');
    }, 'PLAN §1.5: max: 6 cap on door BUILDINGS not yet implemented');

    test('door BUILDINGS entry has no max field yet (pre-1.5)', () => {
      const door = buildingById(newGame(), 'door');
      ok(!('max' in door) || door.max === undefined, 'door max field expected absent before 1.5');
    });
  }
}

// ── 5. catchUp (PLAN §1.1) ──────────────────────────────────────────────────

console.log('\n5. catchUp offline simulation (PLAN §1.1)');

{
  const probe = newGame();
  if (typeof probe.catchUp === 'function') {
    test('catchUp(g, 3600) yields ~50% of live step cash (±2%)', () => {
      // Seed without path-dependent hype/buzz/patron feedback so the half-rate
      // relationship is exact (nonlinear mults make live vs 50%-accrual diverge
      // even with identical shift alignment).
      function seeded() {
        const game = newGame(500);
        const g = game.state.g;
        g.b.rail = 2;
        g.b.bar = 1;
        g.cash = 500;
        g.hype = 0;
        g.buzz = 0;
        g.patrons = 0;
        g.regulars = 0;
        g.crew = 0;
        g.jobs = { stage: 0, vipjob: 0, floor: 0, off: 0 };
        g.shiftIdx = 0;
        g.shiftT = 0;
        g.elapsed = 0;
        g.ts = Date.now();
        return game;
      }
      const live = seeded();
      const off = seeded();
      const cashLive0 = live.state.g.cash;
      const cashOff0 = off.state.g.cash;

      // Live: full-rate step for 3600s wall. Disable random special shifts so both
      // paths share identical shift alignment — the invariant asserted here is the
      // half-rate relationship, not specials (those have their own PLAN §4.2 tests).
      withRandom([0.99], () => {
        live.step(3600);
        off.catchUp(off.state.g, 3600);
      });
      const liveGain = live.state.g.cash - cashLive0;

      // Offline: catchUp at 50% rate
      const offGain = off.state.g.cash - cashOff0;

      // Offline cash delta should be ≈ half of live (same shift alignment)
      const expected = liveGain * 0.5;
      const tol = Math.max(Math.abs(expected) * 0.02, 0.01);
      ok(
        Math.abs(offGain - expected) <= tol,
        `offline cash gain ${offGain} vs 50% live ${expected} (tol ${tol})`
      );
    });

    test('catchUp caps at 28800s', () => {
      const game = newGame(100);
      const g = game.state.g;
      g.b.bar = 1;
      g.cash = 100;
      g.shiftIdx = 0;
      g.shiftT = 0;
      const before = g.elapsed;
      game.catchUp(g, 999999);
      // Wall time advanced should be at most 28800
      ok(g.elapsed - before <= 28800 + 1e-6, `elapsed advanced ${g.elapsed - before}, cap 28800`);
    });
  } else {
    skip('catchUp method exists and yields ~50% of live step()', 'PLAN §1.1: catchUp not yet implemented');
    skip('catchUp(g, 3600) produces cash within 2% of live step equivalent', 'PLAN §1.1: catchUp not yet implemented');
    skip('catchUp caps at 28800s', 'PLAN §1.1: catchUp not yet implemented');

    test('catchUp method is absent (pre-1.1 baseline)', () => {
      const game = newGame();
      strictEqual(typeof game.catchUp, 'undefined', 'catchUp must not exist before PLAN §1.1');
    });
  }
}

// ── 6. Strike rule (PLAN §1.3) ───────────────────────────────────────────────

console.log('\n6. Strike rule at cash=0 (PLAN §1.3)');

test('rates() computes wage field when non-crew revenue covers payroll', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.crew = 3;
  g.jobs = { stage: 1, vipjob: 1, floor: 1, off: 0 };
  g.b.bar = 20;
  const r = game.rates(g);
  ok(typeof r.wage === 'number', 'rates() must return a wage number');
  ok(r.wage > 0, 'wage must be > 0 when crew is working (crew=3, off=0)');
  ok(!r.strike, 'no strike when recurring revenue covers payroll');
});

test('rates() does not crash at cash=0', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.cash = 0;
  g.crew = 3;
  g.jobs = { stage: 1, vipjob: 1, floor: 1, off: 0 };
  const r = game.rates(g);
  ok(typeof r.cash === 'number', 'rates() must return cash number even at cash=0');
});

test('at cash=0 with wages > non-crew income: wage is 0 and strike true', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.cash = 0;
  g.crew = 3;
  g.jobs = { stage: 1, vipjob: 1, floor: 1, off: 0 };
  // No buildings → non-crew income tiny; wages positive
  const r = game.rates(g);
  strictEqual(r.wage, 0, 'wage must be 0 when strike is active');
  strictEqual(r.strike, true, 'strike flag must be true');
});

test('at cash=0 with wages > non-crew income: crew output zeroed', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.cash = 0;
  g.crew = 3;
  g.jobs = { stage: 1, vipjob: 1, floor: 1, off: 0 };
  g.hype = 0;
  g.buzz = 0;
  g.patrons = 0;
  // Struck rates: no vipjob cash, no stage hype, no floor buzz
  const struck = game.rates(g);
  strictEqual(struck.wage, 0, 'wage must be 0 on strike');
  strictEqual(struck.strike, true, 'strike active');
  // A cash balance alone must not end an underfunded strike.
  g.cash = 100;
  const stillStruck = game.rates(g);
  strictEqual(stillStruck.strike, true, 'cash balance does not cover recurring payroll');
  // Paid rates after recurring non-crew revenue covers payroll have crew output.
  g.b.bar = 20;
  const paid = game.rates(g);
  ok(paid.wage > 0, 'wage positive when paid');
  ok(!paid.strike, 'strike clears when recurring revenue covers payroll');
  // Stage hype: paid includes stage crew; struck does not (only DJ buildings = 0)
  ok(paid.hype > struck.hype, 'stage crew hype zeroed on strike');
  // Floor buzz: paid includes floor; struck has none (no marquee/flyers)
  ok(paid.buzz > struck.buzz, 'floor crew buzz zeroed on strike');
  // VIP crew cash: paid net should be lower by wages but vipjob still contributes;
  // struck cash is pure non-crew (tiny base) with no wage
  // Compare gross: paid.cash + paid.wage > struck.cash (vipjob contribution present when paid)
  ok(paid.cash + paid.wage > struck.cash + struck.wage, 'vipjob cash contribution zeroed on strike');
});

test('strike edge-triggered log fires once on onset', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.cash = 0;
  g.crew = 3;
  g.jobs = { stage: 1, vipjob: 1, floor: 1, off: 0 };
  g.log = [];
  game._onStrike = false;
  game.step(0.1);
  const strikeLogs = g.log.filter(l => /on strike/i.test(l.msg));
  strictEqual(strikeLogs.length, 1, 'exactly one strike log on onset');
  // Further ticks while still broke must not re-log
  game.step(0.1);
  game.step(0.1);
  const after = g.log.filter(l => /on strike/i.test(l.msg));
  strictEqual(after.length, 1, 'strike log remains edge-triggered (not per-tick)');
});

test('door trickle does not alternate an underfunded strike into production', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.crew = 2;
  g.jobs = { stage: 1, vipjob: 0, floor: 1, off: 0 };
  game.step(1);
  ok(g.cash > 0, 'non-crew door revenue accumulates during strike');
  const hype = g.hype;
  const buzz = g.buzz;
  game.step(1);
  strictEqual(game.rates(g).strike, true, 'crew remain on strike with positive trickle cash');
  strictEqual(g.hype, hype, 'stage crew do not produce on the next tick');
  strictEqual(g.buzz, buzz, 'floor crew do not produce on the next tick');
});

test('no strike when non-crew income covers wages at cash=0', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.cash = 0;
  // One crew on stage only (wage 0.22); many bars → non-crew covers wage
  g.crew = 1;
  g.jobs = { stage: 1, vipjob: 0, floor: 0, off: 0 };
  g.b.bar = 20;
  const r = game.rates(g);
  ok(r.wage > 0, 'crew still paid when non-crew covers wages');
  ok(!r.strike, 'no strike when buildings cover payroll');
});

// ── 7. Walk-in trickle (PLAN §1.4) ───────────────────────────────────────────

console.log('\n7. Walk-in trickle baseline pull (PLAN §1.4)');

test('pull is at least 0.02 with zero buzz (walk-in baseline)', () => {
  const game = newGame();
  const g = game.state.g;
  g.buzz = 0;
  g.hype = 0;
  g.patrons = 0;
  const r = game.rates(g);
  ok(r.pull >= 0.02 - 1e-9, `pull ${r.pull} must include +0.02 walk-in baseline`);
  strictEqual(r.buzzSpent, 0, 'walk-ins spend no buzz when basis is 0');
});

test('fresh save with zero buzz admits walk-in patrons over time', () => {
  const game = newGame();
  const g = game.state.g;
  g.buzz = 0;
  g.hype = 0;
  g.patrons = 0;
  // ~60s of live sim should accumulate ~1.2 patrons from walk-ins alone
  for (let i = 0; i < 600; i++) game.step(0.1);
  ok(g.patrons > 0.5, `walk-ins must fill floor with zero buzz (patrons=${g.patrons})`);
  ok(g.buzz === 0 || g.buzz < 1e-6, 'buzz must stay ~0 when not generating buzz');
});

test('rail + walk-in patrons earn cash with zero buzz', () => {
  const game = newGame(100);
  const g = game.state.g;
  g.buzz = 0;
  g.hype = 0;
  g.patrons = 3; // patrons already present (walked in)
  g.b.rail = 1;
  g.crew = 0;
  g.jobs = { stage: 0, vipjob: 0, floor: 0, off: 0 };
  const cashBefore = g.cash;
  const r = game.rates(g);
  // rail tips: min(patrons, rail*6) * 0.06 = 3 * 0.06 = 0.18/s (plus flat base)
  ok(r.cash > 0, `rail-first with patrons must earn cash (cash rate=${r.cash})`);
  for (let i = 0; i < 100; i++) game.step(0.1);
  ok(g.cash > cashBefore, `cash must grow via rail tips with zero buzz (${cashBefore} → ${g.cash})`);
});

// PLAN §1.6 — no uncapped patrons*0.012; patron cash via rail only (+ base door)
test('patrons without rail earn only base door cash (no flat patron rate)', () => {
  const game = newGame(100);
  const g = game.state.g;
  g.patrons = 100;
  g.b.rail = 0;
  g.b.bar = 0;
  g.b.vip = 0;
  g.crew = 0;
  g.jobs = { stage: 0, vipjob: 0, floor: 0, off: 0 };
  g.hype = 0;
  g.regulars = 0;
  g.shiftIdx = 0; // Early Doors mult 0.7
  g.u = {};
  const r = game.rates(g);
  // cashMult = 1 * 1 * 0.7; expected non-crew = 0.08 * 0.7 only
  const expected = 0.08 * 0.7;
  ok(Math.abs(r.cash - expected) < 1e-9,
    `no uncapped patrons×0.012: cash=${r.cash}, expected base door ${expected}`);
});

test('Tip Rail desc mentions per-rail patron cap', () => {
  const game = newGame();
  const rail = game.BUILDINGS.find(b => b.id === 'rail');
  ok(rail, 'rail building exists');
  ok(/Up to 6 patrons per rail/i.test(rail.desc), `Tip Rail desc updated: ${rail.desc}`);
});

// ── 8. caps() correctness ────────────────────────────────────────────────────

console.log('\n8. caps() correctness');

test('caps() returns expected fields', () => {
  const game = newGame();
  const c = game.caps(game.state.g);
  ok('patrons' in c);
  ok('buzz' in c);
  ok('hype' in c);
  ok('crew' in c);
});

test('caps().crew is 2 + dress * 2', () => {
  const game = newGame();
  const g = game.state.g;
  strictEqual(game.caps(g).crew, 2);
  g.b.dress = 1;
  strictEqual(game.caps(g).crew, 4);
  g.b.dress = 3;
  strictEqual(game.caps(g).crew, 8);
});

// ── 9. SHIFTS structure ──────────────────────────────────────────────────────

console.log('\n9. SHIFTS structure');

test('4 shifts exist', () => {
  const game = newGame();
  strictEqual(game.SHIFTS.length, 4);
});

test('shift cycle totals 160s per night', () => {
  const game = newGame();
  const total = game.SHIFTS.reduce((s, sh) => s + sh.len, 0);
  strictEqual(total, SECONDS_PER_NIGHT);
});

// ── 10. Edge cases ───────────────────────────────────────────────────────────

console.log('\n10. Edge cases');

test('step(0) does not mutate resources', () => {
  const game = newGame(100);
  const g = game.state.g;
  const cash = g.cash, hype = g.hype, buzz = g.buzz, patrons = g.patrons;
  game.step(0);
  strictEqual(g.cash, cash);
  strictEqual(g.hype, hype);
  strictEqual(g.buzz, buzz);
  strictEqual(g.patrons, patrons);
});

// ── buyUpgrade building requirements (PLAN §1.8) ─────────────────────────────

console.log('\nbuyUpgrade enforces building req (PLAN §1.8)');

test('buyUpgrade rejects purchase when building req unmet', () => {
  const game = newGame(1e9);
  const g = game.state.g;
  const led = game.UPGRADES.find(u => u.id === 'led');
  ok(led, 'led upgrade must exist');
  // led requires dj × 2; leave dj at 0
  strictEqual(g.b.dj, 0);
  const cashBefore = g.cash;
  game.buyUpgrade(led);
  strictEqual(g.u.led, false, 'must not install without dj × 2');
  strictEqual(g.cash, cashBefore, 'cash must not change when req fails');
});

test('buyUpgrade succeeds when building req and cash are met', () => {
  const game = newGame(1e9);
  const g = game.state.g;
  const led = game.UPGRADES.find(u => u.id === 'led');
  g.b.dj = 2;
  const cashBefore = g.cash;
  game.buyUpgrade(led);
  strictEqual(g.u.led, true, 'must install when dj × 2 owned');
  strictEqual(g.cash, cashBefore - led.cost);
});

test('buyUpgrade is no-op when already owned', () => {
  const game = newGame(1e9);
  const g = game.state.g;
  const led = game.UPGRADES.find(u => u.id === 'led');
  g.b.dj = 2;
  game.buyUpgrade(led);
  const cashAfter = g.cash;
  game.buyUpgrade(led);
  strictEqual(g.u.led, true);
  strictEqual(g.cash, cashAfter, 'second buy must not charge again');
});

// ── Perk prerequisites (PLAN §4.3) ───────────────────────────────────────────

console.log('\nperk prerequisites (PLAN §4.3)');

test('buyPerk rejects purchase when prerequisite rank unmet', () => {
  const game = newGame(1e9);
  const g = game.state.g;
  // clout25 requires offline65; offline65 requires cash10. Buy clout25 with neither
  // prerequisite ranked — must be rejected even with ample Legacy.
  g.legacy = 100;
  const clout25 = game.PRESTIGE_PERKS.find(p => p.id === 'clout25');
  strictEqual(game.perk(g, 'offline65'), 0, 'offline65 must start at rank 0');
  const legacyBefore = g.legacy;
  game.buyPerk(clout25);
  strictEqual(game.perk(g, 'clout25'), 0, 'must not buy clout25 without offline65');
  strictEqual(g.legacy, legacyBefore, 'Legacy must not change when req fails');
});

test('buyPerk succeeds once the prerequisite rank is met', () => {
  const game = newGame(1e9);
  const g = game.state.g;
  g.legacy = 100;
  // offline65 requires cash10 — buy cash10 first, then offline65 must succeed.
  const cash10 = game.PRESTIGE_PERKS.find(p => p.id === 'cash10');
  const offline65 = game.PRESTIGE_PERKS.find(p => p.id === 'offline65');
  game.buyPerk(cash10);
  strictEqual(game.perk(g, 'cash10'), 1, 'tier-1 cash10 must be purchasable with no req');
  const legacyBefore = g.legacy;
  game.buyPerk(offline65);
  strictEqual(game.perk(g, 'offline65'), 1, 'offline65 must buy once cash10 rank >= 1');
  strictEqual(g.legacy, legacyBefore - offline65.cost, 'Legacy must drop by offline65 cost');
});

test('buyPerk checks the immediate req, not a transitive walk', () => {
  const game = newGame(1e9);
  const g = game.state.g;
  g.legacy = 100;
  // clout25 requires offline65 (which itself requires cash10). Ranking cash10 satisfies
  // the ancestor, but offline65 is clout25's *immediate* req — clout25 must stay blocked.
  const cash10 = game.PRESTIGE_PERKS.find(p => p.id === 'cash10');
  const clout25 = game.PRESTIGE_PERKS.find(p => p.id === 'clout25');
  game.buyPerk(cash10);
  strictEqual(game.perk(g, 'cash10'), 1, 'cash10 must be ranked first');
  const legacyBefore = g.legacy;
  game.buyPerk(clout25);
  strictEqual(game.perk(g, 'clout25'), 0, 'clout25 must not buy until its immediate req offline65 is ranked');
  strictEqual(g.legacy, legacyBefore, 'Legacy must not change when the immediate req is unmet');
});

test('buyPerk chain startCrew -> doorPlus requires the Seed roster first', () => {
  const game = newGame(1e9);
  const g = game.state.g;
  g.legacy = 100;
  const startCrew = game.PRESTIGE_PERKS.find(p => p.id === 'startCrew');
  const doorPlus = game.PRESTIGE_PERKS.find(p => p.id === 'doorPlus');
  // doorPlus requires startCrew — must be rejected while startCrew is rank 0.
  game.buyPerk(doorPlus);
  strictEqual(game.perk(g, 'doorPlus'), 0, 'must not buy doorPlus without startCrew');
  // Buy startCrew (tier-1, no req), then doorPlus must succeed at its cost.
  const legacyBefore = g.legacy;
  game.buyPerk(startCrew);
  strictEqual(game.perk(g, 'startCrew'), 1, 'tier-1 startCrew must be purchasable with no req');
  game.buyPerk(doorPlus);
  strictEqual(game.perk(g, 'doorPlus'), 1, 'doorPlus must buy once startCrew rank >= 1');
  strictEqual(g.legacy, legacyBefore - startCrew.cost - doorPlus.cost, 'Legacy must drop by both costs');
});

test('hireCrew respects crew cap', () => {
  const game = newGame(50000);
  const g = game.state.g;
  const cap = game.caps(g).crew;
  for (let i = 0; i < cap + 2; i++) game.hireCrew();
  ok(g.crew <= cap, `crew ${g.crew} must not exceed cap ${cap}`);
});

test('hireCrew fails when cash is insufficient', () => {
  const game = newGame(2);
  const g = game.state.g;
  g.b.dress = 1;
  game.hireCrew();
  strictEqual(g.crew, 0, 'hireCrew must fail when cash < price');
});

test('moveJob(d>0) on non-off slot pulls from off', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.b.dress = 2;
  game.hireCrew();
  game.hireCrew();
  game.moveJob('stage', -1);
  game.moveJob('vipjob', 1);
  strictEqual(g.jobs.vipjob, 1);
  strictEqual(g.jobs.off, 0);
  strictEqual(jobSum(g), g.crew);
});

// ── Honest away-report (PLAN §1.10) ──────────────────────────────────────────

console.log('\nhonest away-report (PLAN §1.10)');

test('catchUp returns earned, wagesPaid, struck accumulators', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.b.bar = 2;
  g.crew = 2;
  g.jobs = { stage: 1, vipjob: 1, floor: 0, off: 0 };
  g.shiftIdx = 0;
  g.shiftT = 0;
  const r = game.catchUp(g, 60);
  ok(typeof r.earned === 'number' && r.earned > 0, `earned must be positive gross (${r.earned})`);
  ok(typeof r.wagesPaid === 'number' && r.wagesPaid > 0, `wagesPaid must be positive (${r.wagesPaid})`);
  strictEqual(r.struck, false, 'no strike when cash is ample');
});

test('catchUp struck=true when crew unpaid during gap', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.cash = 0;
  g.crew = 3;
  g.jobs = { stage: 1, vipjob: 1, floor: 1, off: 0 };
  // No buildings → non-crew cannot cover wages at cash=0 (strike at least on first slice)
  const r = game.catchUp(g, 30);
  strictEqual(r.struck, true, 'struck must be true when strike active during gap');
  // Base door may lift cash above 0 mid-gap so wages can resume; only struck flag is required.
});

test('awayMsg reports earned and wages, not cash-floor +$0', () => {
  const game = newGame();
  const msg = game.awayMsg(94 * 60, { earned: 312, wagesPaid: 88, struck: false });
  ok(/Away 94m/.test(msg), `minutes in message: ${msg}`);
  ok(/earned \$312/.test(msg), `earned in message: ${msg}`);
  ok(/wages −\$88/.test(msg), `wages drag in message: ${msg}`);
  ok(!/\+\$0/.test(msg), 'must not collapse to +$0 cash-delta wording');
});

test('awayMsg appends strike note when struck', () => {
  const game = newGame();
  const msg = game.awayMsg(120, { earned: 10, wagesPaid: 5, struck: true });
  ok(/Crew struck while you were gone\./.test(msg), `strike append: ${msg}`);
});

// ── Save import (PLAN §2.1) ──────────────────────────────────────────────────

console.log('\nSave import from clipboard (PLAN §2.1)');

test('valid import replaces state and persists', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.cash = 777;
  g.hype = 12;
  g.buzz = 4;
  g.patrons = 3;
  g.regulars = 1.5;
  g.clout = 2;
  g.crew = 2;
  g.jobs = { stage: 1, vipjob: 0, floor: 0, off: 1 };
  g.b.bar = 2;
  const payload = {
    saveVer: game.SAVE_VER,
    ver: game.VERSION.num,
    build: game.VERSION.build,
    g: JSON.parse(JSON.stringify(g))
  };
  // Mutate live club so import must actually replace.
  game.state.g.cash = 1;
  game.state.g.hype = 0;
  game.state.g.b.bar = 0;
  const okImport = game.importSaveFromText(JSON.stringify(payload));
  strictEqual(okImport, true, 'import must succeed');
  strictEqual(game.state.saveState, 'imported');
  strictEqual(game.state.g.cash, 777);
  strictEqual(game.state.g.hype, 12);
  strictEqual(game.state.g.b.bar, 2);
  strictEqual(game.state.g.crew, 2);
  // Persisted under KEY with SAVE_VER envelope.
  const stored = JSON.parse(localStorage.getItem(game.KEY));
  strictEqual(stored.saveVer, game.SAVE_VER);
  strictEqual(stored.g.cash, 777);
});

test('import runs jobs sum correction (sanitizeG)', () => {
  const game = newGame(20);
  const payload = {
    saveVer: game.SAVE_VER,
    g: {
      cash: 50, hype: 0, buzz: 0, patrons: 0, regulars: 0, clout: 0,
      crew: 3,
      jobs: { stage: 1, vipjob: 0, floor: 0, off: 0 }, // sum 1 < crew 3
      b: {}, u: {}, r: {}, elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now(),
      goals: [], clicks: 0, rounds: 0
    }
  };
  const okImport = game.importSaveFromText(JSON.stringify(payload));
  strictEqual(okImport, true);
  strictEqual(game.state.g.crew, 3);
  strictEqual(game.state.g.jobs.off, 2, 'missing assignments pad into off');
  strictEqual(jobSum(game.state.g), 3);
});

test('invalid JSON fails closed with import failed', () => {
  const game = newGame(50);
  game.state.g.cash = 50;
  const before = game.state.g;
  const okImport = game.importSaveFromText('not-json{{{');
  strictEqual(okImport, false);
  strictEqual(game.state.saveState, 'import failed');
  strictEqual(game.state.g, before, 'club reference must be unchanged');
  strictEqual(game.state.g.cash, 50);
});

test('missing resource fields fail closed', () => {
  const game = newGame(40);
  game.state.g.cash = 40;
  const okImport = game.importSaveFromText(JSON.stringify({
    saveVer: 4,
    g: { cash: 99, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 } } // missing hype etc.
  }));
  strictEqual(okImport, false);
  strictEqual(game.state.saveState, 'import failed');
  strictEqual(game.state.g.cash, 40, 'cash must not change on invalid payload');
});

test('missing maps and shift metadata are safely backfilled before import', () => {
  const game = newGame(20);
  const payload = {
    saveVer: game.SAVE_VER,
    g: {
      cash: 99, hype: 1, buzz: 2, patrons: 3, regulars: 4, clout: 5,
      crew: 1, jobs: { stage: 1, vipjob: 0, floor: 0, off: 0 },
      goals: [], clicks: 0, rounds: 0
    }
  };
  strictEqual(game.importSaveFromText(JSON.stringify(payload)), true);
  strictEqual(game.state.g.b.bar, 0);
  strictEqual(game.state.g.u.coat, false);
  strictEqual(game.state.g.r.loop, false);
  strictEqual(game.state.g.shiftIdx, 0);
  strictEqual(game.state.g.shiftT, 0);
  ok(Number.isFinite(game.rates(game.state.g).cash), 'completed state is simulation-safe');
});

test('invalid nested state fails closed without replacing or persisting club', () => {
  const game = newGame(40);
  localStorage.clear();
  const before = game.state.g;
  const payload = { saveVer: game.SAVE_VER, g: { ...game.fresh(), b: { bar: 'many' } } };
  strictEqual(game.importSaveFromText(JSON.stringify(payload)), false);
  strictEqual(game.state.g, before, 'live state reference remains unchanged');
  strictEqual(localStorage.getItem(game.KEY), null, 'invalid candidate is not persisted');
});

test('init recovers from a previously persisted malformed import', () => {
  const game = new Game(root);
  game.forceUpdate = () => {};
  const poisoned = game.fresh();
  poisoned.b = { bar: 'many' };
  localStorage.setItem(game.KEY, JSON.stringify({ saveVer: game.SAVE_VER, g: poisoned }));
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  strictEqual(game.state.g.b.bar, 0, 'unsafe persisted state resets to fresh');
  ok(game.state.g.log.some(x => /previous save reset/.test(x.msg)), 'reset is disclosed in the log');
});

test('non-numeric saveVer fails closed', () => {
  const game = newGame(30);
  const g = game.fresh();
  g.cash = 999;
  const okImport = game.importSaveFromText(JSON.stringify({
    saveVer: '4',
    g
  }));
  strictEqual(okImport, false);
  strictEqual(game.state.saveState, 'import failed');
  strictEqual(game.state.g.cash, 30);
});

// ── Save migration map (PLAN §2.2) ───────────────────────────────────────────

console.log('\nSave migration map (PLAN §2.2)');

test('SAVE_VER is 8', () => {
  const game = newGame();
  strictEqual(game.SAVE_VER, 8);
  ok(typeof game.MIGRATIONS[3] === 'function', 'MIGRATIONS[3] must exist');
  ok(typeof game.MIGRATIONS[4] === 'function', 'MIGRATIONS[4] must exist (Owner\'s List)');
  ok(typeof game.MIGRATIONS[5] === 'function', 'MIGRATIONS[5] must exist (prestige)');
  ok(typeof game.MIGRATIONS[6] === 'function', 'MIGRATIONS[6] must exist (achievements)');
  ok(typeof game.MIGRATIONS[7] === 'function', 'MIGRATIONS[7] must exist (managers)');
});

test('migrateFrom(3) applies jobs/crew fixups and preserves club', () => {
  const game = newGame();
  const g = game.fresh();
  g.cash = 123;
  g.crew = 3;
  g.jobs = { stage: 1, vipjob: 0, floor: 0, off: 0 }; // sum 1 < crew 3
  const ok = game.migrateFrom(g, 3);
  strictEqual(ok, true);
  strictEqual(g.cash, 123, 'resources must survive migration');
  strictEqual(g.crew, 3);
  strictEqual(g.jobs.off, 2, 'missing assignments pad into off');
  strictEqual(jobSum(g), 3);
});

test('migrateFrom returns false when a version has no path', () => {
  const game = newGame();
  const g = game.fresh();
  g.cash = 50;
  // No MIGRATIONS[1] or [2] — chain cannot reach SAVE_VER.
  strictEqual(game.migrateFrom(g, 1), false);
  strictEqual(game.migrateFrom(g, 2), false);
  // Future format — no downgrade path.
  strictEqual(game.migrateFrom(g, 99), false);
  strictEqual(g.cash, 50, 'failed migrate must not wipe the object');
});

test('init migrates saveVer 3 from localStorage without wipe', () => {
  localStorage.clear();
  // Full building map so rates() stays finite if a tiny offline gap runs during init.
  const b = { rail: 1, bar: 0, vip: 0, dj: 0, marquee: 0, flyers: 0, door: 0, dress: 0 };
  const payload = {
    saveVer: 3,
    ver: '0.4.0',
    build: 100,
    g: {
      cash: 88, hype: 1, buzz: 0, patrons: 0, regulars: 0, clout: 0,
      crew: 2,
      jobs: { stage: 1, vipjob: 0, floor: 0, off: 0 },
      b, u: {}, r: {},
      elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [{ t: 'old', msg: 'gone' }],
      // Far-future ts so offline catch-up does not run (this test is about migrate, not offline).
      ts: Date.now() + 60_000
    }
  };
  localStorage.setItem('afterglow.save', JSON.stringify(payload));
  const game = new Game(root);
  game.forceUpdate = () => {};
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  strictEqual(game.state.g.cash, 88, 'migrated club keeps cash');
  strictEqual(game.state.g.crew, 2);
  strictEqual(game.state.g.b.rail, 1);
  strictEqual(jobSum(game.state.g), 2);
  const msgs = game.state.g.log.map(e => e.msg);
  ok(msgs.some(m => /migrated from format v3/.test(m)), `expect migrate log, got: ${msgs.join(' | ')}`);
  ok(!msgs.some(m => /previous save reset/.test(m)), 'must not claim wipe on successful migrate');
});

test('init wipes garbage JSON with existing reset message', () => {
  localStorage.clear();
  localStorage.setItem('afterglow.save', 'not-json{{{');
  const game = new Game(root);
  game.forceUpdate = () => {};
  game.props.startingCash = 20;
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  strictEqual(game.state.g.cash, 20, 'fresh club after wipe');
  strictEqual(game.state.g.crew, 0);
  const msgs = game.state.g.log.map(e => e.msg);
  ok(msgs.some(m => /previous save reset/.test(m)), `expect wipe log, got: ${msgs.join(' | ')}`);
});

test('init wipes when saveVer has no migration path', () => {
  localStorage.clear();
  localStorage.setItem('afterglow.save', JSON.stringify({
    saveVer: 1,
    ver: '0.1.0',
    g: {
      cash: 999, hype: 0, buzz: 0, patrons: 0, regulars: 0, clout: 0,
      crew: 0, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      b: {}, u: {}, r: {}, elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now()
    }
  }));
  const game = new Game(root);
  game.forceUpdate = () => {};
  game.props.startingCash = 20;
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  strictEqual(game.state.g.cash, 20, 'no-path must wipe to fresh');
  const msgs = game.state.g.log.map(e => e.msg);
  ok(msgs.some(m => /previous save reset/.test(m)), `expect wipe log, got: ${msgs.join(' | ')}`);
});

test('import of saveVer 3 migrates then stamps SAVE_VER', () => {
  const game = newGame(10);
  const g = {
    cash: 42, hype: 0, buzz: 0, patrons: 0, regulars: 0, clout: 0,
    crew: 2, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
    b: {}, u: {}, r: {}, elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now()
  };
  const okImport = game.importSaveFromText(JSON.stringify({ saveVer: 3, g }));
  strictEqual(okImport, true);
  strictEqual(game.state.g.cash, 42);
  strictEqual(jobSum(game.state.g), 2);
  const stored = JSON.parse(localStorage.getItem(game.KEY));
  strictEqual(stored.saveVer, game.SAVE_VER);
  strictEqual(stored.g.cash, 42);
});

// ── Multi-tab storage guard (PLAN §2.3) ───────────────────────────────────────
console.log('\nMulti-tab storage guard (PLAN §2.3)');

test('onForeignSave stops autosave interval and marks tab stale', () => {
  const game = newGame(10);
  game.saver = setInterval(() => {}, 60_000);
  ok(game.saver != null, 'saver mock present');
  game.onForeignSave();
  strictEqual(game.state.tabStale, true);
  strictEqual(game.saver, null, 'autosave interval cleared');
  strictEqual(game.state.saveState, 'paused (other tab)');
  // Idempotent second call.
  game.onForeignSave();
  strictEqual(game.state.tabStale, true);
});

test('autosave and manual save are no-ops while tabStale', () => {
  const game = newGame(10);
  game.markTabOwner(); // even a former owner must not write while tabStale
  game.state.g.cash = 123;
  game.state.tabStale = true;
  localStorage.removeItem(game.KEY);
  game.save('auto');
  strictEqual(localStorage.getItem(game.KEY), null, 'autosave must not clobber foreign save');
  game.save('manual');
  strictEqual(localStorage.getItem(game.KEY), null, 'manual save must not clobber while tabStale');
  strictEqual(game.state.tabStale, true, 'manual save must not clear tabStale');
});

// ── Integer patrons display (PLAN §2.4) ───────────────────────────────────────
console.log('\nInteger patrons display (PLAN §2.4)');

test('Patrons ledger shows floor(g.patrons); sim value stays fractional', () => {
  const game = newGame(10);
  game.state.g.patrons = 3.87;
  const v = game.renderVals();
  const row = v.resources.find(r => r.name === 'Patrons');
  ok(row, 'Patrons resource row present');
  // fmt(Math.floor(3.87)) → fmt(3) → "3.00" for values < 10
  strictEqual(row.val, game.fmt(3), `ledger must show floored patrons, got ${row.val}`);
  strictEqual(game.state.g.patrons, 3.87, 'simulation patrons must remain fractional');
});

// ── File save I/O (PLAN-NEXT §A) ──────────────────────────────────────────────
console.log('\nFile save I/O (PLAN-NEXT §A)');

test('export payload round-trips through importSaveFromText into identical g', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.cash = 555;
  g.hype = 18;
  g.buzz = 7;
  g.patrons = 4.25;
  g.regulars = 2.5;
  g.clout = 3;
  g.crew = 2;
  g.jobs = { stage: 1, vipjob: 0, floor: 0, off: 1 };
  g.b.rail = 2;
  g.b.bar = 1;
  // Same envelope downloadSave / exportSave serialize.
  const payload = {
    saveVer: game.SAVE_VER,
    ver: game.VERSION.num,
    build: game.VERSION.build,
    g: JSON.parse(JSON.stringify(g))
  };
  const exported = JSON.stringify(payload);
  // Wipe live club so import must replace.
  game.state.g = game.fresh();
  game.state.g.cash = 1;
  const okImport = game.importSaveFromText(exported);
  strictEqual(okImport, true);
  strictEqual(game.state.saveState, 'imported');
  strictEqual(game.state.g.cash, 555);
  strictEqual(game.state.g.hype, 18);
  strictEqual(game.state.g.buzz, 7);
  strictEqual(game.state.g.patrons, 4.25);
  strictEqual(game.state.g.regulars, 2.5);
  strictEqual(game.state.g.clout, 3);
  strictEqual(game.state.g.crew, 2);
  strictEqual(game.state.g.b.rail, 2);
  strictEqual(game.state.g.b.bar, 1);
  strictEqual(game.state.g.jobs.stage, 1);
  strictEqual(game.state.g.jobs.off, 1);
});

test('v4 file payload imports like clipboard (shared importSaveFromText path)', () => {
  const game = newGame(10);
  const g = {
    cash: 88, hype: 5, buzz: 1, patrons: 2, regulars: 0.5, clout: 1,
    crew: 1, jobs: { stage: 1, vipjob: 0, floor: 0, off: 0 },
    b: { rail: 1 }, u: {}, r: {}, elapsed: 10, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now()
  };
  // File-shaped v4 envelope (same as clipboard).
  const fileText = JSON.stringify({
    saveVer: 4,
    ver: '0.5.2',
    build: 158,
    g
  });
  game.state.g.cash = 1;
  const okImport = game.importSaveFromText(fileText);
  strictEqual(okImport, true);
  strictEqual(game.state.saveState, 'imported');
  strictEqual(game.state.g.cash, 88);
  strictEqual(game.state.g.b.rail, 1);
  const stored = JSON.parse(localStorage.getItem(game.KEY));
  strictEqual(stored.saveVer, game.SAVE_VER);
  strictEqual(stored.g.cash, 88);
});

test('garbage file content fails closed with import failed', () => {
  const game = newGame(40);
  game.state.g.cash = 40;
  game.state.g.hype = 9;
  const before = game.state.g;
  const okImport = game.importSaveFromText('{not a valid save file');
  strictEqual(okImport, false);
  strictEqual(game.state.saveState, 'import failed');
  strictEqual(game.state.g, before, 'club reference must be unchanged');
  strictEqual(game.state.g.cash, 40);
  strictEqual(game.state.g.hype, 9);
});

test('downloadSave sets saveState downloaded (Blob path)', () => {
  const game = newGame(20);
  const v = game.renderVals();
  ok(typeof v.downloadSave === 'function', 'downloadSave handler present');
  v.downloadSave();
  strictEqual(game.state.saveState, 'downloaded');
});

test('importSaveFile routes FileReader text into importSaveFromText', () => {
  const game = newGame(15);
  const g = game.state.g;
  g.cash = 321;
  g.b.flyers = 2;
  const payload = JSON.stringify({
    saveVer: game.SAVE_VER,
    ver: game.VERSION.num,
    build: game.VERSION.build,
    g: JSON.parse(JSON.stringify(g))
  });
  game.state.g = game.fresh();
  game.state.g.cash = 2;

  // Capture the file input created by importSaveFile and drive onchange with a stub file.
  let captured = null;
  const prevCreate = document.createElement;
  document.createElement = (tag) => {
    const el = { ...root, click: () => {}, files: null, type: '', accept: '', onchange: null };
    if (tag === 'input') captured = el;
    return el;
  };
  try {
    const v = game.renderVals();
    v.importSaveFile();
    ok(captured, 'hidden file input created');
    strictEqual(captured.type, 'file');
    captured.files = [{ _text: payload, name: 'afterglow-save.json' }];
    captured.onchange();
  } finally {
    document.createElement = prevCreate;
  }
  strictEqual(game.state.saveState, 'imported');
  strictEqual(game.state.g.cash, 321);
  strictEqual(game.state.g.b.flyers, 2);
  // File path must not claim clipboard in the night log (shared importSaveFromText).
  const msgs = game.state.g.log.map(e => e.msg);
  ok(msgs.some(m => m === 'Save restored.'), `expect neutral restore log, got: ${msgs.join(' | ')}`);
  ok(!msgs.some(m => /clipboard/i.test(m)), 'restore log must not mention clipboard after file load');
});

// ── Owner's List (PLAN-NEXT §B) ───────────────────────────────────────────────
console.log("\nOwner's List (PLAN-NEXT §B)");

test('fresh() has goals: [], clicks: 0, rounds: 0', () => {
  const game = newGame(20);
  const g = game.fresh();
  ok(Array.isArray(g.goals), 'goals array');
  strictEqual(g.goals.length, 0);
  strictEqual(g.clicks, 0);
  strictEqual(g.rounds, 0);
});

test('every GOALS entry has valid shape; check(fresh) false; progress ok or null', () => {
  const game = newGame(20);
  const g = game.fresh();
  strictEqual(game.GOALS.length, 14, 'exactly 14 goals');
  for (const goal of game.GOALS) {
    ok(goal.id && typeof goal.id === 'string', 'id');
    ok(goal.title && typeof goal.title === 'string', 'title');
    ok(goal.why && typeof goal.why === 'string', 'why');
    ok(goal.hint && typeof goal.hint === 'string', 'hint');
    ok(goal.reward && typeof goal.reward === 'object', 'reward');
    ok(typeof goal.reward.cash === 'number' && typeof goal.reward.clout === 'number', 'reward cash/clout');
    ok(typeof goal.check === 'function', 'check fn');
    strictEqual(goal.check(g), false, `check(fresh) must be false for ${goal.id}`);
    if (goal.progress == null) {
      strictEqual(goal.progress, null);
    } else {
      ok(typeof goal.progress === 'function', `progress fn for ${goal.id}`);
      const p = goal.progress(g);
      ok(p && typeof p.cur === 'number' && typeof p.max === 'number' && p.max > 0,
        `progress shape for ${goal.id}`);
    }
  }
});

test('goal 1 completes after 5 workCrowd calls and pays exactly once', () => {
  const game = newGame(20);
  const g = game.state.g;
  const cashBefore = g.cash;
  const work = game.renderVals().workCrowd;
  for (let i = 0; i < 5; i++) work();
  ok(g.goals.includes('work'), 'work completed');
  strictEqual(g.clicks, 5);
  // Reward $8 paid once (0.6.1 balance)
  const expectedMin = cashBefore + 8; // clicks also add cash; just assert reward once via noteGoals
  // Re-run noteGoals — must not double-pay or re-add id
  const cashAfter = g.cash;
  const goalsLen = g.goals.length;
  game.noteGoals(g);
  game.noteGoals(g);
  strictEqual(g.cash, cashAfter, 'no double-pay on repeated noteGoals');
  strictEqual(g.goals.filter(id => id === 'work').length, 1, 'work id once');
  strictEqual(g.goals.length, goalsLen);
  ok(g.cash >= expectedMin, 'received work reward on top of click cash');
});

test('sequential gating: goal 2 cannot complete while goal 1 incomplete', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.b.rail = 2;
  g.clicks = 0;
  g.goals = [];
  game.noteGoals(g);
  ok(!g.goals.includes('rail'), 'rail must not complete while work is active');
  ok(!g.goals.includes('work'), 'work still incomplete');
  strictEqual(game.activeGoal(g).id, 'work');
  g.clicks = 5;
  game.noteGoals(g);
  ok(g.goals.includes('work'), 'work completes first');
  // rail still satisfied — next noteGoals completes it
  game.noteGoals(g);
  ok(g.goals.includes('rail'), 'rail completes once work is done');
});

test('catchUp completion: state satisfying goal 4 completes via post-catchUp noteGoals', () => {
  const game = newGame(20);
  const g = game.state.g;
  // Unlock through goal 3 so pulse is active
  g.goals = ['work', 'rail', 'word'];
  g.clicks = 5;
  g.b.rail = 1;
  g.b.flyers = 1;
  g.patrons = 7.5;
  g.buzz = 50;
  // Simulate catchUp path: run catchUp then offline noteGoals (same as init/timer)
  game.catchUp(g, 30);
  // Ensure patrons can reach 8 either via catchUp or direct (buzz pull may vary)
  if (g.patrons < 8) g.patrons = 8;
  game.noteGoals(g, { live: false });
  ok(g.goals.includes('pulse'), 'pulse completed after catchUp evaluation');
  ok(g.log.some(e => /Owner's list: A floor with a pulse/.test(e.msg)), 'log line on complete');
});

test('catchUp mid-window threshold: pulse completes if patrons peak then decay', () => {
  const game = newGame(20);
  const g = game.state.g;
  // pulse active; start above 8 patrons with no buzz so the floor drains offline.
  g.goals = ['work', 'rail', 'word'];
  g.clicks = 5;
  g.b.rail = 1;
  g.b.flyers = 1;
  g.patrons = 9.5;
  g.buzz = 0;
  g.hype = 0;
  g.cash = 100;
  // Long away: decay pulls patrons well below 8 by the end (2%/s of sim time at 50% rate).
  game.catchUp(g, 3600);
  ok(g.patrons < 8, `end patrons below threshold (got ${g.patrons})`);
  ok(g.goals.includes('pulse'), 'pulse credited when threshold was crossed mid-catchUp');
  ok(g.log.some(e => /Owner's list: A floor with a pulse/.test(e.msg)), 'pulse log from mid-slice noteGoals');
  // Post-only noteGoals would miss this; reward must already be paid.
  const cashAfter = g.cash;
  game.noteGoals(g, { live: false });
  strictEqual(g.cash, cashAfter, 'no second pulse reward after catchUp');
  strictEqual(g.goals.filter(id => id === 'pulse').length, 1, 'pulse id once');
});

test('migration 4→5→6→7: v4 save with rail+flyers pre-completes those goals, no goal reward cash', () => {
  const game = newGame(10);
  const cash = 100;
  const g = {
    cash, hype: 0, buzz: 0, patrons: 0, regulars: 0, clout: 0,
    crew: 0, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
    b: { rail: 2, flyers: 1 }, u: {}, r: {},
    elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now()
  };
  // No goals/clicks/rounds/achievements — v4 shape
  const okImport = game.importSaveFromText(JSON.stringify({ saveVer: 4, ver: '0.5.3', build: 159, g }));
  strictEqual(okImport, true);
  const loaded = game.state.g;
  ok(Array.isArray(loaded.goals), 'goals present after migrate');
  ok(typeof loaded.clicks === 'number', 'clicks present');
  ok(typeof loaded.rounds === 'number', 'rounds present');
  ok(Array.isArray(loaded.achievements), 'achievements present after migrate');
  ok(loaded.goals.includes('work'), 'work pre-completed');
  ok(loaded.goals.includes('rail'), 'rail pre-completed');
  ok(loaded.goals.includes('word'), 'word pre-completed');
  ok(!loaded.goals.includes('pulse'), 'pulse not falsely completed');
  // Import stamps log with "Save restored"; cash must not include goal rewards
  strictEqual(loaded.cash, cash, 'no back-paid goal rewards on migrate');
  // Achievements legitimately reward clout for already-earned state.
  strictEqual(loaded.clout, 1, 'first_rail achievement clout credited on migrate');
  const stored = JSON.parse(localStorage.getItem(game.KEY));
  strictEqual(stored.saveVer, 8);
});

test('migration 4→5→6→7 mid-game: credits non-sequential goals without reward cascade', () => {
  const game = newGame(10);
  const cash = 500;
  const clout = 4;
  // Mid-game v4 club: past house (rounds unknown) but already has VIP job, regulars,
  // research, roster, and an upgrade. house check fails (rounds=0); later goals true.
  const g = {
    cash, hype: 30, buzz: 10, patrons: 12, regulars: 5, clout,
    crew: 3, jobs: { stage: 1, vipjob: 1, floor: 1, off: 0 },
    b: { rail: 2, flyers: 1, bar: 1, vip: 1, dress: 1, dj: 2, marquee: 0, door: 0 },
    u: { led: true }, r: { loop: true },
    elapsed: 600, night: 4, shiftIdx: 0, shiftT: 10, log: [], ts: Date.now()
  };
  const okImport = game.importSaveFromText(JSON.stringify({ saveVer: 4, ver: '0.5.3', build: 159, g }));
  strictEqual(okImport, true);
  const loaded = game.state.g;
  // Credit without sequential break — holes (house) ok; later satisfied ids still present.
  for (const id of ['work', 'rail', 'word', 'pulse', 'contract', 'energy',
    'backstage', 'regulars', 'study', 'roster', 'builtin']) {
    ok(loaded.goals.includes(id), `mid-game migrate credits ${id}`);
  }
  ok(!loaded.goals.includes('house'), 'house not credited without rounds');
  ok(!loaded.goals.includes('peak'), 'peak not credited (not Peak / not live)');
  ok(!loaded.goals.includes('name'), 'name not credited (regulars < 25)');
  strictEqual(loaded.cash, cash, 'no back-paid cash rewards');
  // Achievements credit already-earned state: first_rail (+1) + first_vip (+2) + regulars_5 (+1).
  strictEqual(loaded.clout, clout + 4, 'achievement clout credited without cascade');
  // Live cascade must not pay already-credited goals when house is next.
  strictEqual(game.activeGoal(loaded).id, 'house');
  const cashBefore = loaded.cash;
  const cloutBefore = loaded.clout;
  loaded.rounds = 1;
  for (let i = 0; i < 10; i++) game.noteGoals(loaded, { live: true });
  ok(loaded.goals.includes('house'), 'house completes live once rounds exist');
  // Only house reward ($20 post-0.6.1) — not backstage/regulars/study/roster cascade.
  strictEqual(loaded.cash, cashBefore + 20, 'only house reward paid after migrate');
  strictEqual(loaded.clout, cloutBefore, 'no cascade clout after migrate');
});

test('peak goal does not complete offline; completes live', () => {
  const game = newGame(20);
  const g = game.state.g;
  // Unlock through roster so peak is active
  g.goals = ['work', 'rail', 'word', 'pulse', 'contract', 'energy', 'house',
    'backstage', 'regulars', 'study', 'roster'];
  g.hype = 65;
  g.shiftIdx = 1; // Peak Hours
  g.cash = 1000;
  game.catchUp(g, 5);
  const cashAfterCatchUp = g.cash;
  game.noteGoals(g, { live: false });
  ok(!g.goals.includes('peak'), 'peak must not complete offline');
  strictEqual(g.cash, cashAfterCatchUp, 'no peak reward offline (cash unchanged by noteGoals)');
  // Live path (step / default noteGoals)
  game.noteGoals(g, { live: true });
  ok(g.goals.includes('peak'), 'peak completes live');
  strictEqual(g.cash, cashAfterCatchUp + 100, 'peak reward $100 once live');
  const cashAfter = g.cash;
  game.noteGoals(g, { live: true });
  strictEqual(g.cash, cashAfter, 'no double-pay peak');
});

// Live step can cross Peak→Last Call in one call (dt ≤ 2). Goals must run per
// slice before shift rollover or peak never awards despite Hype ≥ 60 mid-Peak.
test('peak goal completes on live step slice that ends Peak Hours', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.goals = ['work', 'rail', 'word', 'pulse', 'contract', 'energy', 'house',
    'backstage', 'regulars', 'study', 'roster'];
  g.hype = 65;
  g.shiftIdx = 1; // Peak Hours (len 55)
  g.shiftT = 54.95; // next slice ends Peak
  g.cash = 1000;
  const cashBefore = g.cash;
  game.step(0.2);
  ok(g.goals.includes('peak'), 'peak awarded mid-step before Peak rollover');
  ok(g.log.some(e => /Peak-hour hero/.test(e.msg)), 'peak completion logged from live step');
  // Reward is +$100; sim also moves cash slightly — require the goal pay landed.
  ok(g.cash >= cashBefore + 99, 'peak reward ~$100 applied during live step');
  strictEqual(g.shiftIdx, 2, 'rolled into Last Call after Peak-ending slice');
});

test('completing all 14 leaves activeGoal null and never throws', () => {
  const game = newGame(20);
  const g = game.state.g;
  // Satisfy every check in order without relying on live play
  g.clicks = 5;
  g.b.rail = 1;
  g.b.flyers = 1;
  g.patrons = 8;
  g.crew = 3;
  g.jobs.stage = 2;
  g.jobs.vipjob = 1;
  g.hype = 60;
  g.rounds = 1;
  g.b.vip = 1;
  g.regulars = 25;
  g.r.loop = true;
  g.b.dress = 1;
  g.shiftIdx = 1;
  g.u.led = true;
  g.goals = [];
  for (let i = 0; i < 20; i++) game.noteGoals(g);
  strictEqual(g.goals.length, 14, 'all 14 completed');
  strictEqual(game.activeGoal(g), null);
  const v = game.renderVals();
  ok(v.ownersList && v.ownersList.done, 'resting 14/14 panel state');
  strictEqual(v.ownersList.n, 14);
  strictEqual(v.ownersList.total, 14);
});

test('import of a v4 payload still validates (payload checker unchanged)', () => {
  const game = newGame(20);
  const payload = {
    saveVer: 4,
    g: {
      cash: 20, hype: 0, buzz: 0, patrons: 0, regulars: 0, clout: 0,
      crew: 0, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 }
      // no goals/clicks/rounds — isValidSavePayload must still accept
    }
  };
  ok(game.isValidSavePayload(payload), 'v4 payload without goals fields is valid');
  // Must not require goals on the checker
  ok(!('goals' in payload.g));
});

test('study/builtin ignore orphan keys; catalog research completes study', () => {
  const game = newGame(20);
  const g = game.fresh();
  g.r = { franchise: true }; // preserved orphan from pre-prestige design
  g.u = { ghostUpgrade: true };
  const study = game.GOALS.find(x => x.id === 'study');
  const builtin = game.GOALS.find(x => x.id === 'builtin');
  strictEqual(study.check(g), false, 'orphan r.franchise must not complete study');
  strictEqual(builtin.check(g), false, 'orphan u.* must not complete builtin');
  g.r.loop = true;
  strictEqual(study.check(g), true, 'catalog research completes study');
  g.u.led = true;
  strictEqual(builtin.check(g), true, 'catalog upgrade completes builtin');
});

test('init migrate + offline persists; second init does not double-count offline', () => {
  localStorage.clear();
  const b = { rail: 2, bar: 1, vip: 0, dj: 0, marquee: 0, flyers: 1, door: 0, dress: 0 };
  const hourAgo = Date.now() - 3600_000;
  localStorage.setItem('afterglow.save', JSON.stringify({
    saveVer: 4,
    ver: '0.5.3',
    build: 159,
    g: {
      cash: 100, hype: 10, buzz: 5, patrons: 4, regulars: 0, clout: 0,
      crew: 0, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      b, u: {}, r: {},
      elapsed: 100, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: hourAgo
    }
  }));
  const game1 = new Game(root);
  game1.forceUpdate = () => {};
  game1.init();
  if (game1.timer) clearInterval(game1.timer);
  if (game1.saver) clearInterval(game1.saver);
  const cashAfterFirst = game1.state.g.cash;
  const stored = JSON.parse(localStorage.getItem(game1.KEY));
  strictEqual(stored.saveVer, game1.SAVE_VER, 'init must persist current SAVE_VER immediately');
  ok(Array.isArray(stored.g.goals), 'persisted goals after migrate');
  ok(stored.g.ts > hourAgo + 3_000_000, 'ts refreshed so offline window cannot replay');
  // Second init loads current format with fresh ts — must not re-apply the hour of catchUp.
  // Tiny sub-second offline between inits can tick fractional cash; bound it tightly.
  const game2 = new Game(root);
  game2.forceUpdate = () => {};
  game2.init();
  if (game2.timer) clearInterval(game2.timer);
  if (game2.saver) clearInterval(game2.saver);
  const delta = Math.abs(game2.state.g.cash - cashAfterFirst);
  ok(delta < 1, `second init must not re-apply ~1h offline (Δcash=${delta}, first=${cashAfterFirst})`);
  strictEqual(JSON.parse(localStorage.getItem(game2.KEY)).saveVer, game2.SAVE_VER);
});

// AAR-59 / Codex P2: setItem throw must not leave catch-up applied only in memory
// while the prior blob (old ts) remains — that path double-counts offline on reload.
test('init setItem throw after migrate skips catch-up (no double-count risk)', () => {
  localStorage.clear();
  const b = { rail: 2, bar: 1, vip: 0, dj: 0, marquee: 0, flyers: 1, door: 0, dress: 0 };
  const hourAgo = Date.now() - 3600_000;
  const seed = {
    saveVer: 4,
    ver: '0.5.3',
    build: 159,
    g: {
      cash: 100, hype: 10, buzz: 5, patrons: 4, regulars: 0, clout: 0,
      crew: 0, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      b, u: {}, r: {},
      elapsed: 100, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: hourAgo
    }
  };
  localStorage.setItem('afterglow.save', JSON.stringify(seed));
  const origSet = localStorage.setItem.bind(localStorage);
  // Quota / private-mode failure on every write during this init.
  localStorage.setItem = () => { throw new Error('quota'); };
  const game1 = new Game(root);
  game1.forceUpdate = () => {};
  game1.init();
  if (game1.timer) clearInterval(game1.timer);
  if (game1.saver) clearInterval(game1.saver);
  localStorage.setItem = origSet;

  strictEqual(game1.state.saveState, 'save failed', 'claim failure surfaces save failed');
  // Catch-up must not have run: cash stays at seeded 100 (migrate credits no rewards).
  strictEqual(game1.state.g.cash, 100, 'catch-up skipped when claim persist fails');
  // Disk still holds the prior v4 blob (setItem never succeeded).
  const diskAfterFail = JSON.parse(localStorage.getItem('afterglow.save'));
  strictEqual(diskAfterFail.saveVer, 4, 'prior blob remains when all setItem throws');
  strictEqual(diskAfterFail.g.ts, hourAgo, 'old ts remains on disk');

  // Healthy init can still apply offline once — not twice across the failed session.
  const game2 = new Game(root);
  game2.forceUpdate = () => {};
  game2.init();
  if (game2.timer) clearInterval(game2.timer);
  if (game2.saver) clearInterval(game2.saver);
  ok(game2.state.g.cash > 100, 'successful claim allows catch-up once');
  const stored = JSON.parse(localStorage.getItem(game2.KEY));
  strictEqual(stored.saveVer, game2.SAVE_VER);
  ok(stored.g.ts > hourAgo + 3_000_000, 'ts claimed after successful persist');

  // Third init must not re-apply the hour.
  const cashAfter = game2.state.g.cash;
  const game3 = new Game(root);
  game3.forceUpdate = () => {};
  game3.init();
  if (game3.timer) clearInterval(game3.timer);
  if (game3.saver) clearInterval(game3.saver);
  ok(Math.abs(game3.state.g.cash - cashAfter) < 1, 'no double-count after recover');
});

test('init post-catchUp setItem throw still claimed ts (reload cannot re-apply gap)', () => {
  localStorage.clear();
  const b = { rail: 2, bar: 1, vip: 0, dj: 0, marquee: 0, flyers: 1, door: 0, dress: 0 };
  const hourAgo = Date.now() - 3600_000;
  localStorage.setItem('afterglow.save', JSON.stringify({
    saveVer: 4,
    ver: '0.5.3',
    build: 159,
    g: {
      cash: 100, hype: 10, buzz: 5, patrons: 4, regulars: 0, clout: 0,
      crew: 0, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      b, u: {}, r: {},
      elapsed: 100, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: hourAgo
    }
  }));
  const origSet = localStorage.setItem.bind(localStorage);
  let writes = 0;
  // First write = claim (ok); second write = post-catchUp results (throws).
  localStorage.setItem = (k, v) => {
    writes++;
    if (writes === 1) return origSet(k, v);
    throw new Error('quota after claim');
  };
  const game1 = new Game(root);
  game1.forceUpdate = () => {};
  game1.init();
  if (game1.timer) clearInterval(game1.timer);
  if (game1.saver) clearInterval(game1.saver);
  localStorage.setItem = origSet;

  strictEqual(game1.state.saveState, 'save failed', 'post-catchUp write failure surfaces');
  ok(game1.state.g.cash > 100, 'catch-up applied in memory after claim succeeded');
  const disk = JSON.parse(localStorage.getItem(game1.KEY));
  strictEqual(disk.saveVer, game1.SAVE_VER, 'claim write left SAVE_VER 5 on disk');
  ok(disk.g.ts > hourAgo + 3_000_000, 'claimed ts on disk even if progress write failed');
  // Disk may lack full catch-up cash (second write failed) — that is one-time loss, not double-count.
  const cashOnDisk = disk.g.cash;
  const game2 = new Game(root);
  game2.forceUpdate = () => {};
  game2.init();
  if (game2.timer) clearInterval(game2.timer);
  if (game2.saver) clearInterval(game2.saver);
  // Second init must not re-apply ~1h offline on top of disk state.
  ok(Math.abs(game2.state.g.cash - cashOnDisk) < 1,
    `reload must not re-apply offline gap (disk=${cashOnDisk}, second=${game2.state.g.cash})`);
});

test('v6 migrates to v8 and backfills achievements; v5 without prestige still migrates', () => {
  const game = newGame(20);
  game.state.g.cash = 20;
  const matureNoGoals = {
    cash: 500, hype: 30, buzz: 10, patrons: 12, regulars: 5, clout: 4,
    crew: 3, jobs: { stage: 1, vipjob: 1, floor: 1, off: 0 },
    b: { rail: 2, flyers: 1, bar: 1, vip: 1, dress: 1, dj: 2, marquee: 0, door: 0 },
    u: { led: true }, r: { loop: true },
    elapsed: 600, night: 4, shiftIdx: 0, shiftT: 10, log: [], ts: Date.now()
    // goals/clicks/rounds/achievements omitted; v6 shape
  };
  const okV6 = game.importSaveFromText(JSON.stringify({
    saveVer: 6, ver: '0.8.0', build: 182, g: { ...matureNoGoals }
  }));
  strictEqual(okV6, true, 'v6 missing goals migrates to v8');
  strictEqual(game.state.saveState, 'imported');
  ok(Array.isArray(game.state.g.achievements), 'v6 → v8 adds achievements');
  ok(game.state.g.achievements.includes('first_rail'), 'already-earned achievement backfilled');
  ok(typeof game.state.g.managers === 'object', 'v7 → v8 adds managers map');
  ok(game.state.g.managers.rail === false, 'new manager defaults to false');
  strictEqual(game.state.g.cash, 500, 'no reward cascade on migrate');

  // v5 path migrates without prestige fields and supplies defaults.
  const matureV5 = {
    ...matureNoGoals,
    goals: ['work', 'rail', 'word', 'pulse', 'contract', 'energy',
      'backstage', 'regulars', 'study', 'roster', 'builtin'],
    clicks: 10, rounds: 1
  };
  const okV5 = game.importSaveFromText(JSON.stringify({
    saveVer: 5, ver: '0.6.0', build: 161, g: { ...matureV5 }
  }));
  strictEqual(okV5, true, 'v5 without prestige still migrates');
  ok(Array.isArray(game.state.g.goals), 'migration supplies goals');
  strictEqual(game.state.g.cash, 500, 'no reward cascade on migrate');
  ok(typeof game.state.g.legacy === 'number', 'MIGRATIONS[5] adds legacy');
  ok(typeof game.state.g.perks === 'object' && !Array.isArray(game.state.g.perks), 'MIGRATIONS[5] adds perks map');
  strictEqual(game.state.g.prestiges, 0, 'MIGRATIONS[5] adds prestiges');
});

// ── Import log sanitization + tabStale ownership (AAR-58 / AAR-62) ────────────
console.log('\nImport log sanitization + tabStale ownership (AAR-58 / AAR-62)');

test('crafted HTML in imported log is escaped at render, not stored as entities', () => {
  const game = newGame(10);
  const payload = {
    saveVer: game.SAVE_VER,
    ver: game.VERSION.num,
    build: game.VERSION.build,
    g: {
      cash: 50, hype: 1, buzz: 0, patrons: 0, regulars: 0, clout: 0, crew: 0,
      jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      b: {}, u: {}, r: {},
      elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, ts: Date.now(),
      goals: [], clicks: 0, rounds: 0,
      log: [
        {
          t: '12:00',
          msg: '<img src=x onerror="window.__xss=1">alert(1)',
          color: 'red;background:url(javascript:alert(1))'
        },
        {
          t: '<script>x</script>',
          msg: 'ok line',
          color: '#22d3ee'
        }
      ]
    }
  };
  const okImport = game.importSaveFromText(JSON.stringify(payload));
  strictEqual(okImport, true);
  const log = game.state.g.log;
  // Storage keeps raw validated text (idempotent export→import).
  const xssEntry = log.find(e => /onerror|img/i.test(e.msg));
  ok(xssEntry, 'crafted entry retained in g.log');
  ok(xssEntry.msg.includes('<img'), 'g.log keeps raw angle brackets (not pre-escaped)');
  ok(!xssEntry.msg.includes('&lt;img'), 'g.log must not store entity-escaped markup');
  // Color injection blocked — only hex colors allowed in storage.
  strictEqual(xssEntry.color, '#b9a5c9', 'unsafe color falls back to default');
  const hexEntry = log.find(e => e.msg === 'ok line');
  ok(hexEntry, 'plain msg retained raw');
  strictEqual(hexEntry.color, '#22d3ee', 'valid hex color preserved');
  // renderVals escapes for innerHTML — no raw tags in display fields.
  const v = game.renderVals();
  for (const row of v.log) {
    ok(!String(row.msg).includes('<img'), 'renderVals msg has no raw img tag');
    ok(!String(row.t).includes('<script'), 'renderVals t has no raw script tag');
    if (row.style && row.style.color) {
      ok(/^#[0-9a-fA-F]{3,8}$/.test(row.style.color), `render color is hex: ${row.style.color}`);
    }
  }
  const renderedXss = v.log.find(r => /onerror|img/i.test(r.msg));
  ok(renderedXss, 'crafted entry present in renderVals');
  ok(renderedXss.msg.includes('&lt;img'), 'render boundary entity-escapes markup');
  ok(!renderedXss.msg.includes('<img'), 'render boundary has no raw <img');
});

test('import → export → import leaves log text visually identical', () => {
  const game = newGame(10);
  const originalMsg = 'Hello & welcome <Peak> "VIP"';
  const originalT = 'N1 Early';
  const payload = {
    saveVer: game.SAVE_VER,
    ver: game.VERSION.num,
    build: game.VERSION.build,
    g: {
      cash: 50, hype: 1, buzz: 0, patrons: 0, regulars: 0, clout: 0, crew: 0,
      jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      b: {}, u: {}, r: {},
      elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, ts: Date.now(),
      goals: [], clicks: 0, rounds: 0,
      log: [{ t: originalT, msg: originalMsg, color: '#ff2d78' }]
    }
  };
  strictEqual(game.importSaveFromText(JSON.stringify(payload)), true);
  const afterFirst = game.state.g.log.find(e => e.msg === originalMsg || e.msg.includes('Hello'));
  ok(afterFirst, 'first import keeps original msg');
  strictEqual(afterFirst.msg, originalMsg, 'first import stores raw msg');
  strictEqual(afterFirst.t, originalT, 'first import stores raw t');
  const display1 = game.renderVals().log.find(r => r.msg.includes('Hello') || r.msg.includes('welcome'));
  ok(display1, 'first render has entry');

  // Export current save (same shape as Download / clipboard).
  const exported = JSON.stringify({
    saveVer: game.SAVE_VER,
    ver: game.VERSION.num,
    build: game.VERSION.build,
    g: game.state.g
  });
  const game2 = newGame(10);
  strictEqual(game2.importSaveFromText(exported), true);
  const afterSecond = game2.state.g.log.find(e => e.msg === originalMsg || e.msg.includes('Hello'));
  ok(afterSecond, 'second import finds original msg');
  strictEqual(afterSecond.msg, originalMsg, 're-import must not double-escape storage');
  strictEqual(afterSecond.t, originalT, 're-import t unchanged');
  const display2 = game2.renderVals().log.find(r => r.msg.includes('Hello') || r.msg.includes('welcome'));
  ok(display2, 'second render has entry');
  strictEqual(display2.msg, display1.msg, 'visible log text identical after round-trip');
  strictEqual(display2.t, display1.t, 'visible log time identical after round-trip');
  // Entities appear once in display (not &amp;lt;).
  ok(display2.msg.includes('&amp;') || display2.msg.includes('&lt;'), 'display escapes special chars once');
  ok(!display2.msg.includes('&amp;amp;'), 'no double-escaped ampersand');
  ok(!display2.msg.includes('&amp;lt;'), 'no double-escaped angle bracket');
});

test('successful import clears tabStale and restarts autosave', () => {
  const game = newGame(25);
  // Simulate foreign-tab pause: autosave stopped, banner armed.
  if (game.saver) {
    clearInterval(game.saver);
    game.saver = null;
  }
  game.state.tabStale = true;
  game.state.saveState = 'paused (other tab)';
  const g = {
    cash: 77, hype: 2, buzz: 0, patrons: 0, regulars: 0, clout: 0, crew: 0,
    jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
    b: {}, u: {}, r: {},
    elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now(),
    goals: [], clicks: 0, rounds: 0
  };
  const okImport = game.importSaveFromText(JSON.stringify({
    saveVer: game.SAVE_VER,
    ver: game.VERSION.num,
    build: game.VERSION.build,
    g
  }));
  strictEqual(okImport, true);
  strictEqual(game.state.saveState, 'imported');
  strictEqual(game.state.tabStale, false, 'explicit restore takes ownership');
  ok(game.isTabOwner(), 'import marks tab as owner');
  strictEqual(game.state.g.cash, 77);
  ok(game.saver != null, 'autosave interval restarted after import');
  // Autosave must write again (not no-op under stale guard).
  game.state.g.cash = 99;
  game.save('auto');
  const raw = localStorage.getItem(game.KEY);
  ok(raw, 'autosave wrote after import ownership');
  strictEqual(JSON.parse(raw).g.cash, 99);
  if (game.saver) {
    clearInterval(game.saver);
    game.saver = null;
  }
});

// AAR-71 / PR #14 Codex P2: unknown b/u/r/jobs keys must not survive import
// (Structures used Object.values(g.b) and could concatenate string XSS bait).
test('crafted unknown g.b key is stripped; Structures stays numeric', () => {
  const game = newGame(10);
  const evil = '<img src=x onerror="window.__xssBuild=1">';
  const payload = {
    saveVer: game.SAVE_VER,
    ver: game.VERSION.num,
    build: game.VERSION.build,
    g: {
      cash: 50, hype: 1, buzz: 0, patrons: 0, regulars: 0, clout: 0, crew: 0,
      jobs: { stage: 0, vipjob: 0, floor: 0, off: 0, evilJob: evil },
      b: { rail: 2, bar: 1, evil },
      u: { led: false, evilUp: true },
      r: { loop: false, evilRes: true },
      elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now(),
      goals: [], clicks: 0, rounds: 0
    }
  };
  strictEqual(game.importSaveFromText(JSON.stringify(payload)), true);
  const g = game.state.g;
  strictEqual(g.b.evil, undefined, 'unknown building key stripped');
  strictEqual(Object.prototype.hasOwnProperty.call(g.b, 'evil'), false, 'evil not own prop of g.b');
  strictEqual(g.b.rail, 2, 'known building preserved');
  strictEqual(g.b.bar, 1, 'known building preserved');
  strictEqual(g.u.evilUp, undefined, 'unknown upgrade key stripped');
  strictEqual(g.r.evilRes, undefined, 'unknown research key stripped');
  strictEqual(g.jobs.evilJob, undefined, 'unknown jobs key stripped');
  // Structures must be a plain number string — no HTML payload.
  const structures = game.renderVals().stats.find(s => s.k === 'Structures');
  ok(structures, 'Structures stat present');
  ok(/^\d+$/.test(structures.v), `Structures is numeric digits only: ${structures.v}`);
  ok(!structures.v.includes('<'), 'Structures has no raw angle bracket');
  ok(!structures.v.includes('onerror'), 'Structures has no onerror bait');
  strictEqual(structures.v, '3', 'Structures counts known buildings only (2+1)');
});

// AAR-67 / PR #14 Codex P2: setItem throw must not claim import success or ownership
test('import setItem throw fails closed without claiming ownership', () => {
  const game = newGame(25);
  if (game.saver) {
    clearInterval(game.saver);
    game.saver = null;
  }
  game.state.tabStale = true;
  game.state.saveState = 'paused (other tab)';
  const priorCash = game.state.g.cash;
  const priorG = game.state.g;
  const priorRaw = localStorage.getItem(game.KEY);
  const origSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = () => { throw new Error('quota'); };
  const g = {
    cash: 999, hype: 2, buzz: 0, patrons: 0, regulars: 0, clout: 0, crew: 0,
    jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
    b: {}, u: {}, r: {},
    elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now(),
    goals: [], clicks: 0, rounds: 0
  };
  let okImport;
  try {
    okImport = game.importSaveFromText(JSON.stringify({
      saveVer: game.SAVE_VER,
      ver: game.VERSION.num,
      build: game.VERSION.build,
      g
    }));
  } finally {
    localStorage.setItem = origSet;
  }
  strictEqual(okImport, false);
  strictEqual(game.state.saveState, 'import failed');
  strictEqual(game.state.tabStale, true, 'must not clear tabStale when persist fails');
  ok(!game.isTabOwner(), 'must not mark owner when persist fails');
  ok(!game.saver, 'must not restart autosave when persist fails');
  strictEqual(game.state.g, priorG, 'live club reference unchanged');
  strictEqual(game.state.g.cash, priorCash, 'live club cash unchanged');
  strictEqual(localStorage.getItem(game.KEY), priorRaw, 'disk blob unchanged');
});


// ── Multi-tab ownership hardening (ported from plan-next/b-owners-list / AAR-70–78) ──
console.log('\nMulti-tab ownership hardening (AAR-70–78)');

function seedSave(game, gPatch = {}, ageSec = 5) {
  const g = game.fresh();
  Object.assign(g, gPatch);
  g.ts = Date.now() - ageSec * 1000;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g
  }));
  return g;
}

test('short multi-tab open does not setItem or start autosave', () => {
  const game = newGame(20);
  const diskTs = Date.now() - 5000;
  const g = game.fresh();
  g.cash = 111;
  g.ts = diskTs;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g
  }));
  sessionStorage.clear(); // new tab: no OWNER_KEY / RELOAD_KEY
  game.forceUpdate = () => {};
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  strictEqual(game.isTabOwner(), false, 'non-claiming tab is not owner');
  strictEqual(game.saver, null, 'autosave not armed');
  strictEqual(game.state.tabStale, true, 'non-owner paused');
  const disk = JSON.parse(localStorage.getItem(game.KEY));
  strictEqual(disk.g.ts, diskTs, 'disk ts unchanged (live sibling keeps ownership)');
  strictEqual(disk.g.cash, 111, 'disk cash unchanged');
});

test('same-tab RELOAD_KEY claims and starts autosave', () => {
  const game = newGame(20);
  const g = game.fresh();
  g.cash = 50;
  g.ts = Date.now() - 3000;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g
  }));
  sessionStorage.setItem(game.RELOAD_KEY, 'prev-tab-token');
  game.forceUpdate = () => {};
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  ok(game.isTabOwner(), 'reload intent claims ownership');
  ok(game.saver != null, 'owner starts autosave');
  strictEqual(game.state.tabStale, false);
  strictEqual(sessionStorage.getItem(game.OWNER_KEY), game.tabToken, 'owner token is this page context after claim');
  strictEqual(sessionStorage.getItem(game.RELOAD_KEY), null, 'reload intent consumed');
});

test('copied OWNER_KEY without RELOAD_KEY does not claim (tab-duplicate)', () => {
  const game = newGame(20);
  const g = game.fresh();
  g.ts = Date.now() - 2000;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g
  }));
  // pagehide never ran so RELOAD_KEY is absent. Must not steal a live sibling.
  sessionStorage.setItem(game.OWNER_KEY, game.tabToken);
  // No RELOAD_KEY — simulates duplicate of a still-live owner tab.
  game.forceUpdate = () => {};
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  strictEqual(game.isTabOwner(), false, 'duplicate does not claim');
  strictEqual(game.saver, null);
  strictEqual(game.state.tabStale, true);
});

test('manual save from non-owner is a no-op (no ownership steal)', () => {
  const game = newGame(20);
  const g = game.fresh();
  g.cash = 200;
  g.ts = Date.now() - 4000;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g
  }));
  sessionStorage.clear();
  game.forceUpdate = () => {};
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  strictEqual(game.isTabOwner(), false);
  const diskBefore = localStorage.getItem(game.KEY);
  game.state.g.cash = 9999;
  game.save('manual');
  strictEqual(game.isTabOwner(), false, 'manual save must not take ownership while non-owner');
  strictEqual(game.saver, null, 'manual save must not start autosave while non-owner');
  strictEqual(localStorage.getItem(game.KEY), diskBefore, 'disk unchanged');
});

test('owner save(manual) writes while not tabStale', () => {
  const game = newGame(20);
  game.markTabOwner();
  game.state.tabStale = false;
  game.state.g.cash = 321;
  localStorage.removeItem(game.KEY);
  game.save('manual');
  const raw = localStorage.getItem(game.KEY);
  ok(raw, 'owner manual save writes');
  strictEqual(JSON.parse(raw).g.cash, 321);
});

test('live foreign lease blocks age-only claim', () => {
  const game = newGame(20);
  const g = game.fresh();
  g.cash = 40;
  g.ts = Date.now() - 60_000; // offline > 15s
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g
  }));
  localStorage.setItem(game.LEASE_KEY, JSON.stringify({
    token: 'foreign-live-token', at: Date.now()
  }));
  sessionStorage.clear();
  game.forceUpdate = () => {};
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  if (game._probeTimer) clearTimeout(game._probeTimer);
  strictEqual(game.isTabOwner(), false, 'claimant does not become owner');
  strictEqual(game.state.tabStale, true, 'non-owner is paused read-only');
  strictEqual(game.saver, null);
});

test('stale lease allows age-only claim after probe wait', () => {
  const game = newGame(20);
  const g = game.fresh();
  g.cash = 40;
  g.ts = Date.now() - 60_000;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g
  }));
  // Stale lease (older than LEASE_TTL_MS) must not block claim.
  localStorage.setItem(game.LEASE_KEY, JSON.stringify({
    token: 'stale-foreign', at: Date.now() - (game.LEASE_TTL_MS + 5000)
  }));
  sessionStorage.clear();
  game.forceUpdate = () => {};
  game.init();
  // Probe wait: claim is deferred until finishAgeClaim (no immediate setItem race).
  strictEqual(game.isTabOwner(), false, 'does not claim before probe wait elapses');
  strictEqual(game.state.tabStale, true, 'read-only during probe wait');
  strictEqual(game.state.saveState, 'checking ownership…');
  ok(localStorage.getItem(game.PROBE_KEY), 'probe written for owner handshake');
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  if (game._probeTimer) clearTimeout(game._probeTimer);
  game.finishAgeClaim();
  if (game.saver) clearInterval(game.saver);
  if (game.timer) clearInterval(game.timer);
  ok(game.isTabOwner(), 'stale lease allows age-only claim after probe wait');
  strictEqual(game.state.tabStale, false, 'unpaused after successful claim');
  ok(game.saver != null, 'autosave started after claim');
  const lease = JSON.parse(localStorage.getItem(game.LEASE_KEY));
  strictEqual(lease.token, game.tabToken, 'owner publishes its own lease after claim');
});

test('probe wait aborts when live owner refreshes lease', () => {
  const game = newGame(20);
  const g = game.fresh();
  g.ts = Date.now() - 60_000;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g
  }));
  localStorage.setItem(game.LEASE_KEY, JSON.stringify({
    token: 'was-stale', at: Date.now() - (game.LEASE_TTL_MS + 5000)
  }));
  sessionStorage.clear();
  game.forceUpdate = () => {};
  game.init();
  strictEqual(game.isTabOwner(), false, 'deferred — not owner yet');
  strictEqual(game.state.saveState, 'checking ownership…');
  ok(localStorage.getItem(game.PROBE_KEY), 'probe written for owner handshake');
  // Simulate live owner responding to PROBE via storage (refreshes lease).
  localStorage.setItem(game.LEASE_KEY, JSON.stringify({
    token: 'live-owner-now', at: Date.now()
  }));
  if (game._probeTimer) clearTimeout(game._probeTimer);
  game.finishAgeClaim();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  strictEqual(game.isTabOwner(), false);
  strictEqual(game.state.tabStale, true);
  strictEqual(game.state.saveState, 'paused (other tab)');
});

test('non-owner short multi-tab open is read-only (tabStale; actions no-op)', () => {
  const game = newGame(5000);
  const g0 = game.fresh();
  g0.cash = 5000;
  g0.ts = Date.now() - 4000;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g: g0
  }));
  sessionStorage.clear();
  game.forceUpdate = () => {};
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  strictEqual(game.isTabOwner(), false);
  strictEqual(game.state.tabStale, true, 'non-owner paused with banner state');
  const cashBefore = game.state.g.cash;
  const clicksBefore = game.state.g.clicks || 0;
  const rail = game.BUILDINGS.find(b => b.id === 'rail');
  game.buyBuilding(rail);
  // workCrowd is only on renderVals
  const v = game.renderVals();
  v.workCrowd();
  strictEqual(game.state.g.cash, cashBefore, 'work/buy no-op while tabStale');
  strictEqual(game.state.g.clicks, clicksBefore, 'clicks not advanced while tabStale');
  strictEqual(game.state.g.b.rail, 0, 'building not purchased while tabStale');
});

test('tabStale + save(manual) does not write or clear pause (AAR-78)', () => {
  const game = newGame(20);
  const g0 = game.fresh();
  g0.cash = 88;
  g0.ts = Date.now() - 3000;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g: g0
  }));
  sessionStorage.clear();
  game.forceUpdate = () => {};
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  strictEqual(game.state.tabStale, true);
  const diskBefore = localStorage.getItem(game.KEY);
  game.state.g.cash = 1;
  game.save('manual');
  strictEqual(game.isTabOwner(), false, 'must not mark owner while tabStale');
  strictEqual(game.state.tabStale, true, 'manual save must not clear read-only pause');
  strictEqual(game.saver, null, 'must not start autosave while tabStale');
  strictEqual(localStorage.getItem(game.KEY), diskBefore, 'disk unchanged by manual save');
});

test('pageshow clears RELOAD_KEY (BFCache restore must not leave stealable marker)', () => {
  const game = newGame(20);
  game.markTabOwner();
  sessionStorage.setItem(game.RELOAD_KEY, game.tabToken);
  // ensureOwnerLifecycle bound via markTabOwner
  window.dispatchEvent('pageshow', {});
  strictEqual(sessionStorage.getItem(game.RELOAD_KEY), null,
    'pageshow must clear RELOAD_KEY');
});

test('onForeignSave clears ownership and stops autosave', () => {
  const game = newGame(10);
  game.markTabOwner();
  game.startAutosave();
  ok(game.saver != null);
  game.onForeignSave();
  strictEqual(game.state.tabStale, true);
  strictEqual(game.saver, null, 'autosave interval cleared');
  strictEqual(game.isTabOwner(), false, 'owner cleared on foreign write');
  strictEqual(sessionStorage.getItem(game.RELOAD_KEY), null, 'reload intent cleared on foreign write');
  // Idempotent second call.
  game.onForeignSave();
  strictEqual(game.state.tabStale, true);
});

// AAR-79 review P1: non-owner Settings wipe must not destroy a live sibling save.
test('non-owner hardReset does not removeItem disk save', () => {
  const game = newGame(20);
  const g0 = game.fresh();
  g0.cash = 7777;
  g0.ts = Date.now() - 4000;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g: g0
  }));
  // Live foreign lease so age-claim cannot steal either.
  localStorage.setItem(game.LEASE_KEY, JSON.stringify({
    token: 'foreign-live', at: Date.now()
  }));
  sessionStorage.clear();
  game.forceUpdate = () => {};
  game.init();
  if (game.timer) clearInterval(game.timer);
  if (game.saver) clearInterval(game.saver);
  if (game._probeTimer) clearTimeout(game._probeTimer);
  strictEqual(game.isTabOwner(), false);
  strictEqual(game.state.tabStale, true);
  const diskBefore = localStorage.getItem(game.KEY);
  const cashBefore = JSON.parse(diskBefore).g.cash;
  // Double-confirm wipe (arm + confirm) — both must no-op for non-owner.
  const hr = game.renderVals().hardReset;
  hr();
  hr();
  const diskAfter = localStorage.getItem(game.KEY);
  ok(diskAfter, 'disk KEY still present after non-owner wipe attempts');
  strictEqual(diskAfter, diskBefore, 'disk blob unchanged');
  strictEqual(JSON.parse(diskAfter).g.cash, 7777, 'live sibling cash preserved');
  strictEqual(cashBefore, 7777);
  strictEqual(game.isTabOwner(), false, 'still not owner after wipe attempts');
  strictEqual(game.state.tabStale, true, 'still paused after wipe attempts');
  strictEqual(game.state.resetArmed, false, 'must not arm wipe UI while non-owner');
});

test('owner hardReset wipes disk after double-confirm', () => {
  const game = newGame(20);
  game.markTabOwner();
  game.state.tabStale = false;
  game.state.g.cash = 42;
  localStorage.setItem(game.KEY, JSON.stringify({
    saveVer: game.SAVE_VER, ver: game.VERSION.num, build: game.VERSION.build, g: game.state.g
  }));
  const hr = game.renderVals().hardReset;
  hr(); // arm
  strictEqual(game.state.resetArmed, true);
  hr(); // confirm wipe
  strictEqual(localStorage.getItem(game.KEY), null, 'owner wipe removes KEY');
  strictEqual(game.state.g.cash, game.props.startingCash, 'fresh club after wipe');
  ok(game.isTabOwner(), 'owner remains owner of fresh club');
});

// ── Managers (PLAN.md §4.1) ──────────────────────────────────────────────────
console.log('\\nManagers (PLAN.md §4.1)');

test('fresh() includes managers map with all false', () => {
  const game = newGame();
  const g = game.fresh();
  for (const def of game.MANAGERS) {
    strictEqual(g.managers[def.id], false, def.id + ' defaults to false');
  }
  strictEqual(game.MANAGERS.length, 8, 'exactly 8 managers');
  const buildingIds = new Set(game.BUILDINGS.map(b => b.id));
  for (const def of game.MANAGERS) {
    ok(buildingIds.has(def.id), 'manager id matches a building: ' + def.id);
  }
});

test('buyManager purchases for Legacy, max 1', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.legacy = 10;
  const railMgr = game.MANAGERS.find(m => m.id === 'rail');
  const before = g.managers.rail;
  game.buyManager(railMgr);
  strictEqual(g.managers.rail, true, 'manager hired');
  strictEqual(g.legacy, 0, 'legacy cost deducted');
  // Cannot hire again
  game.buyManager(railMgr);
  strictEqual(g.managers.rail, true, 'cannot hire twice');
  strictEqual(g.legacy, 0, 'no double charge');
});

test('buyManager fails on insufficient Legacy', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.legacy = 9;
  const barMgr = game.MANAGERS.find(m => m.id === 'bar');
  game.buyManager(barMgr);
  strictEqual(g.managers.bar, false, 'not hired without enough Legacy');
  strictEqual(g.legacy, 9, 'legacy unchanged on failure');
});

test('manager auto-buy respects cash-gate (no buy at cash=0)', () => {
  const game = newGame(0);
  const g = game.state.g;
  // Give the club a rail manager but no cash and no income.
  g.managers.rail = true;
  g.cash = 0;
  const before = g.b.rail;
  const bought = game.autoBuyManagers(g);
  strictEqual(bought, 0, 'no auto-buy at cash=0 with no income');
  strictEqual(g.b.rail, before, 'building count unchanged');
});

test('manager auto-buy respects strike rule (no buy while on strike)', () => {
  const game = newGame(0);
  const g = game.state.g;
  // Set up strike: crew working, no buildings to cover wages, cash=0.
  g.crew = 3;
  g.jobs = { stage: 1, vipjob: 1, floor: 1, off: 0 };
  g.cash = 0;
  const r = game.rates(g);
  strictEqual(r.strike, true, 'precondition: crew on strike at cash=0');
  // Hire a rail manager — should NOT auto-buy during strike.
  g.legacy = 10;
  const railMgr = game.MANAGERS.find(m => m.id === 'rail');
  game.buyManager(railMgr);
  g.legacy = 1000; // pile cash for the rail but strike still blocks
  g.cash = 0;
  const bought = game.autoBuyManagers(g);
  strictEqual(bought, 0, 'no auto-buy while on strike even with cash for cost');
  strictEqual(g.b.rail, 0, 'building not purchased on strike');
});

test('manager auto-buy respects Door Staff cap (doorMax)', () => {
  const game = newGame(0);
  const g = game.state.g;
  // Hire door manager.
  g.legacy = 10;
  const doorMgr = game.MANAGERS.find(m => m.id === 'door');
  game.buyManager(doorMgr);
  // Set door to max (base 6) with no doorPlus perk.
  g.b.door = 6;
  g.cash = 9999;
  const bought = game.autoBuyManagers(g);
  strictEqual(bought, 0, 'no auto-buy when door at cap');
  strictEqual(g.b.door, 6, 'door count unchanged at cap');
});

test('manager auto-buy does NOT block when strike is false', () => {
  const game = newGame(0);
  const g = game.state.g;
  // Club with income: bar generates enough to not be on strike.
  g.b.bar = 5;
  g.b.dj = 3;
  g.b.rail = 2;
  g.cash = 9999;
  g.patrons = 50;
  g.crew = 2;
  g.jobs = { stage: 1, vipjob: 0, floor: 1, off: 0 };
  g.shiftIdx = 0;
  g.shiftT = 0;
  const r = game.rates(g);
  ok(!r.strike, 'precondition: not on strike with income');
  // Hire rail manager — should auto-buy during catchUp even though rates.strike is false.
  g.legacy = 10;
  const railMgr = game.MANAGERS.find(m => m.id === 'rail');
  game.buyManager(railMgr);
  g.legacy = 1000;
  const railBefore = g.b.rail;
  const report = game.catchUp(g, 60);
  ok(report.managerBought > 0, 'manager auto-buys when not on strike');
  ok(g.b.rail > railBefore, 'rail count increased when not on strike');
});

test('manager auto-buy fires on live step() when cash is sufficient', () => {
  const game = newGame(0);
  const g = game.state.g;
  // Hire rail + bar managers.
  g.legacy = 20; // 2 managers × 10 Legacy = 20 (railMgr + barMgr)
  const railMgr = game.MANAGERS.find(m => m.id === 'rail');
  const barMgr = game.MANAGERS.find(m => m.id === 'bar');
  game.buyManager(railMgr);
  game.buyManager(barMgr);
  // Give enough cash to buy one rail (base cost 140, growth 1.16, n=0 → 140).
  g.cash = 1000;
  g.b.rail = 0;
  // step() will call autoBuyManagers; rail costs 140 so it should buy.
  const beforeRail = g.b.rail;
  game.step(0.1);
  ok(g.b.rail > beforeRail, 'rail was auto-bought during live step');
});

test('manager auto-buy fires inside catchUp() slices', () => {
  const game = newGame(0);
  const g = game.state.g;
  // Hire rail manager.
  g.legacy = 10;
  const railMgr = game.MANAGERS.find(m => m.id === 'rail');
  game.buyManager(railMgr);
  // Seed with buildings to generate income + enough starting cash for at least one rail.
  g.b.rail = 2;
  g.b.bar = 5;
  g.b.dj = 3;
  g.cash = 50;
  g.patrons = 50;
  g.crew = 2;
  g.jobs = { stage: 1, vipjob: 0, floor: 1, off: 0 };
  g.shiftIdx = 0;
  g.shiftT = 0;
  const cashBefore = g.cash;
  const railBefore = g.b.rail;
  const report = game.catchUp(g, 600); // 10 min offline at 50% rate
  ok(report.managerBought > 0, 'manager bought at least 1 building during catchUp (' + report.managerBought + ')');
  ok(g.b.rail > railBefore, 'rail count increased during catchUp');
  // Verify the report includes managerBought.
  ok('managerBought' in report, 'catchUp report includes managerBought field');
  ok(typeof report.managerBought === 'number', 'managerBought is a number');
});

test('catchUp returns managerBought=0 when no managers hired', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.b.bar = 1;
  g.cash = 500;
  g.shiftIdx = 0;
  g.shiftT = 0;
  const report = game.catchUp(g, 60);
  strictEqual(report.managerBought, 0, 'no managers means zero auto-buys');
});

test('awayMsg includes manager line when managerBought > 0', () => {
  const game = newGame();
  const msg = game.awayMsg(90 * 60, { earned: 500, wagesPaid: 100, struck: false, managerBought: 3 });
  ok(/Managers bought 3 buildings while you were away\./.test(msg), 'manager line present: ' + msg);
});

test('awayMsg omits manager line when managerBought is 0', () => {
  const game = newGame();
  const msg = game.awayMsg(90 * 60, { earned: 500, wagesPaid: 100, struck: false, managerBought: 0 });
  ok(!/Managers bought/.test(msg), 'no manager line when zero: ' + msg);
});

test('MIGRATIONS[7] defaults managers to false on v7 save', () => {
  const game = newGame();
  const g = game.fresh();
  // Simulate a v7 save shape (no managers field).
  delete g.managers;
  game.migrateFrom(g, 7);
  for (const def of game.MANAGERS) {
    strictEqual(g.managers[def.id], false, def.id + ' backfilled to false');
  }
});

test('sanitizeG backfills managers map from known IDs', () => {
  const game = newGame();
  const g = game.fresh();
  // Corrupt managers into an array (hand-edited save).
  g.managers = ['rail'];
  game.sanitizeG(g);
  strictEqual(Array.isArray(g.managers), false, 'array managers replaced with object');
  for (const def of game.MANAGERS) {
    strictEqual(g.managers[def.id], false, def.id + ' clamped to false');
  }
});

// Regression: hiring a manager was permanent with no way to pause/stop its
// auto-buy — a player could not redirect cash toward a different goal once
// every manager was hired. toggleManager() flips a per-manager pause flag
// that autoBuyManagers() honors without firing the manager (Legacy already
// spent stays spent, consistent with the rest of the prestige-persistent state).
test('toggleManager pauses and resumes a hired manager without un-hiring it', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.legacy = 10;
  const railMgr = game.MANAGERS.find(m => m.id === 'rail');
  game.buyManager(railMgr);
  strictEqual(g.managers.rail, true, 'precondition: manager hired');
  strictEqual(g.managerPaused.rail, false, 'starts unpaused');

  game.toggleManager(railMgr);
  strictEqual(g.managerPaused.rail, true, 'paused after first toggle');
  strictEqual(g.managers.rail, true, 'still hired while paused');

  game.toggleManager(railMgr);
  strictEqual(g.managerPaused.rail, false, 'resumed after second toggle');
});

test('toggleManager is a no-op for a manager that was never hired', () => {
  const game = newGame(0);
  const g = game.state.g;
  const barMgr = game.MANAGERS.find(m => m.id === 'bar');
  game.toggleManager(barMgr);
  strictEqual(g.managers.bar, false, 'not hired');
  strictEqual(g.managerPaused.bar, false, 'pause flag untouched');
});

test('autoBuyManagers skips a paused manager even with cash available', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.legacy = 10;
  const railMgr = game.MANAGERS.find(m => m.id === 'rail');
  game.buyManager(railMgr);
  game.toggleManager(railMgr); // pause
  g.cash = 9999;
  const before = g.b.rail;
  const bought = game.autoBuyManagers(g);
  strictEqual(bought, 0, 'paused manager does not auto-buy');
  strictEqual(g.b.rail, before, 'building count unchanged while paused');
});

test('fresh() includes managerPaused map with all false', () => {
  const game = newGame();
  const g = game.fresh();
  for (const def of game.MANAGERS) {
    strictEqual(g.managerPaused[def.id], false, def.id + ' pause defaults to false');
  }
});

test('sanitizeG backfills managerPaused map from known IDs', () => {
  const game = newGame();
  const g = game.fresh();
  g.managerPaused = ['rail'];
  game.sanitizeG(g);
  strictEqual(Array.isArray(g.managerPaused), false, 'array managerPaused replaced with object');
  for (const def of game.MANAGERS) {
    strictEqual(g.managerPaused[def.id], false, def.id + ' clamped to false');
  }
});

// Regression: the manager card's button gained a "pause/hired" title but the
// shift-click-to-buy-max path on regular building cards depends on
// el.dataset.buildingId, which the template never set — only a `title`
// attribute was added (see PR #31). Shift-click silently fell through to a
// normal single buy in every browser. renderVals() is the fast assertion;
// the template snippet itself is asserted directly since the bug lived in
// markup generation, not in a computed value.
test('renderVals() building card carries buildingId for the shift-click handler', () => {
  const game = newGame(500);
  const v = game.renderVals();
  const railCard = v.cards.find(c => c.buildingId === 'rail');
  ok(railCard, 'a building card exposes buildingId for rail');
});

test('render() emits data-building-id on building buy buttons (shift-click wiring)', () => {
  const game = newGame(500);
  game.render();
  ok(lastInnerHTML.includes('data-building-id="rail"'), 'rendered markup wires data-building-id for shift-click');
});

// ── Special shifts (PLAN §4.2) ───────────────────────────────────────────────

console.log('\nspecial shifts (PLAN §4.2)');

test('special-shift override does not corrupt the base SHIFTS rotation on the next boundary', () => {
  const game = newGame();
  const g = game.state.g;
  g.shiftIdx = 1; // Peak Hours
  g.shiftT = 0;
  // Sub-chance roll forces a special on this boundary.
  withRandom([0.01, 0.0], () => {
    game.advanceShift(g);
  });
  ok(g._specialShift != null, 'a special was triggered on the boundary');
  const special = game.SPECIAL_SHIFTS[g._specialShift];
  strictEqual(game.effectiveShift(g), special, 'effective shift is the special');
  strictEqual(g.shiftIdx, 2, 'base rotation advanced to Last Call underneath the special');
  // rates() must expose the special as the active shift (len/mult feed the sim).
  const r = game.rates(g);
  strictEqual(r.shift, special, 'rates() reports the special shift');
  strictEqual(r.sm, special.mult, 'sm uses the special mult');
  // The special instance ends; a high roll so it is not re-triggered (no 2 in a row).
  withRandom([0.99], () => {
    game.advanceShift(g);
  });
  strictEqual(g._specialShift, null, 'special cleared after its instance');
  strictEqual(g.shiftIdx, 3, 'base rotation resumed to After Hours');
  strictEqual(game.effectiveShift(g), game.SHIFTS[3], 'effective shift back to base After Hours');
  // Next normal boundary wraps to Early Doors and increments the night.
  withRandom([0.99], () => {
    game.advanceShift(g);
  });
  strictEqual(g.shiftIdx, 0, 'base rotation wraps to Early Doors');
  strictEqual(g.night, 2, 'night incremented on the wrap to Early Doors');
});

test('weighted selection respects the no-repeat constraint', () => {
  const game = newGame();
  const g = game.state.g;
  g.shiftIdx = 0;
  g.shiftT = 0;
  // Two consecutive sub-chance rolls: the first triggers a special, the second must
  // NOT re-trigger because a special just ended — even though its roll is < chance.
  withRandom([0.01, 0.02, 0.03], () => {
    game.advanceShift(g); // consume 0.01 (trigger) then 0.02 (weighted pick)
    game.advanceShift(g); // special just ended → no re-roll (0.03 ignored)
  });
  strictEqual(g._specialShift, null, 'no second special back-to-back');
  strictEqual(g.shiftIdx, 2, 'base rotation advanced two boundaries');
});

test('pickSpecialShift is weighted by each entry weight field', () => {
  const game = newGame();
  // Total weight = 4+3+3 = 10. Roll 0.0 → first, 0.45 (=4.5) → second, 0.99 (=9.9) → third.
  withRandom([0.0], () => strictEqual(game.pickSpecialShift(game.state.g), 0));
  withRandom([0.45], () => strictEqual(game.pickSpecialShift(game.state.g), 1));
  withRandom([0.99], () => strictEqual(game.pickSpecialShift(game.state.g), 2));
});

test('special shifts work inside catchUp() (offline-progress slices)', () => {
  const game = newGame();
  const g = game.state.g;
  g.b.bar = 2;
  g.patrons = 20;
  g.crew = 1;
  g.jobs = { stage: 1, vipjob: 0, floor: 0, off: 0 };
  g.shiftIdx = 0;
  g.shiftT = 0;
  // Activate the first special (Bachelorette Rush) and confirm catchUp accrues
  // against its len, rolls it over, and clears it — the same path as a live trigger.
  g._specialShift = 0;
  const specialLen = game.SPECIAL_SHIFTS[0].len;
  game.catchUp(g, specialLen + 1);
  strictEqual(g._specialShift, null, 'special cleared after its length in catchUp');
  strictEqual(g.shiftIdx, 1, 'base rotation advanced after the special in catchUp');
});

test('special shifts work inside live step() and resolve on the next boundary', () => {
  const game = newGame();
  const g = game.state.g;
  g.b.bar = 2;
  g.cash = 500;
  g.patrons = 20;
  // No stage worker → hype stays 0 → step()'s whale check never consumes Math.random.
  g.crew = 1;
  g.jobs = { stage: 0, vipjob: 0, floor: 0, off: 1 };
  g.shiftIdx = 0;
  g.shiftT = 39; // 1s from the end of Early Doors (len 40)
  // Force a special on the rollover, then high rolls so it is never re-triggered.
  withRandom([0.01, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99], () => {
    game.step(2); // crosses the boundary and runs ~1s into the special
  });
  ok(g._specialShift != null, 'special is active during live step');
  strictEqual(g.shiftIdx, 1, 'base rotation advanced but the special overlays Peak Hours');
  strictEqual(game.effectiveShift(g), game.SPECIAL_SHIFTS[g._specialShift], 'step uses the special');
  // Run the special to completion, then one more second → base rotation resumes.
  withRandom([0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99], () => {
    game.step(game.SPECIAL_SHIFTS[g._specialShift].len + 1);
  });
  strictEqual(g._specialShift, null, 'special resolved after its length in step');
  strictEqual(g.shiftIdx, 2, 'base rotation resumed to Last Call in step');
});

test('special shifts are a pure modifier — base SHIFTS shape untouched', () => {
  const game = newGame();
  for (const s of game.SHIFTS) {
    ok(['name', 'mult', 'len', 'tint'].every(k => k in s), 'SHIFTS entry has base shape: ' + s.name);
    ok(!('weight' in s), 'base SHIFTS entry has no weight field: ' + s.name);
  }
  for (const s of game.SPECIAL_SHIFTS) {
    ok(['name', 'mult', 'len', 'tint', 'weight'].every(k => k in s), 'SPECIAL_SHIFTS entry shape: ' + s.name);
  }
});

test('special announced even on a night-wrap rollover (review nit fix)', () => {
  const game = newGame();
  const g = game.state.g;
  g.b.bar = 2;
  g.cash = 500;
  g.patrons = 20;
  // No stage worker → hype stays 0 → whale check never consumes Math.random.
  g.crew = 1;
  g.jobs = { stage: 0, vipjob: 0, floor: 0, off: 1 };
  // After Hours (len 30) is the last shift; rolling over wraps to a new night AND
  // triggers a special. Crossing the boundary in a ≤0.5s chunk makes the rollover
  // chatty. Previously the "Night begins." line swallowed the special announcement.
  g.shiftIdx = 3;
  g.shiftT = 29.6; // 0.4s from the end of After Hours
  withRandom([0.01, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99], () => {
    game.step(0.5); // wraps to a new night with a special active, chatty rollover
  });
  strictEqual(g.shiftIdx, 0, 'wrapped to Early Doors (new night)');
  strictEqual(g.night, 2, 'night incremented');
  ok(g._specialShift != null, 'special active on the night-wrap rollover');
  const specialName = game.SPECIAL_SHIFTS[g._specialShift].name;
  ok(g.log.some(e => e.msg.includes(specialName)), 'special is announced in the log on night wrap');
  ok(g.log.some(e => e.msg.startsWith('Night ')), 'night-begin line still present');
});

test('save with an active special shift past the base length round-trips (blocking review fix)', () => {
  const game = newGame();
  const base = game.state.g;
  // After Hours (base len 30) overridden by Midweek Surge (len 34) — shiftT 32 is
  // past the base length but valid for the special. Previously completeImportedG
  // validated against the base length only, so this save was rejected and wiped.
  const g = game.fresh();
  g.shiftIdx = 3;
  g.shiftT = 32;
  g._specialShift = 1; // Midweek Surge
  const payload = {
    saveVer: game.SAVE_VER,
    ver: game.VERSION.num,
    build: game.VERSION.build,
    g
  };
  game.state.g = base;
  const ok = game.importSaveFromText(JSON.stringify(payload));
  strictEqual(ok, true, 'save with a longer active special imports');
  strictEqual(game.state.g._specialShift, 1, 'special index preserved');
  strictEqual(game.state.g.shiftT, 32, 'shiftT past base length preserved');
  strictEqual(game.state.g.shiftIdx, 3, 'base shift index preserved');
});

test('save with an invalid special index is sanitized, not rejected (fail-closed)', () => {
  const game = newGame();
  const base = game.state.g;
  const g = game.fresh();
  g.shiftIdx = 1;
  g.shiftT = 10; // within Peak Hours (len 55)
  g._specialShift = 99; // not a valid SPECIAL_SHIFTS index
  const payload = {
    saveVer: game.SAVE_VER,
    ver: game.VERSION.num,
    build: game.VERSION.build,
    g
  };
  game.state.g = base;
  const ok = game.importSaveFromText(JSON.stringify(payload));
  strictEqual(ok, true, 'save with a bad special index still imports');
  strictEqual(game.state.g._specialShift, null, 'invalid special index cleared');
  strictEqual(game.state.g.shiftT, 10, 'shiftT preserved against base length');
});

// ── Buzz→Patrons conversion cap scales with cap.buzz (issue #29) ─────────────

console.log('\nBuzz→Patrons cap scales with cap.buzz (issue #29)');

test('patrons rate stays positive at high Buzz with upgraded Marquee', () => {
  const game = newGame();
  const g = game.state.g;
  // Simulate the exact reported bug state: Buzz 2290/2290 (capped), Patrons 78.
  // cap.buzz = 50 + marquee*35 = 2290 → marquee = 64.
  // With the old flat 0.065 cap, basis = 0.065 forever and decay outruns it.
  // With the fix, basis cap = 2290 * 0.0013 = 2.977 → pull overwhelms decay.
  // Must also raise cap.patrons so there's room (space > 0) for growth.
  g.b.marquee = 64;         // cap.buzz = 50 + 2240 = 2290
  g.b.bar = 14;             // cap.patrons = 10 + 70 = 80 (room for patrons=78)
  g.buzz = 2290;            // matches the reported capped Buzz
  g.hype = 500;             // realistic late-game Hype
  g.patrons = 78;           // the exact reported stuck-at value
  const r = game.rates(g);
  ok(r.patrons > 0, `patrons rate ${r.patrons} must be positive at high Buzz (reported bug: 0.00/s at Buzz ${g.buzz}, Patrons ${g.patrons})`);
});

test('early-game Buzz→Patrons conversion stays bounded (no flooding)', () => {
  const game = newGame();
  const g = game.state.g;
  // Fresh game: no Marquee upgrades, tiny Buzz from starting click income.
  // cap.buzz = 50 → basis cap = 50 * 0.0013 = 0.065 — same as the original flat cap.
  g.b.marquee = 0;
  g.buzz = 0.03;            // tiny early-game buzz
  g.hype = 0;
  g.patrons = 0;
  const r = game.rates(g);
  // Without the cap, buzz=0.03 would give pull=0.03+0.02=0.05. With the cap
  // (0.065, same as before), buzz passes through directly since 0.03 < 0.065.
  ok(r.patrons < 0.10, `patrons rate ${r.patrons} must be modest at early-game Buzz ${g.buzz} (flooding guard)`);
  ok(r.patrons > 0, `patrons rate ${r.patrons} must be positive for tiny buzz`);
});

test('Buzz cap at marquee=0 equals the original 0.065 flat cap', () => {
  const game = newGame();
  const g = game.state.g;
  g.b.marquee = 0;          // cap.buzz = 50
  g.buzz = 500;             // well above the cap
  g.hype = 0;
  g.patrons = 0;
  const r0 = game.rates(g);
  // Expected: basis = min(500, 50*0.0013) = min(500, 0.065) = 0.065
  // pull = 0.065 * 1 + 0.02 = 0.085
  const expected = 0.065 * 1 + 0.02;  // no hype, no decay
  ok(Math.abs(r0.patrons - expected) < 0.0001,
     `patrons rate ${r0.patrons} must equal 0.085 at marquee=0 (cap.buzz 50 × 0.0013 = 0.065)`);
});

test('Marquee upgrades raise the Buzz→Patrons cap proportionally', () => {
  const game = newGame();
  const g = game.state.g;
  g.buzz = 500;             // above any sane cap
  g.hype = 0;
  g.patrons = 0;
  const ratesAt = (marquee) => {
    g.b.marquee = marquee;
    return game.rates(g).patrons;
  };
  const r0 = ratesAt(0);    // cap.buzz = 50, basis cap = 0.065
  const r2 = ratesAt(2);    // cap.buzz = 50+70 = 120, basis cap = 0.156
  const r4 = ratesAt(4);    // cap.buzz = 50+140 = 190, basis cap = 0.247
  ok(r2 > r0, `marquee=2 rate ${r2} must exceed marquee=0 rate ${r0}`);
  ok(r4 > r2, `marquee=4 rate ${r4} must exceed marquee=2 rate ${r2}`);
  // Verify ratios are exactly proportional (within float tolerance):
  // cap.buzz[2] / cap.buzz[0] = 120/50 = 2.4; cap.buzz[4] / cap.buzz[2] = 190/120 ≈ 1.583
  const expectedR2 = 0.065 * (120 / 50) + 0.02;
  const expectedR4 = 0.065 * (190 / 50) + 0.02;
  ok(Math.abs(r2 - expectedR2) < 0.0001, `marquee=2 rate ${r2} must match expected ${expectedR2}`);
  ok(Math.abs(r4 - expectedR4) < 0.0001, `marquee=4 rate ${r4} must match expected ${expectedR4}`);
});

console.log('\n───────────────────────────────────────');
console.log(`Results: ${passed} passed, ${skipped} skipped, ${failed} failed`);
console.log('───────────────────────────────────────\n');

if (failed > 0) {
  console.error('❌ Some tests failed.\n');
  process.exit(1);
}
console.log(passed > 0 ? '✅ All non-skipped tests passed.\n' : '✅ All tests either passed or were skipped.\n');
process.exit(0);
