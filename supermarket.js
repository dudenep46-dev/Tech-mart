/* ==========================================================================
   TechMart Empire: Ultra Simulator - supermarket.js
   Shelf placement, stock ordering/delivery, restocking, employee automation
   and store expansion upgrades.
   ========================================================================== */
(function (global) {
  'use strict';
  const TM = global.TM;
  const U = TM.Util;
  const Config = TM.Config;
  const SM = (TM.Supermarket = {});
  const busy = new Set(); // shelves currently being served by a stocker (not saved)
  const st = () => TM.state;
  const emit = (n, d) => TM.Events.emit(n, d);

  /* ------------------------------ Pricing -------------------------------- */
  SM.refPrice = (cat) => Config.CATEGORIES[cat].wholesale * Config.CATEGORIES[cat].refMult;
  SM.unitPrice = (shelf) => U.round2(Config.CATEGORIES[shelf.cat].wholesale * (1 + shelf.markup / 100));
  // Chance (0-100) a customer accepts this shelf's price (tolerance is 0.9-1.3 of the fair price).
  SM.acceptChance = function (shelf) {
    const ratio = SM.unitPrice(shelf) / SM.refPrice(shelf.cat);
    return Math.round(U.clamp((1.3 - ratio) / 0.4, 0, 1) * 100);
  };

  /* ------------------------------- Shelves ------------------------------- */
  SM.findShelf = function (id) {
    const a = st().shelves;
    for (let i = 0; i < a.length; i++) if (a[i].id === id) return a[i];
    return null;
  };

  SM.freeSlots = function () {
    const s = st();
    return TM.Layout.g.shelfSlots.filter((sl) => !s.shelves.some((sh) => sh.slot === sl.key));
  };

  SM.buyShelf = function (cat) {
    const s = st();
    const def = Config.CATEGORIES[cat];
    if (!def) return { ok: false, msg: 'Unknown category.' };
    if (s.level < def.unlock) return { ok: false, msg: def.name + ' unlocks at store level ' + def.unlock + '.' };
    if (s.cash < def.shelfCost) return { ok: false, msg: 'Not enough cash.' };
    const slots = SM.freeSlots();
    if (!slots.length) return { ok: false, msg: 'No free shelf space. Expand the store!' };
    s.cash -= def.shelfCost;
    s.shelves.push({ id: U.uid(), cat, slot: slots[0].key, stock: 0, markup: 35 });
    TM.Engine.rebuildLayout();
    return { ok: true, msg: def.name + ' shelf installed. Order stock to fill it!' };
  };

  SM.removeShelf = function (id) {
    const s = st();
    const sh = SM.findShelf(id);
    if (!sh) return { ok: false, msg: 'Shelf not found.' };
    const def = Config.CATEGORIES[sh.cat];
    s.warehouse[sh.cat] += sh.stock;
    s.cash += Math.round(def.shelfCost * 0.5);
    s.shelves = s.shelves.filter((x) => x !== sh);
    busy.delete(id);
    TM.Engine.rebuildLayout();
    return { ok: true, msg: 'Shelf removed. Stock moved to the warehouse, refund ' + U.money(Math.round(def.shelfCost * 0.5)) + '.' };
  };

  SM.setMarkup = function (id, pct) {
    const sh = SM.findShelf(id);
    if (sh) sh.markup = U.clamp(Math.round(pct), 0, 120);
  };

  SM.shelfTotals = function (cat) {
    let stock = 0, cap = 0;
    st().shelves.forEach((sh) => { if (sh.cat === cat) { stock += sh.stock; cap += Config.CATEGORIES[cat].capacity; } });
    return { stock, cap };
  };

  /* ------------------------------- Ordering ------------------------------ */
  SM.discount = function (cat, qty) {
    const d = Config.CATEGORIES[cat].discount;
    return qty >= d[1] ? 0.1 : qty >= d[0] ? 0.05 : 0;
  };
  SM.orderCost = function (cat, qty) {
    return U.round2(Config.CATEGORIES[cat].wholesale * qty * (1 - SM.discount(cat, qty)));
  };

  SM.order = function (cat, qty) {
    const s = st();
    const def = Config.CATEGORIES[cat];
    qty = Math.floor(qty);
    if (!def || qty <= 0) return { ok: false, msg: 'Pick a quantity first.' };
    if (s.level < def.unlock) return { ok: false, msg: 'Not unlocked yet.' };
    const cost = SM.orderCost(cat, qty);
    if (s.cash < cost) return { ok: false, msg: 'Not enough cash for that order.' };
    s.cash -= cost;
    s.today.purchases += cost;
    s.orders.push({ id: U.uid(), cat, qty, eta: 18 });
    return { ok: true, msg: 'Ordered ' + qty + ' x ' + def.name + ' for ' + U.money(cost) + '. Arrives soon.' };
  };

  SM.update = function (dt) {
    const s = st();
    if (!s.orders.length) return;
    for (let i = s.orders.length - 1; i >= 0; i--) {
      const o = s.orders[i];
      o.eta -= dt;
      if (o.eta <= 0) {
        s.warehouse[o.cat] += o.qty;
        s.orders.splice(i, 1);
        emit('delivery', { cat: o.cat, qty: o.qty });
      }
    }
  };

  SM.deliverAll = function () {
    const s = st();
    s.orders.forEach((o) => { s.warehouse[o.cat] += o.qty; });
    s.orders.length = 0;
  };

  /* ------------------------------- Restocking ---------------------------- */
  SM.restockAll = function () {
    const s = st();
    let moved = 0;
    const order = s.shelves.slice().sort((a, b) => a.stock / Config.CATEGORIES[a.cat].capacity - b.stock / Config.CATEGORIES[b.cat].capacity);
    order.forEach((sh) => {
      if (busy.has(sh.id)) return;
      const need = Config.CATEGORIES[sh.cat].capacity - sh.stock;
      const take = Math.min(need, s.warehouse[sh.cat]);
      if (take > 0) { sh.stock += take; s.warehouse[sh.cat] -= take; moved += take; }
    });
    return { ok: moved > 0, moved, msg: moved > 0 ? 'Moved ' + moved + ' items onto the shelves.' : 'Nothing to restock (warehouse empty or shelves full).' };
  };

  // Used by stocker NPCs: reserves a shelf and withdraws the stock from the warehouse.
  SM.takeRestockJob = function () {
    const s = st();
    let best = null, bestRatio = 2;
    for (let i = 0; i < s.shelves.length; i++) {
      const sh = s.shelves[i];
      if (busy.has(sh.id)) continue;
      const cap = Config.CATEGORIES[sh.cat].capacity;
      const need = cap - sh.stock;
      if (need < Math.max(1, Math.ceil(cap * 0.3))) continue;
      if (s.warehouse[sh.cat] <= 0) continue;
      const ratio = sh.stock / cap;
      if (ratio < bestRatio) { bestRatio = ratio; best = sh; }
    }
    if (!best) return null;
    const cap = Config.CATEGORIES[best.cat].capacity;
    const qty = Math.min(cap - best.stock, s.warehouse[best.cat]);
    s.warehouse[best.cat] -= qty;
    busy.add(best.id);
    return { shelfId: best.id, cat: best.cat, slotKey: best.slot, qty };
  };
  SM.releaseJob = (id) => { busy.delete(id); };
  SM.clearJobs = () => { busy.clear(); };

  /* ------------------------------- Employees ----------------------------- */
  SM.hire = function (role) {
    const s = st();
    const def = Config.STAFF[role];
    if (!def) return { ok: false, msg: 'Unknown role.' };
    if (s.staff[role] >= def.max) return { ok: false, msg: 'You already have the maximum number of ' + def.name.toLowerCase() + 's.' };
    if (s.cash < def.hire) return { ok: false, msg: 'Not enough cash for the signing fee.' };
    s.cash -= def.hire;
    s.staff[role]++;
    TM.Engine.syncStockers();
    return { ok: true, msg: def.name + ' hired! Wage ' + U.money(def.wage) + '/day.' };
  };

  SM.fire = function (role) {
    const s = st();
    const def = Config.STAFF[role];
    if (!def || s.staff[role] <= 0) return { ok: false, msg: 'Nobody to let go.' };
    s.staff[role]--;
    TM.Engine.syncStockers();
    return { ok: true, msg: def.name + ' let go.' };
  };

  SM.dailyWages = function () {
    const s = st();
    return s.staff.cashier * Config.STAFF.cashier.wage + s.staff.stocker * Config.STAFF.stocker.wage;
  };
  SM.dailyRent = () => Config.rent(st().expansion);

  /* ------------------------------- Expansion ----------------------------- */
  SM.nextExpansion = function () {
    const s = st();
    const next = Config.EXPANSION[s.expansion + 1];
    return next ? { index: s.expansion + 1, cost: next.cost, level: next.level, size: Config.SIZES[s.expansion + 1] } : null;
  };

  SM.expand = function () {
    const s = st();
    const next = SM.nextExpansion();
    if (!next) return { ok: false, msg: 'Your store is already at maximum size.' };
    if (s.level < next.level) return { ok: false, msg: 'Requires store level ' + next.level + '.' };
    if (s.cash < next.cost) return { ok: false, msg: 'Not enough cash.' };
    s.cash -= next.cost;
    s.expansion = next.index;
    SM.clearJobs();
    TM.Engine.rebuildLayout();
    // listed phones keep their case index; cases only ever grow
    return { ok: true, msg: 'Store expanded! More cases, shelf slots and customers.' };
  };

  /* ------------------------------- Style --------------------------------- */
  SM.setTheme = function (kind, index) {
    const s = st();
    const list = kind === 'floor' ? Config.FLOORS : Config.WALLS;
    if (index < 0 || index >= list.length) return { ok: false, msg: 'Unknown style.' };
    if (s.theme[kind] === index) return { ok: false, msg: 'Already in use.' };
    if (s.cash < Config.THEME_COST) return { ok: false, msg: 'Not enough cash.' };
    s.cash -= Config.THEME_COST;
    s.theme[kind] = index;
    TM.Engine.relayout();
    return { ok: true, msg: list[index].name + ' ' + kind + ' applied.' };
  };

  SM.rename = function (name) {
    const clean = String(name || '').trim().slice(0, 18);
    if (!clean) return false;
    st().storeName = clean;
    return true;
  };
})(typeof window !== 'undefined' ? window : globalThis);
