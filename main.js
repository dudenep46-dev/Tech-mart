/* ==========================================================================
   TechMart Empire: Ultra Simulator - main.js
   Boot sequence, save/load (server + localStorage) and autosave.
   ========================================================================== */
(function (global) {
  'use strict';
  const TM = global.TM;
  const LS_KEY = 'techmart.save.v1';
  let inflight = false;

  /* ---------------- Platform layer (CrazyGames SDK, optional) ---------------- */
  // The game runs anywhere: on Render (server saves) or inside CrazyGames
  // (SDK data module + gameplay events). Every SDK call is guarded.
  const Platform = (TM.Platform = {
    sdk: null,
    active: false,
    playing: false,
    useServer: false,
    async init() {
      Platform.useServer = /^https?:$/.test(global.location.protocol);
      const t0 = Date.now();
      while (!(global.CrazyGames && global.CrazyGames.SDK) && Date.now() - t0 < 2500) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const sdk = global.CrazyGames && global.CrazyGames.SDK;
      if (!sdk) return;
      try {
        await sdk.init();
        if (sdk.environment && sdk.environment !== 'disabled') {
          Platform.sdk = sdk;
          Platform.active = true;
          Platform.useServer = false; // CrazyGames hosts static files only
        }
      } catch (e) { /* SDK unavailable (ad-blocker / offline): run standalone */ }
    },
    loading(on) {
      try { if (Platform.active) Platform.sdk.game[on ? 'loadingStart' : 'loadingStop'](); } catch (e) { /* ignore */ }
    },
    // Called a few times per second: reports real play time (not menus/modals/hidden tab).
    syncGameplay() {
      if (!Platform.active) return;
      const now = !!(TM.Engine.isRunning() && !document.hidden);
      if (now === Platform.playing) return;
      Platform.playing = now;
      try { Platform.sdk.game[now ? 'gameplayStart' : 'gameplayStop'](); } catch (e) { /* ignore */ }
    },
    getItem(k) { try { return Platform.active ? Platform.sdk.data.getItem(k) : null; } catch (e) { return null; } },
    setItem(k, v) { try { if (Platform.active) Platform.sdk.data.setItem(k, v); } catch (e) { /* ignore */ } },
    celebrate() { try { if (Platform.active) Platform.sdk.game.happytime(); } catch (e) { /* ignore */ } }
  });

  function parse(raw) {
    if (!raw) return null;
    try { const o = JSON.parse(raw); return o && typeof o.cash === 'number' ? o : null; } catch (e) { return null; }
  }

  const Save = (TM.Save = {
    readLocal() {
      try {
        const a = parse(Platform.getItem(LS_KEY));
        const b = parse(global.localStorage.getItem(LS_KEY));
        if (a && b) return (a.savedAt || 0) >= (b.savedAt || 0) ? a : b;
        return a || b;
      } catch (e) { return parse(Platform.getItem(LS_KEY)); }
    },

    async readRemote() {
      if (!Platform.useServer) return null;
      try {
        const id = TM.state ? TM.state.playerId : null;
        const pid = id || global.localStorage.getItem('techmart.playerId');
        if (!pid) return null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch('api/load?playerId=' + encodeURIComponent(pid), { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.ok && data.state && typeof data.state.cash === 'number') {
          data.state.savedAt = data.state.savedAt || data.savedAt || 0;
          return data.state;
        }
        return null;
      } catch (e) { return null; }
    },

    async loadBest() {
      const local = Save.readLocal();
      const remote = await Save.readRemote();
      if (local && remote) return (remote.savedAt || 0) > (local.savedAt || 0) ? remote : local;
      return local || remote || null;
    },

    enabled: false, // stays false until the player picks Continue / New Game, so the placeholder state never overwrites a real save

    async save(opts) {
      if (!TM.state || !Save.enabled) return;
      const snap = TM.Engine.serialize();
      const json = JSON.stringify(snap);
      try { global.localStorage.setItem(LS_KEY, json); } catch (e) { /* storage full or blocked */ }
      Platform.setItem(LS_KEY, json);
      if (!Platform.useServer) return;
      const body = JSON.stringify({ playerId: snap.playerId, state: snap });
      if (opts && opts.beacon && navigator.sendBeacon) {
        try { navigator.sendBeacon('api/save', new Blob([body], { type: 'application/json' })); } catch (e) { /* ignore */ }
        return;
      }
      if (inflight) return;
      inflight = true;
      try {
        await fetch('api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 });
      } catch (e) { /* offline: local copy is enough */ }
      inflight = false;
    },

    reset() {
      try { global.localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
      TM.Engine.setState(TM.newState('TechMart'));
      TM.Engine.setPaused('intro', false);
      Save.enabled = true;
      Save.save();
    }
  });

  async function boot() {
    await Platform.init();
    Platform.loading(true);
    TM.UI.init();
    if (TM.Audio) TM.Audio.init();
    TM.Engine.init(document.getElementById('gameCanvas'));
    TM.Engine.setPaused('intro', true);
    TM.Engine.setState(TM.newState('TechMart'));
    TM.Engine.start();

    const saved = await Save.loadBest();
    Platform.loading(false);

    TM.UI.showIntro(
      !!saved,
      () => {
        TM.Engine.setState(saved);
        TM.Engine.setPaused('intro', false);
        Save.enabled = true;
      },
      (name) => {
        TM.Engine.setState(TM.newState(name));
        TM.Engine.setPaused('intro', false);
        Save.enabled = true;
        Save.save();
      }
    );

    // Autosave every 20 seconds while playing
    setInterval(() => { if (TM.Engine.isRunning()) Save.save(); }, 20000);
    setInterval(() => Platform.syncGameplay(), 400);
    TM.Events.on('levelUp', () => Platform.celebrate());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        TM.Engine.setPaused('hidden', true);
        if (TM.Audio) TM.Audio.suspend();
        Save.save({ beacon: true });
      } else {
        TM.Engine.setPaused('hidden', false);
        if (TM.Audio) TM.Audio.resume();
      }
    });
    global.addEventListener('pagehide', () => Save.save({ beacon: true }));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof window !== 'undefined' ? window : globalThis);
