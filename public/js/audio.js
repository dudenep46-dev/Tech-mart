/* ==========================================================================
   TechMart Empire: Ultra Simulator - audio.js
   Tiny synthesized sound effects (WebAudio, no asset files) + mute switch.
   The AudioContext is created/resumed only after a user gesture (iOS/Chrome).
   ========================================================================== */
(function (global) {
  'use strict';
  const TM = global.TM;
  const KEY = 'techmart.muted';
  let ctx = null, master = null, muted = false, last = {};
  try { muted = global.localStorage.getItem(KEY) === '1'; } catch (e) { /* ignore */ }

  function ensure() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.45;
        master.connect(ctx.destination);
      } catch (e) { ctx = null; return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function tone(freq, start, dur, type, vol, toFreq) {
    const t = ctx.currentTime + start;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (toFreq) o.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }

  const SOUNDS = {
    click: () => tone(520, 0, 0.05, 'triangle', 0.12),
    coin: () => { tone(988, 0, 0.09, 'square', 0.1); tone(1319, 0.08, 0.2, 'square', 0.1); },
    good: () => { tone(660, 0, 0.09, 'triangle', 0.14); tone(880, 0.08, 0.14, 'triangle', 0.14); },
    warn: () => tone(330, 0, 0.16, 'sawtooth', 0.08),
    bad: () => tone(220, 0, 0.28, 'sawtooth', 0.1, 110),
    level: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle', 0.16)),
    day: () => { tone(440, 0, 0.15, 'sine', 0.15); tone(660, 0.13, 0.25, 'sine', 0.15); }
  };

  const Audio = (TM.Audio = {
    play(name) {
      if (muted) return;
      const now = performance.now();
      if (last[name] && now - last[name] < 60) return; // avoid stacking identical sounds
      last[name] = now;
      if (!ensure() || !SOUNDS[name]) return;
      try { SOUNDS[name](); } catch (e) { /* ignore */ }
    },
    isMuted: () => muted,
    setMuted(m) {
      muted = !!m;
      try { global.localStorage.setItem(KEY, muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (ensure()) master.gain.value = muted ? 0 : 0.45;
      Audio.syncButton();
    },
    suspend() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    resume() { if (ctx && !muted) ctx.resume().catch(() => {}); },
    syncButton() {
      const b = document.getElementById('btnSound');
      if (b) { b.textContent = muted ? '🔇' : '🔊'; b.setAttribute('aria-pressed', muted ? 'true' : 'false'); }
    },
    init() {
      const unlock = () => { ensure(); };
      ['pointerdown', 'touchend', 'keydown'].forEach((ev) => document.addEventListener(ev, unlock, { passive: true }));
      document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('button');
        if (!b || b.disabled) return;
        if (b.id === 'btnSound') { Audio.setMuted(!muted); Audio.play('click'); return; }
        Audio.play('click');
      });
      const E = TM.Events;
      E.on('sale', () => Audio.play('coin'));
      E.on('levelUp', () => Audio.play('level'));
      E.on('newDay', () => Audio.play('day'));
      E.on('gameOver', () => Audio.play('bad'));
      E.on('delivery', () => Audio.play('good'));
      E.on('toast', (t) => { if (t && t.type === 'good') Audio.play('good'); else if (t && t.type === 'bad') Audio.play('bad'); else if (t && t.type === 'warn') Audio.play('warn'); });
      Audio.syncButton();
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
