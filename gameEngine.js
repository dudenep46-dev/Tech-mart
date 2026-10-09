/* ==========================================================================
   TechMart Empire: Ultra Simulator - gameEngine.js
   Core: utilities, events, config, state, layout, flow-field pathfinding,
   pooled customer AI, stockers, main loop (60 FPS cap) and canvas renderer.
   ========================================================================== */
(function (global) {
  'use strict';
  const TM = (global.TM = global.TM || {});

  /* ------------------------------ Utilities ------------------------------ */
  const U = (TM.Util = {
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    round2: (n) => Math.round(n * 100) / 100,
    uid: () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
    esc: (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    money: (n) => {
      const neg = n < 0;
      const a = Math.abs(n);
      let s;
      if (a >= 1e6) s = (a / 1e6).toFixed(2) + 'M';
      else if (a >= 1e4 || a % 1 === 0) s = Math.round(a).toLocaleString('en-US');
      else s = a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (neg ? '-' : '') + '$' + s;
    },
    shuffle: (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
      }
      return a;
    }
  });

  /* ------------------------------- Events -------------------------------- */
  const listeners = {};
  TM.Events = {
    on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); },
    emit(name, data) {
      const l = listeners[name];
      if (l) for (let i = 0; i < l.length; i++) l[i](data);
    }
  };
  const emit = (n, d) => TM.Events.emit(n, d);

  /* ------------------------------- Config -------------------------------- */
  const Config = (TM.Config = {
    TILE: 40,
    DAY_LENGTH: 150, // game seconds for one trading day (8:00 AM -> 8:00 PM)
    OPEN_HOUR: 8,
    HOURS: 12,
    MAX_CUSTOMERS_POOL: 48,
    SIZES: [{ cols: 12, rows: 11 }, { cols: 16, rows: 13 }, { cols: 20, rows: 15 }, { cols: 24, rows: 17 }],
    PHONE_SLOTS: [3, 5, 7, 9],
    EXPANSION: [{ cost: 0, level: 1 }, { cost: 1200, level: 3 }, { cost: 4000, level: 5 }, { cost: 12000, level: 7 }],
    LEVEL_XP: [0, 60, 180, 400, 800, 1400, 2300, 3600, 5500, 8500],
    TIER_COLORS: ['#94a3b8', '#38bdf8', '#34d399', '#a78bfa', '#f472b6', '#fbbf24', '#f87171'],
    SCAN_COST: 8,
    MARKET_REFRESH_COST: 15,
    TRADER_RATE: 0.7,
    CARD_FEE: 0.015,
    BANKRUPT_AT: -1500,
    CATEGORIES: {
      groceries: { name: 'Groceries', icon: '🛒', color: '#16a34a', wholesale: 3, refMult: 1.5, capacity: 40, unlock: 1, shelfCost: 150, maxQty: 6, step: 10, discount: [30, 80] },
      accessories: { name: 'Tech Accessories', icon: '🎧', color: '#2563eb', wholesale: 12, refMult: 1.5, capacity: 20, unlock: 2, shelfCost: 400, maxQty: 2, step: 5, discount: [15, 40] },
      appliances: { name: 'Appliances', icon: '📺', color: '#d97706', wholesale: 90, refMult: 1.5, capacity: 6, unlock: 4, shelfCost: 1200, maxQty: 1, step: 2, discount: [6, 15] }
    },
    MODELS: [
      { brand: 'Orbit', name: 'S1', value: 140, minLevel: 1 },
      { brand: 'Nova', name: 'Lite', value: 200, minLevel: 1 },
      { brand: 'Kite', name: 'Pro', value: 300, minLevel: 2 },
      { brand: 'Zenith', name: 'Z5', value: 450, minLevel: 3 },
      { brand: 'Orbit', name: 'Ultra', value: 650, minLevel: 4 },
      { brand: 'Nova', name: 'Fold', value: 900, minLevel: 6 },
      { brand: 'Zenith', name: 'Max', value: 1250, minLevel: 8 }
    ],
    PARTS: {
      screen: { name: 'Screen', icon: '📱', rate: 0.18, game: 'crack', symptom: 'Cracked screen' },
      battery: { name: 'Battery', icon: '🔋', rate: 0.08, game: 'timing', symptom: 'Dies within minutes' },
      board: { name: 'Mainboard', icon: '🧩', rate: 0.22, game: 'sequence', symptom: "Won't boot" },
      camera: { name: 'Camera', icon: '📷', rate: 0.12, game: 'focus', symptom: 'Blurry camera' },
      speaker: { name: 'Speaker', icon: '🔊', rate: 0.06, game: 'clean', symptom: 'No sound' }
    },
    STAFF: {
      cashier: { name: 'Cashier', icon: '🧑‍💼', hire: 250, wage: 45, max: 3, desc: 'Serves the queue automatically. More cashiers = faster.' },
      stocker: { name: 'Stocker', icon: '🧑‍🔧', hire: 180, wage: 35, max: 3, desc: 'Moves stock from the warehouse onto empty shelves.' }
    },
    FLOORS: [
      { name: 'Classic', a: '#e2e8f0', b: '#cbd5e1' },
      { name: 'Wood', a: '#d6a869', b: '#c8975a' },
      { name: 'Mint', a: '#d1fae5', b: '#a7f3d0' },
      { name: 'Midnight', a: '#3b4a63', b: '#334155' }
    ],
    WALLS: [
      { name: 'Slate', c: '#475569', d: '#334155' },
      { name: 'Royal', c: '#4f46e5', d: '#3730a3' },
      { name: 'Crimson', c: '#be123c', d: '#881337' },
      { name: 'Forest', c: '#15803d', d: '#14532d' }
    ],
    THEME_COST: 50,
    rent(expansion) { return 30 + 60 * expansion; }
  });

  /* ------------------------------- State --------------------------------- */
  function newDay() {
    return { rev: { phones: 0, groceries: 0, accessories: 0, appliances: 0 }, cogs: 0, fees: 0, purchases: 0, customers: 0, lost: 0 };
  }

  function getPlayerId() {
    let id = null;
    try { id = global.localStorage && global.localStorage.getItem('techmart.playerId'); } catch (e) { id = null; }
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = 'p' + U.uid() + U.uid();
      try { global.localStorage && global.localStorage.setItem('techmart.playerId', id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  function newState(name) {
    return {
      v: 1,
      playerId: getPlayerId(),
      savedAt: 0,
      storeName: (name && String(name).trim().slice(0, 18)) || 'TechMart',
      cash: 1500, day: 1, clock: 0, phase: 'open',
      xp: 0, level: 1, happiness: 75, expansion: 0, speed: 1,
      theme: { floor: 0, wall: 0 },
      phones: { market: [], bench: [], sold: 0 },
      shelves: [],
      warehouse: { groceries: 0, accessories: 0, appliances: 0 },
      orders: [],
      staff: { cashier: 0, stocker: 0 },
      today: newDay(), history: [], lastReport: null,
      totals: { revenue: 0, customers: 0 }
    };
  }

  function fixPhone(p) {
    if (!p || typeof p !== 'object') return null;
    const tier = U.clamp(Math.floor(+p.tier || 0), 0, Config.MODELS.length - 1);
    const faults = Array.isArray(p.faults) ? p.faults.filter((f) => Config.PARTS[f]) : [];
    if (!faults.length) return null;
    return {
      id: String(p.id || U.uid()), brand: String(p.brand || 'Orbit'), name: String(p.name || 'Phone'), tier,
      color: Config.TIER_COLORS[tier], value: Math.max(10, +p.value || 100), ask: Math.max(1, +p.ask || 10),
      faults, fixed: Array.isArray(p.fixed) ? p.fixed.filter((f) => faults.indexOf(f) >= 0) : [],
      diag: !!p.diag, bonus: U.clamp(+p.bonus || 0, 0, 0.08), invested: Math.max(0, +p.invested || 0),
      listed: !!p.listed, slot: p.listed ? Math.floor(+p.slot || 0) : -1, price: Math.max(1, Math.round(+p.price || +p.value || 100)),
      reserved: false
    };
  }

  function hydrate(raw) {
    const s = newState(raw && raw.storeName);
    if (!raw || typeof raw !== 'object') return s;
    const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    const arr = (v) => (Array.isArray(v) ? v : []);
    if (typeof raw.playerId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(raw.playerId)) s.playerId = raw.playerId;
    s.savedAt = num(raw.savedAt, 0);
    s.cash = num(raw.cash, s.cash);
    s.day = Math.max(1, Math.floor(num(raw.day, 1)));
    s.clock = U.clamp(num(raw.clock, 0), 0, 1);
    s.phase = ['open', 'closing', 'report'].indexOf(raw.phase) >= 0 ? raw.phase : 'open';
    s.xp = Math.max(0, num(raw.xp, 0));
    s.level = U.clamp(Math.floor(num(raw.level, 1)), 1, Config.LEVEL_XP.length);
    s.happiness = U.clamp(num(raw.happiness, 75), 0, 100);
    s.expansion = U.clamp(Math.floor(num(raw.expansion, 0)), 0, Config.SIZES.length - 1);
    s.speed = [1, 2, 3].indexOf(raw.speed) >= 0 ? raw.speed : 1;
    if (raw.theme) {
      s.theme.floor = U.clamp(Math.floor(num(raw.theme.floor, 0)), 0, Config.FLOORS.length - 1);
      s.theme.wall = U.clamp(Math.floor(num(raw.theme.wall, 0)), 0, Config.WALLS.length - 1);
    }
    const ph = raw.phones || {};
    s.phones.market = arr(ph.market).map(fixPhone).filter(Boolean);
    s.phones.bench = arr(ph.bench).map(fixPhone).filter(Boolean);
    s.phones.sold = Math.max(0, num(ph.sold, 0));
    s.shelves = arr(raw.shelves)
      .filter((sh) => sh && Config.CATEGORIES[sh.cat] && typeof sh.slot === 'string')
      .map((sh) => ({ id: String(sh.id || U.uid()), cat: sh.cat, slot: sh.slot, stock: U.clamp(Math.floor(num(sh.stock, 0)), 0, Config.CATEGORIES[sh.cat].capacity), markup: U.clamp(Math.round(num(sh.markup, 35)), 0, 120) }));
    Object.keys(s.warehouse).forEach((k) => { s.warehouse[k] = Math.max(0, Math.floor(num(raw.warehouse && raw.warehouse[k], 0))); });
    s.orders = arr(raw.orders).filter((o) => o && Config.CATEGORIES[o.cat] && num(o.qty, 0) > 0).map((o) => ({ id: String(o.id || U.uid()), cat: o.cat, qty: Math.floor(o.qty), eta: Math.max(0, num(o.eta, 0)) }));
    s.staff.cashier = U.clamp(Math.floor(num(raw.staff && raw.staff.cashier, 0)), 0, Config.STAFF.cashier.max);
    s.staff.stocker = U.clamp(Math.floor(num(raw.staff && raw.staff.stocker, 0)), 0, Config.STAFF.stocker.max);
    if (raw.today && typeof raw.today === 'object') {
      const d = newDay();
      ['phones', 'groceries', 'accessories', 'appliances'].forEach((k) => { d.rev[k] = num(raw.today.rev && raw.today.rev[k], 0); });
      ['cogs', 'fees', 'purchases', 'customers', 'lost'].forEach((k) => { d[k] = num(raw.today[k], 0); });
      s.today = d;
    }
    s.history = arr(raw.history).filter((h) => h && typeof h.day === 'number').slice(-14);
    s.lastReport = raw.lastReport && typeof raw.lastReport === 'object' ? raw.lastReport : null;
    if (s.phase === 'report' && !s.lastReport) s.phase = 'open';
    if (raw.totals) { s.totals.revenue = num(raw.totals.revenue, 0); s.totals.customers = num(raw.totals.customers, 0); }
    return s;
  }
  TM.newState = newState;
  TM.hydrate = hydrate;

  /* ------------------------------- Layout -------------------------------- */
  const Layout = (TM.Layout = {
    g: null,
    version: 0,
    build() {
      const st = TM.state;
      const size = Config.SIZES[st.expansion];
      const cols = size.cols, rows = size.rows;
      const cells = new Uint8Array(cols * rows); // 0 floor, 1 wall, 2 blocked
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) cells[y * cols + x] = 1;
        }
      }
      const door = { x: 1, y: rows - 1 };
      cells[door.y * cols + door.x] = 0;
      const counter = { x: 6, y: rows - 3, w: 2 };
      cells[counter.y * cols + 6] = 2;
      cells[counter.y * cols + 7] = 2;
      const cashier = { x: 8, y: rows - 3 };
      cells[cashier.y * cols + cashier.x] = 2;
      const queue = [];
      [rows - 3, rows - 4].forEach((y) => { for (let x = 5; x >= 2; x--) queue.push({ x, y }); });
      const cases = [];
      const nCases = Config.PHONE_SLOTS[st.expansion];
      for (let i = 0; i < nCases; i++) {
        const x = 2 + 2 * i;
        cases.push({ i, x, y: 1, ax: x, ay: 2 });
        cells[1 * cols + x] = 2;
      }
      const shelfSlots = [];
      const slotMap = {};
      for (let ri = 0; 4 + 3 * ri <= rows - 6; ri++) {
        for (let ci = 0; 2 + 3 * ci + 1 <= cols - 3; ci++) {
          const slot = { key: ri + ':' + ci, x: 2 + 3 * ci, y: 4 + 3 * ri };
          shelfSlots.push(slot);
          slotMap[slot.key] = slot;
        }
      }
      st.shelves.forEach((sh) => {
        const sl = slotMap[sh.slot];
        if (sl) { cells[sl.y * cols + sl.x] = 2; cells[sl.y * cols + sl.x + 1] = 2; }
      });
      const floorCells = [];
      for (let y = 2; y < rows - 1; y++) for (let x = 1; x < cols - 1; x++) if (cells[y * cols + x] === 0) floorCells.push({ x, y });
      Layout.version++;
      Layout.g = { cols, rows, cells, door, counter, cashier, queue, cases, shelfSlots, slotMap, floorCells, backroom: { x: 1, y: 1 }, worldW: cols * Config.TILE, worldH: rows * Config.TILE };
      fieldCache.clear();
      return Layout.g;
    }
  });

  /* ------------------- Flow-field pathfinding (BFS, cached) --------------- */
  const fieldCache = new Map();
  function getField(gx, gy) {
    const g = Layout.g;
    const key = gy * g.cols + gx;
    let f = fieldCache.get(key);
    if (f) return f;
    const n = g.cols * g.rows;
    f = new Uint16Array(n).fill(65535);
    fieldCache.set(key, f);
    if (g.cells[key] !== 0) return f;
    const q = new Int16Array(n);
    let h = 0, t = 0;
    q[t++] = key; f[key] = 0;
    while (h < t) {
      const cur = q[h++];
      const cx = cur % g.cols, cy = (cur / g.cols) | 0;
      const d = f[cur] + 1;
      let nb;
      if (cx > 0) { nb = cur - 1; if (g.cells[nb] === 0 && f[nb] === 65535) { f[nb] = d; q[t++] = nb; } }
      if (cx < g.cols - 1) { nb = cur + 1; if (g.cells[nb] === 0 && f[nb] === 65535) { f[nb] = d; q[t++] = nb; } }
      if (cy > 0) { nb = cur - g.cols; if (g.cells[nb] === 0 && f[nb] === 65535) { f[nb] = d; q[t++] = nb; } }
      if (cy < g.rows - 1) { nb = cur + g.cols; if (g.cells[nb] === 0 && f[nb] === 65535) { f[nb] = d; q[t++] = nb; } }
    }
    return f;
  }

  function snapToDoor(e) {
    const g = Layout.g;
    e.x = g.door.x + 0.5; e.y = g.door.y - 0.5;
  }

  // Moves entity e (x,y,gx,gy,ox,oy,speed) one step along the flow field. Returns true when at the goal.
  function moveAlong(e, dt) {
    const g = Layout.g;
    const f = getField(e.gx, e.gy);
    const cx = Math.floor(e.x), cy = Math.floor(e.y);
    if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) { snapToDoor(e); return false; }
    const idx = cy * g.cols + cx;
    const d = f[idx];
    if (d === 65535) { snapToDoor(e); return false; }
    let tx, ty;
    if (d === 0) {
      tx = e.gx + 0.5 + e.ox; ty = e.gy + 0.5 + e.oy;
    } else {
      let bd = d, bx = cx, by = cy;
      if (cx > 0 && f[idx - 1] < bd) { bd = f[idx - 1]; bx = cx - 1; by = cy; }
      if (cx < g.cols - 1 && f[idx + 1] < bd) { bd = f[idx + 1]; bx = cx + 1; by = cy; }
      if (cy > 0 && f[idx - g.cols] < bd) { bd = f[idx - g.cols]; bx = cx; by = cy - 1; }
      if (cy < g.rows - 1 && f[idx + g.cols] < bd) { bd = f[idx + g.cols]; bx = cx; by = cy + 1; }
      tx = bx + 0.5 + e.ox; ty = by + 0.5 + e.oy;
    }
    const dx = tx - e.x, dy = ty - e.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = e.speed * dt;
    if (dist <= step) { e.x = tx; e.y = ty; return d === 0; }
    e.x += (dx / dist) * step; e.y += (dy / dist) * step;
    if (dx > 0.01) e.face = 1; else if (dx < -0.01) e.face = -1;
    return false;
  }

  function setGoal(e, x, y) { e.gx = x; e.gy = y; }

  /* ----------------------------- Customer pool --------------------------- */
  const SKIN = ['#f5d0b0', '#e0ac82', '#c68642', '#8d5524', '#ffdbac'];
  const SHIRT = ['#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#14b8a6', '#ec4899', '#64748b'];
  const HAIR = ['#1f2937', '#78350f', '#facc15', '#111827', '#9a3412'];

  const pool = [];
  for (let i = 0; i < Config.MAX_CUSTOMERS_POOL; i++) {
    pool.push({
      active: false, x: 0, y: 0, gx: 0, gy: 0, ox: 0, oy: 0, speed: 2, face: 1,
      state: 'idle', wants: [], wantIdx: 0, cart: { items: [], phone: null },
      patience: 0, maxPatience: 1, proc: 0, procMax: 1, timer: 0, tol: 1, pay: 'cash', target: null,
      unhappy: 0, bought: false, skin: '', shirt: '', hair: ''
    });
  }
  const queue = [];
  const stockers = [];
  const floaters = [];
  for (let i = 0; i < 24; i++) floaters.push({ active: false, x: 0, y: 0, t: 0, text: '', color: '#fff' });

  let spawnTimer = 2;
  let activeCount = 0;

  function acquire() {
    for (let i = 0; i < pool.length; i++) if (!pool[i].active) return pool[i];
    return null;
  }

  function floatText(x, y, text, color) {
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      if (!f.active) { f.active = true; f.x = x; f.y = y; f.t = 0; f.text = text; f.color = color || '#fde68a'; return; }
    }
  }

  function addHappiness(d) {
    const st = TM.state;
    st.happiness = U.clamp(st.happiness + d, 0, 100);
  }

  function addXP(n) {
    const st = TM.state;
    st.xp += n;
    while (st.level < Config.LEVEL_XP.length && st.xp >= Config.LEVEL_XP[st.level]) {
      st.level++;
      emit('levelUp', st.level);
    }
  }

  function hasStock() {
    const st = TM.state;
    return st.phones.bench.some((p) => p.listed && !p.reserved) || st.shelves.some((s) => s.stock > 0);
  }

  function nextInterval() {
    const st = TM.state;
    let rate = (0.55 + (st.happiness / 100) * 0.9) * (1 + 0.1 * (st.level - 1)) * (1 + 0.25 * st.expansion);
    const t = st.clock;
    if ((t > 0.3 && t < 0.5) || (t > 0.75 && t < 0.92)) rate *= 1.5;
    if (!hasStock()) rate *= 0.25;
    return (6.5 / rate) * U.rand(0.7, 1.3);
  }

  function buildWants() {
    const st = TM.state;
    const wants = [];
    const phonesAvail = st.phones.bench.some((p) => p.listed && !p.reserved);
    const cats = [];
    st.shelves.forEach((s) => { if (cats.indexOf(s.cat) < 0) cats.push(s.cat); });
    if (phonesAvail && (cats.length === 0 || Math.random() < 0.45)) wants.push({ type: 'phone' });
    if (cats.length) {
      const n = wants.length ? (Math.random() < 0.35 ? 1 : 0) : 1 + (Math.random() < 0.5 ? 1 : 0) + (Math.random() < 0.2 ? 1 : 0);
      const order = U.shuffle(cats);
      for (let i = 0; i < Math.min(n, order.length); i++) {
        wants.push({ type: 'shelf', cat: order[i], qty: U.randInt(1, Config.CATEGORIES[order[i]].maxQty) });
      }
    }
    if (!wants.length) wants.push({ type: 'look' });
    return wants;
  }

  function spawnCustomer() {
    const c = acquire();
    if (!c) return;
    const g = Layout.g, st = TM.state;
    c.active = true; activeCount++;
    c.x = g.door.x + 0.5; c.y = g.door.y + 0.5;
    c.ox = U.rand(-0.16, 0.16); c.oy = U.rand(-0.12, 0.12);
    c.speed = U.rand(1.7, 2.5); c.face = 1;
    c.skin = U.pick(SKIN); c.shirt = U.pick(SHIRT); c.hair = U.pick(HAIR);
    c.pay = Math.random() < 0.55 ? 'card' : 'cash';
    c.tol = U.rand(0.9, 1.3);
    c.patience = c.maxPatience = U.rand(38, 62);
    c.cart = { items: [], phone: null };
    c.wants = buildWants(); c.wantIdx = 0; c.unhappy = 0; c.bought = false; c.target = null;
    c.proc = 0; c.procMax = 1; c.timer = 0;
    st.today.customers++;
    st.totals.customers++;
    nextWant(c);
  }

  function pickPhone() {
    const list = TM.state.phones.bench.filter((p) => p.listed && !p.reserved);
    return list.length ? U.pick(list) : null;
  }
  function pickShelf(cat) {
    const all = TM.state.shelves.filter((s) => s.cat === cat);
    if (!all.length) return null;
    const stocked = all.filter((s) => s.stock > 0);
    return U.pick(stocked.length ? stocked : all);
  }
  function findShelf(id) {
    const sh = TM.state.shelves;
    for (let i = 0; i < sh.length; i++) if (sh[i].id === id) return sh[i];
    return null;
  }
  function findPhone(id) {
    const b = TM.state.phones.bench;
    for (let i = 0; i < b.length; i++) if (b[i].id === id) return b[i];
    return null;
  }

  function disappoint(c, amount) {
    addHappiness(-amount);
    c.unhappy++;
  }

  function nextWant(c) {
    const g = Layout.g;
    while (c.wantIdx < c.wants.length) {
      const w = c.wants[c.wantIdx];
      if (w.type === 'phone') {
        const p = pickPhone();
        if (!p || !g.cases[p.slot]) { c.wantIdx++; disappoint(c, 0.8); continue; }
        c.target = p.id;
        setGoal(c, g.cases[p.slot].ax, g.cases[p.slot].ay);
      } else if (w.type === 'shelf') {
        const s = pickShelf(w.cat);
        const slot = s && g.slotMap[s.slot];
        if (!slot) { c.wantIdx++; disappoint(c, 0.5); continue; }
        c.target = s.id;
        setGoal(c, slot.x + (Math.random() < 0.5 ? 0 : 1), slot.y + 1);
      } else {
        const cell = g.floorCells.length ? U.pick(g.floorCells) : { x: 1, y: g.rows - 2 };
        setGoal(c, cell.x, cell.y);
      }
      c.state = 'walking';
      return;
    }
    if (c.cart.items.length || c.cart.phone) joinQueue(c);
    else leave(c);
  }

  function resolveWant(c) {
    const st = TM.state;
    const w = c.wants[c.wantIdx];
    if (w.type === 'phone') {
      let p = findPhone(c.target);
      if (!p || !p.listed || p.reserved) {
        p = pickPhone();
        if (!p) { disappoint(c, 0.8); c.wantIdx++; nextWant(c); return; }
      }
      const MS = TM.MobileShop;
      const mood = MS.buyFactor();
      if (p.price <= MS.fairValue(p) * mood) {
        p.reserved = true;
        c.cart.phone = p;
        if (p.price < MS.fairValue(p) * 0.85) addHappiness(0.6);
      } else {
        disappoint(c, 0.7);
      }
    } else if (w.type === 'shelf') {
      const s = findShelf(c.target);
      const cat = Config.CATEGORIES[w.cat];
      if (!s || s.stock <= 0) {
        disappoint(c, 0.8);
      } else {
        const price = TM.Supermarket.unitPrice(s);
        const ref = cat.wholesale * cat.refMult;
        if (price <= ref * c.tol) {
          const q = Math.min(s.stock, w.qty);
          s.stock -= q;
          c.cart.items.push({ cat: w.cat, qty: q, unit: price, cost: cat.wholesale * q, shelf: s.id });
          if (q < w.qty) disappoint(c, 0.3);
        } else {
          disappoint(c, 0.6);
        }
      }
    }
    c.wantIdx++;
    nextWant(c);
  }

  function reassignQueue() {
    const g = Layout.g;
    for (let i = 0; i < queue.length; i++) {
      queue[i].gx = g.queue[i].x; queue[i].gy = g.queue[i].y;
    }
  }

  function joinQueue(c) {
    const g = Layout.g;
    if (queue.length >= g.queue.length) { abandon(c, 1.2); return; }
    queue.push(c);
    c.state = 'queueing';
    reassignQueue();
  }

  function removeFromQueue(c) {
    const i = queue.indexOf(c);
    if (i >= 0) { queue.splice(i, 1); reassignQueue(); }
  }

  function returnCart(c) {
    const st = TM.state;
    c.cart.items.forEach((it) => {
      const s = findShelf(it.shelf);
      const cap = Config.CATEGORIES[it.cat].capacity;
      if (s && s.stock + it.qty <= cap) s.stock += it.qty;
      else st.warehouse[it.cat] += it.qty;
    });
    if (c.cart.phone) c.cart.phone.reserved = false;
    c.cart = { items: [], phone: null };
  }

  function leave(c) {
    const g = Layout.g;
    removeFromQueue(c);
    if (!c.bought && c.wants.length && c.wants[0].type !== 'look') TM.state.today.lost++;
    c.state = 'leaving';
    setGoal(c, g.door.x, g.door.y);
  }

  function abandon(c, penalty) {
    returnCart(c);
    addHappiness(-penalty);
    floatText(c.x, c.y - 0.8, '😠', '#fca5a5');
    leave(c);
  }

  function release(c) {
    c.active = false;
    c.state = 'idle';
    activeCount--;
  }

  function checkout(c) {
    const st = TM.state, day = st.today;
    let total = 0, profit = 0;
    c.cart.items.forEach((it) => {
      const amt = it.unit * it.qty;
      total += amt; profit += amt - it.cost;
      day.rev[it.cat] += amt; day.cogs += it.cost;
    });
    const p = c.cart.phone;
    if (p) {
      total += p.price; profit += p.price - p.invested;
      day.rev.phones += p.price; day.cogs += p.invested;
      const b = st.phones.bench;
      const i = b.indexOf(p);
      if (i >= 0) b.splice(i, 1);
      st.phones.sold++;
    }
    const fee = c.pay === 'card' ? total * Config.CARD_FEE : 0;
    day.fees += fee;
    st.cash += total - fee;
    st.totals.revenue += total;
    addXP(p ? 2 + Math.max(0, profit) * 0.25 : 1 + Math.max(0, profit) * 0.5);
    addHappiness(c.patience / c.maxPatience > 0.5 ? 1.2 : 0.5);
    c.cart = { items: [], phone: null };
    c.bought = true;
    floatText(c.x, c.y - 0.9, '+' + U.money(Math.round(total)), '#86efac');
    removeFromQueue(c);
    c.state = 'leaving';
    setGoal(c, Layout.g.door.x, Layout.g.door.y);
    emit('sale', total);
  }

  function updateCustomer(c, dt) {
    switch (c.state) {
      case 'walking':
        if (moveAlong(c, dt)) { c.state = 'browsing'; c.timer = U.rand(1.2, 2.8); }
        break;
      case 'browsing':
        c.timer -= dt;
        if (c.timer <= 0) resolveWant(c);
        break;
      case 'queueing':
        c.patience -= dt;
        if (c.patience <= 0) { abandon(c, 2.2); break; }
        if (moveAlong(c, dt) && queue[0] === c) {
          c.state = 'atCounter';
          c.procMax = c.proc = c.pay === 'card' ? 1.8 : 1.0;
        }
        break;
      case 'atCounter':
        c.patience -= dt * 0.7;
        if (c.patience <= 0) abandon(c, 2.2);
        break;
      case 'leaving':
        if (moveAlong(c, dt)) release(c);
        break;
      default: break;
    }
  }

  function updateCashier(dt) {
    const front = queue[0];
    if (!front || front.state !== 'atCounter') return;
    const auto = TM.state.staff.cashier;
    if (auto > 0) {
      front.proc -= dt * (1 + 0.45 * (auto - 1));
      if (front.proc <= 0) checkout(front);
    }
  }

  function counterReady() {
    const f = queue[0];
    return !!(f && f.state === 'atCounter');
  }

  function manualCheckout() {
    const f = queue[0];
    if (f && f.state === 'atCounter') { checkout(f); return true; }
    return false;
  }

  /* -------------------------------- Stockers ----------------------------- */
  function syncStockers() {
    const st = TM.state, g = Layout.g;
    while (stockers.length < st.staff.stocker) {
      stockers.push({ x: g.backroom.x + 0.5, y: g.backroom.y + 0.5, gx: g.backroom.x, gy: g.backroom.y, ox: 0, oy: 0, speed: 2.6, face: 1, state: 'idle', timer: 0, shelfId: null, carry: 0, cat: null });
    }
    while (stockers.length > st.staff.stocker) {
      const s = stockers.pop();
      if (s.carry > 0 && s.cat) st.warehouse[s.cat] += s.carry;
      if (s.shelfId) TM.Supermarket.releaseJob(s.shelfId);
    }
  }

  function updateStockers(dt) {
    const g = Layout.g, st = TM.state;
    for (let i = 0; i < stockers.length; i++) {
      const s = stockers[i];
      if (s.state === 'idle') {
        s.timer -= dt;
        if (s.timer <= 0) {
          s.timer = 0.6;
          const job = TM.Supermarket.takeRestockJob();
          if (job) {
            const slot = g.slotMap[job.slotKey];
            if (slot) {
              s.state = 'toShelf'; s.shelfId = job.shelfId; s.carry = job.qty; s.cat = job.cat;
              setGoal(s, slot.x, slot.y + 1);
            } else {
              st.warehouse[job.cat] += job.qty;
              TM.Supermarket.releaseJob(job.shelfId);
            }
          }
        }
      } else if (s.state === 'toShelf') {
        if (moveAlong(s, dt)) {
          const sh = findShelf(s.shelfId);
          if (sh) {
            const cap = Config.CATEGORIES[sh.cat].capacity;
            const add = Math.min(s.carry, cap - sh.stock);
            sh.stock += add;
            if (s.carry > add) st.warehouse[s.cat] += s.carry - add;
          } else {
            st.warehouse[s.cat] += s.carry;
          }
          TM.Supermarket.releaseJob(s.shelfId);
          s.carry = 0; s.shelfId = null; s.state = 'returning';
          setGoal(s, g.backroom.x, g.backroom.y);
        }
      } else if (s.state === 'returning') {
        if (moveAlong(s, dt)) { s.state = 'idle'; s.timer = 0.4; }
      }
    }
  }

  function resetCustomers() {
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      if (c.active) { returnCart(c); c.active = false; c.state = 'idle'; }
    }
    activeCount = 0;
    queue.length = 0;
    for (let i = 0; i < stockers.length; i++) {
      const s = stockers[i];
      if (s.carry > 0 && s.cat) TM.state.warehouse[s.cat] += s.carry;
      if (s.shelfId) TM.Supermarket.releaseJob(s.shelfId);
      s.carry = 0; s.shelfId = null; s.state = 'idle';
      const g = Layout.g;
      s.x = g.backroom.x + 0.5; s.y = g.backroom.y + 0.5; s.gx = g.backroom.x; s.gy = g.backroom.y;
    }
  }

  /* ------------------------------ Simulation ----------------------------- */
  function endDay() {
    const st = TM.state, d = st.today, SM = TM.Supermarket;
    const rev = d.rev;
    const revenueTotal = rev.phones + rev.groceries + rev.accessories + rev.appliances;
    const wages = SM.dailyWages(), rent = SM.dailyRent();
    const net = revenueTotal - d.cogs - d.fees - wages - rent;
    st.cash -= wages + rent;
    const report = {
      day: st.day, revenue: { phones: rev.phones, groceries: rev.groceries, accessories: rev.accessories, appliances: rev.appliances },
      revenueTotal, cogs: d.cogs, fees: d.fees, wages, rent, net, purchases: d.purchases,
      customers: d.customers, lost: d.lost, cashEnd: st.cash, happiness: Math.round(st.happiness), level: st.level
    };
    st.history.push({ day: st.day, revenue: revenueTotal, net });
    if (st.history.length > 14) st.history.shift();
    st.lastReport = report;
    st.phase = 'report';
    addXP(10);
    emit('dayEnd', report);
    if (st.cash < Config.BANKRUPT_AT) emit('gameOver', report);
  }

  function startNextDay() {
    const st = TM.state;
    if (st.phase !== 'report') return;
    st.day++; st.clock = 0; st.phase = 'open'; st.today = newDay(); st.lastReport = null;
    TM.Supermarket.deliverAll();
    TM.MobileShop.refreshMarket(false);
    spawnTimer = 2;
    emit('newDay', st.day);
  }

  function simulate(dt) {
    const st = TM.state;
    if (!st || st.phase === 'report') return;
    if (st.phase === 'open') {
      st.clock += dt / Config.DAY_LENGTH;
      if (st.clock >= 1) { st.clock = 1; st.phase = 'closing'; emit('closing'); }
    }
    TM.Supermarket.update(dt);
    if (st.phase === 'open') {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = nextInterval();
        const maxC = 10 + 6 * st.expansion;
        if (activeCount < maxC) spawnCustomer();
      }
    }
    for (let i = 0; i < pool.length; i++) if (pool[i].active) updateCustomer(pool[i], dt);
    updateCashier(dt);
    updateStockers(dt);
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      if (f.active) { f.t += dt; f.y -= dt * 0.7; if (f.t > 1.4) f.active = false; }
    }
    if (st.phase === 'closing' && activeCount === 0) endDay();
  }

  /* ------------------------------ Rendering ------------------------------ */
  const T = Config.TILE;
  let canvas = null, ctx = null, dpr = 1;
  let view = { k: 1, ox: 0, oy: 0 };
  let staticCanvas = null, staticKey = '';
  const drawList = [];
  let cashierEnt = null;

  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawStatic(sc, k) {
    const g = Layout.g, st = TM.state;
    const fl = Config.FLOORS[st.theme.floor], wl = Config.WALLS[st.theme.wall];
    sc.setTransform(k, 0, 0, k, 0, 0);
    sc.clearRect(0, 0, g.worldW, g.worldH);
    for (let y = 1; y < g.rows - 1; y++) {
      for (let x = 1; x < g.cols - 1; x++) {
        sc.fillStyle = (x + y) & 1 ? fl.a : fl.b;
        sc.fillRect(x * T, y * T, T, T);
      }
    }
    // walls
    sc.fillStyle = wl.c;
    sc.fillRect(0, 0, g.worldW, T);
    sc.fillStyle = wl.d;
    sc.fillRect(0, T - 6, g.worldW, 6);
    sc.fillRect(0, 0, T, g.worldH);
    sc.fillRect(g.worldW - T, 0, T, g.worldH);
    sc.fillRect(0, g.worldH - T, g.worldW, T);
    // door
    const dx = g.door.x * T, dy = g.door.y * T;
    sc.fillStyle = '#7dd3fc';
    sc.fillRect(dx + 3, dy + 6, T - 6, T - 6);
    sc.fillStyle = 'rgba(255,255,255,.55)';
    sc.fillRect(dx + 6, dy + 8, 6, T - 10);
    sc.strokeStyle = '#e2e8f0';
    sc.lineWidth = 3;
    sc.strokeRect(dx + 3, dy + 6, T - 6, T - 6);
    // entrance mat
    sc.fillStyle = '#7f1d1d';
    rr(sc, dx + 4, (g.rows - 2) * T + 8, T - 8, T - 14, 4); sc.fill();
    // store sign
    const name = st.storeName;
    sc.font = '800 16px system-ui, sans-serif';
    const tw = Math.min(g.worldW - 3 * T, sc.measureText(name).width + 28);
    sc.fillStyle = '#0f172a';
    rr(sc, g.worldW / 2 - tw / 2, 6, tw, T - 16, 8); sc.fill();
    sc.strokeStyle = '#fbbf24'; sc.lineWidth = 2;
    rr(sc, g.worldW / 2 - tw / 2, 6, tw, T - 16, 8); sc.stroke();
    sc.fillStyle = '#fde68a';
    sc.textAlign = 'center'; sc.textBaseline = 'middle';
    sc.fillText(name, g.worldW / 2, 6 + (T - 16) / 2 + 1, tw - 12);
    // queue markers
    sc.strokeStyle = 'rgba(100,116,139,.35)'; sc.lineWidth = 2;
    g.queue.forEach((q) => { sc.strokeRect(q.x * T + 10, q.y * T + 10, T - 20, T - 20); });
    // counter
    const cx = g.counter.x * T, cy = g.counter.y * T;
    sc.fillStyle = '#7c2d12';
    rr(sc, cx + 2, cy + 6, 2 * T - 4, T - 10, 6); sc.fill();
    sc.fillStyle = '#b45309';
    rr(sc, cx + 2, cy + 6, 2 * T - 4, T - 18, 6); sc.fill();
    sc.fillStyle = '#1e293b';
    rr(sc, cx + T * 0.55, cy + 9, 30, 14, 3); sc.fill();
    sc.fillStyle = '#34d399';
    sc.fillRect(cx + T * 0.55 + 4, cy + 12, 22, 6);
    // cashier mat
    sc.fillStyle = 'rgba(30,41,59,.25)';
    rr(sc, g.cashier.x * T + 3, g.cashier.y * T + 3, T - 6, T - 6, 6); sc.fill();
    // backroom crates
    const bx = g.backroom.x * T, by = g.backroom.y * T;
    sc.fillStyle = '#a16207';
    rr(sc, bx + 6, by + 10, 28, 24, 4); sc.fill();
    sc.strokeStyle = '#713f12'; sc.lineWidth = 2;
    sc.beginPath(); sc.moveTo(bx + 6, by + 22); sc.lineTo(bx + 34, by + 22); sc.moveTo(bx + 20, by + 10); sc.lineTo(bx + 20, by + 34); sc.stroke();
    // plant
    sc.font = '24px sans-serif';
    sc.fillStyle = '#000';
    sc.fillText('🪴', (g.cols - 2) * T + T / 2, T + T / 2);
  }

  function ensureStatic() {
    const g = Layout.g, st = TM.state;
    const key = [Layout.version, st.theme.floor, st.theme.wall, st.storeName, view.k.toFixed(3)].join('|');
    if (key === staticKey && staticCanvas) return;
    staticKey = key;
    if (!staticCanvas) staticCanvas = document.createElement('canvas');
    staticCanvas.width = Math.max(1, Math.ceil(g.worldW * view.k));
    staticCanvas.height = Math.max(1, Math.ceil(g.worldH * view.k));
    drawStatic(staticCanvas.getContext('2d'), view.k);
  }

  function drawPerson(x, y, skin, shirt, hair, bag) {
    const px = x * T, py = y * T;
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    ctx.beginPath(); ctx.ellipse(px, py + 9, 8, 3.5, 0, 0, 6.2832); ctx.fill();
    ctx.fillStyle = shirt;
    rr(ctx, px - 7, py - 6, 14, 15, 5); ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath(); ctx.arc(px, py - 11, 6.5, 0, 6.2832); ctx.fill();
    ctx.fillStyle = hair;
    ctx.beginPath(); ctx.arc(px, py - 12.5, 6.6, Math.PI, 0); ctx.fill();
    if (bag) { ctx.fillStyle = '#fbbf24'; rr(ctx, px + 5, py - 1, 7, 8, 2); ctx.fill(); }
  }

  function render(time) {
    if (!ctx) return;
    const st = TM.state, g = Layout.g;
    if (!st || !g) return;
    if (TM.Render3D) {
      if (!cashierEnt) cashierEnt = { x: 0, y: 0, state: 'idle' };
      cashierEnt.x = g.cashier.x + 0.5; cashierEnt.y = g.cashier.y + 0.5;
      TM.Render3D.draw(ctx, time, { st, g, pool, stockers, floaters, cashier: cashierEnt, ready: counterReady() });
      return;
    }
    ensureStatic();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(staticCanvas, view.ox, view.oy);
    ctx.setTransform(view.k, 0, 0, view.k, view.ox, view.oy);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    // phone cases
    const listedBySlot = {};
    for (let i = 0; i < st.phones.bench.length; i++) {
      const p = st.phones.bench[i];
      if (p.listed) listedBySlot[p.slot] = p;
    }
    for (let i = 0; i < g.cases.length; i++) {
      const cs = g.cases[i];
      const x = cs.x * T, y = cs.y * T;
      ctx.fillStyle = 'rgba(186,230,253,.5)';
      rr(ctx, x + 3, y + 4, T - 6, T - 7, 6); ctx.fill();
      ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2;
      rr(ctx, x + 3, y + 4, T - 6, T - 7, 6); ctx.stroke();
      const p = listedBySlot[i];
      if (p) {
        ctx.fillStyle = p.reserved ? '#475569' : p.color;
        rr(ctx, x + T / 2 - 6, y + 8, 12, 20, 3); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.7)';
        ctx.fillRect(x + T / 2 - 4, y + 11, 8, 12);
        ctx.fillStyle = '#0f172a';
        ctx.font = '700 9px system-ui, sans-serif';
        ctx.fillText('$' + p.price, x + T / 2, y + T - 6);
      }
    }

    // shelves
    for (let i = 0; i < st.shelves.length; i++) {
      const s = st.shelves[i];
      const slot = g.slotMap[s.slot];
      if (!slot) continue;
      const cat = Config.CATEGORIES[s.cat];
      const x = slot.x * T, y = slot.y * T;
      ctx.fillStyle = '#475569';
      rr(ctx, x + 2, y + 4, 2 * T - 4, T - 6, 6); ctx.fill();
      ctx.fillStyle = cat.color;
      rr(ctx, x + 4, y + 6, 2 * T - 8, T - 15, 5); ctx.fill();
      const r = s.stock / cat.capacity;
      ctx.fillStyle = 'rgba(15,23,42,.6)';
      ctx.fillRect(x + 8, y + T - 11, 2 * T - 16, 4);
      ctx.fillStyle = r < 0.25 ? '#ef4444' : '#ffffff';
      ctx.fillRect(x + 8, y + T - 11, (2 * T - 16) * r, 4);
      ctx.font = '15px sans-serif';
      ctx.fillStyle = '#000';
      ctx.fillText(cat.icon, x + T, y + T * 0.45);
    }

    // attention ring on the counter
    if (counterReady() && st.staff.cashier === 0) {
      const a = 0.35 + 0.35 * Math.sin(time / 160);
      ctx.strokeStyle = 'rgba(34,197,94,' + a.toFixed(2) + ')';
      ctx.lineWidth = 3;
      rr(ctx, g.counter.x * T, g.counter.y * T + 2, 2 * T, T - 4, 8); ctx.stroke();
    }

    // people (depth sorted)
    drawList.length = 0;
    drawList.push({ y: g.cashier.y + 0.5, kind: 0 });
    for (let i = 0; i < stockers.length; i++) drawList.push({ y: stockers[i].y, kind: 1, e: stockers[i] });
    for (let i = 0; i < pool.length; i++) if (pool[i].active) drawList.push({ y: pool[i].y, kind: 2, e: pool[i] });
    for (let i = 1; i < drawList.length; i++) {
      const it = drawList[i];
      let j = i - 1;
      while (j >= 0 && drawList[j].y > it.y) { drawList[j + 1] = drawList[j]; j--; }
      drawList[j + 1] = it;
    }
    for (let i = 0; i < drawList.length; i++) {
      const it = drawList[i];
      if (it.kind === 0) {
        const auto = st.staff.cashier > 0;
        drawPerson(g.cashier.x + 0.5, g.cashier.y + 0.5, '#f5d0b0', auto ? '#16a34a' : '#0ea5e9', '#1f2937', false);
        ctx.font = '700 8px system-ui, sans-serif';
        ctx.fillStyle = '#0f172a';
        ctx.fillText(auto ? 'CASHIER' : 'YOU', (g.cashier.x + 0.5) * T, (g.cashier.y + 0.5) * T + 18);
      } else if (it.kind === 1) {
        drawPerson(it.e.x, it.e.y, '#e0ac82', '#f59e0b', '#111827', it.e.carry > 0);
      } else {
        const c = it.e;
        drawPerson(c.x, c.y, c.skin, c.shirt, c.hair, c.cart.items.length > 0 || !!c.cart.phone);
        if (c.state === 'queueing' || c.state === 'atCounter') {
          const f = c.patience / c.maxPatience;
          if (f < 0.55) {
            ctx.font = '13px sans-serif';
            ctx.fillText(f < 0.28 ? '😠' : '😐', c.x * T, c.y * T - 26);
          }
          if (c.state === 'atCounter') {
            const w = 26, bx = c.x * T - w / 2, by = c.y * T - 24;
            ctx.fillStyle = 'rgba(15,23,42,.8)';
            ctx.fillRect(bx, by, w, 4);
            ctx.fillStyle = '#22c55e';
            ctx.fillRect(bx, by, w * U.clamp(1 - c.proc / c.procMax, 0, 1), 4);
          }
        }
      }
    }

    // floaters
    ctx.font = '800 13px system-ui, sans-serif';
    for (let i = 0; i < floaters.length; i++) {
      const f = floaters[i];
      if (!f.active) continue;
      ctx.globalAlpha = U.clamp(1.4 - f.t, 0, 1);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(f.text, f.x * T + 1, f.y * T + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x * T, f.y * T);
    }
    ctx.globalAlpha = 1;

    // time-of-day tint
    const t = st.clock;
    if (t > 0.7) {
      ctx.fillStyle = 'rgba(255,120,30,' + (((t - 0.7) / 0.3) * 0.18).toFixed(3) + ')';
      ctx.fillRect(0, 0, g.worldW, g.worldH);
    } else if (t < 0.08) {
      ctx.fillStyle = 'rgba(80,120,255,' + ((0.08 - t) * 1.2).toFixed(3) + ')';
      ctx.fillRect(0, 0, g.worldW, g.worldH);
    }
  }

  function resize() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    const cw = parent.clientWidth, ch = parent.clientHeight;
    dpr = Math.min(global.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(cw * dpr));
    canvas.height = Math.max(1, Math.floor(ch * dpr));
    if (TM.Render3D) TM.Render3D.resize(canvas.width, canvas.height, dpr);
    const g = Layout.g;
    if (!g) return;
    const k = Math.min(canvas.width / g.worldW, canvas.height / g.worldH);
    view.k = k;
    view.ox = Math.floor((canvas.width - g.worldW * k) / 2);
    view.oy = Math.floor((canvas.height - g.worldH * k) / 2);
    staticKey = '';
  }

  function onPointer(e) {
    const g = Layout.g, st = TM.state;
    if (!g || !st || paused.size) return;
    const rect = canvas.getBoundingClientRect();
    const px = (e.clientX - rect.left) * dpr, py = (e.clientY - rect.top) * dpr;
    if (TM.Render3D) {
      const h = TM.Render3D.pick(px, py);
      if (!h) return;
      if (h.type === 'counter') { if (!manualCheckout()) emit('toast', { msg: 'No customer at the counter yet.', type: 'warn' }); }
      else if (h.type === 'shelf') emit('shelfTap', h.id);
      else if (h.type === 'case') emit('caseTap', h.id);
      return;
    }
    const tx = (px - view.ox) / view.k / T, ty = (py - view.oy) / view.k / T;
    // counter / cashier area
    if (tx >= g.counter.x - 1 && tx <= g.cashier.x + 1 && ty >= g.counter.y - 0.6 && ty <= g.counter.y + 1.6) {
      if (!manualCheckout()) emit('toast', { msg: 'No customer at the counter yet.', type: 'warn' });
      return;
    }
    for (let i = 0; i < st.shelves.length; i++) {
      const sl = g.slotMap[st.shelves[i].slot];
      if (sl && tx >= sl.x && tx <= sl.x + 2 && ty >= sl.y && ty <= sl.y + 1) { emit('shelfTap', st.shelves[i].id); return; }
    }
    for (let i = 0; i < g.cases.length; i++) {
      const cs = g.cases[i];
      if (tx >= cs.x && tx <= cs.x + 1 && ty >= 1 && ty <= 2) { emit('caseTap', i); return; }
    }
  }

  /* ------------------------------- Main loop ----------------------------- */
  const paused = new Set();
  let rafId = 0, lastTs = 0, running = false, hudCounter = 0, fpsFrames = 0, fpsLast = 0;
  const MIN_FRAME_MS = 15.2; // ~60 FPS cap (tolerant of vsync jitter)

  function frame(ts) {
    rafId = global.requestAnimationFrame(frame);
    if (!lastTs) { lastTs = ts; fpsLast = ts; return; }
    const elapsed = ts - lastTs;
    if (elapsed < MIN_FRAME_MS) return;
    lastTs = ts;
    let dt = Math.min(elapsed / 1000, 0.1);
    if (!paused.size) {
      dt *= TM.state.speed;
      while (dt > 0) {
        const step = Math.min(dt, 1 / 30);
        simulate(step);
        dt -= step;
      }
    }
    render(ts);
    fpsFrames++;
    if (ts - fpsLast >= 500) {
      const el = document.getElementById('fps');
      if (el) el.textContent = Math.round((fpsFrames * 1000) / (ts - fpsLast)) + ' FPS';
      fpsFrames = 0; fpsLast = ts;
    }
    if (++hudCounter >= 5) { hudCounter = 0; if (TM.UI && TM.UI.hudTick) TM.UI.hudTick(); }
  }

  /* -------------------------------- Engine API --------------------------- */
  TM.Engine = {
    init(canvasEl) {
      canvas = canvasEl;
      ctx = canvas.getContext('2d');
      canvas.addEventListener('pointerdown', onPointer);
      global.addEventListener('resize', resize);
      if (global.ResizeObserver) new global.ResizeObserver(resize).observe(canvas.parentElement);
      resize();
    },
    setState(raw) {
      TM.state = hydrate(raw);
      Layout.build();
      resetCustomers();
      syncStockers();
      TM.MobileShop.ensureMarket();
      spawnTimer = 2;
      resize();
      emit('stateReplaced', TM.state);
      if (TM.state.phase === 'report') {
        const rep = TM.state.lastReport;
        global.setTimeout(() => emit('dayEnd', rep), 0);
      }
    },
    start() {
      if (running) return;
      running = true; lastTs = 0;
      rafId = global.requestAnimationFrame(frame);
    },
    stop() { running = false; global.cancelAnimationFrame(rafId); },
    setPaused(reason, on) {
      if (on) paused.add(reason); else paused.delete(reason);
    },
    isPaused() { return paused.size > 0; },
    isRunning() { return running && paused.size === 0 && TM.state && TM.state.phase !== 'report'; },
    cycleSpeed() { const st = TM.state; st.speed = st.speed >= 3 ? 1 : st.speed + 1; return st.speed; },
    simulate,
    render,
    resize,
    manualCheckout,
    counterReady,
    addXP,
    addHappiness,
    floatText,
    startNextDay,
    resetCustomers,
    syncStockers,
    rebuildLayout() { Layout.build(); resetCustomers(); syncStockers(); resize(); },
    relayout() { Layout.build(); },
    activeCustomers() { return activeCount; },
    queueLength() { return queue.length; },
    clockLabel(clock) {
      const mins = Math.floor(U.clamp(clock, 0, 1) * Config.HOURS * 60);
      let h = Config.OPEN_HOUR + Math.floor(mins / 60);
      const m = mins % 60;
      const ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
    },
    // Snapshot with customers' carts restored so nothing is lost on save.
    serialize() {
      const st = TM.state;
      const snap = JSON.parse(JSON.stringify(st));
      const shelfById = {};
      snap.shelves.forEach((s) => { shelfById[s.id] = s; });
      const returnTo = (it) => {
        const s = shelfById[it.shelf];
        const cap = Config.CATEGORIES[it.cat].capacity;
        if (s && s.stock + it.qty <= cap) s.stock += it.qty; else snap.warehouse[it.cat] += it.qty;
      };
      for (let i = 0; i < pool.length; i++) {
        const c = pool[i];
        if (!c.active) continue;
        c.cart.items.forEach(returnTo);
      }
      for (let i = 0; i < stockers.length; i++) {
        if (stockers[i].carry > 0 && stockers[i].cat) snap.warehouse[stockers[i].cat] += stockers[i].carry;
      }
      snap.phones.bench.forEach((p) => { p.reserved = false; });
      snap.savedAt = Date.now();
      return snap;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
