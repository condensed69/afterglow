> **Status: SUPERSEDED (2026-08-03)** — This document specifies the 0.3.x canvas prototype. The 0.4 rewrite (club-management idle, CSS/DOM performer) replaced those systems; treat this file as historical reference. A rewrite against current systems is scheduled after the 0.5.x logic series.

# Strip Club Idle - Design System Specification

**Version:** 0.3.0  
**Last Updated:** 2026-08-02  
**Status:** Active - Stage 0 Implementation

---

## 1. Design Vision & Philosophy

### 1.1 Project Identity
"Strip Club Idle" is a Kittens Game-style incremental game with a premium dark cyber-luxury aesthetic. The design must feel like a $150k agency build — not a template. Every pixel serves the fantasy of running a high-end establishment.

### 1.2 Design Read
> **Reading this as:** idle/incremental game web app for desktop + mobile, with a premium dark cyber-luxury aesthetic, leaning toward custom Canvas 2D rendering + high-end design system with custom typography, particle atmospherics, and fluid micro-interactions.

### 1.3 Core Dials (Locked)
| Dial | Value | Rationale |
|------|-------|-----------|
| **DESIGN_VARIANCE** | 8 | Asymmetric, premium, breaks grid intentionally |
| **MOTION_INTENSITY** | 7 | Fluid physics, particle systems, magnetic buttons |
| **VISUAL_DENSITY** | 4 | Breathing room, not cockpit — content breathes |

### 1.4 Vibe & Layout Archetypes
- **Vibe:** Ethereal Glass (Dark Tech) — Deep OLED black, radial mesh gradients, vantablack cards with heavy backdrop-blur
- **Layout:** Asymmetrical Bento + Z-Axis Cascade — Left canvas dominates, right panels float at staggered depths

---

## 2. Typography System

### 2.1 Font Stack (Self-Hosted via @font-face)
```css
/* Display / Headlines */
--font-display: 'Geist Display', 'Geist', system-ui, sans-serif;

/* UI / Body */
--font-ui: 'Geist', system-ui, sans-serif;

/* Numbers / Data */
--font-mono: 'Geist Mono', 'JetBrains Mono', monospace;
```

### 2.2 Type Scale
| Role | Font | Size (Mobile) | Size (Desktop) | Weight | Tracking |
|------|------|---------------|----------------|--------|----------|
| Logo/Brand | Geist Display | text-2xl | text-3xl | 700 | -0.02em |
| Resource Value | Geist Mono | text-2xl | text-3xl | 600 | tabular-nums |
| Resource Label | Geist | text-xs | text-sm | 500 | 0.1em (uppercase) |
| Button Primary | Geist | text-sm | text-base | 600 | 0 |
| Button Secondary | Geist | text-xs | text-sm | 500 | 0.05em |
| Panel Title | Geist | text-lg | text-xl | 600 | -0.01em |
| Body/Small | Geist | text-sm | text-base | 400 | 0 |
| Version Tracker | Geist Mono | text-[10px] | text-[10px] | 400 | 0 |

### 2.3 Anti-Patterns (Banned)
- ❌ Inter, Roboto, Arial, Open Sans, Helvetica
- ❌ Serif fonts (unless explicitly justified by brand)
- ❌ Mixed font families in same hierarchy level

---

## 3. Color Palette (LOCKED - Single Accent Family)

### 3.1 Semantic Tokens
```css
:root {
  /* Base Surfaces */
  --color-base: #030305;           /* Near-black OLED */
  --color-surface: #0a080e;        /* Deep purple-black */
  --color-surface-elevated: #14101a; /* Card backgrounds */
  --color-surface-hover: #1a1420;  /* Hover state */
  
  /* Borders */
  --color-border: rgba(255,255,255,0.08);      /* 8% white hairline */
  --color-border-highlight: rgba(255,255,255,0.15); /* Inner highlight */
  --color-border-strong: rgba(255,255,255,0.25);   /* Focus/active */
  
  /* Accents (ONE FAMILY) */
  --color-accent-primary: #ff1a8c;    /* Hot magenta - primary actions, Money */
  --color-accent-secondary: #00ffe0;  /* Electric cyan - Hype, Attention */
  --color-accent-tertiary: #ffd700;   /* Gold - Tips, premium unlocks */
  
  /* Text */
  --color-text-primary: #fafafa;
  --color-text-secondary: #a8a0b0;
  --color-text-muted: #5a5060;
  --color-text-inverse: #0a080e;      /* On accent backgrounds */
  
  /* Status */
  --color-success: #22ff88;
  --color-warning: #ffaa00;
  --color-danger: #ff3355;
  
  /* Gradients */
  --gradient-mesh-1: radial-gradient(ellipse 80% 50% at 20% 0%, rgba(255,26,140,0.15) 0%, transparent 70%);
  --gradient-mesh-2: radial-gradient(ellipse 60% 80% at 80% 100%, rgba(0,255,224,0.1) 0%, transparent 60%);
  --gradient-mesh-3: radial-gradient(ellipse 100% 100% at 50% 50%, rgba(255,215,0,0.05) 0%, transparent 50%);
  --gradient-accent: linear-gradient(135deg, #ff1a8c 0%, #ff6b3a 100%);
  --gradient-cyan: linear-gradient(135deg, #00ffe0 0%, #00b4d8 100%);
  --gradient-gold: linear-gradient(135deg, #ffd700 0%, #ffaa00 100%);
}
```

### 3.2 Palette Rules
- **One accent family only** — No purple AI gradients, no random neon
- **Consistency lock** — Accent colors used ONLY for their semantic purpose
- **No pure #000 or #fff** — Off-black/off-white for depth
- **Dark mode only** — Light mode not supported (intentional aesthetic choice)

---

## 4. Component Architecture: Double-Bezel (Doppelrand)

### 4.1 Universal Card Structure
```html
<!-- OUTER SHELL -->
<div class="card-shell">
  <!-- INNER CORE -->
  <div class="card-core">
    <!-- Content -->
  </div>
</div>
```

```css
.card-shell {
  /* Outer: subtle container */
  padding: 0.375rem;           /* p-1.5 */
  border-radius: 2rem;         /* rounded-2xl */
  background: rgba(0,0,0,0.3); /* bg-black/30 */
  border: 1px solid var(--color-border);
  box-shadow: 
    0 0 0 1px var(--color-border) inset,
    0 4px 24px rgba(0,0,0,0.4);
}

.card-core {
  /* Inner: actual content surface */
  border-radius: 1.625rem;     /* calc(2rem - 0.375rem) */
  background: rgba(20,16,26,0.8); /* bg-surface-elevated/80 */
  backdrop-filter: blur(24px); /* backdrop-blur-xl */
  box-shadow: 
    inset 0 1px 1px rgba(255,255,255,0.15),
    inset 0 -1px 1px rgba(0,0,0,0.3);
  /* Content padding applied here */
}
```

### 4.2 Button Architecture (Button-in-Button)
```html
<button class="btn-primary">
  <span class="btn-label">Upgrade</span>
  <span class="btn-icon-wrapper">
    <svg class="btn-icon">...</svg>
  </span>
</button>
```

```css
.btn-primary {
  border-radius: 9999px;       /* rounded-full */
  padding: 0.75rem 1.5rem;     /* py-3 px-6 */
  font-weight: 600;
  background: var(--gradient-accent);
  color: var(--color-text-inverse);
  border: none;
  transition: all 400ms cubic-bezier(0.32,0.72,0,1);
}

.btn-icon-wrapper {
  width: 2rem; height: 2rem;   /* w-8 h-8 */
  border-radius: 9999px;
  background: rgba(0,0,0,0.2);
  display: flex; align-items: center; justify-content: center;
  transition: transform 300ms cubic-bezier(0.32,0.72,0,1);
}

.btn-primary:hover .btn-icon-wrapper {
  transform: translateX(0.25rem) translateY(-1px) scale(1.05);
}

.btn-primary:active {
  transform: scale(0.98);
}
```

### 4.3 Shape Consistency Lock
| Element | Border Radius |
|---------|---------------|
| Card Shell | 2rem (32px) |
| Card Core | 1.625rem (26px) |
| Buttons | 9999px (full pill) |
| Icon Wrappers | 9999px |
| Inputs | 0.75rem (12px) |
| Tooltips | 0.75rem |

---

## 5. Canvas / Dancer Visual Specification

### 5.1 Atmospheric Background Layers (Back to Front)
1. **Base:** `--color-base` solid
2. **Mesh 1:** Magenta radial (top-left, 15% opacity)
3. **Mesh 2:** Cyan radial (bottom-right, 10% opacity)  
4. **Mesh 3:** Gold radial (center, 5% opacity, subtle)
4. **Noise Overlay:** 3% opacity film grain (fixed, pointer-events-none)
5. **Particle Layer:** Dynamic particles (see 5.3)

### 5.2 Pole & Stage
- **Pole:** Metallic gradient (chrome → dark chrome), 4px reflective highlight line, subtle magenta glow at top (8px blur)
- **Stage Floor:** Reflective surface — mirrors dancer at 30% opacity, gradient fade to transparent
- **Stage Edge:** Thin gold line (1px) with outer glow

### 5.3 Particle System
```javascript
// Particle config
const PARTICLE_CONFIG = {
  maxParticles: 150,
  spawnRate: 2 per frame (at max spin),
  colors: [
    'rgba(255,26,140,0.6)',   // Magenta
    'rgba(0,255,224,0.5)',    // Cyan
    'rgba(255,215,0,0.5)'     // Gold
  ],
  physics: {
    gravity: 0.02,
    drag: 0.985,
    spinInfluence: 0.3        // Particles pulled by dancer rotation
  },
  sizes: { min: 1, max: 4 },
  lifetimes: { min: 60, max: 180 } // frames
};
```

### 5.4 Dancer Rendering Pipeline
1. **Silhouette Pass:** Base body shape (bezier curves, no strokes)
2. **Lighting Pass:** 3-point lighting applied via gradient fills
   - Key: Magenta (45° top-left, 60% intensity)
   - Fill: Cyan (opposite, 30% intensity)  
   - Rim: Gold (back, 40% intensity, 2px edge)
3. **Detail Pass:** Hair strands, facial features, outfit
4. **FX Pass:** Motion blur trails (when spin > 2.5), speed lines, particle bursts

### 5.5 Outfit Stages (Visual Spec)
| Stage | Name | Visual |
|-------|------|--------|
| 0 | Bikini | Magenta mesh, gold straps, semi-transparent |
| 1 | Micro Skirt | Cyan holographic fabric, animated scanlines |
| 2 | Pasties | Gold geometric shapes, pulsing glow, oil sheen effect |

### 5.6 Upgrade Visual Feedback
- **Implants:** Subtle emissive glow on chest (magenta, 2px)
- **Boots:** Patent leather material (high specular, animated reflection)

---

## 6. Motion Choreography

### 6.1 Global Easing
```css
--ease-spring: cubic-bezier(0.32, 0.72, 0, 1);
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-sharp: cubic-bezier(0.4, 0, 0.2, 1);
```

### 6.2 Animation Inventory
| Trigger | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Page Load (staggered) | translateY(8px) blur(4px) opacity:0 → 0,0,1 | 800ms | --ease-spring |
| Button Hover | scale(1.02) + glow | 200ms | --ease-out |
| Button Press | scale(0.98) | 100ms | --ease-sharp |
| Panel Open | height + opacity + translateY(-4px) | 400ms | --ease-spring |
| Resource Tick | number counter + pulse glow | 600ms | --ease-out |
| Spin Change | spring physics (stiffness:120, damping:18) | continuous | spring |
| Particle Burst | radial explosion + fade | 400ms | --ease-out |

### 6.3 Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  .particle { display: none; }
  /* Functional animation (spin, resource ticks) preserved */
}
```

---

## 7. Layout Specification

### 7.1 Desktop (≥1024px) - Asymmetrical Bento
```
┌─────────────────────────────────────────────────────────────┐
│  [Logo]                                    [v0.3.0-a1f2b3c] │  ← HUD Bar (64px)
├──────────────────────────────┬──────────────────────────────┤
│                              │  ┌────────────────────────┐  │
│      CANVAS (65% width)      │  │  UPGRADES PANEL        │  │  ← Z-depth: 10
│   (Pole Dancer + Particles)  │  │  [Floating Glass Card] │  │
│                              │  └────────────────────────┘  │
│                              │  ┌────────────────────────┐  │
│                              │  │  GIRLS / STAGES PANEL  │  │  ← Z-depth: 20
│                              │  │  [Floating Glass Card] │  │
│                              │  └────────────────────────┘  │
│                              │  ┌────────────────────────┐  │
│                              │  │  AUDIO / SETTINGS      │  │  ← Z-depth: 30
│                              │  │  [Floating Glass Card] │  │
│                              │  └────────────────────────┘  │
└──────────────────────────────┴──────────────────────────────┘
```

### 7.2 Tablet (768-1023px) - Compressed Bento
- Canvas: 60% width
- Panels: Stacked right, reduced padding
- HUD: Compact

### 7.3 Mobile (<768px) - Single Column Stack
```
┌─────────────────────────────┐
│ [Logo]              [v0.3.0]│  ← Compact HUD (48px)
├─────────────────────────────┤
│                             │
│      CANVAS (100% width,    │
│      50vh height)           │
│   Touch drag to spin        │
│                             │
├─────────────────────────────┤
│  ▓▓▓ DRAG HANDLE ▓▓▓        │  ← Bottom Drawer
├─────────────────────────────┤
│  [Upgrades] [Girls] [Audio] │  ← Tab bar
│  [Panel Content Scrolls]    │
└─────────────────────────────┘
```

### 7.4 Spacing Scale
| Token | Value | Usage |
|-------|-------|-------|
| --space-xs | 0.25rem (4px) | Icon gaps |
| --space-sm | 0.5rem (8px) | Button inner, card content gap |
| --space-md | 1rem (16px) | Standard gap, card padding |
| --space-lg | 1.5rem (24px) | Section gaps |
| --space-xl | 2rem (32px) | Major section padding |
| --space-2xl | 3rem (48px) | Page-level padding |
| --space-3xl | 4rem (64px) | Hero/major breathing room |

---

## 8. Version Tracker Specification

### 8.1 Display Format
```
v{major}.{minor}.{patch}-{shortHash} • {YYYY-MM-DD}
```
Example: `v0.3.0-a1f2b3c • 2026-08-02`

### 8.2 Injection Points (Build-Time)
```html
<!-- BUILD_META_START -->
<meta name="build-version" content="0.3.0">
<meta name="build-hash" content="a1f2b3c">
<meta name="build-date" content="2026-08-02">
<meta name="build-commit" content="d2ae312a4acfc62d769adae0d67c10ec5c79a49f">
<!-- BUILD_META_END -->
```

### 8.3 Runtime Behavior
- Reads meta tags on load
- Click → copies full version string to clipboard
- Hover → tooltip with full commit hash + branch
- Style: `font: 10px Geist Mono`, `color: var(--color-text-muted)`, `cursor: help`

---

## 9. Audio Visualization

### 9.1 Bass Waveform (Canvas Overlay)
- Circular waveform around pole base (radius: 60px)
- 64 frequency bins, mirrored
- Magenta primary, cyan secondary
- Reacts to `bassGain.gain.value` in real-time

### 9.2 Frequency Bars (Background)
- 32 vertical bars behind canvas (fixed position)
- Height mapped to frequency data
- Gradient: base (magenta) → top (cyan)
- Opacity: 15%, blur: 2px

---

## 10. Game Systems Preservation (Functional Contract)

### 10.1 Resources (4)
| ID | Label | Color | Format |
|----|-------|-------|--------|
| money | $ | Gold (#ffd700) | Integer + 2 decimals |
| tipsRes | Tips | Magenta (#ff1a8c) | Integer |
| hype | Hype | Cyan (#00ffe0) | Integer |
| attn | Attention | Cyan (#00ffe0) | Integer |

### 10.2 Upgrades (8)
| ID | Label | Base Cost | Scaling | Max |
|----|-------|-----------|---------|-----|
| tipJar | Tip Jar | $25 | ×1.65 | ∞ |
| vip | VIP Room | $120 | ×1.8 | ∞ |
| dj | DJ Booth | $80 | ×1.7 | ∞ |
| ads | Flyer Ads | $60 | ×1.6 | ∞ |
| girl | Hire Girl | $250 | ×2.2 | 3 |
| stage | Next Outfit | $180 | ×2.0 | 3 |
| implants | Tit Implants | $400 | — | 1 |
| boots | Stripper Boots | $150 | — | 1 |

### 10.3 Girls (3)
| Index | Name | Skin | Hair | Outfit Accent |
|-------|------|------|------|---------------|
| 0 | Amber | #ffddbb | #3b2314 | #ff1a8c |
| 1 | Jade | #e8c4a8 | #1a0a05 | #00ffe0 |
| 2 | Lola | #f5d0c5 | #5c3a1e | #ffd700 |

### 10.4 Stages (3)
| Index | Name | Unlocks |
|-------|------|---------|
| 0 | Bikini | — |
| 1 | Micro Skirt | — |
| 2 | Topless | Pasties, Oil |

### 10.5 Core Loop
- **Drag/Spin:** Pointer drag on canvas → `targetSpeed` (0.6-4.5)
- **Manual Tip:** Click canvas (non-drag) → instant resources + cha-ching SFX
- **Auto Tick:** Every 150ms → passive resource generation
- **Audio:** Bass loop (48Hz triangle) + hi-hat (320ms interval)

---

## 11. Performance Budget

| Metric | Target |
|--------|--------|
| Canvas FPS | 60fps sustained |
| Particle Count | ≤150 active |
| Frame Budget | ≤16.67ms (incl. GC) |
| Initial Load | <2s (3G) |
| Bundle Size | <100KB (gzipped) |
| Memory | <50MB heap |

### 11.1 Optimization Strategies
- Object pooling for particles
- Dirty rect rendering (only redraw changed regions)
- `requestAnimationFrame` with timestamp delta
- `will-change: transform` on animated canvas only
- Reduced motion = particles disabled, functional preserved

---

## 12. Accessibility

- **Contrast:** All text ≥4.5:1 (WCAG AA), large text ≥3:1
- **Focus:** Visible focus rings (2px, var(--color-border-strong), offset 2px)
- **Reduced Motion:** Honored globally
- **Touch Targets:** ≥48×48px on mobile
- **Color Blind:** Accent colors distinguishable by hue + saturation (not just hue)
- **Screen Readers:** ARIA labels on all buttons, live regions for resource changes

---

## 13. File Structure (Single-File Delivery)

```
index.html
├── <head>
│   ├── Meta + Build Meta Injection
│   ├── @font-face (Geist, Geist Mono)
│   ├── CSS Custom Properties (Design Tokens)
│   └── <style> — All component styles
├── <body>
│   ├── HUD Bar (Logo + Version Tracker)
│   ├── Canvas Wrapper (Canvas + Audio Viz)
│   ├── Right Panel Stack (Desktop) / Bottom Drawer (Mobile)
│   └── <script>
│       ├── Game State Module
│       ├── Renderer Module (Canvas)
│       ├── Particle System Module
│       ├── Audio Module
│       ├── UI Module (DOM)
│       ├── Input Module
│       └── Init / Loop
```

---

## 14. Changelog (Design System)

| Version | Date | Changes |
|---------|------|---------|
| 0.3.0 | 2026-08-02 | Complete design system overhaul: tokens, typography, components, canvas spec, version tracker |
| 0.2.0 | 2026-08-02 | Added implants/boots upgrades, multi-girl, multi-stage |
| 0.1.0 | 2026-08-02 | Initial idle mechanics, basic canvas dancer |

---

**End of DESIGN.md** — This document is the single source of truth for all visual and interaction decisions. Any deviation requires updating this file first.