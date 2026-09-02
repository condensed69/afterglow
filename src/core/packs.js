/**
 * Afterglow 2.0 - Pluggable Content Pack Engine (src/core/packs.js)
 * Modular runtime pack registry, seasonal battle pass progression, and relic management.
 * Designed so content packs can be plugged in or removed without editing core sim equations.
 */

(function (factory) {
  'use strict';
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exports = factory();
    if (typeof globalThis !== 'undefined') {
      globalThis.AfterglowPacks = exports;
      if (globalThis.window) globalThis.window.AfterglowPacks = exports;
    }
    if (typeof window !== 'undefined') {
      window.AfterglowPacks = exports;
    }
  }
})(function () {
  'use strict';

  class ContentPackEngine {
    constructor() {
      this.packs = new Map();
      this.activePackId = null;
      this.listeners = new Set();
    }

    /**
     * Register a content pack definition.
     * @param {Object} pack Pack configuration object
     * @returns {Object} registered pack
     */
    register(pack) {
      if (!pack || typeof pack.id !== 'string' || typeof pack.name !== 'string') {
        throw new Error('Invalid content pack definition: missing required id or name.');
      }
      this.packs.set(pack.id, pack);
      if (!this.activePackId) {
        this.activePackId = pack.id;
      }
      this._emitChange();
      return pack;
    }

    /**
     * Unregister a content pack.
     * @param {string} packId
     * @returns {boolean} true if removed
     */
    unregister(packId) {
      const deleted = this.packs.delete(packId);
      if (deleted && this.activePackId === packId) {
        const next = this.packs.keys().next().value;
        this.activePackId = next || null;
      }
      this._emitChange();
      return deleted;
    }

    /**
     * Get pack by ID.
     * @param {string} packId
     * @returns {Object|null}
     */
    get(packId) {
      return this.packs.get(packId) || null;
    }

    /**
     * List all registered packs.
     * @returns {Array<Object>}
     */
    list() {
      return Array.from(this.packs.values());
    }

    /**
     * Set active content pack.
     * @param {string} packId
     * @returns {boolean}
     */
    setActive(packId) {
      if (!this.packs.has(packId)) return false;
      this.activePackId = packId;
      this._emitChange();
      return true;
    }

    /**
     * Get active content pack.
     * @returns {Object|null}
     */
    getActive() {
      return this.packs.get(this.activePackId) || null;
    }

    /**
     * Add XP towards a seasonal progression track.
     * @param {Object} g Game save state
     * @param {string} packId Pack identifier
     * @param {number} amount XP to award
     * @returns {Object|null} { tier, xp, leveledUp }
     */
    addXp(g, packId, amount) {
      if (!g || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
      const targetId = packId || this.activePackId;
      const pack = this.get(targetId);
      if (!pack || !pack.progression || !Array.isArray(pack.progression.tiers)) return null;

      if (!g.packs || typeof g.packs !== 'object') {
        g.packs = { active: targetId, progress: {} };
      }
      if (!g.packs.progress || typeof g.packs.progress !== 'object') {
        g.packs.progress = {};
      }
      if (!g.packs.progress[targetId] || typeof g.packs.progress[targetId] !== 'object') {
        g.packs.progress[targetId] = { tier: 0, xp: 0, claimed: {} };
      }

      const prog = g.packs.progress[targetId];
      if (!prog.claimed || typeof prog.claimed !== 'object') prog.claimed = {};

      const maxTiers = pack.progression.tiers.length;
      if (prog.tier >= maxTiers) {
        prog.xp = 0;
        return { tier: prog.tier, xp: 0, leveledUp: false };
      }

      const reqPerTier = pack.progression.xpPerTier || 100;
      prog.xp += amount;
      let leveledUp = false;

      while (prog.tier < maxTiers && prog.xp >= reqPerTier) {
        prog.xp -= reqPerTier;
        prog.tier += 1;
        leveledUp = true;
      }

      if (prog.tier >= maxTiers) {
        prog.xp = 0;
      }

      return { tier: prog.tier, xp: prog.xp, leveledUp };
    }

    /**
     * Claim reward for a completed progression tier.
     * @param {Object} game Game instance
     * @param {string} packId Pack identifier
     * @param {number} tierNum 1-indexed tier number
     * @returns {Object} { ok: boolean, reward: Object|null, error?: string }
     */
    claimReward(game, packId, tierNum) {
      if (!game || !game.state || !game.state.g) return { ok: false, error: 'Invalid game state' };
      const g = game.state.g;
      const targetId = packId || this.activePackId;
      const pack = this.get(targetId);
      if (!pack || !pack.progression || !Array.isArray(pack.progression.tiers)) {
        return { ok: false, error: 'Pack or progression not found' };
      }

      if (!g.packs || typeof g.packs !== 'object') g.packs = { active: targetId, progress: {} };
      if (!g.packs.progress || typeof g.packs.progress !== 'object') g.packs.progress = {};
      if (!g.packs.progress[targetId] || typeof g.packs.progress[targetId] !== 'object') {
        g.packs.progress[targetId] = { tier: 0, xp: 0, claimed: {} };
      }
      const prog = g.packs.progress[targetId];
      if (!prog.claimed || typeof prog.claimed !== 'object') prog.claimed = {};

      if (prog.tier < tierNum) {
        return { ok: false, error: 'Tier not yet reached' };
      }
      if (prog.claimed && prog.claimed[tierNum]) {
        return { ok: false, error: 'Reward already claimed' };
      }

      const tierDef = pack.progression.tiers[tierNum - 1];
      if (!tierDef || !tierDef.reward) {
        return { ok: false, error: 'No reward configured for this tier' };
      }

      const reward = tierDef.reward;
      const c = game.club(g);

      // Apply reward
      if (reward.type === 'cash' && typeof reward.val === 'number') {
        c.cash = (c.cash || 0) + reward.val;
        game.push(g, `Claimed Tier ${tierNum} Reward: +$${game.fmt(reward.val)} Cash!`, '#4ade80');
      } else if (reward.type === 'legacy' && typeof reward.val === 'number') {
        g.legacy = (g.legacy || 0) + reward.val;
        g.legacyTotal = (g.legacyTotal || 0) + reward.val;
        game.push(g, `Claimed Tier ${tierNum} Reward: +${reward.val} Legacy Points!`, '#38bdf8');
      } else if (reward.type === 'clout' && typeof reward.val === 'number') {
        g.clout = (g.clout || 0) + reward.val;
        game.push(g, `Claimed Tier ${tierNum} Reward: +${reward.val} Clout!`, '#a855f7');
      } else if (reward.type === 'relic' && typeof reward.relicId === 'string') {
        if (!g.relics || typeof g.relics !== 'object') g.relics = {};
        g.relics[reward.relicId] = true;
        game.push(g, `🏆 UNLOCKED PERMANENT RELIC: ${reward.label || reward.relicId}!`, '#facc15');
      }

      prog.claimed[tierNum] = true;
      game.forceUpdate();
      return { ok: true, reward };
    }

    /**
     * Calculate passive rate multipliers provided by relics and active pack.
     * Data-driven resolution via AfterglowCatalogs.RELICS with built-in Season 1 fallback.
     * @param {Object} g Game state
     * @returns {Object} { vipCashMult, legacyMult }
     */
    getRelicMultipliers(g) {
      const relics = (g && g.relics && typeof g.relics === 'object') ? g.relics : {};
      let vipCashMult = 1.0;
      let legacyMult = 1.0;

      const relicDefs = (typeof AfterglowCatalogs !== 'undefined' && Array.isArray(AfterglowCatalogs.RELICS))
        ? AfterglowCatalogs.RELICS
        : [];

      for (const [relicId, active] of Object.entries(relics)) {
        if (active === true) {
          const def = relicDefs.find(r => r.id === relicId);
          if (def) {
            if (typeof def.vipCashMult === 'number') vipCashMult *= def.vipCashMult;
            if (typeof def.legacyMult === 'number') legacyMult *= def.legacyMult;
          } else if (relicId === 'golden_flamingo') {
            // Built-in Season 1 fallback
            vipCashMult *= 1.15;
            legacyMult *= 1.10;
          }
        }
      }

      return { vipCashMult, legacyMult };
    }

    _emitChange() {
      for (const listener of this.listeners) {
        try { listener(this); } catch (_) {}
      }
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }
  }

  const defaultEngine = new ContentPackEngine();

  return {
    ContentPackEngine,
    engine: defaultEngine,
    register: (pack) => defaultEngine.register(pack),
    unregister: (id) => defaultEngine.unregister(id),
    get: (id) => defaultEngine.get(id),
    list: () => defaultEngine.list(),
    setActive: (id) => defaultEngine.setActive(id),
    getActive: () => defaultEngine.getActive(),
    addXp: (g, id, amt) => defaultEngine.addXp(g, id, amt),
    claimReward: (game, id, tier) => defaultEngine.claimReward(game, id, tier),
    getRelicMultipliers: (g) => defaultEngine.getRelicMultipliers(g)
  };
});
