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

class Game {
  VERSION = { num: '0.4.0', build: 141, channel: 'alpha', date: '2026-08-02', codename: 'Neon Zero' };
  SAVE_VER = 4;
  KEY = 'afterglow.save';

  // Dev-only tunables the Claude-artifact prop editor used to expose
  // (showDebug / simSpeed / startingCash). Fixed to their defaults now that
  // this runs as a plain page instead of inside that editor.
  props = { showDebug: false, simSpeed: 1, startingCash: 20 };

  CHANGELOG = [
    { v: '0.4.0', date: '2026-08-02', codename: 'Neon Zero', notes: [
      'Full visual overhaul: neon-noir club shell, Monoton / Space Grotesk / IBM Plex Mono type system.',
      'Three-column idle layout — resource ledger, stage, systems panel — replacing the single canvas + button strip.',
      'Strict version tracker: header badge, footer stamp, in-game changelog, save-format versioning with migration wipe.',
      'Economy rebuilt around Cash, Hype, Buzz, Regulars and Clout with per-second rate readouts and soft caps.',
      'Crew system: hire dancers, assign them to Stage / VIP / Floor / Off.',
      'Four-phase shift cycle (Early, Peak, Last Call, After Hours) with per-phase multipliers.',
      'Research tree spending Clout; upgrade tier gated behind owned buildings.',
      'Autosave every 10s, offline progress up to 8h at 50% rate, export save to clipboard.',
      'Performer art is a marked render target — drop your own canvas at #performer-stage.'
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

  SHIFTS = [
    { name: 'Early Doors', mult: 0.7, len: 40, tint: '#22d3ee' },
    { name: 'Peak Hours', mult: 1.6, len: 55, tint: '#ff2d78' },
    { name: 'Last Call', mult: 1.15, len: 35, tint: '#ffc94a' },
    { name: 'After Hours', mult: 0.45, len: 30, tint: '#a855f7' }
  ];

  BUILDINGS = [
    { id: 'rail', name: 'Tip Rail', cost: 30, growth: 1.15, desc: 'Brass rail along the stage. +$0.05/s per patron worth of tips.' },
    { id: 'bar', name: 'Back Bar', cost: 75, growth: 1.17, desc: 'Drinks pay the rent. +$0.30/s and +5 floor capacity.' },
    { id: 'dj', name: 'DJ Booth', cost: 140, growth: 1.19, desc: 'Keeps the room moving. +0.09 Hype/s.' },
    { id: 'marquee', name: 'Marquee Sign', cost: 220, growth: 1.22, desc: '+0.10 Buzz/s and +35 Buzz capacity.' },
    { id: 'flyers', name: 'Flyer Crew', cost: 95, growth: 1.16, desc: 'Windshields all over downtown. +0.06 Buzz/s.' },
    { id: 'vip', name: 'VIP Booth', cost: 400, growth: 1.24, desc: 'Private bookings. +$0.9/s and +18% regular conversion.' },
    { id: 'door', name: 'Door Staff', cost: 180, growth: 1.20, desc: 'Fewer incidents. Cuts Hype decay by 12% each.' },
    { id: 'dress', name: 'Dressing Room', cost: 320, growth: 1.28, desc: '+2 crew capacity.' }
  ];

  UPGRADES = [
    { id: 'led', name: 'LED Pole Lighting', cost: 500, req: { dj: 2 }, desc: 'Hype generation x1.30.' },
    { id: 'twodrink', name: 'Two-Drink Minimum', cost: 900, req: { bar: 4 }, desc: 'All cash income x1.35.' },
    { id: 'coat', name: 'Coat Check', cost: 650, req: { door: 2 }, desc: '+20 floor capacity.' },
    { id: 'photog', name: 'House Photographer', cost: 1400, req: { marquee: 2 }, desc: 'Buzz generation x1.5.' },
    { id: 'bottle', name: 'Bottle Service', cost: 3200, req: { vip: 3 }, desc: 'VIP cash x2.2.' },
    { id: 'residency', name: 'Weekly Residency', cost: 5000, req: { dress: 2 }, desc: 'Crew output x1.4.' }
  ];

  RESEARCH = [
    { id: 'loop', name: 'Reputation Loop', cost: 4, desc: 'Regulars each add $0.04/s on their own.' },
    { id: 'latemenu', name: 'Late Kitchen', cost: 8, desc: 'After Hours multiplier 0.45 → 0.95.' },
    { id: 'promo', name: 'Promoter Network', cost: 14, desc: 'Buzz converts to patrons 60% faster.' },
    { id: 'payroll', name: 'Payroll Software', cost: 22, desc: 'Crew wages drop 40%.' },
    { id: 'franchise', name: 'Franchise Binder', cost: 60, desc: 'Unlocks the second location. [prestige — not implemented]' }
  ];

  JOBS = [
    { id: 'stage', name: 'Main Stage', desc: '+0.22 Hype/s each' },
    { id: 'vipjob', name: 'VIP Room', desc: '+$1.10/s each' },
    { id: 'floor', name: 'Floor Work', desc: '+0.05 Buzz/s, +regulars' },
    { id: 'off', name: 'Off Shift', desc: 'No wage drain' }
  ];

  state = {
    stageH: 300, tab: 'club', showChangelog: false, showSettings: false, tick: 0, saveState: 'idle', resetArmed: false,
    g: null
  };

  constructor(root) {
    this.root = root;
    this.state.g = this.fresh();
    this.handlers = [];
  }

  fresh() {
    const b = {}, u = {}, r = {};
    this.BUILDINGS.forEach(x => b[x.id] = 0);
    this.UPGRADES.forEach(x => u[x.id] = false);
    this.RESEARCH.forEach(x => r[x.id] = false);
    return {
      cash: (this.props && this.props.startingCash) ?? 20, hype: 0, buzz: 0, patrons: 0, regulars: 0, clout: 0,
      crew: 0, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      b, u, r, elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now()
    };
  }

  setState(update, cb) {
    const patch = typeof update === 'function' ? update(this.state) : update;
    Object.assign(this.state, patch);
    this.forceUpdate();
    if (cb) cb();
  }

  forceUpdate() { this.render(); }

  init() {
    let g = null, migrated = false, prevVer = null;
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        const p = JSON.parse(raw);
        prevVer = p.ver || null;
        if (p.saveVer === this.SAVE_VER) g = p.g; else migrated = true;
      }
    } catch (e) { migrated = true; }
    if (!g) g = this.fresh();
    g.jobs = g.jobs || { stage: 0, vipjob: 0, floor: 0, off: 0 };
    g.log = [];

    const offline = g.ts ? Math.min((Date.now() - g.ts) / 1000, 28800) : 0;
    this.state.g = g;
    this.push(g, 'Doors open. ' + this.VERSION.codename + ' build ' + this.VERSION.build + '.', '#22d3ee');
    if (migrated) this.push(g, 'Save format changed — previous save reset.', '#ff2d78');
    if (prevVer && prevVer !== this.VERSION.num) this.push(g, 'Updated ' + prevVer + ' → ' + this.VERSION.num + '.', '#ffc94a');
    if (offline > 60) {
      const cashBefore = Math.max(0, g.cash);
      let remaining = offline, gain = 0;
      while (remaining > 0) {
        const rates = this.rates(g);
        const cap = rates.cap;
        const left = rates.shift.len - g.shiftT;
        const chunk = Math.min(remaining, left);
        gain += rates.cash * chunk;
        g.hype = Math.max(0, Math.min(cap.hype, g.hype + rates.hype * chunk));
        g.buzz = Math.max(0, Math.min(cap.buzz, g.buzz + rates.buzz * chunk - this.buzzUse(g) * chunk));
        g.patrons = Math.max(0, Math.min(cap.patrons, g.patrons + rates.patrons * chunk));
        g.regulars += rates.regulars * chunk;
        g.clout += rates.clout * chunk;
        g.shiftT += chunk;
        remaining -= chunk;
        if (g.shiftT >= rates.shift.len) {
          g.shiftT = 0;
          g.shiftIdx = (g.shiftIdx + 1) % 4;
          if (g.shiftIdx === 0) g.night++;
        }
      }
      gain *= 0.5;
      if (gain < 0) gain = 0;
      g.cash = Math.max(0, g.cash + gain);
      const reported = Math.max(0, g.cash - cashBefore);
      this.push(g, 'Away ' + Math.round(offline / 60) + 'm — the room kept tipping: +$' + this.fmt(reported) + '.', '#ffc94a');
    }
    g.ts = Date.now();

    const measure = () => {
      const el = document.getElementById('stage');
      if (el && el.clientHeight && el.clientHeight !== this.state.stageH) this.setState({ stageH: el.clientHeight });
    };
    measure();
    if (window.ResizeObserver) {
      const el = document.getElementById('stage');
      if (el) { this.ro = new ResizeObserver(measure); this.ro.observe(el); }
    }
    this.timer = setInterval(() => {
      const g = this.state.g; if (!g) return;
      const now = Date.now();
      let dt = Math.max(0, (now - (g.ts || now)) / 1000);
      if (dt < 0.05) dt = 0.1;
      this.step(Math.min(dt, 28800));
    }, 100);
    this.saver = setInterval(() => this.save('auto'), 10000);
    this.forceUpdate();
  }

  push(g, msg, color) {
    const d = new Date();
    const t = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    g.log.unshift({ t, msg, color: color || '#b9a5c9' });
    if (g.log.length > 40) g.log.pop();
  }

  fmt(n) {
    if (n === undefined || n === null || isNaN(n)) return '0';
    const a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    if (a >= 100) return Math.floor(n).toString();
    if (a >= 10) return n.toFixed(1);
    return n.toFixed(2);
  }

  caps(g) {
    return {
      patrons: 10 + g.b.bar * 5 + (g.u.coat ? 20 : 0) + g.b.vip * 4,
      buzz: 50 + g.b.marquee * 35,
      hype: 100 + g.b.dj * 25,
      crew: 2 + g.b.dress * 2
    };
  }

  rates(g) {
    const cap = this.caps(g);
    const shift = this.SHIFTS[g.shiftIdx];
    let sm = shift.mult;
    if (g.shiftIdx === 3 && g.r.latemenu) sm = 0.95;
    const hypeMult = 1 + g.hype / 140;
    const crewMult = g.u.residency ? 1.4 : 1;
    const cashMult = (g.u.twodrink ? 1.35 : 1) * hypeMult * sm;

    const bottle = g.u.bottle ? 2.2 : 1;
    const railCap = g.b.rail * 6;
    let cash = (0.08 + Math.min(g.patrons, railCap) * 0.05 + g.b.bar * 0.30) * cashMult;
    cash += g.b.vip * 0.9 * bottle * cashMult;
    cash += g.jobs.vipjob * 1.10 * crewMult * bottle * cashMult;
    cash += g.patrons * 0.012 * cashMult;
    if (g.r.loop) cash += g.regulars * 0.04 * cashMult;
    const wage = (g.crew - g.jobs.off) * 0.22 * (g.r.payroll ? 0.6 : 1);
    cash -= wage;

    const hypeGain = (g.b.dj * 0.09 + g.jobs.stage * 0.22 * crewMult) * (g.u.led ? 1.3 : 1);
    const decay = g.hype * 0.014 * Math.max(0.25, 1 - g.b.door * 0.12);
    const hype = hypeGain - decay;

    const buzz = (g.b.marquee * 0.10 + g.b.flyers * 0.06 + g.jobs.floor * 0.05 * crewMult) * (g.u.photog ? 1.5 : 1);
    const pull = Math.min(g.buzz, 0.8) * (g.r.promo ? 1.6 : 1) * (1 + g.hype / 200);
    const patrons = Math.min(pull, Math.max(0, cap.patrons - g.patrons)) - g.patrons * 0.02;
    const regulars = g.patrons * 0.0007 * (1 + g.b.vip * 0.18) * sm;
    const clout = g.regulars * 0.0016;
    return { cash, hype, buzz, patrons, regulars, clout, wage, cap, shift, sm, pull };
  }

  buzzUse(g) {
    return Math.min(g.buzz, 0.8) * (g.r.promo ? 1.6 : 1);
  }

  step(dt) {
    const g = this.state.g;
    if (!g) return;
    dt *= (this.props.simSpeed ?? 1);
    dt = Math.min(dt, 28800);
    let remaining = dt;
    while (remaining > 0) {
      const r = this.rates(g);
      const cap = r.cap;
      const left = r.shift.len - g.shiftT;
      const chunk = Math.min(remaining, left);
      const chatty = remaining <= 0.5;
      g.cash = Math.max(0, g.cash + r.cash * chunk);
      g.hype = Math.max(0, Math.min(cap.hype, g.hype + r.hype * chunk));
      g.buzz = Math.max(0, Math.min(cap.buzz, g.buzz + r.buzz * chunk - this.buzzUse(g) * chunk));
      g.patrons = Math.max(0, Math.min(cap.patrons, g.patrons + r.patrons * chunk));
      g.regulars += r.regulars * chunk;
      g.clout += r.clout * chunk;
      g.elapsed += chunk;
      g.shiftT += chunk;
      remaining -= chunk;
      if (g.shiftT >= r.shift.len) {
        g.shiftT = 0;
        g.shiftIdx = (g.shiftIdx + 1) % 4;
        if (g.shiftIdx === 0) g.night++;
        if (chatty) {
          if (g.shiftIdx === 0) this.push(g, 'Night ' + g.night + ' begins.', '#a855f7');
          else {
            const effMult = (g.shiftIdx === 3 && g.r.latemenu) ? 0.95 : this.SHIFTS[g.shiftIdx].mult;
            this.push(g, this.SHIFTS[g.shiftIdx].name + ' — x' + effMult.toFixed(2) + ' take.', this.SHIFTS[g.shiftIdx].tint);
          }
        }
      }
    }
    g.ts = Date.now();
    this.setState(s => ({ tick: s.tick + 1 }));
  }

  save(kind) {
    const g = this.state.g;
    if (!g) return;
    try {
      localStorage.setItem(this.KEY, JSON.stringify({ saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g }));
      this.setState({ saveState: kind === 'auto' ? 'autosaved' : 'saved ✓' });
    } catch (e) { this.setState({ saveState: 'save failed' }); }
  }

  buyBuilding(def) {
    const g = this.state.g;
    const n = g.b[def.id];
    const price = Math.floor(def.cost * Math.pow(def.growth, n));
    if (g.cash < price) return;
    g.cash -= price;
    g.b[def.id] = n + 1;
    this.push(g, 'Built ' + def.name + ' #' + (n + 1) + ' for $' + this.fmt(price) + '.', '#22d3ee');
    this.forceUpdate();
  }
  buyUpgrade(def) {
    const g = this.state.g;
    if (g.u[def.id] || g.cash < def.cost) return;
    g.cash -= def.cost;
    g.u[def.id] = true;
    this.push(g, 'Installed ' + def.name + '.', '#ffc94a');
    this.forceUpdate();
  }
  buyResearch(def) {
    const g = this.state.g;
    if (g.r[def.id] || g.clout < def.cost) return;
    g.clout -= def.cost;
    g.r[def.id] = true;
    this.push(g, 'Researched ' + def.name + '.', '#a855f7');
    this.forceUpdate();
  }
  hireCrew() {
    const g = this.state.g;
    const cap = this.caps(g).crew;
    if (g.crew >= cap) return;
    const price = Math.floor(250 * Math.pow(1.38, g.crew));
    if (g.cash < price) return;
    g.cash -= price;
    g.crew++;
    g.jobs.off++;
    this.push(g, 'Hired crew member #' + g.crew + ' for $' + this.fmt(price) + '.', '#ff2d78');
    this.forceUpdate();
  }
  moveJob(id, d) {
    const g = this.state.g;
    if (d > 0) {
      const used = g.jobs.stage + g.jobs.vipjob + g.jobs.floor + g.jobs.off;
      if (id !== 'off') { if (g.jobs.off < 1) return; g.jobs.off--; }
      else if (used >= g.crew) return;
      g.jobs[id]++;
    } else {
      if (id === 'off') return;
      if (g.jobs[id] < 1) return;
      g.jobs[id]--;
      g.jobs.off++;
    }
    this.forceUpdate();
  }

  bar(pct, color) {
    return { width: Math.max(0, Math.min(100, pct)) + '%', height: '100%', background: color, borderRadius: '3px', transition: 'width .18s linear' };
  }

  renderVals() {
    const g = this.state.g;
    const V = this.VERSION;
    const base = {
      verLabel: 'v' + V.num, verBuild: V.build, verChannel: V.channel,
      verFull: 'v' + V.num + ' · build ' + V.build + ' · ' + V.channel + ' · ' + V.codename + ' · ' + V.date,
      saveVer: this.SAVE_VER, changelog: this.CHANGELOG.map(c => ({ ...c })),
      showChangelog: this.state.showChangelog, showSettings: this.state.showSettings,
      resetHint: this.state.resetArmed ? '⚠ Click "Wipe save and restart" again to confirm — this is permanent.' : '',
      resetLabel: this.state.resetArmed ? '⚠ Confirm — click again to wipe' : 'Wipe save and restart',
      resetStyle: {
        background: this.state.resetArmed ? '#4a0f1e' : '#22060f', border: '1px solid ' + (this.state.resetArmed ? '#ff2d78' : '#6b1130'),
        borderRadius: '7px', color: this.state.resetArmed ? '#fff' : '#ff7aa8', padding: '11px', cursor: 'pointer',
        fontSize: '12px', fontWeight: 700, textAlign: 'left'
      },
      toggleChangelog: () => this.setState(s => ({ showChangelog: !s.showChangelog })),
      toggleSettings: () => this.setState(s => ({ showSettings: !s.showSettings, resetArmed: false })),
      saveNow: () => this.save('manual'),
      exportSave: async () => { try { await navigator.clipboard.writeText(JSON.stringify({ saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g: this.state.g })); this.setState({ saveState: 'copied' }); } catch (e) { this.setState({ saveState: 'clipboard failed' }); } },
      hardReset: () => {
        if (!this.state.resetArmed) { this.setState({ resetArmed: true }); return; }
        localStorage.removeItem(this.KEY);
        this.state.g = this.fresh();
        this.push(this.state.g, 'Save wiped. Fresh club.', '#ff2d78');
        this.setState({ showSettings: false, resetArmed: false });
      },
      tickCount: this.state.tick, saveState: this.state.saveState
    };
    if (!g) return base;

    const r = this.rates(g), cap = r.cap;
    const sign = v => (v >= 0 ? '+' : '') + this.fmt(v) + '/s';

    const resources = [
      { name: 'Cash', val: '$' + this.fmt(g.cash), rate: sign(r.cash), pct: 100, color: '#ffc94a', note: r.wage > 0 ? 'wages −$' + this.fmt(r.wage) + '/s' : 'no payroll yet' },
      { name: 'Hype', val: this.fmt(g.hype), rate: sign(r.hype), pct: g.hype / cap.hype * 100, color: '#ff2d78', note: 'cap ' + cap.hype + ' · x' + (1 + g.hype / 140).toFixed(2) + ' income' },
      { name: 'Buzz', val: this.fmt(g.buzz), rate: sign(r.buzz - this.buzzUse(g)), pct: g.buzz / cap.buzz * 100, color: '#22d3ee', note: 'cap ' + cap.buzz + ' · pulls patrons in' },
      { name: 'Patrons', val: this.fmt(g.patrons), rate: sign(r.patrons), pct: g.patrons / cap.patrons * 100, color: '#a855f7', note: 'floor cap ' + cap.patrons },
      { name: 'Regulars', val: this.fmt(g.regulars), rate: sign(r.regulars), pct: Math.min(100, g.regulars), color: '#4ade80', note: g.r.loop ? '$0.04/s each' : 'unlock Reputation Loop' },
      { name: 'Clout', val: this.fmt(g.clout), rate: sign(r.clout), pct: Math.min(100, g.clout * 2), color: '#e879f9', note: 'spent on research' }
    ].map(x => ({
      name: x.name, val: x.val, rate: x.rate, note: x.note,
      valStyle: { fontFamily: "'IBM Plex Mono',monospace", fontSize: '15px', fontWeight: 600, color: x.color },
      barStyle: this.bar(x.pct, x.color)
    }));

    const stats = [
      { k: 'Crew', v: g.crew + ' / ' + cap.crew },
      { k: 'On stage', v: String(g.jobs.stage) },
      { k: 'Structures', v: String(Object.values(g.b).reduce((a, b) => a + b, 0)) },
      { k: 'Night time', v: Math.floor(g.elapsed / 60) + 'm ' + Math.floor(g.elapsed % 60) + 's' }
    ];

    const tabDefs = [
      { id: 'club', label: 'Club' }, { id: 'crew', label: 'Crew' },
      { id: 'up', label: 'Upgrades' }, { id: 'res', label: 'Research' }
    ];
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
      color: ok ? '#fff' : '#5c4470', padding: '8px 12px', cursor: ok ? 'pointer' : 'not-allowed',
      fontSize: '11px', fontWeight: 700, letterSpacing: '.6px', minWidth: '104px'
    });

    let cards = [], tabHint = '';
    if (this.state.tab === 'club') {
      tabHint = 'Structures are permanent and scale in price. Everything on this tab is bought with cash.';
      cards = this.BUILDINGS.map(d => {
        const n = g.b[d.id], price = Math.floor(d.cost * Math.pow(d.growth, n)), ok = g.cash >= price;
        return { name: d.name, desc: d.desc, owned: n > 0 ? '×' + n : '—', btn: 'Build $' + this.fmt(price),
          meta: ok ? 'affordable' : 'need $' + this.fmt(price - g.cash), locked: !ok,
          wrapStyle: cardWrap(true), btnStyle: btn(ok), act: () => this.buyBuilding(d) };
      });
    } else if (this.state.tab === 'crew') {
      tabHint = 'Crew cost a wage every second. Park them Off Shift when the room is dead.';
      const price = Math.floor(250 * Math.pow(1.38, g.crew));
      const room = g.crew < cap.crew, ok = room && g.cash >= price;
      cards = [{ name: 'Hire Crew', desc: 'Dancers, bartenders, hosts. Assign them below. Capacity comes from Dressing Rooms.',
        owned: g.crew + ' / ' + cap.crew, btn: room ? 'Hire $' + this.fmt(price) : 'At capacity',
        meta: room ? (ok ? 'affordable' : 'need $' + this.fmt(price - g.cash)) : 'build a Dressing Room',
        locked: !ok, wrapStyle: cardWrap(true), btnStyle: btn(ok), act: () => this.hireCrew() }];
    } else if (this.state.tab === 'up') {
      tabHint = 'One-time purchases. Each unlocks once you own enough of the required structure.';
      cards = this.UPGRADES.map(d => {
        const reqId = Object.keys(d.req)[0], need = d.req[reqId];
        const have = g.b[reqId] >= need, bought = g.u[d.id], ok = !bought && have && g.cash >= d.cost;
        const rn = this.BUILDINGS.find(b => b.id === reqId).name;
        return { name: d.name, desc: d.desc, owned: bought ? 'owned' : '',
          btn: bought ? 'Installed' : 'Buy $' + this.fmt(d.cost),
          meta: bought ? '' : (have ? (ok ? 'affordable' : 'need $' + this.fmt(d.cost - g.cash)) : 'requires ' + rn + ' ×' + need),
          locked: !ok, wrapStyle: cardWrap(have && !bought), btnStyle: btn(ok, '#ffc94a'), act: () => this.buyUpgrade(d) };
      });
    } else {
      tabHint = 'Research is paid in Clout, which accrues slowly from Regulars. Permanent, global effects.';
      cards = this.RESEARCH.map(d => {
        const bought = g.r[d.id], ok = !bought && g.clout >= d.cost;
        return { name: d.name, desc: d.desc, owned: bought ? 'done' : '',
          btn: bought ? 'Researched' : d.cost + ' Clout',
          meta: bought ? '' : (ok ? 'ready' : this.fmt(d.cost - g.clout) + ' Clout short'),
          locked: !ok, wrapStyle: cardWrap(!bought), btnStyle: btn(ok, '#a855f7'), act: () => this.buyResearch(d) };
      });
    }

    const assigned = g.jobs.stage + g.jobs.vipjob + g.jobs.floor;
    const jobs = this.JOBS.map(j => ({
      name: j.name, desc: j.desc, n: g.jobs[j.id],
      inc: () => this.moveJob(j.id, 1), dec: () => this.moveJob(j.id, -1),
      incLocked: j.id === 'off' ? assigned + g.jobs.off >= g.crew : g.jobs.off < 1,
      decLocked: j.id === 'off' ? true : g.jobs[j.id] < 1,
      stepStyle: { width: '26px', height: '26px', border: '1px solid #3a2350', borderRadius: '5px', background: '#170e22', color: '#e7d8f2', cursor: 'pointer', fontSize: '14px', lineHeight: 1 }
    }));

    const clickVal = 4 + g.b.rail * 1.5 + g.hype * 0.12;
    const roundPrice = Math.floor(40 + g.patrons * 6);
    const roundOk = g.cash >= roundPrice;

    return {
      ...base,
      resources, stats, tabs, cards, tabHint, jobs, crewOpen: this.state.tab === 'crew' && g.crew > 0,
      log: g.log.map(l => ({ t: l.t, msg: l.msg, style: { color: l.color } })),
      shiftName: r.shift.name, nightNo: g.night, shiftMultLabel: 'x' + r.sm.toFixed(2),
      shiftBar: this.bar(g.shiftT / r.shift.len * 100, r.shift.tint),
      perfStyle: {
        position: 'absolute', left: '50%', bottom: '22%',
        transformOrigin: 'bottom center',
        transform: 'translateX(-50%) scale(' + Math.max(0.42, Math.min(1, (this.state.stageH * 0.78 - 38) / 260)).toFixed(3) + ')',
        width: '190px', height: '260px',
        ['--bpm']: Math.max(0.55, 2.3 - (g.hype / cap.hype) * 1.6).toFixed(2) + 's',
        opacity: g.jobs.stage > 0 ? 1 : 0.55,
        filter: g.jobs.stage > 0 ? 'none' : 'grayscale(.6)',
        transition: 'opacity .4s linear'
      },
      stageLine: g.jobs.stage > 0 ? g.jobs.stage + ' on rotation' : 'nobody on stage',
      energyPct: Math.round(g.hype / cap.hype * 100) + '%',
      clickValue: '$' + this.fmt(clickVal),
      workCrowd: () => { g.cash += clickVal; g.buzz = Math.min(cap.buzz, g.buzz + 0.4); this.forceUpdate(); },
      roundLabel: 'Buy a round $' + this.fmt(roundPrice),
      roundLocked: !roundOk,
      roundStyle: {
        background: roundOk ? '#170e22' : '#120c1c', border: '1px solid ' + (roundOk ? '#3a2350' : '#1f1430'),
        borderRadius: '8px', color: roundOk ? '#e7d8f2' : '#4a3860', padding: '13px 16px',
        cursor: roundOk ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 700, minWidth: '190px'
      },
      buyRound: () => { if (g.cash < roundPrice) return; g.cash -= roundPrice; g.hype = Math.min(cap.hype, g.hype + 14); this.push(g, 'Bought the room a round. +14 Hype.', '#ffc94a'); this.forceUpdate(); },
      debugLine: (this.props.showDebug ?? false) ? 'cash ' + r.cash.toFixed(3) + '/s · hype ' + r.hype.toFixed(3) + '/s · buzz ' + r.buzz.toFixed(3) + '/s · pull ' + r.pull.toFixed(2) : ''
    };
  }

  // --- render: turns renderVals() into markup, mirroring the original
  // template's {{ interpolations }}, sc-for loops and sc-if branches with
  // plain template literals + a click-handler registry (data-h index). ---

  bind(fn) {
    this.handlers.push(fn);
    return this.handlers.length - 1;
  }

  render() {
    this.handlers = [];
    const v = this.renderVals();

    const resourceRows = v.resources.map(r => `
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
        <div style="font-size:10px;color:#5c4470;margin-top:3px">${r.note}</div>
      </div>`).join('');

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
        <div style="display:flex;align-items:center;gap:8px">
          <button data-h="${this.bind(cd.act)}" ${cd.locked ? 'disabled' : ''} style="${css(cd.btnStyle)}">${cd.btn}</button>
          <span style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#6f5885;text-align:right;flex:1">${cd.meta}</span>
        </div>
      </div>`).join('');

    const jobRows = v.jobs.map(j => `
      <div style="display:flex;align-items:center;gap:9px;border:1px solid #221434;border-radius:7px;background:#0f0a18;padding:8px 9px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:#e7d8f2">${j.name}</div>
          <div style="font-size:10px;color:#6f5885">${j.desc}</div>
        </div>
        <button data-h="${this.bind(j.dec)}" ${j.decLocked ? 'disabled' : ''} style="${css(j.stepStyle)}">−</button>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#ffc94a;min-width:20px;text-align:center;font-weight:600">${j.n}</span>
        <button data-h="${this.bind(j.inc)}" ${j.incLocked ? 'disabled' : ''} style="${css(j.stepStyle)}">+</button>
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
                  <span style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#5c4470">${c.date}</span>
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

    const settingsModal = v.showSettings ? `
      <div style="position:fixed;inset:0;background:rgba(5,3,9,.82);display:flex;align-items:center;justify-content:center;z-index:60;padding:32px">
        <div style="width:420px;background:#0e0918;border:1px solid #3a2350;border-radius:12px;box-shadow:0 30px 90px rgba(0,0,0,.7)">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #241536">
            <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700">Settings</div>
            <button data-h="${this.bind(v.toggleSettings)}" class="hv-pink" style="width:30px;height:30px;border:1px solid #3a2350;border-radius:6px;background:#160d22;color:#9c86ab;cursor:pointer;font-size:14px">✕</button>
          </div>
          <div style="padding:16px 18px;display:flex;flex-direction:column;gap:10px">
            <button data-h="${this.bind(v.saveNow)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Save now</button>
            <button data-h="${this.bind(v.exportSave)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Copy save to clipboard</button>
            <button data-h="${this.bind(v.hardReset)}" style="${css(v.resetStyle)}">${v.resetLabel}</button>
            <div style="font-size:10.5px;color:#5c4470;line-height:1.5;font-family:'IBM Plex Mono',monospace">${v.resetHint} ${v.verFull} · save format v${v.saveVer}</div>
          </div>
        </div>
      </div>` : '';

    this.root.innerHTML = `
<div style="height:100vh;display:grid;grid-template-rows:auto 1fr auto;background:radial-gradient(1200px 700px at 50% -10%,#1a0e26 0%,#07050c 62%);overflow:hidden">

  <header style="display:flex;align-items:center;gap:20px;padding:0 18px;height:62px;border-bottom:1px solid #2a1738;background:linear-gradient(180deg,#140b1f,#0b0712);position:relative;z-index:20">
    <div style="display:flex;align-items:baseline;gap:12px">
      <span style="font-family:'Monoton',cursive;font-size:24px;color:#ff2d78;letter-spacing:1px;text-shadow:0 0 12px rgba(255,45,120,.75),0 0 34px rgba(255,45,120,.35);animation:neonFlicker 7s infinite">Afterglow</span>
      <span style="font-size:10px;letter-spacing:3.5px;text-transform:uppercase;color:#7b5f90;font-weight:700">Club Idle</span>
    </div>

    <button data-h="${this.bind(v.toggleChangelog)}" title="Version history" class="hv-pink" style="display:flex;align-items:center;gap:9px;background:#170e22;border:1px solid #3a2350;border-radius:6px;padding:6px 11px;cursor:pointer;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#d6c2e6">
      <span style="width:6px;height:6px;border-radius:50%;background:#22d3ee;box-shadow:0 0 7px #22d3ee;animation:pulseDot 2.2s infinite"></span>
      <span style="color:#ffc94a;font-weight:600">${v.verLabel}</span>
      <span style="color:#5c4470">|</span>
      <span>build ${v.verBuild}</span>
      <span style="color:#5c4470">|</span>
      <span style="text-transform:uppercase;letter-spacing:1px;color:#ff2d78">${v.verChannel}</span>
    </button>

    <div style="flex:1"></div>

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

  <main style="display:grid;grid-template-columns:262px minmax(420px,1fr) 352px;min-height:0;overflow:auto">

    <aside style="border-right:1px solid #2a1738;background:#0a0611;overflow-y:auto;padding:14px 12px">
      <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700;margin-bottom:10px">Ledger</div>
      <div style="display:flex;flex-direction:column;gap:9px">${resourceRows}</div>

      <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700;margin:18px 0 8px">Floor</div>
      <div style="border:1px solid #221434;border-radius:7px;background:#0f0a18;padding:9px">${statRows}</div>
    </aside>

    <section style="display:grid;grid-template-rows:minmax(300px,1fr) auto 146px;min-height:0;min-width:0">

      <div id="stage" style="position:relative;overflow:hidden;min-height:0;background:linear-gradient(180deg,#12081c 0%,#1a0b26 55%,#0d0715 100%);border-bottom:1px solid #2a1738">
        <div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,45,120,.05) 0 2px,transparent 2px 62px)"></div>
        <div style="position:absolute;top:0;left:0;right:0;height:22px;display:flex;justify-content:center;gap:16px;align-items:center;background:linear-gradient(180deg,#1e1029,transparent)">
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite 0s"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite .2s"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite .4s"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite .6s"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite .8s"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite 1s"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite 1.2s"></span>
          <span style="width:5px;height:5px;border-radius:50%;background:#ffc94a;animation:bulb 1.6s infinite 1.4s"></span>
        </div>

        <div style="position:absolute;top:25px;left:50%;transform:translateX(-50%);white-space:nowrap;font-family:'Monoton',cursive;font-size:13px;color:#22d3ee;letter-spacing:2px;text-shadow:0 0 10px rgba(34,211,238,.8),0 0 30px rgba(34,211,238,.4);animation:neonFlicker 9s infinite;opacity:.9">girls girls girls</div>

        <div style="position:absolute;top:-10%;left:26%;width:120px;height:78%;transform-origin:50% 0;background:linear-gradient(180deg,rgba(255,45,120,.42),rgba(255,45,120,0));filter:blur(14px);animation:sweepL 9s ease-in-out infinite"></div>
        <div style="position:absolute;top:-10%;right:26%;width:120px;height:78%;transform-origin:50% 0;background:linear-gradient(180deg,rgba(34,211,238,.34),rgba(34,211,238,0));filter:blur(14px);animation:sweepR 11s ease-in-out infinite"></div>

        <div style="position:absolute;left:50%;bottom:26%;transform:translateX(-50%);width:230px;height:56px;border-radius:50%;background:radial-gradient(closest-side,rgba(255,232,180,.34),rgba(255,232,180,0));filter:blur(6px)"></div>

        <div style="position:absolute;left:0;right:0;bottom:24%;height:1px;background:linear-gradient(90deg,transparent,#ff2d78,transparent);opacity:.6"></div>
        <div style="position:absolute;left:0;right:0;bottom:0;height:24%;background:linear-gradient(180deg,#1b1027,#0a0611);border-top:1px solid #38204d"></div>

        <div style="position:absolute;left:0;right:0;bottom:0;height:74px;display:flex;align-items:flex-end;justify-content:center;gap:22px;opacity:.85">
          <span style="width:26px;height:44px;border-radius:13px 13px 0 0;background:#160d20;animation:crowdBob 3.1s ease-in-out infinite"></span>
          <span style="width:30px;height:52px;border-radius:15px 15px 0 0;background:#120a1b;animation:crowdBob 2.6s ease-in-out infinite .3s"></span>
          <span style="width:24px;height:38px;border-radius:12px 12px 0 0;background:#180e23;animation:crowdBob 3.6s ease-in-out infinite .7s"></span>
          <span style="width:200px"></span>
          <span style="width:28px;height:46px;border-radius:14px 14px 0 0;background:#150c1f;animation:crowdBob 2.9s ease-in-out infinite .2s"></span>
          <span style="width:32px;height:56px;border-radius:16px 16px 0 0;background:#110919;animation:crowdBob 3.3s ease-in-out infinite .9s"></span>
          <span style="width:25px;height:40px;border-radius:12px 12px 0 0;background:#170d21;animation:crowdBob 2.4s ease-in-out infinite .5s"></span>
        </div>

        <div id="performer-stage" style="${css(v.perfStyle)}">
          <!-- Reserved mount point for a performer canvas (210x238). No DOM performer art here. -->
        </div>

        <div style="position:absolute;left:14px;top:14px;display:flex;flex-direction:column;gap:5px">
          <div style="font-size:9px;letter-spacing:2.6px;text-transform:uppercase;color:#7b5f90;font-weight:700">Main Stage</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#ff2d78">${v.stageLine}</div>
        </div>

        <div style="position:absolute;right:14px;top:14px;text-align:right">
          <div style="font-size:9px;letter-spacing:2.6px;text-transform:uppercase;color:#7b5f90;font-weight:700">Room energy</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:26px;color:#ffc94a;font-weight:600;line-height:1.1">${v.energyPct}</div>
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:10px;padding:12px 14px;background:#0b0712;border-bottom:1px solid #2a1738;align-items:center">
        <button data-h="${this.bind(v.workCrowd)}" class="cta" style="flex:1 1 240px;background:linear-gradient(180deg,#ff3d85,#d81259);border:0;border-radius:8px;color:#fff;font-weight:700;font-size:13px;letter-spacing:1.2px;text-transform:uppercase;padding:13px 16px;cursor:pointer;box-shadow:0 0 22px rgba(255,45,120,.35)">Work the room <span style="font-family:'IBM Plex Mono',monospace;opacity:.85;text-transform:none;letter-spacing:0">+${v.clickValue}</span></button>
        <button data-h="${this.bind(v.buyRound)}" ${v.roundLocked ? 'disabled' : ''} style="${css(v.roundStyle)}">${v.roundLabel}</button>
      </div>

      <div style="background:#080510;overflow-y:auto;padding:10px 14px">
        <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700;margin-bottom:7px">Night log</div>
        <div style="display:flex;flex-direction:column;gap:3px">${logRows}</div>
      </div>
    </section>

    <aside style="border-left:1px solid #2a1738;background:#0a0611;display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0">
      <div style="display:flex;border-bottom:1px solid #2a1738;background:#0d0814">${tabRows}</div>

      <div style="overflow-y:auto;padding:12px">
        <div style="font-size:10.5px;color:#6f5885;line-height:1.5;margin-bottom:11px">${v.tabHint}</div>

        <div style="display:flex;flex-direction:column;gap:8px">${cardRows}</div>

        ${assignments}
      </div>
    </aside>
  </main>

  <footer style="display:flex;align-items:center;gap:16px;height:28px;padding:0 14px;border-top:1px solid #2a1738;background:#0b0712;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#5c4470">
    <span style="color:#ffc94a">${v.verFull}</span>
    <span>save v${v.saveVer}</span>
    <span>${v.saveState}</span>
    <div style="flex:1"></div>
    <span>${v.debugLine}</span>
    <span>ticks ${v.tickCount}</span>
  </footer>

  ${changelogModal}
  ${settingsModal}
</div>`;

    this.root.querySelectorAll('[data-h]').forEach(el => {
      const fn = this.handlers[Number(el.getAttribute('data-h'))];
      if (fn) el.onclick = fn;
    });
  }
}

const game = new Game(document.getElementById('app'));
game.init();
window.__game = game;
