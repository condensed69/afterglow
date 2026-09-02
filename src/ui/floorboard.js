/**
 * Afterglow 2.0 - Canvas Floorboard Engine (src/ui/floorboard.js)
 * Interactive 60 FPS HTML5 Canvas floor renderer with crowd particles,
 * dynamic spotlight sweeps, neon floor reflections, and click ripples.
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
      globalThis.AfterglowFloorboard = exports;
      if (globalThis.window) globalThis.window.AfterglowFloorboard = exports;
    }
    if (typeof window !== 'undefined') {
      window.AfterglowFloorboard = exports;
    }
  }
})(function () {
  'use strict';

  class Floorboard {
    constructor(canvas) {
      this.canvas = canvas || null;
      this.ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
      this.rafId = null;
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.running = false;
      this.particles = [];
      this.ripples = [];
      this.maxParticles = 64;
      this.time = 0;

      // State inputs
      this.patrons = 0;
      this.regulars = 0;
      this.hype = 0.5;
      this.energy = 0.5;
      this.beamOpacity = 0.5;
      this.signLit = true;

      if (this.canvas) {
        this.mount(this.canvas);
      }
    }

    mount(canvas) {
      if (!canvas || !canvas.getContext) return;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.resize();

      this._onVisibilityChange = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          this.pause();
        } else {
          this.start();
        }
      };

      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', this._onVisibilityChange);
      }

      this.start();
    }

    resize() {
      if (!this.canvas || !this.ctx) return;
      const rect = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { width: 400, height: 260 };
      const w = Math.floor(rect.width) || this.canvas.width || 400;
      const h = Math.floor(rect.height) || this.canvas.height || 260;

      this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.min(window.devicePixelRatio, 2) : 1;
      this.width = w;
      this.height = h;

      this.canvas.width = Math.floor(w * this.dpr);
      this.canvas.height = Math.floor(h * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      this._initParticles();
    }

    _initParticles() {
      const targetCount = Math.min(this.maxParticles, Math.max(6, Math.floor(this.patrons * 1.5) + this.regulars));
      while (this.particles.length < targetCount) {
        this.particles.push({
          x: Math.random() * (this.width || 400),
          y: (this.height * 0.55) + Math.random() * (this.height * 0.4),
          vx: (Math.random() - 0.5) * 0.6,
          vy: (Math.random() - 0.5) * 0.3,
          radius: 2 + Math.random() * 2.5,
          phase: Math.random() * Math.PI * 2,
          isRegular: Math.random() < 0.25,
          hue: Math.random() < 0.5 ? 330 : 185 // pink or cyan
        });
      }
      if (this.particles.length > targetCount) {
        this.particles.length = targetCount;
      }
    }

    update(params = {}) {
      if (typeof params.patrons === 'number') this.patrons = params.patrons;
      if (typeof params.regulars === 'number') this.regulars = params.regulars;
      if (typeof params.hype === 'number') this.hype = Math.max(0, params.hype);
      if (typeof params.energy === 'number') this.energy = Math.max(0, Math.min(1, params.energy));
      if (typeof params.beamOpacity === 'number') this.beamOpacity = params.beamOpacity;
      if (typeof params.signLit === 'boolean') this.signLit = params.signLit;

      this._initParticles();
    }

    triggerPulse(x, y, color = '#ff2d78') {
      const px = x !== undefined ? x : this.width * 0.5;
      const py = y !== undefined ? y : this.height * 0.6;
      this.ripples.push({
        x: px,
        y: py,
        radius: 4,
        maxRadius: 60 + this.hype * 40,
        opacity: 0.9,
        color
      });
    }

    start() {
      if (this.running) return;
      this.running = true;
      const loop = () => {
        if (!this.running) return;
        this.render();
        if (typeof window !== 'undefined' && window.requestAnimationFrame) {
          this.rafId = window.requestAnimationFrame(loop);
        }
      };
      if (typeof window !== 'undefined' && window.requestAnimationFrame) {
        this.rafId = window.requestAnimationFrame(loop);
      }
    }

    pause() {
      this.running = false;
      if (this.rafId && typeof window !== 'undefined' && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    render() {
      if (!this.ctx || !this.width || !this.height) return;
      const ctx = this.ctx;
      const w = this.width;
      const h = this.height;
      this.time += 0.016;

      // 1. Clear & Dark Background
      ctx.fillStyle = '#0a0612';
      ctx.fillRect(0, 0, w, h);

      // 2. Perspective Neon Grid Floor
      this._drawFloorGrid(ctx, w, h);

      // 3. Dynamic Spotlights & Light Beams
      this._drawBeams(ctx, w, h);

      // 4. Crowd Particles
      this._drawCrowd(ctx, w, h);

      // 5. Interactive Ripples
      this._drawRipples(ctx);
    }

    _drawFloorGrid(ctx, w, h) {
      const horizon = h * 0.48;
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 45, 120, 0.12)';
      ctx.lineWidth = 1;

      // Horizontal depth lines
      for (let y = horizon + 8; y < h; y += Math.max(6, (y - horizon) * 0.3)) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Perspective vertical rays radiating from stage center
      const vanishingX = w * 0.5;
      const rays = 12;
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.09)';
      for (let i = 0; i <= rays; i++) {
        const spread = (i - rays / 2) / (rays / 2);
        const bottomX = vanishingX + spread * (w * 0.7);
        ctx.beginPath();
        ctx.moveTo(vanishingX, horizon);
        ctx.lineTo(bottomX, h);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawBeams(ctx, w, h) {
      const horizon = h * 0.48;
      const centerX = w * 0.5;
      const speed = 0.8 + this.hype * 1.2;
      const angleL = Math.sin(this.time * speed) * 0.35 - 0.2;
      const angleR = Math.cos(this.time * speed * 0.9) * 0.35 + 0.2;
      const beamAlpha = Math.max(0.1, this.beamOpacity * 0.45);

      ctx.save();
      ctx.globalCompositeOperation = 'screen';

      // Left Sweeping Beam
      const gradL = ctx.createLinearGradient(centerX - 60, horizon, centerX - 60 + Math.tan(angleL) * h, h);
      gradL.addColorStop(0, `rgba(255, 45, 120, ${beamAlpha})`);
      gradL.addColorStop(1, 'rgba(255, 45, 120, 0)');
      ctx.fillStyle = gradL;
      ctx.beginPath();
      ctx.moveTo(centerX - 60, horizon);
      ctx.lineTo(centerX - 90 + Math.tan(angleL) * h, h);
      ctx.lineTo(centerX - 30 + Math.tan(angleL) * h, h);
      ctx.closePath();
      ctx.fill();

      // Right Sweeping Beam
      const gradR = ctx.createLinearGradient(centerX + 60, horizon, centerX + 60 + Math.tan(angleR) * h, h);
      gradR.addColorStop(0, `rgba(34, 211, 238, ${beamAlpha})`);
      gradR.addColorStop(1, 'rgba(34, 211, 238, 0)');
      ctx.fillStyle = gradR;
      ctx.beginPath();
      ctx.moveTo(centerX + 60, horizon);
      ctx.lineTo(centerX + 30 + Math.tan(angleR) * h, h);
      ctx.lineTo(centerX + 90 + Math.tan(angleR) * h, h);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    _drawCrowd(ctx, w, h) {
      const bobFreq = 3 + this.hype * 4;
      const horizon = h * 0.52;

      ctx.save();
      for (const p of this.particles) {
        // Move particle gently
        p.x += p.vx * (1 + this.hype * 0.5);
        p.y += p.vy * (1 + this.hype * 0.5);

        // Keep inside lower half floor area
        if (p.x < 10) { p.x = 10; p.vx *= -1; }
        if (p.x > w - 10) { p.x = w - 10; p.vx *= -1; }
        if (p.y < horizon) { p.y = horizon; p.vy *= -1; }
        if (p.y > h - 10) { p.y = h - 10; p.vy *= -1; }

        const bob = Math.sin(this.time * bobFreq + p.phase) * (2 + this.hype * 3);
        const y = p.y + bob;

        ctx.beginPath();
        ctx.arc(p.x, y, p.radius, 0, Math.PI * 2);

        if (p.isRegular) {
          ctx.fillStyle = 'rgba(255, 201, 74, 0.85)';
          ctx.shadowColor = '#ffc94a';
          ctx.shadowBlur = 6;
        } else if (p.hue === 330) {
          ctx.fillStyle = 'rgba(255, 45, 120, 0.75)';
          ctx.shadowColor = '#ff2d78';
          ctx.shadowBlur = 4;
        } else {
          ctx.fillStyle = 'rgba(34, 211, 238, 0.75)';
          ctx.shadowColor = '#22d3ee';
          ctx.shadowBlur = 4;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    _drawRipples(ctx) {
      if (this.ripples.length === 0) return;
      ctx.save();
      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const r = this.ripples[i];
        r.radius += 2.5;
        r.opacity -= 0.03;

        if (r.opacity <= 0 || r.radius >= r.maxRadius) {
          this.ripples.splice(i, 1);
          continue;
        }

        ctx.strokeStyle = r.color;
        ctx.globalAlpha = Math.max(0, r.opacity);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    destroy() {
      this.pause();
      if (this._onVisibilityChange && typeof document !== 'undefined' && document.removeEventListener) {
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
      }
      this.particles = [];
      this.ripples = [];
      this.canvas = null;
      this.ctx = null;
    }
  }

  return {
    Floorboard,
    createFloorboard: (canvas) => new Floorboard(canvas)
  };
});
