/**
 * Afterglow 2.0 - Season 1: Miami Vice '86 Content Pack
 * (src/catalogs/packs/season1-miami.js)
 *
 * Dayclub pool venue, 80s synth aesthetic, 30-day battle pass track,
 * and permanent Golden Flamingo Relic.
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
      globalThis.AfterglowSeason1Miami = exports;
      if (globalThis.window) globalThis.window.AfterglowSeason1Miami = exports;
    }
    if (typeof window !== 'undefined') {
      window.AfterglowSeason1Miami = exports;
    }
    // Auto-register with pack engine if present
    if (typeof globalThis !== 'undefined' && globalThis.AfterglowPacks && globalThis.AfterglowPacks.register) {
      globalThis.AfterglowPacks.register(exports);
    } else if (typeof window !== 'undefined' && window.AfterglowPacks && window.AfterglowPacks.register) {
      window.AfterglowPacks.register(exports);
    }
  }
})(function () {
  'use strict';

  const season1Miami = {
    id: 'season1-miami',
    name: "Season 1: Miami Vice '86",
    codename: 'Miami Vice',
    season: 1,
    tagline: 'Sun-drenched Ocean Drive, pastel neon dayclubs, and high-roller 80s synth vibes.',
    desc: 'Transport your nightlife syndicate back to 1986 South Beach. Features the Oceanfront Dayclub pool venue, synthwave soundtrack, 30-tier seasonal progression track, and the legendary Golden Flamingo Relic.',

    theme: {
      id: 'miami_vice_86',
      name: 'Miami Vice 1986',
      primary: '#ff71ce',   // hot neon pink
      secondary: '#01cdfe', // ocean neon cyan
      accent: '#fffb96',    // sunset gold
      bg: '#0a0614',        // midnight synth indigo
      cardBg: '#180e28',
      crtShader: true       // retro CRT scanline styling
    },

    venues: [
      {
        id: 'dayclub',
        name: 'South Beach Dayclub & Pool',
        tagline: 'Oceanfront sun-drenched dayclub with private cabana bottle service',
        desc: 'Daytime pool party venue on Ocean Drive with high-roller VIP daybeds and open-air sound stage.',
        color: '#01cdfe',
        reqCash: 15000,
        reqNight: 10
      }
    ],

    tracks: [
      { id: 'synthwave_sunset', name: 'Synthwave Sunset (112 BPM)', bpm: 112, genre: 'Synthwave / Outrun' },
      { id: 'ocean_drive_groove', name: 'Ocean Drive Groove (118 BPM)', bpm: 118, genre: 'Miami Funk' }
    ],

    beverages: [
      { id: 'vice_mojito', name: 'Vice Mojito', batchCost: 35, batchSize: 60, revMult: 1.45 },
      { id: 'flamingo_punch', name: 'Flamingo Sunset Punch', batchCost: 75, batchSize: 80, revMult: 1.80 }
    ],

    progression: {
      xpPerTier: 100,
      totalTiers: 30,
      tiers: [
        { tier: 1, reward: { type: 'cash', val: 100, label: '$100 Cash' } },
        { tier: 2, reward: { type: 'cash', val: 250, label: '$250 Cash' } },
        { tier: 3, reward: { type: 'clout', val: 10, label: '10 Clout' } },
        { tier: 4, reward: { type: 'cash', val: 500, label: '$500 Cash' } },
        { tier: 5, reward: { type: 'legacy', val: 1, label: '1 Legacy Point & Neon Flamingo Pin' } },
        { tier: 6, reward: { type: 'cash', val: 750, label: '$750 Cash' } },
        { tier: 7, reward: { type: 'clout', val: 25, label: '25 Clout' } },
        { tier: 8, reward: { type: 'cash', val: 1000, label: '$1,000 Cash' } },
        { tier: 9, reward: { type: 'cash', val: 1250, label: '$1,250 Cash' } },
        { tier: 10, reward: { type: 'legacy', val: 2, label: '2 Legacy Points & Ocean Drive Pass' } },
        { tier: 11, reward: { type: 'cash', val: 1500, label: '$1,500 Cash' } },
        { tier: 12, reward: { type: 'clout', val: 50, label: '50 Clout' } },
        { tier: 13, reward: { type: 'cash', val: 2000, label: '$2,000 Cash' } },
        { tier: 14, reward: { type: 'cash', val: 2500, label: '$2,500 Cash' } },
        { tier: 15, reward: { type: 'legacy', val: 3, label: '3 Legacy Points & Sunset Synthesizer' } },
        { tier: 16, reward: { type: 'cash', val: 3000, label: '$3,000 Cash' } },
        { tier: 17, reward: { type: 'clout', val: 100, label: '100 Clout' } },
        { tier: 18, reward: { type: 'cash', val: 4000, label: '$4,000 Cash' } },
        { tier: 19, reward: { type: 'cash', val: 5000, label: '$5,000 Cash' } },
        { tier: 20, reward: { type: 'legacy', val: 4, label: '4 Legacy Points & White Linen VIP Badge' } },
        { tier: 21, reward: { type: 'cash', val: 6000, label: '$6,000 Cash' } },
        { tier: 22, reward: { type: 'clout', val: 200, label: '200 Clout' } },
        { tier: 23, reward: { type: 'cash', val: 8000, label: '$8,000 Cash' } },
        { tier: 24, reward: { type: 'cash', val: 10000, label: '$10,000 Cash' } },
        { tier: 25, reward: { type: 'legacy', val: 5, label: '5 Legacy Points & South Beach High-Roller' } },
        { tier: 26, reward: { type: 'cash', val: 15000, label: '$15,000 Cash' } },
        { tier: 27, reward: { type: 'clout', val: 500, label: '500 Clout' } },
        { tier: 28, reward: { type: 'cash', val: 25000, label: '$25,000 Cash' } },
        { tier: 29, reward: { type: 'cash', val: 50000, label: '$50,000 Cash' } },
        {
          tier: 30,
          reward: {
            type: 'relic',
            relicId: 'golden_flamingo',
            label: 'Golden Flamingo Relic (+15% VIP Cash, +10% Prestige Legacy)'
          }
        }
      ]
    },

    relics: [
      {
        id: 'golden_flamingo',
        name: 'Golden Flamingo Relic',
        desc: 'Gleaming 24-karat art deco flamingo relic from the 1986 Miami underground. Permanent artifact that persists across all prestige timelines.',
        perk: '+15% VIP Cash Flow and +10% Prestige Legacy point yield.',
        vipCashMult: 1.15,
        legacyMult: 1.10
      }
    ]
  };

  return season1Miami;
});
