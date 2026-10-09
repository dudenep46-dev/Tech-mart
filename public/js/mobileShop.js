/* ==========================================================================
   TechMart Empire: Ultra Simulator - mobileShop.js
   Phone market, diagnostics, repair mini-games, pricing slider logic and
   phone transactions (customer sales, trader quick-sell, scrapping).
   ========================================================================== */
(function (global) {
  'use strict';
  const TM = global.TM;
  const U = TM.Util;
  const Config = TM.Config;
  const MobileShop = (TM.MobileShop = {});

  const st = () => TM.state;

  /* ------------------------------ Market --------------------------------- */
  function makeListing(level) {
    const models = Config.MODELS.map((m, i) => ({ m, i })).filter((o) => o.m.minLevel <= level);
    let total = 0;
    const weights = models.map((o, idx) => { const w = 1 + idx; total += w; return w; });
    let r = Math.random() * total;
    let chosen = models[models.length - 1];
    for (let i = 0; i < models.length; i++) {
      r -= weights[i];
      if (r <= 0) { chosen = models[i]; break; }
    }
    const m = chosen.m, tier = chosen.i;
    const value = Math.round(m.value * U.rand(0.92, 1.1));
    const nFaults = U.pick([1, 1, 2, 2, 3, 4]);
    const faults = U.shuffle(Object.keys(Config.PARTS)).slice(0, nFaults);
    const sum = faults.reduce((a, k) => a + Config.PARTS[k].rate, 0);
    const ask = Math.max(10, Math.round(value * (1 - sum) * U.rand(0.55, 0.8)));
    return {
      id: U.uid(), brand: m.brand, name: m.name, tier, color: Config.TIER_COLORS[tier],
      value, ask, faults, fixed: [], diag: false, bonus: 0, invested: 0,
      listed: false, slot: -1, price: Math.round(value * 1.1), reserved: false
    };
  }

  MobileShop.generateMarket = function () {
    const s = st();
    const n = 4 + s.expansion;
    const list = [];
    for (let i = 0; i < n; i++) list.push(makeListing(s.level));
    list.sort((a, b) => a.ask - b.ask);
    return list;
  };

  MobileShop.ensureMarket = function () {
    const s = st();
    if (!s.phones.market.length) s.phones.market = MobileShop.generateMarket();
  };

  MobileShop.refreshMarket = function (pay) {
    const s = st();
    if (pay) {
      if (s.cash < Config.MARKET_REFRESH_COST) return { ok: false, msg: 'Not enough cash to refresh.' };
      s.cash -= Config.MARKET_REFRESH_COST;
      s.today.purchases += Config.MARKET_REFRESH_COST;
    }
    s.phones.market = MobileShop.generateMarket();
    return { ok: true, msg: 'New phones arrived at the market.' };
  };

  MobileShop.find = function (id) {
    const s = st();
    for (let i = 0; i < s.phones.bench.length; i++) if (s.phones.bench[i].id === id) return s.phones.bench[i];
    return null;
  };
  MobileShop.findListing = function (id) {
    const m = st().phones.market;
    for (let i = 0; i < m.length; i++) if (m[i].id === id) return m[i];
    return null;
  };

  MobileShop.scan = function (id) {
    const s = st();
    const p = MobileShop.findListing(id);
    if (!p) return { ok: false, msg: 'Listing not found.' };
    if (p.diag) return { ok: false, msg: 'Already scanned.' };
    if (s.cash < Config.SCAN_COST) return { ok: false, msg: 'Not enough cash for a scan.' };
    s.cash -= Config.SCAN_COST;
    s.today.purchases += Config.SCAN_COST;
    p.diag = true;
    p.invested += Config.SCAN_COST;
    return { ok: true, msg: 'Scan complete: all faults revealed.' };
  };

  MobileShop.buy = function (id) {
    const s = st();
    const p = MobileShop.findListing(id);
    if (!p) return { ok: false, msg: 'Listing not found.' };
    if (s.cash < p.ask) return { ok: false, msg: 'Not enough cash.' };
    s.cash -= p.ask;
    s.today.purchases += p.ask;
    p.invested += p.ask;
    s.phones.market = s.phones.market.filter((x) => x !== p);
    s.phones.bench.push(p);
    return { ok: true, msg: 'Bought ' + p.brand + ' ' + p.name + ' for ' + U.money(p.ask) + '.' };
  };

  /* ---------------------------- Workbench -------------------------------- */
  MobileShop.partCost = (phone, part) => Math.max(5, Math.round(phone.value * Config.PARTS[part].rate));
  MobileShop.repairTotal = (phone) => phone.faults.reduce((a, f) => a + MobileShop.partCost(phone, f), 0);
  MobileShop.isReady = (phone) => phone.diag && phone.fixed.length === phone.faults.length;
  MobileShop.fairValue = (phone) => phone.value * (1 + phone.bonus);
  MobileShop.buyFactor = () => U.rand(0.92, 1.18) + (st().happiness - 50) / 600;

  MobileShop.diagnose = function (id) {
    const p = MobileShop.find(id);
    if (!p) return { ok: false, msg: 'Phone not found.' };
    p.diag = true;
    return { ok: true, msg: 'Diagnostics done: ' + p.faults.length + ' fault' + (p.faults.length > 1 ? 's' : '') + ' found.' };
  };

  // Estimated chance (0-100) that a visiting customer accepts this price.
  MobileShop.demand = function (phone, price) {
    const ratio = price / MobileShop.fairValue(phone);
    return Math.round(U.clamp((1.18 - ratio) / 0.26, 0, 1) * 100);
  };

  MobileShop.priceRange = function (phone) {
    const v = MobileShop.fairValue(phone);
    return { min: Math.max(1, Math.round(v * 0.5)), max: Math.round(v * 2) };
  };

  MobileShop.setPrice = function (id, price) {
    const p = MobileShop.find(id);
    if (!p) return;
    const r = MobileShop.priceRange(p);
    p.price = U.clamp(Math.round(price), r.min, r.max);
  };

  MobileShop.freeSlot = function () {
    const s = st();
    const total = Config.PHONE_SLOTS[s.expansion];
    for (let i = 0; i < total; i++) {
      if (!s.phones.bench.some((p) => p.listed && p.slot === i)) return i;
    }
    return -1;
  };
  MobileShop.slotsUsed = () => st().phones.bench.filter((p) => p.listed).length;
  MobileShop.slotsTotal = () => Config.PHONE_SLOTS[st().expansion];

  MobileShop.list = function (id) {
    const p = MobileShop.find(id);
    if (!p) return { ok: false, msg: 'Phone not found.' };
    if (!MobileShop.isReady(p)) return { ok: false, msg: 'Finish the repairs first.' };
    const slot = MobileShop.freeSlot();
    if (slot < 0) return { ok: false, msg: 'All display cases are full. Expand the shop or unlist a phone.' };
    p.listed = true; p.slot = slot;
    MobileShop.setPrice(id, p.price);
    return { ok: true, msg: p.brand + ' ' + p.name + ' is on display for ' + U.money(p.price) + '.' };
  };

  MobileShop.unlist = function (id) {
    const p = MobileShop.find(id);
    if (!p) return { ok: false, msg: 'Phone not found.' };
    if (p.reserved) return { ok: false, msg: 'A customer is holding this phone right now.' };
    p.listed = false; p.slot = -1;
    return { ok: true, msg: 'Phone moved back to the workbench.' };
  };

  MobileShop.traderOffer = (phone) => Math.round(MobileShop.fairValue(phone) * Config.TRADER_RATE);

  MobileShop.quickSell = function (id) {
    const s = st();
    const p = MobileShop.find(id);
    if (!p) return { ok: false, msg: 'Phone not found.' };
    if (!MobileShop.isReady(p)) return { ok: false, msg: 'The trader only buys fully repaired phones.' };
    if (p.reserved) return { ok: false, msg: 'A customer is holding this phone.' };
    const price = MobileShop.traderOffer(p);
    s.cash += price;
    s.today.rev.phones += price;
    s.today.cogs += p.invested;
    s.totals.revenue += price;
    s.phones.sold++;
    s.phones.bench = s.phones.bench.filter((x) => x !== p);
    TM.Engine.addXP(1 + Math.max(0, price - p.invested) * 0.2);
    return { ok: true, msg: 'Sold to the trader for ' + U.money(price) + '.' };
  };

  MobileShop.scrap = function (id) {
    const s = st();
    const p = MobileShop.find(id);
    if (!p) return { ok: false, msg: 'Phone not found.' };
    if (p.reserved) return { ok: false, msg: 'A customer is holding this phone.' };
    const price = Math.round(p.ask * 0.4);
    s.cash += price;
    s.phones.bench = s.phones.bench.filter((x) => x !== p);
    return { ok: true, msg: 'Scrapped for parts: ' + U.money(price) + '.' };
  };

  /* --------------------------- Repair mini-games -------------------------- */
  const Games = (MobileShop.Games = {});

  function loop(fn) {
    let id = 0, last = performance.now(), dead = false;
    function f(t) {
      if (dead) return;
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      fn(dt);
      if (!dead) id = global.requestAnimationFrame(f);
    }
    id = global.requestAnimationFrame(f);
    return function stop() { dead = true; global.cancelAnimationFrame(id); };
  }

  // Screen: tap the cracks in order before time runs out.
  Games.crack = function (el, diff, done) {
    const n = 3 + diff;
    const total = 9;
    let time = total, next = 1, mistakes = 0, ended = false;
    el.innerHTML = '<p class="mg-hint">Tap the cracks in order: 1 &rarr; ' + n + '</p><div class="mg-timer"><i></i></div><div class="mg-screen"></div>';
    const bar = el.querySelector('.mg-timer i');
    const area = el.querySelector('.mg-screen');
    const pts = [];
    let guard = 0;
    while (pts.length < n && guard++ < 300) {
      const x = U.rand(12, 88), y = U.rand(14, 86);
      if (pts.every((p) => Math.hypot(p.x - x, p.y - y) > 24)) pts.push({ x, y });
    }
    while (pts.length < n) pts.push({ x: 12 + pts.length * 14, y: 50 });
    pts.forEach((p, i) => {
      const b = document.createElement('button');
      b.className = 'crack';
      b.textContent = String(i + 1);
      b.style.left = p.x + '%';
      b.style.top = p.y + '%';
      b.dataset.i = String(i + 1);
      area.appendChild(b);
    });
    function finish(ok, perfect) {
      if (ended) return;
      ended = true; stop(); done(ok, perfect);
    }
    area.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.crack');
      if (!b || ended) return;
      e.preventDefault();
      if (b.classList.contains('done')) return;
      if (+b.dataset.i === next) {
        b.classList.add('done');
        next++;
        if (next > n) finish(true, mistakes === 0 && time / total > 0.35);
      } else {
        mistakes++; time -= 0.8;
        b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      }
    });
    const stop = loop((dt) => {
      time -= dt;
      bar.style.width = Math.max(0, (time / total) * 100) + '%';
      if (time <= 0) finish(false, false);
    });
    return { abort() { finish(false, false); } };
  };

  // Battery: stop the needle inside the green zone 3 times (3 misses = fail).
  Games.timing = function (el, diff, done) {
    let hits = 0, misses = 0, pos = 0, dir = 1, ended = false;
    const speed = 55 + diff * 18;
    const width = Math.max(12, 24 - diff * 4);
    let center = U.rand(30, 70);
    el.innerHTML = '<p class="mg-hint">Stop the needle inside the green zone. 3 hits charge the cell.</p>' +
      '<div class="mg-bar"><div class="mg-zone"></div><div class="mg-needle"></div></div>' +
      '<div class="mg-score"></div><button class="btn btn-primary btn-lg w-full mg-action">LOCK</button>';
    const zone = el.querySelector('.mg-zone');
    const needle = el.querySelector('.mg-needle');
    const score = el.querySelector('.mg-score');
    const btn = el.querySelector('.mg-action');
    function layout() {
      zone.style.left = (center - width / 2) + '%';
      zone.style.width = width + '%';
      score.textContent = 'Hits ' + hits + '/3  ·  Misses ' + misses + '/3';
    }
    layout();
    function finish(ok, perfect) {
      if (ended) return;
      ended = true; stop(); done(ok, perfect);
    }
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (ended) return;
      if (Math.abs(pos - center) <= width / 2) hits++; else misses++;
      center = U.rand(25, 75);
      layout();
      if (hits >= 3) finish(true, misses === 0);
      else if (misses >= 3) finish(false, false);
    });
    const stop = loop((dt) => {
      pos += dir * speed * dt;
      if (pos >= 100) { pos = 100; dir = -1; }
      if (pos <= 0) { pos = 0; dir = 1; }
      needle.style.left = pos + '%';
    });
    return { abort() { finish(false, false); } };
  };

  // Mainboard: repeat the circuit pattern (2 lives).
  Games.sequence = function (el, diff, done) {
    const len = 4 + diff;
    const seq = [];
    for (let i = 0; i < len; i++) seq.push(U.randInt(0, 3));
    let idx = 0, lives = 2, accepting = false, ended = false;
    const timers = [];
    el.innerHTML = '<p class="mg-hint">Watch the circuit pattern...</p>' +
      '<div class="mg-pads">' + [0, 1, 2, 3].map((i) => '<button class="pad pad-' + i + '" data-i="' + i + '"></button>').join('') + '</div>' +
      '<div class="mg-score"></div>';
    const hint = el.querySelector('.mg-hint');
    const score = el.querySelector('.mg-score');
    const pads = el.querySelectorAll('.pad');
    function setScore() { score.textContent = 'Lives: ' + '❤️'.repeat(lives) + '   Step ' + Math.min(idx + 1, len) + '/' + len; }
    function flash(i, ms) {
      pads[i].classList.add('lit');
      timers.push(setTimeout(() => pads[i].classList.remove('lit'), ms));
    }
    function play() {
      accepting = false; idx = 0; setScore();
      hint.textContent = 'Watch the circuit pattern...';
      seq.forEach((s, k) => timers.push(setTimeout(() => flash(s, 380), 500 + k * 620)));
      timers.push(setTimeout(() => { if (ended) return; accepting = true; hint.textContent = 'Your turn: repeat it!'; }, 500 + seq.length * 620));
    }
    function finish(ok, perfect) {
      if (ended) return;
      ended = true;
      timers.forEach(clearTimeout);
      done(ok, perfect);
    }
    el.querySelector('.mg-pads').addEventListener('pointerdown', (e) => {
      const b = e.target.closest('.pad');
      if (!b || !accepting || ended) return;
      e.preventDefault();
      const i = +b.dataset.i;
      flash(i, 160);
      if (i === seq[idx]) {
        idx++;
        setScore();
        if (idx >= len) finish(true, lives === 2);
      } else {
        lives--;
        if (lives <= 0) { finish(false, false); return; }
        accepting = false;
        hint.textContent = 'Wrong pad! Watch again...';
        timers.push(setTimeout(play, 800));
      }
    });
    play();
    return { abort() { finish(false, false); } };
  };

  // Camera: drag the slider until the preview is sharp, then capture (3 strikes).
  Games.focus = function (el, diff, done) {
    const target = U.randInt(15, 85);
    const tol = Math.max(2.5, 5 - diff * 0.8);
    let strikes = 0, ended = false, start;
    do { start = U.randInt(0, 100); } while (Math.abs(start - target) < 25);
    el.innerHTML = '<p class="mg-hint">Slide until the image is sharp, then capture.</p>' +
      '<div class="mg-preview"><span class="mg-subject">🏞️</span></div>' +
      '<input class="range mg-focus" type="range" min="0" max="100" value="' + start + '">' +
      '<div class="mg-score">Strikes 0/3</div>' +
      '<button class="btn btn-primary btn-lg w-full mg-action">📷 CAPTURE</button>';
    const input = el.querySelector('.mg-focus');
    const subject = el.querySelector('.mg-subject');
    const score = el.querySelector('.mg-score');
    function blur() {
      const d = Math.abs(+input.value - target);
      subject.style.filter = 'blur(' + (Math.max(0, d - tol) * 0.28).toFixed(1) + 'px)';
    }
    blur();
    input.addEventListener('input', blur);
    function finish(ok, perfect) {
      if (ended) return;
      ended = true; done(ok, perfect);
    }
    el.querySelector('.mg-action').addEventListener('click', () => {
      if (ended) return;
      if (Math.abs(+input.value - target) <= tol) finish(true, strikes === 0);
      else {
        strikes++;
        score.textContent = 'Strikes ' + strikes + '/3 (still blurry!)';
        if (strikes >= 3) finish(false, false);
      }
    });
    return { abort() { finish(false, false); } };
  };

  // Speaker: tap fast to clear the dust before time runs out.
  Games.clean = function (el, diff, done) {
    let meter = 18, time = 9, ended = false;
    const total = 9;
    const drain = 11 + diff * 3, gain = 7.5;
    el.innerHTML = '<p class="mg-hint">Tap fast to clear the dust from the speaker grille!</p>' +
      '<div class="mg-timer"><i></i></div><div class="mg-dust">🌫️</div>' +
      '<div class="mg-meter"><i></i></div>' +
      '<button class="btn btn-primary btn-lg w-full mg-action">🧹 TAP TO CLEAN</button>';
    const tbar = el.querySelector('.mg-timer i');
    const mbar = el.querySelector('.mg-meter i');
    const dust = el.querySelector('.mg-dust');
    function finish(ok, perfect) {
      if (ended) return;
      ended = true; stop(); done(ok, perfect);
    }
    el.querySelector('.mg-action').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (ended) return;
      meter += gain;
      if (meter >= 100) finish(true, time / total > 0.4);
    });
    const stop = loop((dt) => {
      meter -= drain * dt;
      time -= dt;
      tbar.style.width = Math.max(0, (time / total) * 100) + '%';
      mbar.style.width = U.clamp(meter, 0, 100) + '%';
      dust.style.opacity = String(U.clamp(1 - meter / 100, 0.1, 1));
      if (meter <= 0 || time <= 0) finish(false, false);
    });
    return { abort() { finish(false, false); } };
  };

  function finishRepair(phone, part, ok, perfect) {
    const def = Config.PARTS[part];
    if (ok) {
      if (phone.fixed.indexOf(part) < 0) phone.fixed.push(part);
      if (perfect) phone.bonus = Math.min(0.08, phone.bonus + 0.02);
      TM.Engine.addXP(3);
      return { ok: true, perfect: !!perfect, msg: def.name + ' repaired' + (perfect ? ' perfectly! (+2% value)' : '.') };
    }
    return { ok: false, perfect: false, msg: 'Repair failed. The part is ruined, try again with a new one.' };
  }

  // Deducts the part cost, then runs the mini-game inside stageEl.
  MobileShop.startRepair = function (phone, part, stageEl, cb) {
    const s = st();
    if (!phone.diag) return { ok: false, msg: 'Run diagnostics first.' };
    if (phone.faults.indexOf(part) < 0 || phone.fixed.indexOf(part) >= 0) return { ok: false, msg: 'Nothing to repair there.' };
    if (phone.listed) return { ok: false, msg: 'Unlist the phone first.' };
    const cost = MobileShop.partCost(phone, part);
    if (s.cash < cost) return { ok: false, msg: 'Not enough cash for the replacement part.' };
    s.cash -= cost;
    phone.invested += cost;
    s.today.purchases += cost;
    const def = Config.PARTS[part];
    const diff = Math.min(3, Math.floor(phone.tier / 2));
    const handle = Games[def.game](stageEl, diff, (ok, perfect) => { cb(finishRepair(phone, part, ok, perfect)); });
    return { ok: true, cost, handle, def };
  };
})(typeof window !== 'undefined' ? window : globalThis);
