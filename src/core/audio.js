/**
 * Afterglow 2.0 - Procedural Web Audio Engine (src/core/audio.js)
 * Lightweight, zero-asset procedural synth & rhythm generator.
 * Less than 4KB, 100% synthesized via Web Audio API.
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
      globalThis.AfterglowAudio = exports;
      if (globalThis.window) globalThis.window.AfterglowAudio = exports;
    }
    if (typeof window !== 'undefined') {
      window.AfterglowAudio = exports;
    }
  }
})(function () {
  'use strict';

  class SynthAudio {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.noiseBuffer = null;
      this.enabled = false;
      this.volume = 0.35;
      this.step = 0;
      this.tempo = 124;
      this.bassNotes = [55, 62.23, 65.41, 73.42, 82.41]; // A1, Eb2, F2, D2, E2

      // Restore sound preference if available
      try {
        if (typeof localStorage !== 'undefined') {
          this.enabled = localStorage.getItem('afterglow.sound') === '1';
        }
      } catch (_) {}

      // Handle visibility changes to suspend background audio
      if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') {
            this.suspend();
          } else if (this.enabled && this.ctx && this.ctx.state === 'suspended') {
            this.resume();
          }
        });
      }
    }

    _initContext() {
      if (this.ctx) return;
      const AudioContextClass = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
      if (!AudioContextClass) return;

      try {
        this.ctx = new AudioContextClass();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(this.enabled ? this.volume : 0, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);

        // Build 1s white noise buffer for snare/hi-hats
        const bufferSize = this.ctx.sampleRate;
        this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          output[i] = Math.random() * 2 - 1;
        }
      } catch (err) {
        this.ctx = null;
      }
    }

    toggle() {
      return this.setEnabled(!this.enabled);
    }

    setEnabled(val) {
      this.enabled = Boolean(val);
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('afterglow.sound', this.enabled ? '1' : '0');
        }
      } catch (_) {}

      if (this.enabled) {
        this._initContext();
        this.resume();
        if (this.masterGain && this.ctx) {
          this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
        }
        this.playClick();
      } else {
        if (this.masterGain && this.ctx) {
          this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
        }
        this.suspend();
      }
      return this.enabled;
    }

    setVolume(vol) {
      this.volume = Math.max(0, Math.min(1, vol));
      if (this.masterGain && this.ctx && this.enabled) {
        this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      }
    }

    suspend() {
      if (this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      }
    }

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    }

    /**
     * Tactile UI click / work-the-room sound effect.
     */
    playClick() {
      if (!this.enabled || !this.ctx) return;
      this.resume();

      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, t);
      osc.frequency.exponentialRampToValueAtTime(80, t + 0.04);

      gain.gain.setValueAtTime(0.4 * this.volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

      osc.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.05);
    }

    /**
     * Ascending synth chime cascade for VIP / round purchases.
     */
    playRoundBuy() {
      if (!this.enabled || !this.ctx) return;
      this.resume();

      const t = this.ctx.currentTime;
      const notes = [440, 554.37, 659.25, 880]; // A4, C#5, E5, A5

      notes.forEach((freq, idx) => {
        const noteTime = t + idx * 0.04;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, noteTime);

        gain.gain.setValueAtTime(0.25 * this.volume, noteTime);
        gain.gain.exponentialRampToValueAtTime(0.001, noteTime + 0.18);

        osc.connect(gain);
        gain.connect(this.masterGain || this.ctx.destination);

        osc.start(noteTime);
        osc.stop(noteTime + 0.2);
      });
    }

    /**
     * Procedural beat tick: plays kick, hi-hat, or synth bass based on rhythmic tempo.
     * @param {number} hype - Current club hype ratio (0 to 1+)
     */
    tickRhythm(hype = 0.5) {
      if (!this.enabled || !this.ctx) return;
      this.resume();

      const t = this.ctx.currentTime;
      const stepInMeasure = this.step % 16;
      this.step++;

      // 4-on-the-floor kick on steps 0, 4, 8, 12
      if (stepInMeasure % 4 === 0) {
        this._playKick(t, hype);
      }

      // Off-beat hi-hat on steps 2, 6, 10, 14
      if (stepInMeasure % 4 === 2) {
        this._playHiHat(t, hype);
      }

      // Synth Bassline on every 16th step with filter cutoff modulated by hype
      if (stepInMeasure % 2 === 0) {
        const noteIdx = (stepInMeasure / 2) % this.bassNotes.length;
        this._playBass(t, this.bassNotes[noteIdx], hype);
      }
    }

    _playKick(t, hype) {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(140 + hype * 20, t);
      osc.frequency.exponentialRampToValueAtTime(38, t + 0.08);

      gain.gain.setValueAtTime(0.8 * this.volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

      osc.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.16);
    }

    _playHiHat(t, hype) {
      if (!this.noiseBuffer) return;
      const noise = this.ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(7000, t);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.18 * (0.8 + hype * 0.4) * this.volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);

      noise.start(t);
      noise.stop(t + 0.06);
    }

    _playBass(t, freq, hype) {
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);

      filter.type = 'lowpass';
      const cutoff = Math.min(2400, 350 + hype * 1200);
      filter.frequency.setValueAtTime(cutoff, t);
      filter.Q.setValueAtTime(4, t);

      gain.gain.setValueAtTime(0.22 * this.volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain || this.ctx.destination);

      osc.start(t);
      osc.stop(t + 0.13);
    }
  }

  return {
    SynthAudio,
    createAudio: () => new SynthAudio()
  };
});
