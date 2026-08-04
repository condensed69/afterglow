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
  VERSION = { num: '0.6.1', build: 169, channel: 'alpha', date: '2026-08-04', codename: 'Neon Zero' };
  SAVE_VER = 5;
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
    // v3 → v4: jobs/crew assignment honesty (was an informal init() fixup).
    3(g) {
      this.sanitizeG(g);
    },
    // v4 → v5: Owner's List fields; backfill completed goals without paying rewards.
    // Credit every satisfied check (no sequential break) so mid-game saves don't get
    // live reward cascades for already-earned state. Holes are fine — activeGoal
    // still returns the first missing id for live play.
    4(g) {
      g.goals = [];
      g.clicks = 0;
      g.rounds = 0;
      const b = g.b || {};
      // v4 never tracked clicks; clubs past the opener clearly finished the click tutorial.
      if (g.crew > 0 || g.patrons > 0 || g.regulars > 0 ||
          Object.values(b).some(n => n > 0)) {
        g.clicks = 5;
      }
      for (const goal of this.GOALS) {
        if (goal.check(g)) g.goals.push(goal.id);
      }
    }
  };

  CHANGELOG = [
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
    { id: 'residency', name: 'Weekly Residency', cost: 5800, req: { dress: 2 }, desc: 'Crew output x1.4.' }
  ];

  RESEARCH = [
    { id: 'loop', name: 'Reputation Loop', cost: 6, desc: 'Regulars each add $0.04/s on their own.' },
    { id: 'latemenu', name: 'Late Kitchen', cost: 12, desc: 'After Hours multiplier 0.45 → 0.95.' },
    { id: 'promo', name: 'Promoter Network', cost: 20, desc: 'Buzz converts to patrons 60% faster.' },
    { id: 'payroll', name: 'Payroll Software', cost: 32, desc: 'Crew wages drop 40%.' }
  ];

  JOBS = [
    { id: 'stage', name: 'Main Stage', desc: '+0.24 Hype/s each' },
    { id: 'vipjob', name: 'VIP Room', desc: '+$1.35/s each' },
    { id: 'floor', name: 'Floor Work', desc: '+0.035 Buzz/s' },
    { id: 'off', name: 'Off Shift', desc: 'No wage drain' }
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
    stageH: 300, tab: 'club', showChangelog: false, showSettings: false, tick: 0, saveState: 'idle', resetArmed: false,
    // true when another tab wrote KEY — autosave is off until reload (PLAN §2.3).
    tabStale: false,
    g: null
  };

  constructor(root) {
    this.root = root;
    this.state.g = this.fresh();
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
      if (fn) fn(e);
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
    const b = {}, u = {}, r = {};
    this.BUILDINGS.forEach(x => b[x.id] = 0);
    this.UPGRADES.forEach(x => u[x.id] = false);
    this.RESEARCH.forEach(x => r[x.id] = false);
    return {
      cash: (this.props && this.props.startingCash) ?? 20, hype: 0, buzz: 0, patrons: 0, regulars: 0, clout: 0,
      crew: 0, jobs: { stage: 0, vipjob: 0, floor: 0, off: 0 },
      b, u, r, elapsed: 0, night: 1, shiftIdx: 0, shiftT: 0, log: [], ts: Date.now(),
      // Owner's List (SAVE_VER 5) — not required by isValidSavePayload (v4 imports lack them).
      goals: [], clicks: 0, rounds: 0
    };
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
    g.jobs = g.jobs || { stage: 0, vipjob: 0, floor: 0, off: 0 };
    g.crew = Math.max(0, g.crew | 0);
    // Keep assignment totals honest after old saves / partial migrations.
    for (const k of ['stage', 'vipjob', 'floor', 'off']) g.jobs[k] = Math.max(0, g.jobs[k] | 0);
    let jobSum = g.jobs.stage + g.jobs.vipjob + g.jobs.floor + g.jobs.off;
    if (jobSum < g.crew) g.jobs.off += g.crew - jobSum;
    else if (jobSum > g.crew) {
      let over = jobSum - g.crew;
      for (const k of ['off', 'floor', 'vipjob', 'stage']) {
        const take = Math.min(g.jobs[k], over);
        g.jobs[k] -= take;
        over -= take;
        if (!over) break;
      }
    }
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
    for (const k of ['cash', 'hype', 'buzz', 'patrons', 'regulars', 'clout', 'crew']) {
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
    const numeric = ['cash', 'hype', 'buzz', 'patrons', 'regulars', 'clout', 'crew',
      'elapsed', 'night', 'shiftIdx', 'shiftT', 'ts'];
    for (const k of numeric) {
      if (g[k] === undefined) g[k] = defaults[k];
      if (typeof g[k] !== 'number' || !Number.isFinite(g[k])) return false;
    }
    if (!Number.isInteger(g.shiftIdx) || !this.SHIFTS[g.shiftIdx]) return false;
    if (g.shiftT < 0 || g.shiftT >= this.SHIFTS[g.shiftIdx].len) return false;
    if (g.elapsed < 0 || g.night < 1) return false;

    // Rebuild from known IDs only — unknown keys (e.g. string-valued XSS bait under
    // g.b) must not survive into Object.values(g.b) / Structures or other paths.
    for (const [key, defs, fallback] of [
      ['b', this.BUILDINGS, 0], ['u', this.UPGRADES, false], ['r', this.RESEARCH, false]
    ]) {
      if (g[key] === undefined) g[key] = {};
      if (!g[key] || typeof g[key] !== 'object' || Array.isArray(g[key])) return false;
      const next = Object.create(null);
      for (const def of defs) {
        let value = g[key][def.id];
        if (value === undefined) value = fallback;
        if (key === 'b') {
          if (!Number.isInteger(value) || value < 0) return false;
        } else if (typeof value !== 'boolean') return false;
        next[def.id] = value;
      }
      g[key] = next;
    }

    if (!g.jobs || typeof g.jobs !== 'object' || Array.isArray(g.jobs)) return false;
    const jobsNext = Object.create(null);
    for (const k of ['stage', 'vipjob', 'floor', 'off']) {
      let value = g.jobs[k];
      if (value === undefined) value = 0;
      if (!Number.isFinite(value) || value < 0) return false;
      jobsNext[k] = value;
    }
    g.jobs = jobsNext;
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
          saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g
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
      this.state.g = g;
      // Successful persist is an explicit ownership take (import path):
      // a non-claiming second tab must start autosave and mark owner so later
      // progress is not lost after pausing siblings via the storage event.
      this.state.tabStale = false;
      this.markTabOwner();
      this.startAutosave();
      this.setState({ tabStale: false, saveState: 'imported' });
      return true;
    } catch (e) {
      this.setState({ saveState: 'import failed' });
      return false;
    }
  }

  init() {
    let g = null, wiped = false, upgraded = false, prevVer = null, fromSaveVer = null;
    try {
      const raw = localStorage.getItem(this.KEY);
      if (raw) {
        const p = JSON.parse(raw);
        prevVer = p.ver || null;
        fromSaveVer = p.saveVer;
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
    this.state.g = g;
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
      if (offline > 0 && claimed) {
        const report = this.catchUp(g, offline);
        if (offline > 60) this.push(g, this.awayMsg(offline, report), '#ffc94a');
        // Offline: peak (goal 12) must not complete here — live-only.
        this.noteGoals(g, { live: false });
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
      g.ts = Date.now();
    }

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
        g.ts = Date.now();
        this.setState(s => ({ tick: s.tick + 1 }));
      } else {
        this.step(Math.min(dt, 28800));
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
    if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    if (a >= 100) return Math.floor(n).toString();
    if (a >= 10) return n.toFixed(1);
    return n.toFixed(2);
  }

  // --- economy (caps, rates) ---
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
    // Non-crew cash: base door + tip rail + bar + VIP rooms + regulars loop.
    // Patron tips only via rail (PLAN §1.6); flat 0.08 covers the door.
    let nonCrewCash = (0.08 + Math.min(g.patrons, railCap) * 0.06 + g.b.bar * 0.45) * cashMult;
    nonCrewCash += g.b.vip * 1.25 * bottle * cashMult;
    if (g.r.loop) nonCrewCash += g.regulars * 0.04 * cashMult;

    let wage = (g.crew - g.jobs.off) * 0.20 * (g.r.payroll ? 0.6 : 1);
    let vipCrewCash = g.jobs.vipjob * 1.35 * crewMult * bottle * cashMult;
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

    const hypeGain = (g.b.dj * 0.10 + stageHype) * (g.u.led ? 1.3 : 1);
    const decay = g.hype * 0.014 * Math.max(0.25, 1 - g.b.door * 0.12);
    const hype = hypeGain - decay;

    const buzz = (g.b.marquee * 0.07 + g.b.flyers * 0.025 + floorBuzz) * (g.u.photog ? 1.5 : 1);
    const promoMult = g.r.promo ? 1.6 : 1;
    // Buzz→patron conversion paced for §C (numbers only; walk-in 0.02 stays fixed).
    // Cap keeps active-play click buzz from flooding the floor before ~6 min.
    const basis = (g.buzz > 0 ? Math.min(g.buzz, 0.065) : 0) * promoMult;
    // Walk-in trickle: flat +0.02 patrons/s, unscaled by Hype (PLAN §1.4).
    const pull = basis * (1 + g.hype / 200) + 0.02;
    const space = Math.max(0, cap.patrons - g.patrons);
    const admitted = Math.min(pull, space);
    const buzzSpent = basis > 0 && pull > 0 ? basis * (admitted / pull) : 0;
    const patrons = admitted - g.patrons * 0.008;
    // Regulars / Clout paced for first-research ~25 min under the §C reference bot.
    const regulars = g.patrons * 0.00045 * (1 + g.b.vip * 0.18) * sm;
    const clout = g.regulars * 0.0011;
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
  awayMsg(seconds, { earned = 0, wagesPaid = 0, struck = false } = {}) {
    let msg = 'Away ' + Math.round(seconds / 60) + 'm — earned $' + this.fmt(earned) + ', wages −$' + this.fmt(wagesPaid) + '.';
    if (struck) msg += ' Crew struck while you were gone.';
    return msg;
  }

  // --- simulation (step, catchUp) ---
  // Offline / large-gap simulation at 50% rate. Wall time advances fully;
  // resource accrual uses dt = wall * 0.5. Silent shift/night rollover.
  // Returns gross cash earned, wages paid, and whether a strike occurred (1.10).
  catchUp(g, seconds) {
    if (!g || !(seconds > 0)) return { earned: 0, wagesPaid: 0, struck: false };
    seconds = Math.min(seconds, 28800);
    let remaining = seconds;
    let earned = 0;
    let wagesPaid = 0;
    let struck = false;
    while (remaining > 0) {
      const rates = this.rates(g);
      if (rates.strike) struck = true;
      this.noteStrike(g, rates.strike);
      const cap = rates.cap;
      const left = rates.shift.len - g.shiftT;
      const wall = Math.min(remaining, left, this.OFFLINE_STEP);
      const dt = wall * 0.5;
      // rates.cash is net of wage; reconstruct gross for reporting.
      earned += (rates.cash + rates.wage) * dt;
      wagesPaid += rates.wage * dt;
      g.cash = Math.max(0, g.cash + rates.cash * dt);
      g.hype = Math.max(0, Math.min(cap.hype, g.hype + rates.hype * dt));
      g.buzz = Math.max(0, Math.min(cap.buzz, g.buzz + rates.buzz * dt - rates.buzzSpent * dt));
      g.patrons = Math.max(0, Math.min(cap.patrons, g.patrons + rates.patrons * dt));
      g.regulars = Math.max(0, g.regulars + rates.regulars * dt);
      g.clout = Math.max(0, g.clout + rates.clout * dt);
      g.shiftT += wall;
      g.elapsed += wall;
      remaining -= wall;
      if (g.shiftT >= rates.shift.len) {
        g.shiftT = 0;
        g.shiftIdx = (g.shiftIdx + 1) % 4;
        if (g.shiftIdx === 0) g.night++;
      }
      // Per-slice goal check: threshold goals (patrons/hype) may peak mid-window
      // then decay before catch-up ends — post-only noteGoals would miss them.
      // live:false keeps peak-hour hero offline-ineligible.
      this.noteGoals(g, { live: false });
    }
    return { earned, wagesPaid, struck };
  }

  step(dt) {
    const g = this.state.g;
    if (!g) return;
    dt *= (this.props.simSpeed ?? 1);
    dt = Math.min(dt, 28800);
    let remaining = dt;
    while (remaining > 0) {
      const r = this.rates(g);
      this.noteStrike(g, r.strike);
      const cap = r.cap;
      const left = r.shift.len - g.shiftT;
      const chunk = Math.min(remaining, left, this.SIM);
      const chatty = remaining <= 0.5;
      g.cash = Math.max(0, g.cash + r.cash * chunk);
      g.hype = Math.max(0, Math.min(cap.hype, g.hype + r.hype * chunk));
      g.buzz = Math.max(0, Math.min(cap.buzz, g.buzz + r.buzz * chunk - r.buzzSpent * chunk));
      g.patrons = Math.max(0, Math.min(cap.patrons, g.patrons + r.patrons * chunk));
      g.regulars += r.regulars * chunk;
      g.clout += r.clout * chunk;
      g.elapsed += chunk;
      g.shiftT += chunk;
      remaining -= chunk;
      // Per-slice goals before shift rollover: a live tick (dt ≤ 2) can finish Peak
      // Hours mid-loop; post-loop noteGoals would see the next shift and miss peak.
      this.noteGoals(g, { live: true });
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

  // --- Owner's List (PLAN-NEXT §B) ---
  activeGoal(g) {
    if (!g) return null;
    const done = Array.isArray(g.goals) ? g.goals : [];
    return this.GOALS.find(goal => !done.includes(goal.id)) || null;
  }

  // Evaluate the single active goal. opts.live (default true): peak-hour hero only
  // completes when live is true — offline catchUp / load must pass { live: false }.
  noteGoals(g, opts = {}) {
    if (!g) return;
    const live = opts.live !== false;
    if (!Array.isArray(g.goals)) g.goals = [];
    if (typeof g.clicks !== 'number' || !Number.isFinite(g.clicks)) g.clicks = 0;
    if (typeof g.rounds !== 'number' || !Number.isFinite(g.rounds)) g.rounds = 0;
    const goal = this.activeGoal(g);
    if (!goal || typeof goal.check !== 'function' || !goal.check(g)) return;
    // Goal 12 (peak): live play only — not offline catch-up or load-time evaluation.
    if (goal.id === 'peak' && !live) return;
    const rew = goal.reward || {};
    if (rew.cash) g.cash = (g.cash || 0) + rew.cash;
    if (rew.clout) g.clout = (g.clout || 0) + rew.clout;
    g.goals.push(goal.id);
    const parts = [];
    if (rew.cash) parts.push('$' + this.fmt(rew.cash));
    if (rew.clout) parts.push(this.fmt(rew.clout) + ' Clout');
    this.push(g, "Owner's list: " + goal.title + ' — ' + (parts.join(', ') || 'done') + '.', '#4ade80');
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
      localStorage.setItem(this.KEY, JSON.stringify({ saveVer: this.SAVE_VER, ver: this.VERSION.num, build: this.VERSION.build, g }));
      this.markTabOwner();
      this.state.tabStale = false;
      this.startAutosave();
      this.setState({ tabStale: false, saveState: kind === 'auto' ? 'autosaved' : 'saved ✓' });
    } catch (e) { this.setState({ saveState: 'save failed' }); }
  }

  // --- actions (buy*, hire, moveJob) ---
  // Non-owner / foreign-tab pause: actions are no-ops so progress cannot be "played" without persistence.
  buyBuilding(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    const n = g.b[def.id];
    if (def.max != null && n >= def.max) return;
    const price = Math.floor(def.cost * Math.pow(def.growth, n));
    if (g.cash < price) return;
    g.cash -= price;
    g.b[def.id] = n + 1;
    this.push(g, 'Built ' + def.name + ' #' + (n + 1) + ' for $' + this.fmt(price) + '.', '#22d3ee');
    this.noteGoals(g);
    this.forceUpdate();
  }
  buyUpgrade(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    if (g.u[def.id] || g.cash < def.cost) return;
    // Enforce building req in the action (UI already gates; do not trust UI alone).
    const reqId = Object.keys(def.req)[0];
    if (g.b[reqId] < def.req[reqId]) return;
    g.cash -= def.cost;
    g.u[def.id] = true;
    this.push(g, 'Installed ' + def.name + '.', '#ffc94a');
    this.noteGoals(g);
    this.forceUpdate();
  }
  buyResearch(def) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    if (g.r[def.id] || g.clout < def.cost) return;
    g.clout -= def.cost;
    g.r[def.id] = true;
    this.push(g, 'Researched ' + def.name + '.', '#a855f7');
    this.noteGoals(g);
    this.forceUpdate();
  }
  hireCrew() {
    if (this.state.tabStale) return;
    const g = this.state.g;
    const cap = this.caps(g).crew;
    if (g.crew >= cap) return;
    const price = Math.floor(280 * Math.pow(1.38, g.crew));
    if (g.cash < price) return;
    g.cash -= price;
    g.crew++;
    // New hires open on Main Stage so the room doesn't stay empty after a hire.
    g.jobs.stage++;
    this.push(g, 'Hired crew member #' + g.crew + ' for $' + this.fmt(price) + ' — on Main Stage.', '#ff2d78');
    this.noteGoals(g);
    this.forceUpdate();
  }
  moveJob(id, d) {
    if (this.state.tabStale) return;
    const g = this.state.g;
    // Off Shift is the residual pool (display-only); never assign to it directly.
    if (id === 'off') return;
    if (d > 0) {
      if (g.jobs.off < 1) return;
      g.jobs.off--;
      g.jobs[id]++;
    } else {
      if (g.jobs[id] < 1) return;
      g.jobs[id]--;
      g.jobs.off++;
    }
    this.noteGoals(g);
    this.forceUpdate();
  }

  // Round price — single source for UI and pacing.mjs reference bot (PLAN-NEXT §C).
  roundPrice(g) {
    return Math.floor(50 + (g.patrons || 0) * 7);
  }

  // --- render values ---
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
        this.state.g = this.fresh();
        this.push(this.state.g, 'Save wiped. Fresh club.', '#ff2d78');
        this.setState({ showSettings: false, resetArmed: false });
      },
      tickCount: this.state.tick, saveState: this.state.saveState,
      tabStale: this.state.tabStale,
      // Reload adopts the other tab's save from localStorage (last-explicit-wins via reload).
      takeOverTab: () => { window.location.reload(); }
    };
    if (!g) return base;

    const r = this.rates(g), cap = r.cap;
    const sign = v => (v >= 0 ? '+' : '') + this.fmt(v) + '/s';

    const resources = [
      { name: 'Cash', val: '$' + this.fmt(g.cash), rate: sign(r.cash), pct: 100, color: '#ffc94a', note: r.strike ? 'crew unpaid — on strike' : (r.wage > 0 ? 'wages −$' + this.fmt(r.wage) + '/s' : 'no payroll yet') },
      { name: 'Hype', val: this.fmt(g.hype), rate: sign(r.hype), pct: g.hype / cap.hype * 100, color: '#ff2d78', note: 'cap ' + cap.hype + ' · x' + (1 + g.hype / 140).toFixed(2) + ' income' },
      { name: 'Buzz', val: this.fmt(g.buzz), rate: sign(r.buzz - r.buzzSpent), pct: g.buzz / cap.buzz * 100, color: '#22d3ee', note: 'cap ' + cap.buzz + ' · pulls patrons in' },
      // Display whole people; sim keeps fractional g.patrons (PLAN §2.4).
      { name: 'Patrons', val: this.fmt(Math.floor(g.patrons)), rate: sign(r.patrons), pct: g.patrons / cap.patrons * 100, color: '#a855f7', note: 'floor cap ' + cap.patrons },
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
      // Sum only known building IDs (defense in depth vs unknown keys).
      { k: 'Structures', v: String(this.BUILDINGS.reduce((a, d) => a + (g.b[d.id] || 0), 0)) },
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
      tabHint = 'Structures are permanent and scale in price. Everything on this tab is bought with cash. A few regulars wander in on their own; Buzz fills the floor faster.';
      cards = this.BUILDINGS.map(d => {
        const n = g.b[d.id], price = Math.floor(d.cost * Math.pow(d.growth, n));
        const maxed = d.max != null && n >= d.max;
        const ok = !maxed && g.cash >= price;
        return { name: d.name, desc: d.desc, owned: n > 0 ? '×' + n : '—',
          btn: maxed ? 'Maxed' : 'Build $' + this.fmt(price),
          meta: maxed ? 'maxed' : (ok ? 'affordable' : 'need $' + this.fmt(price - g.cash)),
          locked: !ok, wrapStyle: cardWrap(!maxed), btnStyle: btn(ok), act: () => this.buyBuilding(d) };
      });
    } else if (this.state.tab === 'crew') {
      tabHint = 'Hire dancers, then assign them to Main Stage (Hype), VIP, or Floor. Wages tick every second — park extras Off Shift when the room is dead.';
      const price = Math.floor(280 * Math.pow(1.38, g.crew));
      const room = g.crew < cap.crew, ok = room && g.cash >= price;
      cards = [{ name: 'Hire Crew', desc: 'Dancers, bartenders, hosts. New hires start on Main Stage — reassign below. Capacity comes from Dressing Rooms.',
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

    const jobs = this.JOBS.map(j => {
      if (j.id === 'off') {
        // Passive roster row: count only, no steppers (PLAN §1.7).
        return { name: j.name, desc: j.desc, n: g.jobs.off, passive: true };
      }
      return {
        name: j.name, desc: j.desc, n: g.jobs[j.id], passive: false,
        inc: () => this.moveJob(j.id, 1), dec: () => this.moveJob(j.id, -1),
        incLocked: g.jobs.off < 1,
        decLocked: g.jobs[j.id] < 1,
        stepStyle: { width: '26px', height: '26px', border: '1px solid #3a2350', borderRadius: '5px', background: '#170e22', color: '#e7d8f2', cursor: 'pointer', fontSize: '14px', lineHeight: 1 }
      };
    });

    // Click / round numbers retuned for PLAN-NEXT §C pacing (active-play early curve).
    const clickVal = 1.15 + g.b.rail * 0.65 + g.hype * 0.07;
    const roundPrice = this.roundPrice(g);
    const hypeRoom = Math.max(0, cap.hype - g.hype);
    const roundGain = Math.min(14, hypeRoom);
    const roundOk = g.cash >= roundPrice && roundGain > 0;

    return {
      ...base,
      resources, stats, tabs, cards, tabHint, jobs, crewOpen: this.state.tab === 'crew' && g.crew > 0,
      // Escape t/msg at the HTML boundary only (g.log stays raw for save round-trips).
      log: g.log.map(l => ({
        t: this.escapeHtml(l.t),
        msg: this.escapeHtml(l.msg),
        style: { color: this.safeLogColor(l.color) }
      })),
      shiftName: r.shift.name, nightNo: g.night, shiftMultLabel: 'x' + r.sm.toFixed(2),
      shiftBar: this.bar(g.shiftT / r.shift.len * 100, r.shift.tint),
      perfStyle: {
        position: 'absolute', left: '50%', bottom: '22%',
        transformOrigin: 'bottom center',
        transform: 'translateX(-50%) scale(' + Math.max(0.42, Math.min(1, (this.state.stageH * 0.78 - 38) / 260)).toFixed(3) + ')',
        width: '190px', height: '260px',
        ['--bpm']: Math.max(0.55, 2.3 - (g.hype / cap.hype) * 1.6).toFixed(2) + 's',
        ['--energy']: Math.round(g.hype / cap.hype * 100) + '%',
        opacity: g.jobs.stage > 0 ? 1 : 0.55,
        filter: g.jobs.stage > 0 ? 'none' : 'grayscale(.6)',
        transition: 'opacity .4s linear'
      },
      dancerHTML: this.dancerHTML(g, cap),
      stageLine: g.jobs.stage > 0
        ? g.jobs.stage + ' on rotation'
        : (g.crew === 0
          ? 'hire crew to open the stage'
          : (g.jobs.off > 0 ? 'assign crew · Crew tab' : 'nobody on stage')),
      // Empty-stage badge jumps to Crew so the next action is one click away.
      stageLineAct: g.jobs.stage > 0 ? null : () => this.setState({ tab: 'crew' }),
      energyPct: Math.round(g.hype / cap.hype * 100) + '%',
      clickValue: '$' + this.fmt(clickVal),
      workCrowd: () => {
        if (this.state.tabStale) return;
        g.cash += clickVal;
        g.buzz = Math.min(cap.buzz, g.buzz + 0.12);
        g.clicks = (g.clicks || 0) + 1;
        this.noteGoals(g);
        this.forceUpdate();
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
        g.cash -= roundPrice;
        g.hype = Math.max(0, Math.min(cap.hype, g.hype + 14));
        g.rounds = (g.rounds || 0) + 1;
        this.push(g, 'Bought the room a round. +' + this.fmt(roundGain) + ' Hype.', '#ffc94a');
        this.noteGoals(g);
        this.forceUpdate();
      },
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
            reward: '', progress: null, flash: false
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
        return {
          done: false, n: done, total,
          title: goal.title,
          why: goal.why,
          hint: goal.hint,
          reward: rparts.join(' '),
          progress,
          flash: done > 0 && this.state.tick > 0
        };
      })()
    };
  }

  // --- render ---
  // Turns renderVals() into markup, mirroring the original template's
  // {{ interpolations }}, sc-for loops and sc-if branches with plain
  // template literals + a click-handler registry (data-h index).

  bind(fn) {
    this.handlers.push(fn);
    return this.handlers.length - 1;
  }

  dancerHTML(g, cap) {
    const onStage = g.jobs.stage > 0;
    // Empty stage: bare pole only. A grayed-out idle body read as "someone is
    // stuck" while the badge said nobody — confusing. Body appears once crew
    // is actually assigned to Main Stage.
    if (!onStage) {
      return '<div class="performer empty"><div class="pole"></div></div>';
    }
    const crowd = g.patrons >= 3 ? ' crowd' : '';
    const line = '<div class="pbody"><div class="phip"></div><div class="ptorso"></div>' +
      '<div class="pneck"></div><div class="phead"><div class="phair"></div></div>' +
      '<div class="parm pole"></div><div class="parm free"></div>' +
      '<div class="pleg l"></div><div class="pleg r"></div></div>';
    return '<div class="performer' + crowd + '"><div class="pole"></div>' + line + '</div>';
  }

  render() {
    this.handlers = [];
    if (!this.scrollSave) this.scrollSave = {};
    this.root.querySelectorAll('[data-scroll]').forEach(el => {
      this.scrollSave[el.getAttribute('data-scroll')] = [el.scrollTop, el.scrollLeft];
    });
    const existingStage = this.root.querySelector('#performer-stage');
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

    const jobRows = v.jobs.map(j => j.passive ? `
      <div style="display:flex;align-items:center;gap:9px;border:1px solid #1a1228;border-radius:7px;background:#0c0814;padding:8px 9px;opacity:0.88">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:#9c86ab">${j.name}</div>
          <div style="font-size:10px;color:#5c4470">${j.desc}</div>
        </div>
        <span style="font-family:'IBM Plex Mono',monospace;font-size:13px;color:#6f5885;min-width:20px;text-align:center;font-weight:600">${j.n}</span>
      </div>` : `
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
            <button data-h="${this.bind(v.downloadSave)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Download save (.json)</button>
            <button data-h="${this.bind(v.importSaveFile)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Load save from file…</button>
            <button data-h="${this.bind(v.exportSave)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Copy save to clipboard</button>
            <button data-h="${this.bind(v.importSave)}" class="hv-cyan" style="background:#170e22;border:1px solid #3a2350;border-radius:7px;color:#e7d8f2;padding:11px;cursor:pointer;font-size:12px;font-weight:700;text-align:left">Restore save from clipboard</button>
            <button data-h="${this.bind(v.hardReset)}" style="${css(v.resetStyle)}">${v.resetLabel}</button>
            <div style="font-size:10.5px;color:#5c4470;line-height:1.5;font-family:'IBM Plex Mono',monospace">${v.resetHint} Files and clipboard saves are the same format — either restores either way. ${v.verFull} · save format v${v.saveVer}</div>
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

  <main data-scroll="main" style="display:grid;grid-template-columns:262px minmax(420px,1fr) 352px;min-height:0;overflow:auto">

    <aside data-scroll="ledger" style="border-right:1px solid #2a1738;background:#0a0611;overflow-y:auto;padding:14px 12px">
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
          ${v.dancerHTML}
        </div>

        <div style="position:absolute;left:14px;top:14px;display:flex;flex-direction:column;gap:5px">
          <div style="font-size:9px;letter-spacing:2.6px;text-transform:uppercase;color:#7b5f90;font-weight:700">Main Stage</div>
          ${v.stageLineAct
            ? `<button data-h="${this.bind(v.stageLineAct)}" class="hv-pink" title="Open Crew tab" style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#ff2d78;background:transparent;border:0;padding:0;cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:3px">${v.stageLine}</button>`
            : `<div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:#ff2d78">${v.stageLine}</div>`}
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

      <div data-scroll="log" style="background:#080510;overflow-y:auto;padding:10px 14px">
        <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#7b5f90;font-weight:700;margin-bottom:7px">Night log</div>
        <div style="display:flex;flex-direction:column;gap:3px">${logRows}</div>
      </div>
    </section>

    <aside style="border-left:1px solid #2a1738;background:#0a0611;display:grid;grid-template-rows:auto auto minmax(0,1fr);min-height:0">
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
        return `<div style="border-bottom:1px solid #2a1738;background:#0d0814;padding:10px 12px">
          <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px">
            <div style="display:flex;align-items:center;gap:7px;min-width:0">
              <span style="width:6px;height:6px;border-radius:50%;background:${ol.done ? '#4ade80' : '#ff2d78'};box-shadow:0 0 7px ${ol.done ? '#4ade80' : '#ff2d78'};flex-shrink:0;animation:pulseDot 2.2s infinite"></span>
              <span style="font-size:12px;font-weight:700;color:#f2e8f7;line-height:1.25">${ol.title}</span>
            </div>
            <div style="display:flex;align-items:center;gap:7px;flex-shrink:0">
              ${ol.reward ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#ffc94a;font-weight:600">${ol.reward}</span>` : ''}
              <span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#7b5f90">${ol.n} / ${ol.total}</span>
            </div>
          </div>
          <div style="font-size:10.5px;color:#6f5885;font-style:italic;line-height:1.4;margin-bottom:4px">${ol.why}</div>
          <div style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#22d3ee;line-height:1.4">${ol.hint}</div>
          ${prog}
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
    <footer style="display:flex;align-items:center;gap:16px;height:28px;padding:0 14px;border-top:1px solid #2a1738;background:#0b0712;font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#5c4470">
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
</div>`;

    const newStage = this.root.querySelector('#performer-stage');
    if (existingStage && newStage) {
      newStage.replaceWith(existingStage);
      existingStage.setAttribute('style', css(v.perfStyle));
      // Swap performer markup when occupancy flips so we don't keep a stale
      // body (or empty pole) after hire/assign. Class-only updates cover the
      // common on-stage crowd/energy path without restarting CSS animations.
      if (this.state.g) {
        const onStage = this.state.g.jobs.stage > 0;
        const perf = existingStage.querySelector('.performer');
        const wantEmpty = !onStage;
        const isEmpty = perf && perf.classList.contains('empty');
        if (!perf || isEmpty !== wantEmpty) {
          existingStage.innerHTML = v.dancerHTML;
        } else if (perf) {
          perf.className = 'performer' + (onStage && this.state.g.patrons >= 3 ? ' crowd' : '');
        }
      }
    }

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
