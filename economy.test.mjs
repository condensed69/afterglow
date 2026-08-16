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
  // SAVE_VER 9: state.g is the clubs-map shape. game.js's own wrapState (club
  // proxy) handles flat-g reads against the ACTIVE club and survives every
  // state.g replacement (prestige/reset/import) — no override needed here.
  // fresh() is wrapped so direct candidate mutations (g.cash = 777) land in the
  // active club like live code, and JSON payloads built from it serialize as v9.
  const rawFresh = game.fresh.bind(game);
  game.fresh = () => game.wrapState(rawFresh());
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
  let completed = false;
  try {
    const result = fn();
    completed = true;
    return result;
  } finally {
    Math.random = orig;
    // A multi-value list is a per-draw script: value 1 for the first roll, value 2
    // for the second, and so on. Drawing past the end silently wraps to values[0]
    // and re-fires whatever that value was chosen to trigger — the test then passes
    // because the wrap-around value happened to be benign, not because anyone picked
    // it. That is how `critic fires at night rollover during a live step` sat at 6
    // draws against a 4-value script with a comment claiming 4.
    //
    // A single-value list is the separate, deliberate idiom "pin Math.random to this
    // constant for the whole block", where cycling is the point. Only scripts are
    // checked.
    //
    // Guarded on `completed` because a throw from `finally` discards whatever
    // exception is already in flight. A test that fails an assertion is exactly the
    // test most likely to have drawn a different number of times than its author
    // assumed, so without this the overrun message would replace the assertion
    // failure at the moment the assertion failure is the thing you need to read.
    // The overrun is reported only when fn() returned normally.
    if (completed && values.length > 1 && i > values.length) {
      throw new Error(
        `withRandom script overrun: ${i} draws against ${values.length} supplied values. ` +
        `Draws past the end wrap to values[0] (${values[0]}) and can re-fire it. ` +
        `Supply one value per draw, or pass a single-value list to pin the RNG.`);
    }
  }
}

// Freeze Date.now for the duration of fn(), which receives the frozen value.
// init() computes `offline = (now - g.ts) / 1000` with no minimum threshold
// (game.js:1068), so a save written with `ts: Date.now()` and loaded a moment
// later measures however long the harness happened to take — sub-millisecond on
// a dev box, long enough on a loaded CI runner to accrue real resources and
// break an exact-value assertion. Frozen, a test picks its own gap by writing
// `ts: t - ms` and gets the same window every run.
//
// Note the gap must stay > 0 where the load-time achievement backfill is under
// test: that backfill lives inside init()'s `if (offline > 0 && claimed)` branch,
// so a zero gap skips it.
function withFrozenNow(fn) {
  const orig = Date.now;
  const t = orig();
  Date.now = () => t;
  try { return fn(t); } finally { Date.now = orig; }
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
  const c = g.clubs.main;
  // Resources are split: cash..regulars are per-club, clout is account-level.
  for (const k of resourceNames()) ok(k in c || k in g, `missing key: ${k}`);
  ok('jobs' in g, 'missing jobs');
  ok('clubs' in g, 'missing clubs map');
  ok('activeClub' in g, 'missing activeClub');
  ok('b' in c, 'missing buildings map');
  ok('u' in c, 'missing upgrades map');
  ok('r' in g, 'missing research map');
  ok('elapsed' in c, 'missing elapsed');
  ok('night' in c, 'missing night');
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
  strictEqual(boostedMult, 1.75);
  ok(Math.abs(boosted - base * 1.75) < 0.0001, 'rates().cash scales by 1.75x at cash10 rank 5 (15%/rank)');
});

test('achievementMult counts unique non-burst achievements (milk multiplier)', () => {
  const game = newGame();
  const g = game.state.g;
  strictEqual(game.achievementMult(g), 1, '1.00x at 0 achievements');
  g.achievements = game.ACHIEVEMENTS.map(a => a.id);
  ok(Math.abs(game.achievementMult(g) - 1.34) < 1e-9, '1.34x at all 38 (34 non-burst)');
  g.achievements = game.ACHIEVEMENTS.map(a => a.id).concat(['first_rail', 'first_rail']);
  ok(Math.abs(game.achievementMult(g) - 1.34) < 1e-9, 'duplicate ids ignored');
  g.achievements = ['whale_1', 'whale_10', 'special_1', 'special_5'];
  strictEqual(game.achievementMult(g), 1, 'burst achievements excluded');
});

test('achievement multiplier scales rates().cash alongside cashIncomeMult', () => {
  const game = newGame(1000);
  const g = game.state.g;
  g.b.rail = 2;
  g.b.bar = 1;
  g.patrons = 10;
  const base = game.rates(g).cash;
  const nonBurst = game.ACHIEVEMENTS.filter(a => !a.burst).map(a => a.id).slice(0, 10);
  g.achievements = nonBurst;
  const boosted = game.rates(g).cash;
  ok(Math.abs(boosted - base * 1.10) < 0.0001, 'rates().cash scales by 1.10x at 10 non-burst achievements');
});

test('whale and golden event cash scales by the milk multiplier (totalCashMult)', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 50;
  g.achievements = game.ACHIEVEMENTS.filter(a => !a.burst).map(a => a.id).slice(0, 10);
  // Whale bonus: floor(50 × (1 + hype/100) × totalCashMult). No RNG in
  // spawnWhale, so no withRandom needed; measure the cash delta because
  // checkAchievements can credit rewards on the same call.
  const whaleMult = game.totalCashMult(g);
  const beforeWhale = g.cash;
  game.spawnWhale(g);
  ok(Math.abs((g.cash - beforeWhale) - Math.floor(50 * 1.5 * whaleMult)) < 0.0001, 'spawnWhale cash scales by totalCashMult');
  // Golden tip: floor(25 × totalCashMult). Re-seed achievements so any unlock
  // during spawnWhale's checkAchievements pass can't shift the multiplier.
  g.achievements = game.ACHIEVEMENTS.filter(a => !a.burst).map(a => a.id).slice(0, 10);
  const goldenMult = game.totalCashMult(g);
  g.golden = { at: Date.now(), club: g.activeClub };
  const beforeGolden = g.cash;
  game.takeGolden(g, 'cash');
  ok(Math.abs((g.cash - beforeGolden) - Math.floor(25 * goldenMult)) < 0.0001, 'takeGolden cash scales by totalCashMult');
});

test('flavor tables are well-formed (FLAVOR/REGULAR_NAMES)', () => {
  const game = newGame();
  const g = game.state.g;
  const c = game.club(g);
  ok(game.FLAVOR.length >= 8, 'FLAVOR has enough lines');
  for (const f of game.FLAVOR) {
    ok(typeof f.cond === 'function', 'each FLAVOR entry has a cond');
    ok(typeof f.text === 'string' && f.text.length > 0, 'each FLAVOR entry has text');
  }
  ok(game.FLAVOR.some(f => f.cond(g, c)), 'catch-all line guarantees a ticker string');
  ok(game.REGULAR_NAMES.length >= 15, 'REGULAR_NAMES pool is large enough');
  ok(new Set(game.REGULAR_NAMES).size === game.REGULAR_NAMES.length, 'REGULAR_NAMES are unique');
});

test('regularName derives deterministically from regulars count', () => {
  const game = newGame();
  const g = game.state.g;
  strictEqual(game.regularName(g), null, 'no name below 5 regulars');
  g.regulars = 4;
  strictEqual(game.regularName(g), null, 'still no name at 4');
  g.regulars = 5;
  const first = game.regularName(g);
  ok(typeof first === 'string' && first.length > 0, 'name appears at 5 regulars');
  strictEqual(game.regularName(g), first, 'deterministic at same count');
  g.regulars = 9;
  strictEqual(game.regularName(g), first, 'same name through 9 regulars');
  g.regulars = 10;
  ok(game.regularName(g) !== first, 'new name at 10 regulars');
});

test('flavorLine returns a non-empty deterministic ticker line', () => {
  const game = newGame();
  const g = game.state.g;
  const c = game.club(g);
  const line = game.flavorLine(g, c, 0);
  ok(typeof line === 'string' && line.length > 0, 'ticker line is non-empty');
  strictEqual(game.flavorLine(g, c, 0), line, 'deterministic for same tick');
  // Mid-game state: several FLAVOR conds fire, and the ~3s rotation cycles them.
  g.regulars = 30;
  g.hype = 100;
  g.patrons = 50;
  const seen = new Set();
  for (let t = 0; t < 600; t += 30) seen.add(game.flavorLine(g, c, t));
  ok(seen.size >= 3, 'ticker rotates through multiple applicable lines');
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
  // withRandom is required, not decorative: catchUp crosses a shift boundary in
  // this window and advanceShift rolls SPECIAL_CHANCE there. Unstubbed, the two
  // arms get different shift schedules, and a low-multiplier special landing on
  // the boosted arm sinks it below the base arm — a real ~5% flake this test had
  // before. 1 is never < SPECIAL_CHANCE, so neither arm gets a special and the
  // comparison isolates the 0.5 → 0.65 offline rate, which is what it claims.
  withRandom([1], () => {
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

// Same regression class as PR #30, one surface later: the 0.10.5 golden-ticket
// badge built its claim closures inside render() (no `g` in scope) instead of
// renderVals(). That throws only when the button is clicked, so a render smoke
// test alone is not enough — the click-through below is the part that bites.
test('renderVals() exposes golden claim actions and an integer crowd preview', () => {
  const game = newGame(500);
  const g = game.state.g;
  g.golden = { at: Date.now() };
  g.patrons = 2.6667; // sim keeps patrons fractional
  const v = game.renderVals();
  strictEqual(typeof v.takeGoldenCash, 'function', 'cash claim is a bound action on v');
  strictEqual(typeof v.takeGoldenCrowd, 'function', 'crowd claim is a bound action on v');
  strictEqual(
    v.golden.crowdAmount, Math.round(v.golden.crowdAmount),
    'crowd preview is rounded, not a raw float',
  );
});

test('render() does not throw with the golden-ticket badge expanded', () => {
  const game = newGame(500);
  game.state.g.golden = { at: Date.now() };
  game.state.goldenOpen = true;
  game.render(); // assertion is that this call does not throw
});

// ── Guardrail: templates read the view model, never `g` ──────────────────────
// This bug class has shipped twice (PR #30 prestige modal, PR #43 golden badge).
// A template that references the bare identifier `g` parses fine and renders
// fine, then throws `ReferenceError: g is not defined` inside the delegated
// click handler — so it survives every render smoke test and only fails when a
// player actually clicks. DESIGN.md §14.4 states the rule; these two tests
// enforce it. The static check pins the exact cause; the sweep catches the
// general case wherever a handler is built.

function renderMethodSource() {
  const start = src.indexOf('\n  render() {');
  ok(start !== -1, 'located render() in game.js');
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error('render() braces never balanced');
}

test('render() never references the bare identifier `g`', () => {
  // render() has only `v` (the renderVals() output) in scope. Anything a
  // template needs from game state must be built in renderVals() and exposed
  // on `v`. Bare `g` here is the exact shape of both shipped regressions.
  const body = renderMethodSource();
  const offenders = [];
  const bareG = /(?<![\w.$])g(?![\w$])/g;
  let m;
  while ((m = bareG.exec(body)) !== null) {
    const line = body.slice(0, m.index).split('\n').length;
    offenders.push(`render()+${line}: ${body.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\n/g, ' ')}`);
  }
  strictEqual(
    offenders.length, 0,
    `render() must not reference \`g\` — build the value in renderVals() and read it off \`v\`:\n  ${offenders.join('\n  ')}`,
  );
});

// A game with everything unlocked, so no surface renders its locked/empty
// branch and every card, stepper, and modal body is reachable.
function unlockedGame() {
  const game = newGame(1e6);
  const g = game.state.g;
  g.crew = 4;
  g.jobs = { stage: 1, vipjob: 1, floor: 1, off: 1 }; // must sum to crew
  g.hype = 60; g.buzz = 40; g.patrons = 20; g.regulars = 30;
  g.clout = 500; g.legacy = 10; g.legacyTotal = 10; g.prestiges = 1;
  g.rounds = 1; g.clicks = 10;
  for (const b of game.BUILDINGS) g.b[b.id] = 1;
  g.golden = { at: Date.now() };
  return game;
}

// Surfaces are DISCOVERED, not listed. Tabs come from the view model's own tab
// array (activated through each tab's `go` action, so the test never has to
// know a tab id — an earlier hand-written list silently used 'upgrades' and
// 'research' when the real ids are 'up' and 'res', and swept the wrong tab
// twice). Modal/overlay surfaces come from every boolean flag on game.state.
// Add a modal → add a `show*` flag → it is swept, with no test edit.
function discoverSurfaces() {
  const probe = unlockedGame();
  const tabCount = probe.renderVals().tabs.length;
  const flags = Object.keys(probe.state).filter(k => typeof probe.state[k] === 'boolean');

  const surfaces = [];
  for (let i = 0; i < tabCount; i++) {
    surfaces.push({
      name: `tab #${i}`,
      setup: game => { game.renderVals().tabs[i].go(); },
    });
  }
  for (const flag of flags) {
    surfaces.push({ name: `state.${flag}`, setup: game => { game.state[flag] = true; } });
  }
  // Dependent pairs (e.g. resetArmed only means anything inside the settings
  // modal) without enumerating which depends on which.
  surfaces.push({
    name: 'all flags at once',
    setup: game => { for (const f of flags) game.state[f] = true; },
  });

  return { surfaces, tabCount, flagCount: flags.length };
}

test('handler sweep discovers every surface without a hand-maintained list', () => {
  // Guards the discovery itself: if a refactor stops exposing tabs on the view
  // model, or renames the state booleans, the sweep below would quietly shrink
  // to nothing and keep passing.
  const { tabCount, flagCount } = discoverSurfaces();
  ok(tabCount >= 5, `discovered every tab including Perks (got ${tabCount})`);
  ok(flagCount >= 6, `discovered the UI state booleans (got ${flagCount})`);
});

test('every bound click handler is invocable without a scope error', () => {
  // render() populates game.handlers via bind(); the delegated listener looks
  // each one up by its data-h index and calls it. Calling them all here is the
  // click-through a render smoke test cannot do. We only care about scope
  // errors — a handler is free to throw for missing-DOM reasons in this
  // harness, and destructive actions run against a throwaway in-memory game.
  const { surfaces } = discoverSurfaces();
  const failures = [];
  let invoked = 0;

  for (const surface of surfaces) {
    const game = unlockedGame();
    surface.setup(game);
    game.render();

    // Snapshot: invoking a handler may mutate state, but each closure stays
    // valid across renders exactly as it does in the browser.
    const handlers = game.handlers.slice();
    ok(handlers.length > 0, `${surface.name} bound at least one handler`);

    handlers.forEach((fn, i) => {
      if (typeof fn !== 'function') {
        failures.push(`${surface.name} handler ${i} is ${typeof fn}, not a function`);
        return;
      }
      invoked++;
      try {
        fn({ shiftKey: false, preventDefault: () => {}, stopPropagation: () => {} });
      } catch (e) {
        if (e instanceof ReferenceError) {
          failures.push(`${surface.name} handler ${i} — ${e.message}`);
        }
        // Anything else is a missing-DOM artifact of the harness, not a scope bug.
      }
    });
  }

  ok(invoked > 200, `swept a meaningful number of handlers (got ${invoked})`);
  strictEqual(
    failures.length, 0,
    `handlers threw a scope error on click — the template captured game state render() does not have:\n  ${failures.join('\n  ')}`,
  );
});

test('fresh club keeps Club + Crew tabs; Upgrades/Research appear on unlock', () => {
  const game = newGame(10);
  const labels = () => game.renderVals().tabs.map(t => t.label);
  ok(labels().includes('Club'), 'Club tab always visible');
  ok(labels().includes('Crew'), 'Crew tab always visible (stage CTA routes to it)');
  ok(!labels().includes('Upgrades'), 'Upgrades hidden before first building');
  ok(!labels().includes('Research'), 'Research hidden before first Clout');

  // Unlock path: first building reveals Upgrades, first Clout reveals Research.
  game.state.g.b.rail = 1;
  ok(labels().includes('Upgrades'), 'Upgrades appears after first building');
  ok(!labels().includes('Research'), 'Research still hidden without Clout');

  game.state.g.clout = 1;
  ok(labels().includes('Research'), 'Research appears after first Clout');

  // The stage CTA must never point at a tab missing from the bar.
  const v = game.renderVals();
  if (v.stageLineAct) {
    ok(labels().includes('Crew'), 'stage CTA target (crew) is visible in the tab bar');
  }
});

test('ledger collapses to CASH row by default and toggles open', () => {
  const game = newGame(20);
  const v = game.renderVals();
  strictEqual(v.ledgerOpen, false, 'ledger starts collapsed on narrow screens');
  ok(v.resources.length >= 2, 'ledger has CASH plus other resources');
  strictEqual(typeof v.toggleLedger, 'function', 'toggle action exposed');

  v.toggleLedger();
  strictEqual(game.renderVals().ledgerOpen, true, 'toggle expands the ledger');
  v.toggleLedger();
  strictEqual(game.renderVals().ledgerOpen, false, 'toggle collapses again');

  // CASH is always the first resource row — the one that stays visible collapsed.
  ok(v.resources[0].name.includes('Cash'), 'CASH row first in the ledger');
});

test('golden claim actions from renderVals() resolve the offer when invoked', () => {
  const game = newGame(500);
  const g = game.state.g;

  g.golden = { at: Date.now() };
  game.renderVals().takeGoldenCash();
  strictEqual(g.golden, null, 'cash claim resolved the offer');

  g.golden = { at: Date.now() };
  game.renderVals().takeGoldenCrowd();
  strictEqual(g.golden, null, 'crowd claim resolved the offer');
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

test('buyBuilding(def, count) respects building max cap', () => {
  const game = newGame(99999);
  const door = buildingById(game, 'door');
  // Door Staff max is 6 (or 7 with doorPlus). Buy 10, expect cap.
  game.buyBuilding(door, 10);
  const max = game.doorMax(game.state.g);
  strictEqual(game.state.g.b.door, max, `buyBuilding(door, 10) stops at cap (${max})`);
});

test('buyBuilding(def, count) only buys what cash allows', () => {
  const game = newGame(500);
  const rail = buildingById(game, 'rail');
  game.buyBuilding(rail, 10);
  ok(game.state.g.b.rail >= 1, 'at least one rail bought');
  ok(game.state.g.b.rail < 10, 'cannot afford 10 rails from $500');
  ok(game.state.g.cash >= 0, 'cash never negative');
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
  game._live = true; // 0.10.19: the special roll is live-only (pacing-bot determinism)
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
  game._live = true; // 0.10.19: the special roll is live-only (pacing-bot determinism)
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

test('special_1 does not unlock when completing Work the room goal (no special shift)', () => {
  const game = newGame(20);
  const g = game.state.g;
  // Complete "Work the room" goal by clicking 5 times, then run the same
  // noteGoals + checkAchievements pair every real call site uses.
  g.clicks = 5;
  g.specialsCount = 0;
  game.noteGoals(g);
  ok(g.goals.includes('work'), 'Work the room goal actually completed');
  game.checkAchievements(g);
  ok(!g.achievements.includes('special_1'), 'special_1 (Surprise Hit) must not unlock from tutorial completion');
  strictEqual(g.specialsCount, 0, 'specialsCount must remain 0 after tutorial goal');
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
  // rave +2 Clout, plus hype_50 (Buzzing) completes immediately via the
  // handler-pattern checkAchievements → +1 more.
  strictEqual(g.clout, 3, 'rave grants +2 Clout, hype_50 completes immediately');
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
  // step(0.1) runs TWO slices here, not one: shiftT starts 0.05 short of the shift
  // length, so the first slice rolls the shift over and a second slice runs after it.
  // Slice 1 rolls whale (0.99 no), golden (0.99 no), special rollover (0.99 no),
  // critic (0.0 yes — the behavior under test). Slice 2 rolls whale and golden again;
  // it does not re-roll the rollover or critic, having already crossed the boundary.
  // All six are supplied explicitly. Before, only four were, and draws 5-6 wrapped
  // back to values[0..1] — benign only because both are 0.99. withRandom now throws
  // on a script overrun rather than wrapping, so this cannot silently regress.
  withRandom([0.99, 0.99, 0.99, 0.0, 0.99, 0.99], () => game.step(0.1));
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
  // 0.10.19: count actual Math.random calls instead of pinning a single all-hit
  // value. withRandom's overrun throw only guards multi-value scripts (single-value
  // lists cycle by design), so [0.0] would still pass if a non-live path drew a
  // random that happened not to fire the asserted events. A spy asserting ZERO
  // draws is the tightest determinism pin: any leaked roll — whale, special-shift,
  // critic, golden, or a future event — fails the count.
  const origRandom = Math.random;
  let draws = 0;
  Math.random = () => { draws++; return 0.0; };
  try {
    game.step(0.1);
  } finally {
    Math.random = origRandom;
  }
  strictEqual(draws, 0, 'bot path draws zero randoms (whale/special/critic/golden all gated)');
  strictEqual(g.golden, null, 'no golden offer in bot path');
  ok(g.clout < 0.001, 'no critic clout in bot path');
  strictEqual(g._specialShift, null, 'no special shift in bot path');
  strictEqual(g.whalesCount || 0, 0, 'no whale spawn in bot path');
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

test('maybeGolden scales its roll by chunk like the whale roll', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 50;
  // Partial chunk (0.05s): scaled chance = 0.001 * 0.05/0.1 = 0.0005.
  withRandom([0.0004], () => { game.maybeGolden(g, 0.05); });
  ok(g.golden, 'roll under the scaled threshold spawns');
  g.golden = null;
  withRandom([0.0006], () => { game.maybeGolden(g, 0.05); });
  strictEqual(g.golden, null, 'partial chunk uses the scaled (lower) chance — a flat 0.1% roll would have spawned');
  // Full chunk (SIM = 0.1s): chance back to the documented 0.1%.
  withRandom([0.0009], () => { game.maybeGolden(g, 0.1); });
  ok(g.golden, 'full chunk rolls at the documented 0.1%');
});

test('takeGolden runs achievement checks after resolving (like other handlers)', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.golden = { at: Date.now() };
  let calls = 0;
  const orig = game.checkAchievements;
  game.checkAchievements = () => { calls++; };
  try {
    game.takeGolden(g, 'cash');
  } finally {
    game.checkAchievements = orig;
  }
  strictEqual(calls, 1, 'achievement check ran once');
  strictEqual(g.golden, null, 'offer resolved');
});

test('catchUp clears a golden offer whose TTL lapsed offline', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.golden = { at: Date.now() - (game.GOLDEN_TTL * 1000 + 5000) };
  game.catchUp(g, 10);
  strictEqual(g.golden, null, 'expired offer cleared on offline catch-up');
  g.golden = { at: Date.now() };
  game.catchUp(g, 10);
  ok(g.golden, 'fresh offer survives offline');
});

test('_live flag is restored even when step throws (hard-gate invariant)', () => {
  const game = newGame(20);
  const g = game.state.g;
  const orig = game.step;
  game.step = () => { throw new Error('boom'); };
  let threw = false;
  try { game.liveStep(g, 0.1); } catch (e) { threw = true; }
  game.step = orig;
  strictEqual(threw, true, 'step threw');
  strictEqual(game._live, false, '_live restored by finally — hard gate cannot stick open');
});

test('critic rave resolves goals/achievements immediately (handler pattern)', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.hype = 45; // rave bonus floor(8 + 45*0.08) = 11 → crosses hype_50 (50)
  g.patrons = 25; g.b.bar = 4; g.clout = 0;
  withRandom([0.0], () => { game.maybeCritic(g); }); // 0.0 < 0.02 → fires
  ok(g.hype >= 50, 'rave crossed the hype_50 threshold');
  ok(Array.isArray(g.achievements) && g.achievements.includes('hype_50'),
    'achievement completed inside maybeCritic, not one tick later');
  ok(g.clout >= 3, 'rave +2 clout plus achievement reward credited immediately');
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

test('init backfills achievements on existing current-format save', () => withFrozenNow((t) => {
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
      // Exactly 1s of offline, every run: enough to enter init()'s backfill
      // branch, short enough that the exact clout assertion below stays exact.
      elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: t - 1000,
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
}));

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

test('door cover does not alternate an underfunded strike into production', () => {
  const game = newGame(0);
  const g = game.state.g;
  g.crew = 2;
  g.jobs = { stage: 1, vipjob: 0, floor: 1, off: 0 };
  g.patrons = 8; // cover 8×0.02 = 0.16/s gross (0.112 net at Early Doors) < wage 0.40
  game.step(1);
  ok(g.cash > 0, 'non-crew door-cover revenue accumulates during strike');
  const hype = g.hype;
  const buzz = g.buzz;
  game.step(1);
  strictEqual(game.rates(g).strike, true, 'crew remain on strike with positive cover cash');
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

// 0.10.19 — PLAN §1.6 "no uncapped patrons×0.012" is superseded: the door take is
// now a per-patron cover (patrons × 0.02) REPLACING the flat 0.08 trickle, so an
// empty room earns ~nothing (no free money) while a packed floor pays more at any
// size. Patron TIPS still only via rail (that part of §1.6 stands).
test('patrons pay door cover scaled by head count, empty room earns nothing', () => {
  const game = newGame(100);
  const g = game.state.g;
  g.b.rail = 0;
  g.b.bar = 0;
  g.b.vip = 0;
  g.crew = 0;
  g.jobs = { stage: 0, vipjob: 0, floor: 0, off: 0 };
  g.hype = 0;
  g.regulars = 0;
  g.shiftIdx = 0; // Early Doors mult 0.7
  g.u = {};
  g.patrons = 0;
  let r = game.rates(g);
  strictEqual(r.cash, 0, 'empty room earns no door money (cover replaces flat 0.08)');
  g.patrons = 100;
  r = game.rates(g);
  // cashMult = 1 * 1 * 0.7; expected cover = 100 * 0.02 * 0.7 = 1.40 (no rail tips)
  const expected = 100 * 0.02 * 0.7;
  ok(Math.abs(r.cash - expected) < 1e-9,
    `uncapped cover: cash=${r.cash}, expected ${expected}`);
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

test('pacing anchors: loop cheapest research, residency most expensive upgrade (0.10.18 balance)', () => {
  // 0.10.18 balance pass pins the two pacing knobs so future retunes are
  // deliberate: Reputation Loop (cost 12) is the first research bought — it
  // anchors the "first research" milestone — and Weekly Residency (cost 8000)
  // is the last upgrade bought under the §C bot's cheapest-first policy, so it
  // anchors "all upgrades owned". Residency must stay the max so the milestone
  // bottleneck cannot silently move to Bottle Service.
  const game = newGame(1e9);
  const loop = game.RESEARCH.find(r => r.id === 'loop');
  const residency = game.UPGRADES.find(u => u.id === 'residency');
  ok(loop, 'loop research must exist');
  ok(residency, 'residency upgrade must exist');
  strictEqual(loop.cost, 12, 'loop cost pins the first-research gate (~22m under §C bot)');
  strictEqual(residency.cost, 8000, 'residency cost pins the all-upgrades gate (~46m under §C bot)');
  const researchCosts = game.RESEARCH.map(r => r.cost);
  strictEqual(Math.min(...researchCosts), loop.cost, 'loop stays the cheapest research (milestone anchor)');
  const upgradeCosts = game.UPGRADES.map(u => u.cost);
  strictEqual(Math.max(...upgradeCosts), residency.cost, 'residency stays the most expensive upgrade (milestone anchor)');
});

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
  strictEqual(stored.g.clubs.main.cash, 777);
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

test('SAVE_VER is 10', () => {
  const game = newGame();
  strictEqual(game.SAVE_VER, 10);
  ok(typeof game.MIGRATIONS[3] === 'function', 'MIGRATIONS[3] must exist');
  ok(typeof game.MIGRATIONS[4] === 'function', 'MIGRATIONS[4] must exist (Owner\'s List)');
  ok(typeof game.MIGRATIONS[5] === 'function', 'MIGRATIONS[5] must exist (prestige)');
  ok(typeof game.MIGRATIONS[6] === 'function', 'MIGRATIONS[6] must exist (achievements)');
  ok(typeof game.MIGRATIONS[7] === 'function', 'MIGRATIONS[7] must exist (managers)');
  ok(typeof game.MIGRATIONS[8] === 'function', 'MIGRATIONS[8] must exist (clubs map)');
  ok(typeof game.MIGRATIONS[9] === 'function', 'MIGRATIONS[9] must exist (Renown)');
});

test('v8 save migrates to the current version: club fields land in clubs.main, account fields stay', () => {
  const game = newGame(20);
  const v8 = {
    cash: 555, hype: 12, buzz: 4, patrons: 3, regulars: 1.5, clout: 2, crew: 1,
    jobs: { stage: 1, vipjob: 0, floor: 0, off: 0 },
    b: { rail: 2, flyers: 1 }, u: { led: true }, r: { loop: true },
    elapsed: 300, night: 3, shiftIdx: 2, shiftT: 9, log: [], ts: Date.now(),
    goals: [], clicks: 5, rounds: 1, achievements: ['first_rail']
  };
  const okImport = game.importSaveFromText(JSON.stringify({ saveVer: 8, ver: '0.10.21', build: 212, g: v8 }));
  strictEqual(okImport, true);
  const g = game.state.g;
  // v9 shape: club fields nested, account fields top-level.
  strictEqual(g.clubs.main.cash, 555);
  strictEqual(g.clubs.main.hype, 12);
  strictEqual(g.clubs.main.b.rail, 2);
  strictEqual(g.clubs.main.u.led, true);
  strictEqual(g.clubs.main.shiftIdx, 2);
  strictEqual(g.clubs.main.night, 3);
  strictEqual(g.activeClub, 'main');
  // Flat reads still work through the compat layer.
  strictEqual(g.cash, 555);
  strictEqual(g.b.rail, 2);
  // Account fields stayed put.
  strictEqual(g.clout, 2);
  strictEqual(g.crew, 1);
  strictEqual(g.r.loop, true);
  // Persisted save is stamped v10 and carries the clubs shape, no flat leftovers.
  const stored = JSON.parse(localStorage.getItem(game.KEY));
  strictEqual(stored.saveVer, 10);
  strictEqual(stored.g.clubs.main.cash, 555);
  ok(!('cash' in stored.g), 'no flat cash in persisted save');
  ok(!('b' in stored.g), 'no flat b in persisted save');
  // The v9 → v10 step ran: Renown fields exist on the upgraded state.
  strictEqual(stored.g.renown, 0, 'renown defaulted by migration');
  strictEqual(stored.g.renownTotal, 0, 'renownTotal defaulted by migration');
  ok(stored.g.brand && typeof stored.g.brand === 'object', 'brand defaulted by migration');
});

test('club(g) resolves active club with main fallback; flat reads follow activeClub', () => {
  const game = newGame(20);
  const g = game.state.g;
  strictEqual(game.club(g), g.clubs.main, 'default id = active club');
  strictEqual(game.club(g, 'annex'), g.clubs.main, 'unknown id falls back to main');
  g.clubs.annex = { ...g.clubs.main, cash: 42 };
  strictEqual(game.club(g, 'annex').cash, 42, 'explicit valid id resolves');
  // Pre-v9 shape (no clubs map) falls back to g itself.
  const flat = { cash: 1, b: {} };
  strictEqual(game.club(flat), flat, 'no clubs → g itself');
  strictEqual(game.club(flat, 'main'), flat);
  // Switching activeClub re-routes flat reads and the accessor together.
  g.activeClub = 'annex';
  strictEqual(game.club(g).cash, 42);
  strictEqual(g.cash, 42, 'flat read follows activeClub through the compat layer');
  // Inherited Object.prototype keys ('constructor', ...) must never resolve to a
  // club entry — fail closed to main, not to a function.
  g.activeClub = 'constructor';
  strictEqual(game.club(g), g.clubs.main, "inherited key can't hijack activeClub");
  strictEqual(g.cash, 20, 'flat reads land on main for an inherited activeClub');
  strictEqual(game.club(g, 'toString'), g.clubs.main, 'toString falls back to main');
  g.activeClub = 'main';
});

test('v9 import rejects an EMPTY clubs map (no usable club)', () => {
  const game = newGame(20);
  const payload = JSON.stringify({
    saveVer: 9,
    g: {
      clubs: {},
      activeClub: 'main',
      clout: 0, crew: 0,
      jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      goals: [], clicks: 0, rounds: 0
    }
  });
  strictEqual(game.importSaveFromText(payload), false, 'empty clubs map is malformed, not a fresh start');
  strictEqual(game.state.g.clubs.main.cash, 20, 'live club untouched by rejected import');
});

test('prestige resets run state but preserves every club and activeClub', () => {
  const game = newGame(20);
  const g = game.state.g;
  const f = game.fresh().clubs.main;
  g.clubs.annex = { ...f, b: { ...f.b }, u: { ...f.u }, cash: 500 };
  g.activeClub = 'annex';
  g.clubs.annex.b.rail = 3;
  g.clubs.annex.regulars = 40;
  g.clubs.main.regulars = 10;
  game.confirmPrestige();
  const a = game.state.g;
  ok(a.clubs.annex, 'annex survives prestige');
  ok(a.clubs.main, 'main survives prestige');
  strictEqual(a.activeClub, 'annex', 'activeClub preserved');
  strictEqual(a.clubs.annex.b.rail, 0, 'annex run buildings reset');
  strictEqual(a.clubs.annex.regulars, 0, 'annex run regulars reset');
  strictEqual(a.clubs.main.regulars, 0, 'main run regulars reset');
  strictEqual(a.clubs.annex.cash, 20, 'annex cash back to startingCash');
  strictEqual(a.prestiges, 1, 'prestige counted');
});

test('v9 import resolves activeClub to an existing own club when main is absent', () => {
  const game = newGame(20);
  const f = game.fresh().clubs.main;
  const payload = JSON.stringify({
    saveVer: 9,
    g: {
      clubs: { annex: { ...f, cash: 88 } },
      clout: 0, crew: 0,
      jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      goals: [], clicks: 0, rounds: 0
    }
  });
  strictEqual(game.importSaveFromText(payload), true, 'annex-only map imports');
  strictEqual(game.state.g.activeClub, 'annex', 'activeClub resolved to the existing club, not a phantom main');
  strictEqual(game.state.g.cash, 88, 'flat reads hit the resolved club');

  // Unknown activeClub id behaves the same.
  const game2 = newGame(20);
  const payload2 = JSON.stringify({
    saveVer: 9,
    g: {
      clubs: { annex: { ...f, cash: 88 } },
      activeClub: 'nowhere',
      clout: 0, crew: 0,
      jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      goals: [], clicks: 0, rounds: 0
    }
  });
  strictEqual(game2.importSaveFromText(payload2), true, 'unknown activeClub id imports');
  strictEqual(game2.state.g.activeClub, 'annex', 'unknown id falls back to an existing club');
});

test('v9 import rejects reserved club IDs like __proto__ (no prototype pollution)', () => {
  const game = newGame(20);
  // JSON.parse creates an own '__proto__' DATA property (object literals would
  // invoke the setter instead) — this is exactly the hostile payload shape.
  const evil = JSON.parse('{"saveVer":9,"g":{"clubs":{' +
    '"__proto__":{"cash":50,"hype":0,"buzz":0,"patrons":0,"regulars":0,"elapsed":0,"night":1,"shiftIdx":0,"shiftT":0},' +
    '"main":{"cash":20,"hype":0,"buzz":0,"patrons":0,"regulars":0,"elapsed":0,"night":1,"shiftIdx":0,"shiftT":0}},' +
    '"activeClub":"__proto__","clout":0,"crew":0,"jobs":{"stage":0,"vipjob":0,"floor":0,"off":0},' +
    '"goals":[],"clicks":0,"rounds":0}}');
  strictEqual(game.importSaveFromText(JSON.stringify(evil)), false, 'reserved club id rejected fail-closed');
  strictEqual(game.state.g.activeClub, 'main', 'live club untouched');
  strictEqual(Object.prototype.hasOwnProperty.call(game.state.g.clubs, '__proto__'), false, 'no own __proto__ entry created');
});

test('second room gate: prestiges >= 1 AND at least one manager (account-level)', () => {
  const game = newGame(20);
  const g = game.state.g;
  strictEqual(game.canOpenRoom(), false, 'fresh account: gate closed');
  g.prestiges = 1;
  strictEqual(game.canOpenRoom(), false, 'prestige alone is not enough');
  g.managers.rail = true;
  strictEqual(game.canOpenRoom(), true, 'franchise + one manager opens the gate');
  g.clubs.annex = game.freshClubState();
  strictEqual(game.canOpenRoom(), false, 'annex already open: one-time unlock');
});

test('openRoom → confirmOpenRoom unlocks the annex; first club untouched', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.prestiges = 1;
  g.managers.rail = true;
  g.cash = 500;
  g.b.rail = 2;
  g.regulars = 30;
  game.openRoom();
  strictEqual(game.state.showOpenRoom, true, 'modal opens when gate met');
  game.confirmOpenRoom();
  const a = game.state.g;
  ok(a.clubs.annex, 'annex created');
  strictEqual(a.activeClub, 'main', 'active club unchanged by unlock');
  strictEqual(a.clubs.main.cash, 500, 'first club untouched');
  strictEqual(a.clubs.main.b.rail, 2, 'first club buildings untouched');
  strictEqual(a.clubs.annex.cash, 20, 'annex starts at starting cash');
  strictEqual(a.clubs.annex.b.rail, 0, 'annex starts empty');
  strictEqual(a.clubs.annex.night, 1, 'annex night baseline');
  strictEqual(game.state.showOpenRoom, false, 'modal closed after confirm');

  // tabStale blocks both open and confirm (no account progress in memory).
  const game2 = newGame(20);
  game2.state.tabStale = true;
  game2.state.g.prestiges = 1;
  game2.state.g.managers.rail = true;
  game2.openRoom();
  strictEqual(game2.state.showOpenRoom, false, 'openRoom blocked while tabStale');
  game2.state.showOpenRoom = true;
  game2.confirmOpenRoom();
  strictEqual(game2.state.g.clubs.annex, undefined, 'confirmOpenRoom blocked while tabStale');
});

test('setActiveClub switches rooms and evicts excess WORKING crew to off (cap-aware)', () => {
  const game = newGame(20);
  const g = game.state.g;
  const annex = game.freshClubState();
  annex.b.dress = 1; // cap.crew = 2 + 1*2 = 4
  g.clubs.annex = annex;
  // main has no Dressing Rooms → cap.crew = 2
  g.crew = 5;
  g.jobs = { stage: 2, vipjob: 2, floor: 1, off: 0 };
  game.setActiveClub('annex');
  strictEqual(g.activeClub, 'annex', 'switched to annex');
  // annex cap 4 → evict 1 working crew, floor first.
  strictEqual(g.jobs.floor, 0, 'floor evicted first');
  strictEqual(g.jobs.stage, 2);
  strictEqual(g.jobs.vipjob, 2);
  strictEqual(g.jobs.off, 1, 'excess working crew parked in off');
  // Switch back to main: cap 2 → evict 2 more working crew (stage → vipjob).
  game.setActiveClub('main');
  strictEqual(g.activeClub, 'main', 'switched back');
  strictEqual(g.jobs.stage, 0, 'stage evicted (floor already empty)');
  strictEqual(g.jobs.vipjob, 2, 'vipjob kept — only 2 working crew were over cap');
  strictEqual(g.jobs.off, 3, 'total evicted = working 5 − cap 2');
  // Same-club and unknown-id switches are no-ops.
  const jobsBefore = JSON.stringify(g.jobs);
  game.setActiveClub('main');
  game.setActiveClub('nowhere');
  strictEqual(JSON.stringify(g.jobs), jobsBefore, 'same/unknown id no-op');
  // tabStale blocks switching (read-only tab).
  game.state.tabStale = true;
  game.setActiveClub('annex');
  strictEqual(g.activeClub, 'main', 'switch blocked while tabStale');
});

test('setActiveClub does not over-evict when crew are already off shift', () => {
  const game = newGame(20);
  const g = game.state.g;
  const annex = game.freshClubState();
  annex.b.dress = 1; // cap.crew = 4
  g.clubs.annex = annex;
  // main cap 2; five crew with three ALREADY off shift and two working.
  g.crew = 5;
  g.jobs = { stage: 2, vipjob: 0, floor: 0, off: 3 };
  game.setActiveClub('annex');
  strictEqual(g.jobs.stage, 2, 'working crew untouched (2 working ≤ cap 4)');
  strictEqual(g.jobs.off, 3, 'existing off-shift crew not evicted further');
  strictEqual(g.activeClub, 'annex');
});

test('moveJob respects the active room crew cap after eviction', () => {
  const game = newGame(20);
  const g = game.state.g;
  const annex = game.freshClubState();
  annex.b.dress = 1; // cap.crew = 4
  g.clubs.annex = annex;
  g.crew = 5;
  g.jobs = { stage: 5, vipjob: 0, floor: 0, off: 0 };
  game.setActiveClub('annex'); // cap 4 → evict 1 stage worker → off 1
  strictEqual(g.jobs.off, 1, 'eviction parked one worker');
  // At cap: assigning the parked crew back is blocked.
  game.moveJob('stage', 1);
  strictEqual(g.jobs.off, 1, 'assignment blocked at cap');
  strictEqual(g.jobs.stage, 4, 'stage unchanged');
  // Unassigning still works and frees a slot.
  game.moveJob('stage', -1);
  strictEqual(g.jobs.stage, 3);
  strictEqual(g.jobs.off, 2);
  game.moveJob('stage', 1);
  strictEqual(g.jobs.stage, 4, 'reassign allowed once below cap');
  strictEqual(g.jobs.off, 1);
});

test('Hire Crew card and ledger show WORKING crew, not total shared crew', () => {
  const game = newGame(20);
  const g = game.state.g;
  const annex = game.freshClubState();
  annex.b.dress = 8; // cap.crew = 18
  g.clubs.annex = annex;
  g.crew = 43;
  g.jobs = { stage: 43, vipjob: 0, floor: 0, off: 0 };
  game.setActiveClub('annex'); // cap 18 → evict 25 working crew to off
  strictEqual(g.jobs.off, 25, '25 crew evicted to off shift');
  // The Hire Crew card must report working crew (18), not the shared total (43).
  game.state.tab = 'crew';
  const v = game.renderVals();
  const hireCard = v.cards.find(c => c.name === 'Hire Crew');
  strictEqual(hireCard.owned, '18 / 18', 'Hire Crew card shows working crew / cap');
  // The ledger Crew stat must match.
  const crewStat = v.stats.find(s => s.k.startsWith('Crew'));
  strictEqual(crewStat.v, '18 / 18', 'ledger Crew shows working crew / cap');
});

test('hireCrew caps WORKING crew, not total (off-shift crew do not block hiring)', () => {
  const game = newGame(50000);
  const g = game.state.g;
  // No Dressing Rooms → cap.crew = 2. Three crew: two working, one parked.
  g.crew = 3;
  g.jobs = { stage: 2, vipjob: 0, floor: 0, off: 1 };
  game.hireCrew();
  strictEqual(g.crew, 3, 'blocked when working crew is at cap');
  // Free a working slot: working 1 < cap 2 → hiring allowed even though total (3) ≥ cap (2).
  g.jobs = { stage: 1, vipjob: 0, floor: 0, off: 2 };
  game.hireCrew();
  strictEqual(g.crew, 4, 'hiring allowed when working < cap despite total ≥ cap');
});

test('golden ticket resolves against its source club after a switch', () => {
  const game = newGame(20);
  const g = game.state.g;
  const annex = game.freshClubState('annex');
  annex.b.bar = 3; // annex patron cap 10 + 15 = 25
  g.clubs.annex = annex;
  g.clubs.main.b.bar = 1; // main patron cap 10 + 5 = 15
  g.clubs.main.patrons = 10;
  // Offer spawns in main (maybeGolden stamps club: activeClub).
  g.golden = { at: Date.now(), club: 'main' };
  game.setActiveClub('annex');
  const v = game.renderVals().golden;
  strictEqual(v.crowdAmount, 5, 'crowd preview uses the source club cap (15 − 10)');
  strictEqual(game.takeGolden(g, 'crowd'), true);
  strictEqual(g.clubs.main.patrons, 15, 'patrons land in the SOURCE club');
  strictEqual(g.clubs.annex.patrons, 0, 'annex untouched (no cross-club transfer)');
  strictEqual(g.golden, null, 'offer consumed');
});

test('switching to a fresh room falls back from Upgrades to Club', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.clubs.annex = game.freshClubState();
  g.b.rail = 1; // main has a building → Upgrades unlocked
  game.state.tab = 'up';
  game.setActiveClub('annex');
  strictEqual(game.state.tab, 'club', 'tab falls back to Club when Upgrades is not unlocked');
  game.state.tab = 'up';
  game.setActiveClub('main');
  strictEqual(game.state.tab, 'up', 'tab preserved when the destination unlocks it');
});

test('v9 import rejects hostile club IDs (XSS via crafted id)', () => {
  const game = newGame(20);
  // JSON.parse builds the hostile key as an own data property; the safe-id
  // regex must reject it before it ever renders into a header button.
  const evil = JSON.parse('{"saveVer":9,"g":{"clubs":{' +
    '"<img src=x onerror=alert(1)>":{"cash":50,"hype":0,"buzz":0,"patrons":0,"regulars":0,"elapsed":0,"night":1,"shiftIdx":0,"shiftT":0},' +
    '"main":{"cash":20,"hype":0,"buzz":0,"patrons":0,"regulars":0,"elapsed":0,"night":1,"shiftIdx":0,"shiftT":0}},' +
    '"activeClub":"main","clout":0,"crew":0,"jobs":{"stage":0,"vipjob":0,"floor":0,"off":0},' +
    '"goals":[],"clicks":0,"rounds":0}}');
  strictEqual(game.importSaveFromText(JSON.stringify(evil)), false, 'non-identifier club id rejected fail-closed');
  strictEqual(game.state.g.activeClub, 'main', 'live club untouched');
});

test('v9 save round-trip preserves the annex club and activeClub', () => {
  const game = newGame(20);
  const p = game.fresh();
  p.clubs.annex = game.freshClubState();
  p.clubs.annex.cash = 77;
  p.activeClub = 'annex';
  const payload = JSON.stringify({ saveVer: 9, ver: '0.11.1', build: 214, g: p });
  strictEqual(game.importSaveFromText(payload), true, 'annex save imports');
  strictEqual(game.state.g.activeClub, 'annex', 'activeClub restored');
  strictEqual(game.state.g.clubs.annex.cash, 77, 'annex till restored');
  strictEqual(game.state.g.cash, 77, 'flat reads follow the restored annex');
  strictEqual(game.state.g.clubs.main.cash, 20, 'main intact');
});

test('wipe (hardReset) returns to a single main club', () => {
  const game = newGame(20);
  game.markTabOwner();
  game.state.tabStale = false;
  game.state.g.clubs.annex = game.freshClubState();
  const hr = game.renderVals().hardReset;
  hr(); // arm
  hr(); // wipe
  strictEqual(game.state.g.activeClub, 'main', 'active club back to main');
  strictEqual(Object.keys(game.state.g.clubs).join(','), 'main', 'annex wiped with the save');
});

test('v9 import sanitizes inherited-key activeClub to main (own-property check)', () => {
  const game = newGame(20);
  const payload = JSON.stringify({
    saveVer: 9,
    g: {
      clubs: { main: { ...game.fresh().clubs.main, cash: 66 } },
      activeClub: 'constructor',
      clout: 0, crew: 0,
      jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      goals: [], clicks: 0, rounds: 0
    }
  });
  strictEqual(game.importSaveFromText(payload), true);
  strictEqual(game.state.g.activeClub, 'main', 'inherited key sanitized to main');
  strictEqual(game.state.g.cash, 66, 'main club intact');
});

test('fresh() v9: clubs.main carries the full club field set, account level is clean', () => {
  const game = newGame(20);
  const g = game.fresh();
  const main = g.clubs.main;
  for (const k of ['cash', 'hype', 'buzz', 'patrons', 'regulars', 'b', 'u',
    'elapsed', 'night', 'shiftIdx', 'shiftT', '_specialShift', '_whaleCooldown']) {
    ok(k in main, `club field ${k} in clubs.main`);
  }
  ok(!('cash' in g), 'no flat cash on account level');
  ok(!('b' in g), 'no flat b on account level');
  strictEqual(g.activeClub, 'main');
  ok(!('clubs' in main), 'clubs map is not nested inside a club');
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
  strictEqual(stored.g.clubs.main.cash, 42);
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
  const row = v.resources.find(r => r.name && r.name.includes('Patrons'));
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
  game.state.g = game.wrapState(game.fresh());
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
  strictEqual(stored.g.clubs.main.cash, 88);
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
  game.state.g = game.wrapState(game.fresh());
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
  strictEqual(stored.saveVer, 10);
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

test('init migrate + offline persists; second init does not double-count offline', () => withFrozenNow((t) => {
  localStorage.clear();
  const b = { rail: 2, bar: 1, vip: 0, dj: 0, marquee: 0, flyers: 1, door: 0, dress: 0 };
  const hourAgo = t - 3600_000;
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
  // Frozen, the first init refreshed ts to exactly `t`, so the second init measures a 0s
  // window and applies nothing at all: the delta is exactly 0, not merely small. The old
  // `< 1` slack existed only to absorb whatever wall-clock passed between the two inits;
  // with the clock held there is nothing to absorb, and an exact assertion catches a
  // fractional re-apply that a tolerance of 1 would have hidden.
  const game2 = new Game(root);
  game2.forceUpdate = () => {};
  game2.init();
  if (game2.timer) clearInterval(game2.timer);
  if (game2.saver) clearInterval(game2.saver);
  const delta = game2.state.g.cash - cashAfterFirst;
  strictEqual(delta, 0, `second init must not re-apply ~1h offline (Δcash=${delta}, first=${cashAfterFirst})`);
  strictEqual(JSON.parse(localStorage.getItem(game2.KEY)).saveVer, game2.SAVE_VER);
}));

// AAR-59 / Codex P2: setItem throw must not leave catch-up applied only in memory
// while the prior blob (old ts) remains — that path double-counts offline on reload.
test('init setItem throw after migrate skips catch-up (no double-count risk)', () => withFrozenNow((t) => {
  localStorage.clear();
  const b = { rail: 2, bar: 1, vip: 0, dj: 0, marquee: 0, flyers: 1, door: 0, dress: 0 };
  const hourAgo = t - 3600_000;
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

  // Third init must not re-apply the hour. Frozen, game2 claimed ts at exactly `t`, so
  // game3 measures a 0s window and the delta is exactly 0 (see the note on the previous
  // test for why the old `< 1` slack is no longer needed).
  const cashAfter = game2.state.g.cash;
  const game3 = new Game(root);
  game3.forceUpdate = () => {};
  game3.init();
  if (game3.timer) clearInterval(game3.timer);
  if (game3.saver) clearInterval(game3.saver);
  strictEqual(game3.state.g.cash - cashAfter, 0, 'no double-count after recover');
}));

test('init post-catchUp setItem throw still claimed ts (reload cannot re-apply gap)', () => withFrozenNow((t) => {
  localStorage.clear();
  const b = { rail: 2, bar: 1, vip: 0, dj: 0, marquee: 0, flyers: 1, door: 0, dress: 0 };
  const hourAgo = t - 3600_000;
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
  const cashOnDisk = disk.g.clubs.main.cash;
  const game2 = new Game(root);
  game2.forceUpdate = () => {};
  game2.init();
  if (game2.timer) clearInterval(game2.timer);
  if (game2.saver) clearInterval(game2.saver);
  // Second init must not re-apply ~1h offline on top of disk state. Frozen, the claim
  // write set ts to exactly `t`, so the reload measures a 0s window and re-applies
  // nothing — exactly 0, not within 1.
  strictEqual(game2.state.g.cash - cashOnDisk, 0,
    `reload must not re-apply offline gap (disk=${cashOnDisk}, second=${game2.state.g.cash})`);
}));

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

// ── Help-icon jargon tooltips (PR #55) ────────────────────────────────────────
console.log('\nHelp-icon jargon tooltips (PR #55)');

test('helpIcon escapes quotes and angle brackets in title and aria-label', () => {
  const game = newGame(10);
  const out = game.helpIcon('Door Staff', 'Hired muscle. "VIPS" <b>cut</b> the line & skip the queue.');
  ok(out.startsWith('<span'), 'helpIcon emits a span');
  ok(!out.includes('title="Hired muscle. "'), 'double quote must not close the title attribute early');
  ok(out.includes('&quot;'), 'double quotes entity-escaped');
  ok(out.includes('&lt;b&gt;'), 'angle brackets entity-escaped');
  ok(out.includes('&amp;'), 'ampersand entity-escaped');
  ok(!out.includes('<b>'), 'no raw tags leak into the emitted markup');
  ok(out.includes('aria-label="Door Staff: '), 'aria-label carries the term and definition');
  ok(out.includes('aria-label="Door Staff: Hired muscle. &quot;'), 'quote in def is escaped inside aria-label too');
  ok(out.includes('tabindex="0"'), 'icon is keyboard-reachable');
});

test('job row names are plain text (no icon markup) and rawName stays markup-free', () => {
  const game = newGame(10);
  const v = game.renderVals();
  for (const j of v.jobs) {
    ok(typeof j.rawName === 'string' && j.rawName.length > 0, `job ${j.id} has rawName`);
    ok(!j.rawName.includes('<'), `job ${j.id} rawName has no markup`);
    // 0.10.21: help icons were removed from job rows (the desc is displayed right
    // under the name, so the ? repeated it verbatim). Names are now plain text.
    ok(!j.name.includes('<') && !j.name.includes('cursor:help'), `job ${j.id} name has no icon markup`);
    strictEqual(j.name, j.rawName, `job ${j.id} name is plain text, matching rawName`);
  }
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
  strictEqual(JSON.parse(raw).g.clubs.main.cash, 99);
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
  const structures = game.renderVals().stats.find(s => s.k && s.k.includes('Structures'));
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
  strictEqual(disk.g.clubs.main.cash, 111, 'disk cash unchanged');
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
  strictEqual(JSON.parse(raw).g.clubs.main.cash, 321);
});

test('save round-trip: auto-save sets lastAutoSave; manual-save preserves it; init() rehydrates it', () => {
  const game = newGame(20);
  game.markTabOwner();
  game.state.tabStale = false;
  game.state.g.cash = 100;
  localStorage.removeItem(game.KEY);

  // Auto-save: sets lastAutoSave
  game.save('auto');
  let raw = localStorage.getItem(game.KEY);
  let payload = JSON.parse(raw);
  ok(payload.lastAutoSave != null, 'auto-save writes lastAutoSave');
  const autoTs = payload.lastAutoSave;
  strictEqual(game.state.lastAutoSave, autoTs, 'game.state.lastAutoSave set to auto-save timestamp');

  // Manual save: preserves lastAutoSave (does not clobber it)
  game.state.g.cash = 200;
  game.save('manual');
  raw = localStorage.getItem(game.KEY);
  payload = JSON.parse(raw);
  strictEqual(payload.lastAutoSave, autoTs, 'manual save preserves lastAutoSave');
  strictEqual(game.state.lastAutoSave, autoTs, 'game.state.lastAutoSave unchanged by manual save');

  // init() rehydrates lastAutoSave from stored payload
  const game2 = newGame(20);
  game2.forceUpdate = () => {};
  game2.init();
  if (game2.timer) clearInterval(game2.timer);
  if (game2.saver) clearInterval(game2.saver);
  strictEqual(game2.state.lastAutoSave, autoTs, 'init() rehydrates lastAutoSave from disk');
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
  const cashBefore = JSON.parse(diskBefore).g.clubs.main.cash;
  // Double-confirm wipe (arm + confirm) — both must no-op for non-owner.
  const hr = game.renderVals().hardReset;
  hr();
  hr();
  const diskAfter = localStorage.getItem(game.KEY);
  ok(diskAfter, 'disk KEY still present after non-owner wipe attempts');
  strictEqual(diskAfter, diskBefore, 'disk blob unchanged');
  strictEqual(JSON.parse(diskAfter).g.clubs.main.cash, 7777, 'live sibling cash preserved');
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

test('hardReset and import fall back to Club when gating hides the current tab', () => {
  // Park on Upgrades, then wipe: fresh g has no buildings, so Upgrades is no
  // longer in tabDefs — the tab bar must not silently render stale content
  // with no highlighted tab (same class doPrestige already guards).
  const game = newGame(20);
  game.markTabOwner();
  game.state.tabStale = false;
  game.state.g.b.rail = 1; // Upgrades unlocked
  game.state.tab = 'up';
  const hr = game.renderVals().hardReset;
  hr(); // arm
  hr(); // wipe
  strictEqual(game.state.tab, 'club', 'hardReset resets tab to Club');
  const labels = game.renderVals().tabs.map(t => t.label);
  ok(labels.includes('Club') && labels.includes('Crew'), 'fresh bar keeps Club + Crew');
  ok(!labels.includes('Upgrades'), 'fresh bar has no Upgrades');
  strictEqual(game.renderVals().tabs.some(t => t.label === 'Upgrades'), false, 'no stale Upgrades tab');

  // Import a fresh/lower-progress save while parked on Research.
  const game2 = newGame(20);
  game2.state.g.clout = 5; // Research unlocked
  game2.state.tab = 'res';
  const payload = {
    saveVer: game2.SAVE_VER, ver: game2.VERSION.num, build: game2.VERSION.build,
    g: game2.fresh()
  };
  strictEqual(game2.importSaveFromText(JSON.stringify(payload)), true);
  strictEqual(game2.state.tab, 'club', 'import resets tab to Club');
  const labels2 = game2.renderVals().tabs.map(t => t.label);
  ok(labels2.includes('Club') && labels2.includes('Crew'), 'imported bar keeps Club + Crew');
  ok(!labels2.includes('Research'), 'imported bar has no Research');
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
  game._live = true; // 0.10.19: the special roll is live-only (pacing-bot determinism)
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
  game._live = true; // 0.10.19: the special roll is live-only (pacing-bot determinism)
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
  game._live = true; // 0.10.19: the special roll is live-only (pacing-bot determinism)
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
  game._live = true; // 0.10.19: the special roll is live-only (pacing-bot determinism)
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

test('render throttle: forceUpdate throttled with mock clock', () => {
  const game = newGame(20);
  let calls = 0;
  const origFU = game.forceUpdate;
  const origNow = Date.now;
  let tick = 1000000;
  Date.now = () => tick;
  game.forceUpdate = () => { calls++; };
  try {
    // First step at t=1,000,000: cold start → forceUpdate fires (falsy _lastRender)
    game.step(0.09); tick += 100;
    strictEqual(calls, 1, 'cold start: first step always renders');
    // Next 3 steps at t=+100, +200, +300: only the one at +300 crosses the 250ms window
    for (let i = 0; i < 3; i++) { game.step(0.09); tick += 100; }
    strictEqual(calls, 2, 'after 400ms elapsed: 2 renders total (0ms + 300ms)');
  } finally {
    game.forceUpdate = origFU;
    Date.now = origNow;
  }
});

// ── Second-location field partition (SECOND_LOCATION.md §3–§4) ───────────────
// The reverted first attempt at multi-club died on a clubFields/freshClub()
// mismatch: crew and jobs are SHARED roster and stay top-level, but the two
// field lists disagreed about it. These tests exist BEFORE the implementation
// so the implementer inherits the guard instead of being asked to write it.
//
// Pre-v9 (today) they assert the doc's partition is complete against fresh().
// The moment g.clubs appears they arm themselves and assert the split is right.

// Verbatim from SECOND_LOCATION.md §4 "Fields that move ... into each club".
const CLUB_FIELDS = [
  'cash', 'hype', 'buzz', 'patrons', 'regulars', 'b', 'u',
  'elapsed', 'night', 'shiftIdx', 'shiftT', '_specialShift', '_whaleCooldown',
];
// Verbatim from SECOND_LOCATION.md §4 "Fields that stay at the top level".
const ACCOUNT_FIELDS = [
  'clout', 'legacy', 'legacyTotal', 'perks', 'prestiges',
  'r', 'managers', 'managerPaused', 'managerLevels', 'achievements',
  'goals', 'clicks', 'rounds',
  'whalesCount', 'specialsCount', 'golden',
  'challenge', 'challengesDone',
  'renown', 'renownTotal', 'brand',
  'ts', 'log',
  'crew', 'jobs',
  'clubs', 'activeClub',
];

test('SECOND_LOCATION field lists partition fresh() with nothing unassigned', () => {
  const overlap = CLUB_FIELDS.filter(k => ACCOUNT_FIELDS.includes(k));
  strictEqual(overlap.length, 0, `field claimed by both lists: ${overlap.join(', ')}`);

  // Every key fresh() actually produces must be assigned to exactly one side.
  // This fails when someone adds a field to fresh() without deciding whether a
  // second club gets its own copy — the decision that broke the last attempt.
  const unassigned = Object.keys(newGame(20).fresh())
    .filter(k => !CLUB_FIELDS.includes(k) && !ACCOUNT_FIELDS.includes(k));
  strictEqual(unassigned.length, 0,
    `fresh() field not assigned club-level or account-level in SECOND_LOCATION.md §4: ${unassigned.join(', ')}`);
});

test('crew and jobs stay top-level shared roster, never inside a club', () => {
  const game = newGame(20);
  const g = game.state.g;

  // Holds today and must survive the migration. crew/jobs are shared across
  // clubs (§3 "Shared roster"); moving them into a club silently duplicates
  // the roster and breaks the cap-aware rebalance in setActiveClub.
  ok(typeof g.crew === 'number', 'g.crew is top-level');
  ok(g.jobs && typeof g.jobs === 'object', 'g.jobs is top-level');

  if (!g.clubs) return; // pre-v9: nothing further to check yet.

  for (const club of Object.values(g.clubs)) {
    ok(!('crew' in club), 'crew must not be copied into a club');
    ok(!('jobs' in club), 'jobs must not be copied into a club');
  }
});

const SPLIT_TEST = 'once g.clubs exists, the club/account split matches the design';
if (!newGame(20).state.g.clubs) {
  // Reported as a skip, not a pass: this is coverage that arms on implementation,
  // and counting it green today would misstate what the suite currently checks.
  skip(SPLIT_TEST, 'pre-SAVE_VER-9: g.clubs not implemented yet');
} else test(SPLIT_TEST, () => {
  const game = newGame(20);
  const g = game.state.g;

  ok(typeof g.activeClub === 'string', 'g.activeClub names a club');
  const active = g.clubs[g.activeClub];
  ok(active && typeof active === 'object', `g.activeClub '${g.activeClub}' resolves to a club`);

  // Account fields must not have leaked into the club.
  const leaked = ACCOUNT_FIELDS.filter(k => k in active);
  strictEqual(leaked.length, 0, `account-level field found inside a club: ${leaked.join(', ')}`);

  // Club fields must no longer sit at the top level, shadowing the club copy.
  // A stale top-level `cash` is the failure mode where the UI and the sim read
  // different numbers and neither is obviously wrong.
  const shadowed = CLUB_FIELDS.filter(k => k in g);
  strictEqual(shadowed.length, 0, `club-level field still top-level on g: ${shadowed.join(', ')}`);

  // freshClub(), if present, must produce exactly the club field set — this is
  // the clubFields/freshClub() equality the reverted attempt got wrong.
  if (typeof game.freshClub === 'function') {
    const produced = Object.keys(game.freshClub()).sort();
    const expected = CLUB_FIELDS.filter(k => !k.startsWith('_')).sort();
    const missing = expected.filter(k => !produced.includes(k));
    const extra = produced.filter(k => !CLUB_FIELDS.includes(k));
    strictEqual(missing.length, 0, `freshClub() omits club field(s): ${missing.join(', ')}`);
    strictEqual(extra.length, 0, `freshClub() invents non-club field(s): ${extra.join(', ')}`);
  }
});

console.log('\n───────────────────────────────────────');
// ── PR 3 — Deep research tree (REPLAY_ROADMAP.md §5) ─────────────────────────

test('research tree is well-formed (tier + req)', () => {
  const game = newGame();
  ok(game.RESEARCH.length >= 12 && game.RESEARCH.length <= 16, '12–16 research items');
  const ids = new Set(game.RESEARCH.map(d => d.id));
  strictEqual(ids.size, game.RESEARCH.length, 'unique research ids');
  for (const d of game.RESEARCH) {
    ok(d.tier >= 1 && d.tier <= 3, `${d.id} has a valid tier`);
    ok(typeof d.cost === 'number' && d.cost > 0, `${d.id} has a positive cost`);
    if (d.req) {
      ok(ids.has(d.req), `${d.id} req points at a real research id`);
      ok(d.req !== d.id, `${d.id} req is not self-referential`);
    }
  }
  const tiers = new Set(game.RESEARCH.map(d => d.tier));
  strictEqual(tiers.size, 3, 'exactly 3 tiers present');
});

test('cheapest research anchors the first-research band (loop @ 12)', () => {
  const game = newGame();
  const loop = game.RESEARCH.find(d => d.id === 'loop');
  const minCost = Math.min(...game.RESEARCH.map(d => d.cost));
  strictEqual(loop.cost, 12, 'loop stays 12 Clout');
  strictEqual(minCost, loop.cost, 'min(researchCosts) === loop.cost');
});

test('buyResearch rejects a locked node and honors its prerequisite', () => {
  const game = newGame();
  const g = game.state.g;
  const host = game.RESEARCH.find(d => d.id === 'host');
  const promo = game.RESEARCH.find(d => d.id === 'promo');
  g.clout = 1000;
  game.buyResearch(host);
  strictEqual(g.r.host, false, 'host cannot be bought before promo');
  strictEqual(g.clout, 1000, 'clout unchanged when rejected');
  game.buyResearch(promo);
  strictEqual(g.r.promo, true, 'promo bought');
  game.buyResearch(host);
  strictEqual(g.r.host, true, 'host buyable after promo');
});

test('research card reports the locked/unavailable state', () => {
  const game = newGame();
  const g = game.state.g;
  g.clout = 1000;
  game.state.tab = 'res';
  const hostCard = game.renderVals().cards.find(c => c.name === 'Floor Host');
  ok(hostCard, 'host card present');
  ok(hostCard.reqLocked === true, 'host card reports reqLocked before promo');
  strictEqual(hostCard.reqName, 'Promoter Network', 'host card names its prereq');
  game.buyResearch(game.RESEARCH.find(d => d.id === 'promo'));
  const hostCard2 = game.renderVals().cards.find(c => c.name === 'Floor Host');
  ok(hostCard2.reqLocked === false, 'host card unlocks after promo');
});

test('research-unlocked job is catalog-driven (fresh + moveJob)', () => {
  const game = newGame();
  const g = game.state.g;
  ok('host' in g.jobs, 'fresh() includes the host job id');
  strictEqual(g.jobs.host, 0, 'host starts at 0');
  // moveJob rejects a locked job (action invariant, not just UI).
  g.crew = 2; g.jobs.off = 2;
  game.moveJob('host', 1);
  strictEqual(g.jobs.host, 0, 'moveJob rejects locked host');
  strictEqual(g.jobs.off, 2, 'no crew consumed by a locked job');
  // Unlock host research → moveJob allows.
  g.r.host = true;
  game.moveJob('host', 1);
  strictEqual(g.jobs.host, 1, 'moveJob allows host after unlock');
  strictEqual(g.jobs.off, 1, 'off decremented');
});

test('sanitizeG evicts a locked job to off (no phantom working crew)', () => {
  const game = newGame();
  const g = { crew: 3, jobs: { stage: 1, vipjob: 1, floor: 0, host: 1, off: 0 }, r: {} };
  game.sanitizeG(g);
  strictEqual(g.jobs.host, 0, 'locked host forced to 0');
  strictEqual(g.jobs.off, 1, 'evicted host crew moved to off');
  strictEqual(g.jobs.stage + g.jobs.vipjob + g.jobs.floor + g.jobs.host + g.jobs.off, 3, 'crew total honest (no loss/dup)');
});

test('import accepts the host job and rejects malformed assignments', () => {
  const game = newGame();
  const g = game.state.g;
  g.r.host = true; g.crew = 1; g.jobs.off = 0; g.jobs.host = 1;
  const base = JSON.parse(JSON.stringify(g));
  // Valid save carrying the host job imports cleanly.
  ok(game.importSaveFromText(JSON.stringify({ saveVer: 9, g: base })), 'host job id imports');
  // Negative host assignment is rejected by the deep import validation.
  const neg = JSON.parse(JSON.stringify(g));
  neg.jobs.host = -1;
  ok(!game.importSaveFromText(JSON.stringify({ saveVer: 9, g: neg })), 'negative host rejected');
  // Non-numeric host assignment is rejected.
  const str = JSON.parse(JSON.stringify(g));
  str.jobs.host = 'x';
  ok(!game.importSaveFromText(JSON.stringify({ saveVer: 9, g: str })), 'non-numeric host rejected');
});

test('prestige reset is catalog-driven (host job zeroed, research reset)', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.regulars = 30; g.night = 10;
  g.r.host = true; g.crew = 3; g.jobs.stage = 2; g.jobs.host = 1;
  game.confirmPrestige();
  const next = game.state.g;
  strictEqual(next.crew, 0, 'crew reset');
  ok('host' in next.jobs, 'host id survives in the catalog shape');
  strictEqual(next.jobs.host, 0, 'host job zeroed after prestige');
  strictEqual(next.r.host, false, 'research reset after prestige');
});

test('brand research folds into totalCashMult (all cash, not passive-only, no double count)', () => {
  const game = newGame();
  const g = game.state.g;
  const c = game.club(g);
  // Nonzero door cover so the cash multiplier has something to scale; no crew,
  // no jobs, so cash === nonCrewCash (pure multiplier path).
  c.patrons = 10;
  const rBase = game.rates(g); // brand off
  g.r.brand = true;
  const rBrand = game.rates(g); // brand on
  ok(Math.abs(rBrand.cash - rBase.cash * 1.10) < 1e-6, 'rates cash scales exactly ×1.10 with brand (no double count)');
  // totalCashMult itself includes brand — so clicks/whale/golden get it too.
  const multBase = game.cashIncomeMult(g) * game.achievementMult(g);
  ok(Math.abs(game.totalCashMult(g) - multBase * 1.10) < 1e-9, 'totalCashMult includes brand');
  // Active click (Work the room) pays the brand-inclusive grant.
  const clickVal = 1.15 + c.b.rail * 0.65 + c.hype * 0.07;
  const before = c.cash;
  game.renderVals().workCrowd();
  ok(Math.abs((c.cash - before) - clickVal * game.totalCashMult(g)) < 1e-9, 'click pays the brand-inclusive grant');
});

// ── PR 4 — Challenge runs (REPLAY_ROADMAP.md §6) ─────────────────────────────

test('CHALLENGES table is well-formed; rewards never grant Clout', () => {
  const game = newGame();
  ok(game.CHALLENGES.length >= 3, 'at least 3 challenges');
  const ids = new Set(game.CHALLENGES.map(c => c.id));
  strictEqual(ids.size, game.CHALLENGES.length, 'unique challenge ids');
  for (const c of game.CHALLENGES) {
    ok(typeof c.name === 'string' && c.name.length > 0, `${c.id} has a name`);
    ok(typeof c.desc === 'string' && c.desc.length > 0, `${c.id} has a desc`);
    ok(typeof c.check === 'function', `${c.id} has a completion predicate`);
    ok(c.mod && typeof c.mod === 'object', `${c.id} has a modifier`);
    ok(c.reward && typeof c.reward === 'object', `${c.id} has a reward`);
    ok(!('clout' in c.reward), `${c.id} grants no Clout (Legacy-not-Clout rule)`);
    ok(!('legacy' in c.reward), `${c.id} grants no Legacy — derived bonuses only`);
  }
});

test('startChallenge resets every club, re-locks the annex, preserves account meta', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.regulars = 30; g.night = 10;
  g.legacy = 8; g.legacyTotal = 20; g.prestiges = 2;
  g.perks.cash10 = 1;
  g.managers.rail = true;
  // Pre-record the achievements this setup satisfies (prestige_1 fires at
  // prestiges >= 1) so the post-start catch-up credits nothing new.
  g.achievements = ['first_rail', 'prestige_1'];
  g.clubs.annex = game.freshClubState();
  g.activeClub = 'annex';
  const tight = game.CHALLENGES.find(c => c.id === 'tight');
  game.startChallenge(tight); // first click arms only
  strictEqual(game.state.g.challenge, null, 'first click only arms');
  game.startChallenge(tight); // confirm
  const next = game.state.g;
  strictEqual(next.challenge, 'tight', 'challenge active');
  strictEqual(next.clubs.main.cash, 0, 'startCash modifier applied (tight = $0 till)');
  ok(!next.clubs.annex, 'annex re-locked (removed)');
  strictEqual(next.activeClub, 'main', 'returns to main');
  strictEqual(next.regulars, 0, 'club run state reset');
  strictEqual(next.legacy, 8, 'legacy preserved');
  strictEqual(next.perks.cash10, 1, 'perk preserved');
  strictEqual(next.managers.rail, true, 'manager preserved');
  ok(next.achievements.includes('first_rail'), 'achievements preserved');
});

test('challenge incomeMult modifier hits passive AND active clicks', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.regulars = 30; g.night = 10; g.legacy = 8; g.prestiges = 2;
  const slim = game.CHALLENGES.find(c => c.id === 'slim');
  game.startChallenge(slim); game.startChallenge(slim);
  const g2 = game.state.g;
  const c = game.club(g2);
  c.patrons = 10;
  const base = game.cashIncomeMult(g2) * game.achievementMult(g2);
  ok(Math.abs(game.totalCashMult(g2) - base * 0.5) < 1e-9, 'incomeMult halves totalCashMult');
  const clickVal = 1.15 + c.b.rail * 0.65 + c.hype * 0.07;
  const before = c.cash;
  game.renderVals().workCrowd();
  ok(Math.abs((c.cash - before) - clickVal * game.totalCashMult(g2)) < 1e-9, 'click pays the halved grant');
});

test('challenge locked building is enforced in buyBuilding, managers, and cards', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.regulars = 30; g.night = 10; g.legacy = 8; g.prestiges = 2;
  g.managers.flyers = true;
  const dry = game.CHALLENGES.find(c => c.id === 'dry');
  game.startChallenge(dry); game.startChallenge(dry);
  const g2 = game.state.g;
  const c = game.club(g2);
  c.cash = 10000;
  const flyers = game.BUILDINGS.find(b => b.id === 'flyers');
  game.buyBuilding(flyers);
  strictEqual(c.b.flyers, 0, 'buyBuilding rejects locked flyers');
  strictEqual(game.buildingMaxAffordable(flyers), 0, 'buildingMaxAffordable returns 0 when locked');
  strictEqual(game.autoBuyManagers(g2), 0, 'autoBuyManagers skips locked flyers');
  game.state.tab = 'club';
  const card = game.renderVals().cards.find(cd => cd.buildingId === 'flyers');
  ok(card, 'flyers card present');
  strictEqual(card.owned, 'LOCKED', 'card shows LOCKED');
  strictEqual(card.btn, 'Locked', 'card button reads Locked');
});

test('challenge completes via checkAchievements and grants the derived reward', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.regulars = 30; g.night = 10; g.legacy = 8; g.prestiges = 2;
  const tight = game.CHALLENGES.find(c => c.id === 'tight');
  game.startChallenge(tight); game.startChallenge(tight);
  const g2 = game.state.g;
  strictEqual(g2.challenge, 'tight', 'challenge active');
  game.checkAchievements(g2);
  strictEqual(g2.challenge, 'tight', 'still active below the threshold');
  game.club(g2).regulars = 25;
  game.checkAchievements(g2);
  strictEqual(g2.challenge, null, 'challenge cleared on completion');
  ok(g2.challengesDone.includes('tight'), 'challenge recorded as done');
  const bonus = game.challengeBonus(g2);
  strictEqual(bonus.cashMult, 0.05, 'cashMult reward derived from the table');
  const multBase = game.cashIncomeMult(g2) * game.achievementMult(g2);
  ok(Math.abs(game.totalCashMult(g2) - multBase * 1.05) < 1e-9, 'completed reward scales totalCashMult');
});

test('challenge doorMax and crewOut rewards are wired', () => {
  const game = newGame();
  const g = game.state.g;
  const baseDoor = game.doorMax(g);
  g.challengesDone = ['slim'];
  strictEqual(game.doorMax(g), baseDoor + 1, 'doorMax +1 from Slim Margins');
  g.challengesDone = ['slim', 'dry'];
  strictEqual(game.doorMax(g), baseDoor + 1, 'dry adds no doorMax');
  // crewOut: stage crew output scales exactly ×1.05 with No Street Team done.
  const c = game.club(g);
  g.crew = 1; g.jobs.stage = 1; g.jobs.off = 0;
  const rBase = game.rates(g);
  g.challengesDone = ['slim', 'dry'];
  const rDry = game.rates(g);
  ok(Math.abs(rDry.hype - rBase.hype * 1.05) < 1e-9, 'crewOut scales stage hype ×1.05');
});

test('endChallenge lifts the active modifier without reward', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.regulars = 30; g.night = 10; g.legacy = 8; g.prestiges = 2;
  const dry = game.CHALLENGES.find(c => c.id === 'dry');
  game.startChallenge(dry); game.startChallenge(dry);
  const g2 = game.state.g;
  strictEqual(g2.challenge, 'dry', 'challenge active');
  game.endChallenge();
  strictEqual(g2.challenge, null, 'challenge cleared');
  ok(!g2.challengesDone.includes('dry'), 'not recorded as done');
});

test('startChallenge lock overrides start perks (flyers seed dropped in dry)', () => {
  // Dry (flyers locked): the startFlyers seed must NOT bypass the lock.
  const game = newGame(5000);
  game.state.g.perks.startFlyers = 1;
  const dry = game.CHALLENGES.find(c => c.id === 'dry');
  game.startChallenge(dry);
  game.startChallenge(dry);
  strictEqual(game.state.g.clubs.main.b.flyers, 0, 'flyers seed dropped under the flyers lock');
  // Tight (no building lock): the seed is kept.
  const game2 = newGame(5000);
  game2.state.g.perks.startFlyers = 1;
  const tight = game2.CHALLENGES.find(c => c.id === 'tight');
  game2.startChallenge(tight);
  game2.startChallenge(tight);
  strictEqual(game2.state.g.clubs.main.b.flyers, 1, 'flyers seed kept when not locked');
});

// ── PR 5 — Upgradeable managers (REPLAY_ROADMAP.md §7) ───────────────────────

test('manager levels: fresh() seeds zeros, level costs scale 10/20/30', () => {
  const game = newGame();
  const g = game.state.g;
  ok(g.managerLevels && typeof g.managerLevels === 'object', 'managerLevels map exists');
  for (const def of game.MANAGERS) {
    strictEqual(g.managerLevels[def.id], 0, `${def.id} starts at level 0`);
  }
  const rail = game.MANAGERS.find(d => d.id === 'rail');
  strictEqual(game.managerLevelCost(rail, 0), 10, 'level 0→1 costs 10 Legacy');
  strictEqual(game.managerLevelCost(rail, 1), 20, 'level 1→2 costs 20 Legacy');
  strictEqual(game.managerLevelCost(rail, 2), 30, 'level 2→3 costs 30 Legacy');
});

test('buyManagerLevel requires hired, deducts Legacy, caps at 3', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.legacy = 100;
  const rail = game.MANAGERS.find(d => d.id === 'rail');
  game.buyManagerLevel(rail);
  strictEqual(g.managerLevels.rail, 0, 'cannot level an unhired manager');
  g.managers.rail = true;
  game.buyManagerLevel(rail);
  strictEqual(g.managerLevels.rail, 1, 'level 1 after purchase');
  strictEqual(g.legacy, 90, '10 Legacy spent');
  game.buyManagerLevel(rail);
  strictEqual(g.managerLevels.rail, 2, 'level 2');
  strictEqual(g.legacy, 70, '20 Legacy spent');
  game.buyManagerLevel(rail);
  strictEqual(g.managerLevels.rail, 3, 'level 3');
  strictEqual(g.legacy, 40, '30 Legacy spent');
  game.buyManagerLevel(rail);
  strictEqual(g.managerLevels.rail, 3, 'capped at 3');
  strictEqual(g.legacy, 40, 'no spend at max');
  g.legacy = 5;
  const bar = game.MANAGERS.find(d => d.id === 'bar');
  g.managers.bar = true;
  game.buyManagerLevel(bar);
  strictEqual(g.managerLevels.bar, 0, 'unaffordable level-up rejected');
  strictEqual(g.legacy, 5, 'no spend when short');
});

test('autoBuyManagers scales quantity with level (1 / 5 / max)', () => {
  const game = newGame(50000);
  const g = game.state.g;
  const c = game.club(g);
  c.cash = 50000;
  g.legacy = 100;
  g.managers.rail = true;
  const rail = game.MANAGERS.find(d => d.id === 'rail');
  c.b.rail = 0;
  strictEqual(game.autoBuyManagers(g), 1, 'level 0 buys 1 per call');
  strictEqual(c.b.rail, 1, 'rail = 1');
  game.buyManagerLevel(rail);
  game.buyManagerLevel(rail);
  strictEqual(g.managerLevels.rail, 2, 'rail at level 2');
  strictEqual(game.autoBuyManagers(g), 5, 'level 2 buys 5 per call');
  strictEqual(c.b.rail, 6, 'rail = 6');
  game.buyManagerLevel(rail);
  strictEqual(g.managerLevels.rail, 3, 'rail at level 3');
  const before = c.b.rail;
  const n = game.autoBuyManagers(g);
  ok(n > 5, `level 3 buys max affordable (${n} > 5)`);
  strictEqual(c.b.rail, before + n, 'count matches delta');
  const price = Math.floor(140 * Math.pow(1.16, c.b.rail));
  ok(c.cash < price, 'stopped only when unaffordable (or capped)');
});

test('ordinary prestige preserves hired state, pause state, and manager levels', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.regulars = 30; g.night = 10;
  g.legacy = 100;
  g.managers.rail = true;
  g.managerPaused.rail = true;
  g.managerLevels.rail = 2;
  g.achievements = ['first_rail', 'prestige_1'];
  game.confirmPrestige();
  const next = game.state.g;
  strictEqual(next.managers.rail, true, 'hired state survives ordinary prestige');
  strictEqual(next.managerPaused.rail, true, 'pause state survives');
  strictEqual(next.managerLevels.rail, 2, 'manager level survives ordinary prestige');
});

test('sanitizeG/import fail-closed on malformed manager levels', () => {
  const game = newGame();
  const g = { managerLevels: { rail: 99, bar: -1, dj: 'x', flyers: 2 } };
  game.sanitizeG(g);
  strictEqual(g.managerLevels.rail, 3, '99 clamps to max 3');
  strictEqual(g.managerLevels.bar, 0, 'negative → 0');
  strictEqual(g.managerLevels.dj, 0, 'non-numeric → 0');
  strictEqual(g.managerLevels.flyers, 2, 'valid level kept');
  // Import path: same normalization through completeImportedG.
  const g2 = game.state.g;
  g2.managers.rail = true;
  g2.managerLevels.rail = 2;
  const raw = JSON.parse(JSON.stringify(g2));
  raw.managerLevels.rail = 99;
  game.importSaveFromText(JSON.stringify({ saveVer: 9, g: raw }));
  strictEqual(game.state.g.managerLevels.rail, 3, 'imported level clamped to max 3');
});

test('managerPaused and challenge locks still apply at any level', () => {
  const game = newGame(50000);
  const g = game.state.g;
  const c = game.club(g);
  c.cash = 50000;
  g.legacy = 100;
  g.managers.rail = true;
  const rail = game.MANAGERS.find(d => d.id === 'rail');
  game.buyManagerLevel(rail);
  game.buyManagerLevel(rail);
  game.buyManagerLevel(rail);
  g.managerPaused.rail = true;
  strictEqual(game.autoBuyManagers(g), 0, 'paused level-3 manager buys nothing');
  g.managerPaused.rail = false;
  g.managers.rail = false;
  g.managers.flyers = true;
  g.managerLevels.flyers = 3;
  g.challenge = 'dry';
  strictEqual(game.autoBuyManagers(g), 0, 'level-3 manager skips a challenge-locked building');
});

test('manager card exposes level + level-up sub-button', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.legacy = 100; g.prestiges = 1;
  g.managers.rail = true;
  game.state.tab = 'perks';
  const cards = game.renderVals().cards;
  const railCard = cards.find(cd => typeof cd.subBtn === 'string' && cd.subBtn.includes('Level up'));
  ok(railCard, 'hired manager has a level-up sub-button');
  strictEqual(railCard.subBtn, 'Level up 10 Legacy', 'level 0 → costs 10 Legacy');
  ok(railCard.owned.includes('Lv 0/3'), 'owned shows the level');
  // Level 3 → Maxed, no sub-action.
  g.managerLevels.rail = 3;
  const railCard2 = game.renderVals().cards.find(cd => cd.name === railCard.name);
  strictEqual(railCard2.subBtn, 'Maxed', 'maxed shows Maxed');
  strictEqual(railCard2.subAct, null, 'no sub-action at max');
});

test('startChallenge preserves manager levels (Legacy-purchased account meta)', () => {
  const game = newGame(5000);
  const g = game.state.g;
  g.legacy = 100; g.prestiges = 1;
  g.managers.rail = true;
  g.managerLevels.rail = 2;
  g.achievements = ['first_rail', 'prestige_1'];
  const tight = game.CHALLENGES.find(c => c.id === 'tight');
  game.startChallenge(tight); // arms
  game.startChallenge(tight); // confirm
  const next = game.state.g;
  strictEqual(next.managers.rail, true, 'hired state survives challenge start');
  strictEqual(next.managerLevels.rail, 2, 'manager level survives challenge start');
});

// ── PR 6 — Second prestige layer / Franchise → Renown (REPLAY_ROADMAP.md §8) ─

// Helper: drive g to the franchise-sale gate — every perk maxed, every manager
// hired, both clubs unlocked. Achievements pre-recorded (prestiges 15 satisfies
// prestige_1/prestige_5; checkAchievements catch-up would otherwise credit
// Legacy mid-test and break exact-value asserts).
function gateMetGame(game) {
  const g = game.state.g;
  for (const p of game.PRESTIGE_PERKS) g.perks[p.id] = p.max;
  for (const m of game.MANAGERS) g.managers[m.id] = true;
  if (!g.clubs.annex) g.clubs.annex = game.freshClubState();
  g.legacyTotal = 105;
  g.prestiges = 15;
  g.achievements = ['first_rail', 'prestige_1', 'prestige_5', 'legacy_50'];
  return g;
}

test('franchiseGate: every perk maxed AND every manager hired AND both clubs', () => {
  const game = newGame(5000);
  const g = gateMetGame(game);
  ok(game.franchiseGate(g), 'full account meets the gate');

  // Each condition independently closes the gate.
  for (const p of game.PRESTIGE_PERKS) g.perks[p.id] = 0;
  strictEqual(game.franchiseGate(g), false, 'un-maxed perks close the gate');
  for (const p of game.PRESTIGE_PERKS) g.perks[p.id] = p.max;

  g.managers.rail = false;
  strictEqual(game.franchiseGate(g), false, 'a missing manager closes the gate');
  g.managers.rail = true;

  delete g.clubs.annex;
  strictEqual(game.franchiseGate(g), false, 'a missing club closes the gate');
  strictEqual(game.franchiseGate(null), false, 'null state never meets the gate');
});

test('renownGain: floor(sqrt(lifetime Legacy) + prestiges/3)', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.legacyTotal = 121; g.prestiges = 6;
  strictEqual(game.renownGain(g), 13, 'sqrt(121)=11 + 6/3=2 → 13');
  g.legacyTotal = 105; g.prestiges = 15;
  strictEqual(game.renownGain(g), 15, 'spec sanity: ~105 lifetime + 15 prestiges → ~15 Renown');
  g.legacyTotal = 0; g.prestiges = 0;
  strictEqual(game.renownGain(g), 0, 'fresh account earns 0');
  // Transactional: renownGain reads ONLY lifetime + count (spendable renown
  // neither boosts nor gates the formula).
  g.legacyTotal = 49; g.prestiges = 2; g.renown = 500;
  strictEqual(game.renownGain(g), 7, 'spendable renown does not inflate the gain (sqrt(49)=7 + 2/3=0)');
});

test('v9 → v10 migration defaults renown/renownTotal/brand without clobbering', () => {
  const game = newGame(20);
  const g = game.state.g;
  // A v9 save: fresh shape minus the PR 6 fields.
  delete g.renown; delete g.renownTotal; delete g.brand;
  ok(game.migrateFrom(g, 9), 'v9 → v10 migration chain completes');
  strictEqual(g.renown, 0, 'renown defaults to 0');
  strictEqual(g.renownTotal, 0, 'renownTotal defaults to 0');
  ok(g.brand && typeof g.brand === 'object' && !Array.isArray(g.brand), 'brand defaults to a plain object');

  // No-clobber: real values pass through untouched.
  const g2 = game.state.g;
  g2.renown = 7; g2.renownTotal = 42; g2.brand = { national: 1 };
  ok(game.migrateFrom(g2, 9), 'migration runs again');
  strictEqual(g2.renown, 7, 'existing renown preserved (no-clobber)');
  strictEqual(g2.renownTotal, 42, 'existing renownTotal preserved');
  strictEqual(g2.brand.national, 1, 'existing brand preserved');
});

test('v9 save import upgrades to v10 with the renown fields defaulted', () => {
  const game = newGame(20);
  const f = game.fresh().clubs.main;
  const payload = JSON.stringify({
    saveVer: 9,
    g: {
      clubs: { main: { ...f, cash: 88 } },
      clout: 0, crew: 0,
      jobs: { stage: 0, vipjob: 0, floor: 0, host: 0, off: 0 },
      goals: [], clicks: 0, rounds: 0
    }
  });
  strictEqual(game.importSaveFromText(payload), true, 'v9 payload imports');
  strictEqual(game.state.g.renown, 0, 'imported v9 save gains renown 0');
  strictEqual(game.state.g.renownTotal, 0, 'imported v9 save gains renownTotal 0');
  ok(game.state.g.brand && typeof game.state.g.brand === 'object', 'imported v9 save gains a brand map');
  strictEqual(game.state.g.cash, 88, 'club state intact after upgrade');
});

test('sanitizeG fail-closes malformed renown/renownTotal/brand', () => {
  const game = newGame(20);
  const g = game.state.g;
  g.renown = 'lots';
  g.renownTotal = NaN;
  g.brand = [];
  game.sanitizeG(g);
  strictEqual(g.renown, 0, 'string renown → 0');
  strictEqual(g.renownTotal, 0, 'NaN renownTotal → 0');
  ok(g.brand && typeof g.brand === 'object' && !Array.isArray(g.brand), 'array brand → {}');
  // Negative renown clamps to 0 (spendable can never go below 0).
  g.renown = -5; g.renownTotal = -5;
  game.sanitizeG(g);
  strictEqual(g.renown, 0, 'negative renown clamps to 0');
  strictEqual(g.renownTotal, 0, 'negative renownTotal clamps to 0');
});

test('franchise sale resets the full §8.4 matrix and keeps permanent layers', () => {
  const game = newGame(5000);
  const g = gateMetGame(game);
  // Load every reset-sensitive account field with non-default values.
  g.legacy = 42;
  g.clout = 20;
  for (const r of game.RESEARCH) g.r[r.id] = true;
  g.crew = 5;
  g.jobs.stage = 2; g.jobs.vipjob = 2; g.jobs.off = 1;
  g.goals = ['work', 'rail'];
  g.clicks = 9; g.rounds = 7;
  g.challenge = 'slim';
  g.challengesDone = ['tight', 'dry'];
  g.whalesCount = 3; g.specialsCount = 2; g.golden = { at: 1 };
  g.managerPaused.rail = true;
  g.managerLevels.dj = 2;
  g.renown = 3; g.renownTotal = 30;
  g.brand = { national: 1 };
  g.clubs.main.cash = 999; g.clubs.main.regulars = 60;
  g.clubs.annex.cash = 500; g.clubs.annex.b.rail = 4;
  g.activeClub = 'annex';
  const gain = game.renownGain(g); // sqrt(105)+15/3 = 10+5 = 15
  strictEqual(gain, 15, 'expected gain for the fixture');

  game.openFranchise();
  ok(game.state.showFranchise, 'modal opens at gate');
  game.confirmFranchiseSale(); // arms
  ok(game.state.franchiseArmed, 'first click arms the sale');
  strictEqual(game.state.g, g, 'armed click leaves live state untouched');
  game.confirmFranchiseSale(); // confirms

  const a = game.state.g;
  // Permanent layers persist.
  strictEqual(a.renown, 3 + gain, 'renown = old spare + gain');
  strictEqual(a.renownTotal, 30 + gain, 'renownTotal = old lifetime + gain');
  strictEqual(a.achievements.includes('first_rail'), true, 'achievements preserved');
  strictEqual(a.achievements.includes('prestige_5'), true, 'all achievements preserved');
  strictEqual(a.brand.national, 1, 'brand ranks preserved');
  // Everything else wipes to fresh().
  strictEqual(a.prestiges, 0, 'prestiges wiped');
  strictEqual(a.legacy, 0, 'legacy wiped');
  strictEqual(a.legacyTotal, 0, 'legacyTotal wiped');
  strictEqual(a.clout, 0, 'clout wiped');
  ok(game.PRESTIGE_PERKS.every(p => a.perks[p.id] === 0), 'perks wiped');
  ok(game.RESEARCH.every(r => a.r[r.id] === false), 'research wiped');
  ok(game.MANAGERS.every(m => a.managers[m.id] === false), 'managers wiped');
  ok(game.MANAGERS.every(m => a.managerPaused[m.id] === false), 'manager pause wiped');
  ok(game.MANAGERS.every(m => a.managerLevels[m.id] === 0), 'manager levels wiped');
  strictEqual(a.crew, 0, 'crew wiped');
  strictEqual(a.jobs.stage + a.jobs.vipjob + a.jobs.floor + a.jobs.off, 0, 'job assignments wiped');
  strictEqual(a.goals.length, 0, 'goals wiped');
  strictEqual(a.clicks, 0, 'clicks wiped');
  strictEqual(a.rounds, 0, 'rounds wiped');
  strictEqual(a.challenge, null, 'active challenge cleared');
  strictEqual(a.challengesDone.length, 0, 'challenges re-lock');
  strictEqual(a.whalesCount, 0, 'whale counter wiped');
  strictEqual(a.specialsCount, 0, 'special counter wiped');
  strictEqual(a.golden, null, 'golden offer wiped');
  // Clubs: fresh { main } only — the annex re-locks.
  strictEqual(Object.keys(a.clubs).join(','), 'main', 'only main remains');
  strictEqual(a.activeClub, 'main', 'activeClub back to main');
  strictEqual(a.clubs.main.cash, 5000, 'main till back to startingCash');
  strictEqual(a.clubs.main.regulars, 0, 'main regulars fresh');
  // Disk persisted a v10 envelope with the post-sale shape.
  const saved = JSON.parse(localStorage.getItem(game.KEY));
  strictEqual(saved.saveVer, 10, 'saved envelope is v10');
  strictEqual(saved.g.renown, 3 + gain, 'disk matches memory renown');
  strictEqual(saved.g.achievements.includes('first_rail'), true, 'disk keeps achievements');
});

test('franchise sale no-ops below the gate (gate is an action invariant)', () => {
  const game = newGame(5000);
  const g = game.state.g;
  for (const p of game.PRESTIGE_PERKS) g.perks[p.id] = p.max;
  for (const m of game.MANAGERS) g.managers[m.id] = true;
  g.legacyTotal = 105; g.prestiges = 15;
  g.renown = 1;
  // Annex missing — the last gate condition.
  delete g.clubs.annex;
  game.openFranchise();
  strictEqual(game.state.showFranchise, false, 'modal does not open below gate');
  game.confirmFranchiseSale();
  game.confirmFranchiseSale();
  strictEqual(game.state.g, g, 'live state untouched');
  strictEqual(g.renown, 1, 'renown unchanged');
  strictEqual(g.clubs.annex, undefined, 'no club created by a failed sale');
});

test('franchise sale without the modal open is a no-op even at the gate', () => {
  const game = newGame();
  const g = game.state.g;
  // Meet the gate (all perks max, all managers hired, both clubs owned).
  game.PRESTIGE_PERKS.forEach(p => { g.perks[p.id] = p.max; });
  game.MANAGERS.forEach(m => { g.managers[m.id] = true; });
  g.clubs.annex = { ...g.clubs.main };
  g.renown = 1;
  g.legacyTotal = 121; g.prestiges = 6;
  strictEqual(game.franchiseGate(g), true, 'gate met');
  // No openFranchise() — the modal is closed, so the sale must not arm or run.
  game.confirmFranchiseSale();
  strictEqual(game.state.franchiseArmed, false, 'no arm without the modal');
  strictEqual(game.state.g, g, 'live state untouched');
  strictEqual(g.renown, 1, 'renown unchanged');
});

test('franchise sale is persist-before-replace: setItem throw leaves live state intact', () => {
  const game = newGame(5000);
  const g = gateMetGame(game);
  g.renown = 3; g.renownTotal = 30;
  g.clubs.main.cash = 999;
  const origSet = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('quota exceeded'); };
  try {
    game.openFranchise();
    game.confirmFranchiseSale(); // arms
    game.confirmFranchiseSale(); // confirm → setItem throws
  } finally {
    localStorage.setItem = origSet;
  }
  strictEqual(game.state.saveState, 'franchise failed', 'failure surfaced in saveState');
  strictEqual(game.state.g, g, 'live state object unchanged (never replaced)');
  strictEqual(g.renown, 3, 'renown untouched');
  strictEqual(g.renownTotal, 30, 'renownTotal untouched');
  strictEqual(g.clubs.main.cash, 999, 'club run state untouched');
  strictEqual(g.achievements.includes('first_rail'), true, 'achievements untouched');
  // No success-side effects: no sale log line on the LIVE state, no autosave.
  strictEqual(g.log.some(l => l.msg.includes('Sold the franchise')), false, 'no sale log on live state');
  strictEqual(game.saver, null, 'autosave not started');
});

test('Perks panel: sell card appears only at gate; Renown readout after first sale', () => {
  const game = newGame(5000);
  const g = game.state.g;
  game.state.tab = 'perks';
  // Below the gate: no sell card, no readout.
  g.legacy = 100; g.prestiges = 1;
  let cards = game.renderVals().cards;
  strictEqual(cards.some(c => c.name === 'Sell the franchise'), false, 'no sell card below gate');
  strictEqual(cards.some(c => c.name === 'Renown'), false, 'no readout before first sale');

  // Renown earned (first sale done): readout appears.
  g.renownTotal = 12; g.renown = 4;
  g.perks.cash10 = 5;
  cards = game.renderVals().cards;
  const ro = cards.find(c => c.name === 'Renown');
  ok(ro, 'readout card present after first sale');
  ok(ro.owned.includes('4 spare') && ro.owned.includes('12 lifetime'), 'readout shows spare + lifetime');

  // At the gate: sell card appears alongside.
  gateMetGame(game);
  g.renown = 4; g.renownTotal = 12;
  cards = game.renderVals().cards;
  const sell = cards.find(c => c.name === 'Sell the franchise');
  ok(sell, 'sell card appears at gate');
  ok(sell.meta.includes('+ 15 Renown'), 'sell card previews the gain');
  ok(sell.locked === false, 'sell card actionable');
  const v = game.renderVals();
  strictEqual(v.franchiseGate, true, 'view model exposes the gate');
  strictEqual(v.franchiseGain, 15, 'view model previews the gain');
  strictEqual(v.renownTotal, 12, 'view model exposes lifetime renown');
});

test('franchise modal handlers are bound and invocable (surface sweep safety)', () => {
  const game = newGame(5000);
  gateMetGame(game);
  game.openFranchise();
  const v = game.renderVals();
  strictEqual(v.showFranchise, true, 'modal open flag exposed');
  ok(typeof v.confirmFranchiseSale === 'function', 'confirm handler bound');
  ok(typeof v.toggleFranchise === 'function', 'close handler bound');
  // Close resets the arm so a stale armed state cannot leak into the next open.
  game.confirmFranchiseSale(); // arms
  v.toggleFranchise();
  strictEqual(game.state.showFranchise, false, 'modal closed');
  strictEqual(game.state.franchiseArmed, false, 'arm reset on close');
});

// ── PR 7 — Renown unlocks: Brand perks + third club + location identity ──────

test('BRAND_PERKS table is well-formed; LOCATION_EXTRAS cover all three clubs', () => {
  const game = newGame();
  ok(game.BRAND_PERKS.length >= 4, 'at least 4 brand perks');
  const ids = new Set(game.BRAND_PERKS.map(p => p.id));
  strictEqual(ids.size, game.BRAND_PERKS.length, 'unique brand perk ids');
  for (const p of game.BRAND_PERKS) {
    ok(typeof p.name === 'string' && p.name.length > 0, `${p.id} has a name`);
    ok(typeof p.cost === 'number' && p.cost > 0, `${p.id} has a Renown cost`);
    ok(typeof p.max === 'number' && p.max >= 1, `${p.id} has a max rank`);
    if (p.req) ok(ids.has(p.req), `${p.id} req is a real brand perk id`);
  }
  // Every known club id has an extras entry (main/annex/rooftop), each with a
  // building or upgrade carrying the full price fields (no NaN pricing).
  for (const loc of ['main', 'annex', 'rooftop']) {
    const extras = game.locationExtras(loc);
    ok(extras.length >= 1, `${loc} has location extras`);
    for (const x of extras) {
      ok(x.kind === 'b' || x.kind === 'u', `${loc}.${x.id} has a kind`);
      ok(typeof x.cost === 'number' && x.cost > 0, `${loc}.${x.id} has a cost`);
      if (x.kind === 'b') ok(typeof x.growth === 'number' && x.growth > 1, `${loc}.${x.id} has growth`);
    }
  }
});

test('buyBrandPerk spends Renown, caps at max, respects reqs and shortage', () => {
  const game = newGame();
  const g = game.state.g;
  g.renown = 20;
  const nat = game.BRAND_PERKS.find(p => p.id === 'nationwide');
  game.buyBrandPerk(nat);
  strictEqual(g.brand.nationwide, 1, 'rank 1 after purchase');
  strictEqual(g.renown, 15, '5 Renown spent');
  game.buyBrandPerk(nat);
  game.buyBrandPerk(nat);
  strictEqual(g.brand.nationwide, 3, 'capped at max 3');
  strictEqual(g.renown, 5, '3 × 5 Renown spent total');
  game.buyBrandPerk(nat);
  strictEqual(g.brand.nationwide, 3, 'no purchase at max');
  // Short on Renown → no-op.
  g.renown = 3;
  const loyalty = game.BRAND_PERKS.find(p => p.id === 'loyalty');
  game.buyBrandPerk(loyalty);
  strictEqual(g.brand.loyalty, undefined, 'unaffordable rejected');
  strictEqual(g.renown, 3, 'no spend when short');
});

test('brand perk effects are wired (nationwide/loyalty/rnd/offline)', () => {
  const game = newGame();
  const g = game.state.g;
  // nationwide: +10% all cash per rank via totalCashMult.
  const multBase = game.totalCashMult(g);
  g.brand.nationwide = 2;
  ok(Math.abs(game.totalCashMult(g) - multBase * 1.20) < 1e-9, 'nationwide ×1.20 at rank 2');
  // loyalty: runs started after prestige carry the account's brand regulars
  // (brand is restored BEFORE start perks in the reset path).
  const game2 = newGame();
  const g2 = game2.state.g;
  g2.regulars = 30; g2.night = 10; g2.legacy = 100;
  g2.brand.loyalty = 2;
  g2.achievements = ['first_rail', 'prestige_1'];
  game2.confirmPrestige();
  strictEqual(game2.state.g.clubs.main.regulars, 2, 'loyalty seeds 2 regulars on the post-prestige run');
  strictEqual(game2.state.g.brand.loyalty, 2, 'brand ranks survive ordinary prestige');
  // rnd: research costs −10% per rank.
  const loop = game.RESEARCH.find(d => d.id === 'loop');
  strictEqual(game.researchCost(g, loop), 12, 'no rnd → full cost');
  g.brand.rnd = 2;
  strictEqual(game.researchCost(g, loop), 9, 'rnd rank 2 → 12 × 0.8 = 9');
  // offline: catchUp accrues faster (two independent, identically-seeded games).
  const g3game = newGame();
  const g4game = newGame();
  const g3 = g3game.state.g, g4 = g4game.state.g;
  g3.brand.offline = 0;
  g4.brand.offline = 2;
  const c3 = g3game.club(g3); c3.b.bar = 1; c3.cash = 100;
  const c4 = g4game.club(g4); c4.b.bar = 1; c4.cash = 100;
  const before3 = c3.cash, before4 = c4.cash;
  g3game.catchUp(g3, 600);
  g4game.catchUp(g4, 600);
  const gain3 = c3.cash - before3, gain4 = c4.cash - before4;
  ok(gain4 > gain3 * 1.15 && gain4 < gain3 * 1.25, `offline rank 2 ≈ ×1.2 (${(gain4 / gain3).toFixed(2)})`);
});

test('rooftop unlock: brand perk gates the third club with its extras', () => {
  const game = newGame();
  const g = game.state.g;
  strictEqual(game.canOpenRooftop(), false, 'no rooftop without the perk');
  game.confirmOpenRooftop();
  ok(!g.clubs.rooftop, 'no club created without the perk');
  g.brand.rooftop = 1;
  strictEqual(game.canOpenRooftop(), true, 'perk unlocks the gate');
  game.confirmOpenRooftop();
  ok(g.clubs.rooftop, 'rooftop club created');
  strictEqual(g.clubs.rooftop.b.heli, 0, 'rooftop extras initialized (heli)');
  strictEqual(g.clubs.rooftop.u.vista, false, 'rooftop extras initialized (vista)');
  strictEqual(game.canOpenRooftop(), false, 'gate closes once opened');
  // Club switcher sees three clubs.
  const switcher = game.renderVals().clubSwitcher.map(s => s.id);
  ok(switcher.includes('rooftop'), 'rooftop in the switcher');
});

test('freshClubState(loc) initializes that location\'s extras; sanitize backfills missing ones', () => {
  const game = newGame();
  const main = game.freshClubState('main');
  strictEqual(main.b.pool, 0, 'main has the Neon Pool');
  strictEqual(main.b.roofbar, undefined, 'main lacks annex extras');
  const annex = game.freshClubState('annex');
  strictEqual(annex.b.roofbar, 0, 'annex has the Rooftop Bar');
  strictEqual(annex.u.skyline, false, 'annex has the Skyline upgrade');
  const rooftop = game.freshClubState('rooftop');
  strictEqual(rooftop.b.heli, 0, 'rooftop has the Helipad Lounge');
  strictEqual(rooftop.u.vista, false, 'rooftop has the Panorama Deck');
  // sanitize backfills extras for an existing save that lacks them.
  const raw = { crew: 0, clubs: { annex: { cash: 20, hype: 0, buzz: 0, patrons: 0, regulars: 0, b: { bar: 1 }, u: {}, elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0 } }, activeClub: 'annex' };
  game.sanitizeG(raw);
  strictEqual(raw.clubs.annex.b.roofbar, 0, 'roofbar backfilled to 0');
  strictEqual(raw.clubs.annex.u.skyline, false, 'skyline backfilled to false');
});

test('location extra buildings and upgrades affect rates/caps', () => {
  const game = newGame();
  const g = game.state.g;
  const c = game.club(g);
  c.patrons = 10;
  const rNo = game.rates(g);
  const capBase = game.caps(g).patrons;
  c.b.pool = 1; c.b.roofbar = 2; c.b.heli = 1;
  const r = game.rates(g);
  strictEqual(game.caps(g).patrons, capBase + 1 * 6 + 2 * 8 + 1 * 12, 'extra buildings raise the patron cap');
  // Cash from extras: 0.60 + 2×0.90 + 1.50 = 3.90, scaled by the same mults.
  const base = game.cashIncomeMult(g) * game.achievementMult(g);
  const expectedExtra = 3.90 * rNo.sm * base; // cashMult = twodrink(1)·hypeMult(1)·sm
  ok(Math.abs((r.cash - rNo.cash) - expectedExtra) < 1e-6, 'extra cash income present');
  // skyline: ×1.25 all cash in the annex.
  const g2 = newGame();
  g2.state.g.clubs.annex = g2.freshClubState('annex');
  g2.state.g.activeClub = 'annex';
  const a = g2.club(g2.state.g);
  a.patrons = 10;
  const rNoSky = g2.rates(g2.state.g);
  a.u.skyline = true;
  const rSky = g2.rates(g2.state.g);
  ok(rSky.cash > rNoSky.cash * 1.24 && rSky.cash < rNoSky.cash * 1.26, 'skyline ×1.25 cash');
  // vista: ×1.40 hype generation on the rooftop.
  const g3 = newGame();
  g3.state.g.clubs.rooftop = g3.freshClubState('rooftop');
  g3.state.g.activeClub = 'rooftop';
  const rt = g3.club(g3.state.g);
  rt.b.dj = 1;
  const hNo = g3.rates(g3.state.g).hype;
  rt.u.vista = true;
  const hVista = g3.rates(g3.state.g).hype;
  ok(hVista > hNo * 1.39 && hVista < hNo * 1.41, 'vista ×1.40 hype');
});

console.log(`Results: ${passed} passed, ${skipped} skipped, ${failed} failed`);
console.log('───────────────────────────────────────\n');

if (failed > 0) {
  console.error('❌ Some tests failed.\n');
  process.exit(1);
}
console.log(passed > 0 ? '✅ All non-skipped tests passed.\n' : '✅ All tests either passed or were skipped.\n');
process.exit(0);
