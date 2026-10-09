/* ==========================================================================
   TechMart Empire: Ultra Simulator - uiController.js
   HUD updates, modal handling, workbench/shop/order screens, financial
   reports, toasts and all DOM event listeners.
   ========================================================================== */
(function (global) {
  'use strict';
  const TM = global.TM;
  const U = TM.Util;
  const C = TM.Config;
  const E = TM.Events;
  const UI = (TM.UI = {});
  const $ = (id) => document.getElementById(id);
  const st = () => TM.state;
  const MS = () => TM.MobileShop;
  const SM = () => TM.Supermarket;
  const EN = () => TM.Engine;

  const orderQty = { groceries: 20, accessories: 10, appliances: 2 };
  let repairHandle = null;
  let introHandlers = { cont: null, fresh: null };

  const MODALS = {
    workbench: { id: 'modalWorkbench', body: 'wbBody', tabs: 'wbTabs', tab: 'market', pauses: true },
    shop: { id: 'modalShop', body: 'shBody', tabs: 'shTabs', tab: 'shelves', pauses: true },
    orders: { id: 'modalOrders', body: 'orBody', pauses: true },
    report: { id: 'modalReport', body: 'rpBody' },
    intro: { id: 'modalIntro' },
    gameover: { id: 'modalGameover' }
  };

  /* ------------------------------ Toasts --------------------------------- */
  UI.toast = function (msg, type) {
    const box = $('toasts');
    if (!box) return;
    while (box.children.length >= 3) box.removeChild(box.firstChild);
    const d = document.createElement('div');
    d.className = 'toast ' + (type || '');
    d.textContent = msg;
    box.appendChild(d);
    setTimeout(() => d.classList.add('out'), 2300);
    setTimeout(() => { if (d.parentNode) d.parentNode.removeChild(d); }, 2700);
  };
  const say = (res) => { if (res && res.msg) UI.toast(res.msg, res.ok ? 'good' : 'bad'); return res; };

  /* ------------------------------ HUD ------------------------------------ */
  const hudCache = {};
  function setText(id, val) {
    if (hudCache[id] === val) return;
    hudCache[id] = val;
    const el = $(id);
    if (el) el.textContent = val;
  }

  function happyIcon(h) { return h >= 80 ? '😄' : h >= 60 ? '🙂' : h >= 40 ? '😐' : h >= 20 ? '🙁' : '😡'; }

  UI.hudTick = function () {
    const s = st();
    if (!s) return;
    setText('hudCash', U.money(Math.round(s.cash * 100) / 100));
    const cashEl = $('hudCash');
    if (cashEl) cashEl.classList.toggle('neg', s.cash < 0);
    setText('hudDay', String(s.day));
    setText('hudClock', s.phase === 'open' ? EN().clockLabel(s.clock) : s.phase === 'closing' ? 'Closing' : 'Closed');
    const h = Math.round(s.happiness);
    setText('hudHappy', String(h));
    setText('hudHappyIco', happyIcon(h));
    const hb = $('hudHappyBar');
    if (hb) { hb.style.width = h + '%'; hb.style.background = h >= 60 ? '#22c55e' : h >= 35 ? '#f59e0b' : '#ef4444'; }
    setText('hudLevel', String(s.level));
    const lv = s.level, xps = C.LEVEL_XP;
    if (lv >= xps.length) {
      setText('hudXpText', 'MAX LEVEL');
      const xb = $('hudXpBar'); if (xb) xb.style.width = '100%';
    } else {
      const lo = xps[lv - 1], hi = xps[lv];
      setText('hudXpText', Math.floor(s.xp) + ' / ' + hi + ' XP');
      const xb = $('hudXpBar'); if (xb) xb.style.width = U.clamp(((s.xp - lo) / (hi - lo)) * 100, 0, 100) + '%';
    }
    setText('hudStore', s.storeName);
    const badge = $('phaseBadge');
    if (badge) {
      const txt = s.phase === 'closing' ? 'CLOSING TIME' : EN().isPaused() ? 'PAUSED' : '';
      if (hudCache.badge !== txt) { hudCache.badge = txt; badge.textContent = txt; badge.hidden = !txt; }
    }
    const btn = $('btnCheckout');
    if (btn) {
      const ready = EN().counterReady();
      if (hudCache.ready !== ready) { hudCache.ready = ready; btn.classList.toggle('ready', ready && s.staff.cashier === 0); }
    }
    const sp = $('btnSpeed');
    if (sp && hudCache.speed !== s.speed) { hudCache.speed = s.speed; sp.querySelector('small').textContent = s.speed + 'x'; }
  };

  /* ------------------------------ Modals --------------------------------- */
  const open = new Set();

  function syncPause() {
    let p = false;
    open.forEach((n) => { if (MODALS[n].pauses) p = true; });
    EN().setPaused('ui', p);
  }

  function renderModal(name) {
    if (name === 'workbench') renderWorkbench();
    else if (name === 'shop') renderShop();
    else if (name === 'orders') renderOrders();
    else if (name === 'report') renderReport();
  }

  function keepScroll(bodyId, fn) {
    const el = $(bodyId);
    const top = el ? el.scrollTop : 0;
    fn();
    if (el) el.scrollTop = top;
  }

  UI.open = function (name, tab) {
    const m = MODALS[name];
    if (!m) return;
    if (tab) m.tab = tab;
    $(m.id).hidden = false;
    open.add(name);
    renderModal(name);
    syncPause();
  };

  UI.close = function (name) {
    const m = MODALS[name];
    if (!m) return;
    if (name === 'workbench' && repairHandle) { $('repairOverlay').hidden = true; repairHandle.abort(); repairHandle = null; }
    $(m.id).hidden = true;
    open.delete(name);
    syncPause();
    UI.hudTick();
  };

  UI.refresh = function () {
    open.forEach((n) => {
      const m = MODALS[n];
      if (m.body) keepScroll(m.body, () => renderModal(n));
    });
    UI.hudTick();
  };

  function tabsHtml(modal, list, active) {
    return list.map((t) => '<button class="tab' + (t[0] === active ? ' active' : '') + '" data-action="tab" data-modal="' + modal + '" data-tab="' + t[0] + '">' + t[1] + '</button>').join('');
  }

  /* ---------------------------- Workbench -------------------------------- */
  const phoneIco = (p) => '<div class="phone-ico" style="--c:' + p.color + '"></div>';
  const demandPill = (d) => '<span class="pill ' + (d >= 65 ? 'good' : d >= 30 ? 'ok' : 'bad') + '">Demand ' + d + '%</span>';

  function renderWorkbench() {
    const m = MODALS.workbench, s = st();
    const bench = s.phones.bench.filter((p) => !p.listed);
    const listed = s.phones.bench.filter((p) => p.listed);
    $(m.tabs).innerHTML = tabsHtml('workbench', [
      ['market', '🛒 Market'], ['bench', '🔧 Workbench (' + bench.length + ')'], ['listed', '🏷️ On display (' + listed.length + '/' + MS().slotsTotal() + ')']
    ], m.tab);
    let html = '';
    if (m.tab === 'market') html = marketHtml();
    else if (m.tab === 'bench') html = bench.length ? bench.map(benchCard).join('') : '<div class="empty">No phones on the workbench.<br>Buy broken phones in the Market tab.</div>';
    else html = listed.length ? listed.map(listedCard).join('') : '<div class="empty">Nothing on display.<br>Repair a phone and list it for sale.</div>';
    $(m.body).innerHTML = html;
  }

  function marketHtml() {
    const s = st();
    let h = '<div class="row between"><div class="muted">Used phones from private sellers. Prices reflect their hidden faults.</div>' +
      '<button class="btn btn-sm" data-action="refreshMarket">🔄 New batch ' + U.money(C.MARKET_REFRESH_COST) + '</button></div><div class="mt"></div>';
    if (!s.phones.market.length) return h + '<div class="empty">The market is empty. Refresh for new listings.</div>';
    h += s.phones.market.map((p) => {
      const can = s.cash >= p.ask;
      let faults;
      if (p.diag) {
        faults = '<div class="row mt">' + p.faults.map((f) => '<span class="pill">' + C.PARTS[f].icon + ' ' + C.PARTS[f].name + ' · ' + U.money(MS().partCost(p, f)) + '</span>').join('') + '</div>';
        const margin = Math.round(MS().fairValue(p) * 1.1 - p.ask - MS().repairTotal(p));
        faults += '<div class="muted mt">Est. profit if sold near value: <b class="' + (margin >= 0 ? 'profit' : 'loss') + '">' + U.money(margin) + '</b></div>';
      } else {
        faults = '<div class="row mt"><span class="pill dim">Reported: ' + C.PARTS[p.faults[0]].symptom + ' (other faults unknown)</span></div>';
      }
      return '<div class="card"><div class="card-head">' + phoneIco(p) +
        '<div class="grow"><div class="card-title">' + p.brand + ' ' + p.name + '</div><div class="card-sub">Working value ~' + U.money(p.value) + '</div></div>' +
        '<div class="price">' + U.money(p.ask) + '</div></div>' + faults +
        '<div class="row mt">' +
        (p.diag ? '' : '<button class="btn btn-sm" data-action="scanPhone" data-id="' + p.id + '"' + (s.cash >= C.SCAN_COST ? '' : ' disabled') + '>🔍 Scan ' + U.money(C.SCAN_COST) + '</button>') +
        '<button class="btn btn-sm btn-good" data-action="buyPhone" data-id="' + p.id + '"' + (can ? '' : ' disabled') + '>Buy ' + U.money(p.ask) + '</button></div></div>';
    }).join('');
    return h;
  }

  function priceBox(p) {
    const r = MS().priceRange(p);
    return '<div class="mt"><div class="row between"><span class="muted">Resale price</span><b class="price" id="price-' + p.id + '">' + U.money(p.price) + '</b><span id="demand-' + p.id + '">' + demandPill(MS().demand(p, p.price)) + '</span></div>' +
      '<input class="range js-price" type="range" data-id="' + p.id + '" min="' + r.min + '" max="' + r.max + '" step="1" value="' + p.price + '">' +
      '<div class="muted">Fair value ' + U.money(Math.round(MS().fairValue(p))) + ' (quality bonus +' + Math.round(p.bonus * 100) + '%)</div></div>';
  }

  function benchCard(p) {
    const s = st();
    let body = '';
    if (!p.diag) {
      body = '<div class="row mt"><span class="muted">Faults unknown.</span><button class="btn btn-sm btn-primary" data-action="diagPhone" data-id="' + p.id + '">🔍 Run diagnostics (free)</button></div><div class="progress" data-diag="' + p.id + '" hidden><i></i></div>';
    } else {
      body = p.faults.map((f) => {
        const def = C.PARTS[f], done = p.fixed.indexOf(f) >= 0, cost = MS().partCost(p, f);
        return '<div class="fault"><span>' + def.icon + '</span><span class="grow">' + def.name + '</span>' +
          (done ? '<span class="pill done">✓ Fixed</span>' : '<button class="btn btn-sm btn-primary" data-action="repairPart" data-id="' + p.id + '" data-part="' + f + '"' + (s.cash >= cost ? '' : ' disabled') + '>Repair ' + U.money(cost) + '</button>') + '</div>';
      }).join('');
      if (MS().isReady(p)) {
        body += priceBox(p) + '<div class="row mt"><button class="btn btn-good" data-action="listPhone" data-id="' + p.id + '">🏷️ Put on display</button>' +
          '<button class="btn" data-action="quickSell" data-id="' + p.id + '">Trader ' + U.money(MS().traderOffer(p)) + '</button></div>';
      }
    }
    return '<div class="card"><div class="card-head">' + phoneIco(p) +
      '<div class="grow"><div class="card-title">' + p.brand + ' ' + p.name + '</div><div class="card-sub">Invested ' + U.money(p.invested) + ' · value ~' + U.money(p.value) + '</div></div>' +
      '<button class="btn btn-sm btn-ghost" data-action="scrapPhone" data-id="' + p.id + '" title="Scrap for parts">🗑️ ' + U.money(Math.round(p.ask * 0.4)) + '</button></div>' + body + '</div>';
  }

  function listedCard(p) {
    return '<div class="card"><div class="card-head">' + phoneIco(p) +
      '<div class="grow"><div class="card-title">' + p.brand + ' ' + p.name + '</div><div class="card-sub">Case #' + (p.slot + 1) + ' · invested ' + U.money(p.invested) + (p.reserved ? ' · customer holding it' : '') + '</div></div></div>' +
      priceBox(p) + '<div class="row mt"><button class="btn" data-action="unlistPhone" data-id="' + p.id + '">Take off display</button></div></div>';
  }

  function startRepair(pid, part) {
    const p = MS().find(pid);
    if (!p) return;
    const res = MS().startRepair(p, part, $('repairStage'), (r) => {
      repairHandle = null;
      $('repairOverlay').hidden = true;
      say(r);
      UI.refresh();
    });
    if (!res.ok) { say(res); return; }
    repairHandle = res.handle;
    $('repairTitle').textContent = res.def.icon + ' ' + p.brand + ' ' + p.name + ': ' + res.def.name + ' (-' + U.money(res.cost) + ')';
    $('repairOverlay').hidden = false;
    UI.hudTick();
  }

  /* ------------------------------ Shop ----------------------------------- */
  function renderShop() {
    const m = MODALS.shop, s = st();
    $(m.tabs).innerHTML = tabsHtml('shop', [['shelves', '🛒 Shelves'], ['staff', '🧑‍💼 Staff'], ['expand', '📐 Expand'], ['style', '🎨 Style']], m.tab);
    let html = '';
    if (m.tab === 'shelves') html = shelvesHtml();
    else if (m.tab === 'staff') html = staffHtml();
    else if (m.tab === 'expand') html = expandHtml();
    else html = styleHtml();
    $(m.body).innerHTML = html;
  }

  function shelvesHtml() {
    const s = st();
    const free = SM().freeSlots().length;
    let h = '<div class="sect">Add a shelf (' + free + ' free spot' + (free === 1 ? '' : 's') + ')</div><div class="stack">';
    Object.keys(C.CATEGORIES).forEach((k) => {
      const d = C.CATEGORIES[k], locked = s.level < d.unlock;
      h += '<div class="card"><div class="card-head"><div class="cat-ico" style="--c:' + d.color + '">' + d.icon + '</div>' +
        '<div class="grow"><div class="card-title">' + d.name + '</div><div class="card-sub">Cost/unit ' + U.money(d.wholesale) + ' · holds ' + d.capacity + '</div></div>' +
        (locked ? '<span class="pill dim">🔒 Level ' + d.unlock + '</span>' : '<button class="btn btn-sm btn-good" data-action="buyShelf" data-cat="' + k + '"' + (s.cash >= d.shelfCost && free > 0 ? '' : ' disabled') + '>+ Shelf ' + U.money(d.shelfCost) + '</button>') +
        '</div></div>';
    });
    h += '</div><div class="sect">Your shelves (' + s.shelves.length + ')</div>';
    if (!s.shelves.length) return h + '<div class="empty">No shelves yet. Add one above, then order stock.</div>';
    h += s.shelves.map((sh) => {
      const d = C.CATEGORIES[sh.cat], price = SM().unitPrice(sh), ch = SM().acceptChance(sh);
      return '<div class="card" id="shelf-' + sh.id + '"><div class="card-head"><div class="cat-ico" style="--c:' + d.color + '">' + d.icon + '</div>' +
        '<div class="grow"><div class="card-title">' + d.name + '</div><div class="card-sub">Stock ' + sh.stock + '/' + d.capacity + '</div></div>' +
        '<button class="btn btn-sm btn-ghost" data-action="removeShelf" data-id="' + sh.id + '">Remove</button></div>' +
        '<div class="row between mt"><span class="muted">Markup <b id="mk-' + sh.id + '">' + sh.markup + '%</b> → <b class="price" id="mkp-' + sh.id + '">' + U.money(price) + '</b></span><span id="mkd-' + sh.id + '">' + demandPill(ch) + '</span></div>' +
        '<input class="range js-markup" type="range" data-id="' + sh.id + '" min="0" max="120" step="5" value="' + sh.markup + '"></div>';
    }).join('');
    return h;
  }

  function staffHtml() {
    const s = st();
    let h = '<div class="muted">Wages are paid at the end of every day. Daily total: <b>' + U.money(SM().dailyWages()) + '</b> · rent <b>' + U.money(SM().dailyRent()) + '</b></div><div class="mt"></div>';
    Object.keys(C.STAFF).forEach((role) => {
      const d = C.STAFF[role], n = s.staff[role];
      h += '<div class="card"><div class="card-head"><div class="cat-ico" style="--c:#334155">' + d.icon + '</div>' +
        '<div class="grow"><div class="card-title">' + d.name + 's <span class="pill">' + n + '/' + d.max + '</span></div><div class="card-sub">' + d.desc + '</div></div></div>' +
        '<div class="row mt"><span class="muted">Fee ' + U.money(d.hire) + ' · wage ' + U.money(d.wage) + '/day</span></div>' +
        '<div class="row mt"><button class="btn btn-good" data-action="hire" data-role="' + role + '"' + (n < d.max && s.cash >= d.hire ? '' : ' disabled') + '>Hire</button>' +
        '<button class="btn" data-action="fire" data-role="' + role + '"' + (n > 0 ? '' : ' disabled') + '>Let go</button></div></div>';
    });
    return h;
  }

  function expandHtml() {
    const s = st(), cur = C.SIZES[s.expansion], next = SM().nextExpansion();
    let h = '<div class="card"><div class="card-title">Current store: ' + cur.cols + ' × ' + cur.rows + ' tiles</div><div class="card-sub">' + MS().slotsTotal() + ' display cases · ' + TM.Layout.g.shelfSlots.length + ' shelf spots · rent ' + U.money(SM().dailyRent()) + '/day</div></div>';
    if (!next) return h + '<div class="empty">Maximum size reached. 🏆</div>';
    const caseCount = C.PHONE_SLOTS[next.index], shelfCount = '+' + (C.SIZES[next.index].cols);
    h += '<div class="card"><div class="card-title">Next: ' + next.size.cols + ' × ' + next.size.rows + ' tiles</div>' +
      '<div class="card-sub">Needs store level ' + next.level + ' · ' + caseCount + ' display cases · more shelf spots · more customers · rent ' + U.money(C.rent(next.index)) + '/day</div>' +
      '<div class="row mt"><button class="btn btn-accent btn-lg" data-action="expand"' + (s.level >= next.level && s.cash >= next.cost ? '' : ' disabled') + '>Expand ' + U.money(next.cost) + '</button>' +
      (s.level < next.level ? '<span class="pill bad">Level ' + next.level + ' needed</span>' : '') + '</div></div>';
    return h;
  }

  function styleHtml() {
    const s = st();
    let h = '<label class="field"><span>Store name</span><input id="storeNameInput" type="text" maxlength="18" value="' + U.esc(s.storeName) + '"></label>';
    h += '<div class="sect">Floor (' + U.money(C.THEME_COST) + ' per change)</div><div class="swatches">' + C.FLOORS.map((f, i) =>
      '<button class="sw' + (s.theme.floor === i ? ' on' : '') + '" data-action="setFloor" data-i="' + i + '"><i style="background:linear-gradient(135deg,' + f.a + ' 50%,' + f.b + ' 50%)"></i>' + f.name + '</button>').join('') + '</div>';
    h += '<div class="sect">Walls (' + U.money(C.THEME_COST) + ' per change)</div><div class="swatches">' + C.WALLS.map((w, i) =>
      '<button class="sw' + (s.theme.wall === i ? ' on' : '') + '" data-action="setWall" data-i="' + i + '"><i style="background:linear-gradient(135deg,' + w.c + ' 50%,' + w.d + ' 50%)"></i>' + w.name + '</button>').join('') + '</div>';
    h += '<div class="sect">Game</div><div class="row"><button class="btn" data-action="saveNow">💾 Save now</button><button class="btn btn-bad" data-action="resetGame">🔄 New game</button></div>';
    return h;
  }

  /* ----------------------------- Orders ---------------------------------- */
  function renderOrders() {
    const s = st();
    let h = '<div class="muted">Orders arrive in the warehouse after a short delivery. Stockers (or the button below) move them onto shelves. Bulk orders get a discount.</div><div class="mt"></div>';
    Object.keys(C.CATEGORIES).forEach((k) => {
      const d = C.CATEGORIES[k];
      if (s.level < d.unlock) {
        h += '<div class="card"><div class="card-head"><div class="cat-ico" style="--c:#334155">🔒</div><div class="grow"><div class="card-title">' + d.name + '</div><div class="card-sub">Unlocks at store level ' + d.unlock + '</div></div></div></div>';
        return;
      }
      const q = orderQty[k], cost = SM().orderCost(k, q), disc = SM().discount(k, q), tot = SM().shelfTotals(k);
      const pending = s.orders.filter((o) => o.cat === k).reduce((a, o) => a + o.qty, 0);
      h += '<div class="card"><div class="card-head"><div class="cat-ico" style="--c:' + d.color + '">' + d.icon + '</div>' +
        '<div class="grow"><div class="card-title">' + d.name + '</div><div class="card-sub">' + U.money(d.wholesale) + '/unit · discount ' + d.discount[0] + '+ (5%) · ' + d.discount[1] + '+ (10%)</div></div></div>' +
        '<div class="row mt"><span class="pill">Warehouse ' + s.warehouse[k] + '</span><span class="pill">Shelves ' + tot.stock + '/' + tot.cap + '</span>' + (pending ? '<span class="pill ok">Incoming ' + pending + '</span>' : '') + '</div>' +
        '<div class="row between mt"><div class="stepper"><button class="btn btn-sm" data-action="qty" data-cat="' + k + '" data-delta="-' + d.step + '">−</button><b>' + q + '</b><button class="btn btn-sm" data-action="qty" data-cat="' + k + '" data-delta="' + d.step + '">+</button></div>' +
        '<button class="btn btn-primary" data-action="order" data-cat="' + k + '"' + (s.cash >= cost && q > 0 ? '' : ' disabled') + '>Order ' + U.money(cost) + (disc ? ' (-' + Math.round(disc * 100) + '%)' : '') + '</button></div></div>';
    });
    if (s.orders.length) {
      h += '<div class="sect">Pending deliveries</div>' + s.orders.map((o) => '<div class="row between muted"><span>' + C.CATEGORIES[o.cat].icon + ' ' + o.qty + ' × ' + C.CATEGORIES[o.cat].name + '</span><span>arrives in ' + Math.ceil(o.eta) + 's</span></div>').join('');
    }
    h += '<div class="mt"></div><button class="btn btn-accent w-full btn-lg" data-action="restockAll">📥 Restock shelves from warehouse</button>';
    $(MODALS.orders.body).innerHTML = h;
  }

  /* ----------------------------- Report ---------------------------------- */
  function renderReport() {
    const r = st() && st().lastReport;
    if (!r) { $(MODALS.report.body).innerHTML = '<div class="empty">No report available.</div>'; return; }
    const gross = r.revenueTotal - r.cogs;
    const row = (label, val, cls) => '<tr><td>' + label + '</td><td class="' + (cls || '') + '">' + val + '</td></tr>';
    let h = '<div class="card-title">Day ' + r.day + ' summary</div><div class="muted">' + r.customers + ' customers visited · ' + r.lost + ' left without buying · happiness ' + r.happiness + '%</div><div class="mt"></div>';
    h += '<table class="rep-table">' +
      row('📱 Phone sales', U.money(Math.round(r.revenue.phones))) +
      row('🛒 Groceries', U.money(Math.round(r.revenue.groceries))) +
      row('🎧 Accessories', U.money(Math.round(r.revenue.accessories))) +
      row('📺 Appliances', U.money(Math.round(r.revenue.appliances))) +
      row('<b>Total revenue</b>', '<b>' + U.money(Math.round(r.revenueTotal)) + '</b>') +
      row('Cost of goods sold', '-' + U.money(Math.round(r.cogs)), 'loss') +
      row('Gross profit', U.money(Math.round(gross)), gross >= 0 ? 'profit' : 'loss') +
      row('Card fees', '-' + U.money(Math.round(r.fees * 100) / 100), 'loss') +
      row('Staff wages', '-' + U.money(r.wages), 'loss') +
      row('Rent', '-' + U.money(r.rent), 'loss') +
      '<tr class="total"><td>' + (r.net >= 0 ? 'Net profit' : 'Net loss') + '</td><td class="' + (r.net >= 0 ? 'profit' : 'loss') + '">' + U.money(Math.round(r.net)) + '</td></tr></table>';
    h += '<div class="muted mt">Spent on inventory, parts and scans today: ' + U.money(Math.round(r.purchases)) + '. Cash at close: <b>' + U.money(Math.round(r.cashEnd)) + '</b></div>';
    const hist = st().history.slice(-7);
    if (hist.length > 1) {
      const max = Math.max.apply(null, hist.map((x) => Math.abs(x.net)).concat([1]));
      h += '<div class="sect">Net profit · last ' + hist.length + ' days</div><div class="chart">' + hist.map((x) =>
        '<div class="col"><i style="height:' + Math.max(3, Math.round((Math.abs(x.net) / max) * 70)) + 'px;background:' + (x.net >= 0 ? '#22c55e' : '#ef4444') + '"></i>D' + x.day + '</div>').join('') + '</div>';
    }
    if (r.cashEnd < 0) h += '<div class="card mt"><b class="loss">⚠️ You are in debt.</b> <span class="muted">If cash falls below ' + U.money(C.BANKRUPT_AT) + ' the shop goes bankrupt.</span></div>';
    h += '<div class="mt"></div><button class="btn btn-primary btn-lg w-full" data-action="nextDay">☀️ Start day ' + (r.day + 1) + '</button>';
    $(MODALS.report.body).innerHTML = h;
  }

  /* ------------------------------- Intro --------------------------------- */
  UI.showIntro = function (hasSave, onContinue, onNew) {
    introHandlers.cont = onContinue;
    introHandlers.fresh = onNew;
    $('btnContinue').hidden = !hasSave;
    $('modalIntro').hidden = false;
    open.add('intro');
  };
  function hideIntro() { $('modalIntro').hidden = true; open.delete('intro'); }

  /* ----------------------------- Actions --------------------------------- */
  function onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const a = el.dataset.action, d = el.dataset;
    switch (a) {
      case 'openWorkbench': UI.open('workbench'); break;
      case 'openShop': UI.open('shop'); break;
      case 'openOrders': UI.open('orders'); break;
      case 'close': UI.close(d.modal); break;
      case 'tab': MODALS[d.modal].tab = d.tab; UI.refresh(); break;
      case 'checkout':
        if (!EN().manualCheckout()) UI.toast(st().staff.cashier > 0 ? 'Your cashiers are handling the queue.' : 'No customer at the counter yet.', 'warn');
        UI.hudTick();
        break;
      case 'speed': EN().cycleSpeed(); UI.hudTick(); break;
      case 'refreshMarket': say(MS().refreshMarket(true)); UI.refresh(); break;
      case 'scanPhone': say(MS().scan(d.id)); UI.refresh(); break;
      case 'buyPhone': say(MS().buy(d.id)); UI.refresh(); break;
      case 'diagPhone': {
        const bar = document.querySelector('[data-diag="' + d.id + '"]');
        if (bar) bar.hidden = false;
        el.disabled = true;
        setTimeout(() => { say(MS().diagnose(d.id)); UI.refresh(); }, 1400);
        break;
      }
      case 'repairPart': startRepair(d.id, d.part); break;
      case 'giveUp': if (repairHandle) repairHandle.abort(); break;
      case 'listPhone': say(MS().list(d.id)); UI.refresh(); break;
      case 'unlistPhone': say(MS().unlist(d.id)); UI.refresh(); break;
      case 'quickSell': say(MS().quickSell(d.id)); UI.refresh(); break;
      case 'scrapPhone':
        if (global.confirm('Scrap this phone for parts?')) { say(MS().scrap(d.id)); UI.refresh(); }
        break;
      case 'buyShelf': say(SM().buyShelf(d.cat)); UI.refresh(); break;
      case 'removeShelf':
        if (global.confirm('Remove this shelf? You get a 50% refund.')) { say(SM().removeShelf(d.id)); UI.refresh(); }
        break;
      case 'hire': say(SM().hire(d.role)); UI.refresh(); break;
      case 'fire': say(SM().fire(d.role)); UI.refresh(); break;
      case 'expand': say(SM().expand()); UI.refresh(); break;
      case 'setFloor': say(SM().setTheme('floor', +d.i)); UI.refresh(); break;
      case 'setWall': say(SM().setTheme('wall', +d.i)); UI.refresh(); break;
      case 'qty': {
        const def = C.CATEGORIES[d.cat];
        orderQty[d.cat] = U.clamp(orderQty[d.cat] + parseInt(d.delta, 10), 0, def.capacity * 12);
        UI.refresh();
        break;
      }
      case 'order': say(SM().order(d.cat, orderQty[d.cat])); UI.refresh(); break;
      case 'restockAll': say(SM().restockAll()); UI.refresh(); break;
      case 'saveNow': if (TM.Save) TM.Save.save().then(() => UI.toast('Game saved.', 'good')); break;
      case 'resetGame':
        if (global.confirm('Start a brand new game? Your current progress will be lost.')) { UI.close('shop'); if (TM.Save) TM.Save.reset(); }
        break;
      case 'nextDay':
        $(MODALS.report.id).hidden = true;
        open.delete('report');
        EN().startNextDay();
        if (TM.Save) TM.Save.save();
        UI.hudTick();
        break;
      case 'introContinue': hideIntro(); if (introHandlers.cont) introHandlers.cont(); break;
      case 'introNew': {
        const name = $('introName').value;
        hideIntro();
        if (introHandlers.fresh) introHandlers.fresh(name);
        break;
      }
      case 'restart':
        $('modalGameover').hidden = true;
        open.delete('gameover');
        if (TM.Save) TM.Save.reset();
        break;
      default: break;
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.classList.contains('js-price')) {
      const p = MS().find(t.dataset.id);
      if (!p) return;
      MS().setPrice(p.id, +t.value);
      const lab = $('price-' + p.id), dem = $('demand-' + p.id);
      if (lab) lab.textContent = U.money(p.price);
      if (dem) dem.innerHTML = demandPill(MS().demand(p, p.price));
    } else if (t.classList.contains('js-markup')) {
      const sh = SM().findShelf(t.dataset.id);
      if (!sh) return;
      SM().setMarkup(sh.id, +t.value);
      const a = $('mk-' + sh.id), b = $('mkp-' + sh.id), c = $('mkd-' + sh.id);
      if (a) a.textContent = sh.markup + '%';
      if (b) b.textContent = U.money(SM().unitPrice(sh));
      if (c) c.innerHTML = demandPill(SM().acceptChance(sh));
    }
  }

  function onChange(e) {
    if (e.target.id === 'storeNameInput') {
      if (SM().rename(e.target.value)) { UI.toast('Store renamed.', 'good'); UI.hudTick(); }
      else e.target.value = st().storeName;
    }
  }

  /* ------------------------------- Init ---------------------------------- */
  UI.init = function () {
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !open.size) return;
      const names = Array.from(open);
      UI.close(names[names.length - 1]);
    });
    // block pinch/double-tap zoom gestures on iOS
    document.addEventListener('gesturestart', (e) => e.preventDefault());

    E.on('toast', (t) => UI.toast(t.msg, t.type));
    E.on('closing', () => UI.toast('Closing time! Serve the last customers.', 'warn'));
    E.on('delivery', (d) => { UI.toast('Delivery: ' + d.qty + ' × ' + C.CATEGORIES[d.cat].name, 'good'); if (open.has('orders')) UI.refresh(); });
    E.on('levelUp', (lv) => {
      const unlocks = [];
      Object.keys(C.CATEGORIES).forEach((k) => { if (C.CATEGORIES[k].unlock === lv) unlocks.push(C.CATEGORIES[k].name + ' shelves'); });
      if (C.MODELS.some((m) => m.minLevel === lv)) unlocks.push('new phone models');
      if (C.EXPANSION.some((x, i) => i > 0 && x.level === lv)) unlocks.push('store expansion');
      UI.toast('⭐ Store level ' + lv + '!' + (unlocks.length ? ' Unlocked: ' + unlocks.join(', ') : ''), 'good');
    });
    E.on('dayEnd', () => {
      open.forEach((n) => { if (n !== 'report' && n !== 'intro') UI.close(n); });
      UI.open('report');
      if (TM.Save) TM.Save.save();
    });
    E.on('gameOver', () => { $('modalGameover').hidden = false; open.add('gameover'); });
    E.on('shelfTap', () => { UI.open('shop', 'shelves'); });
    E.on('caseTap', () => { UI.open('workbench', 'listed'); });
    E.on('stateReplaced', () => {
      MODALS.workbench.tab = 'market';
      MODALS.shop.tab = 'shelves';
      Object.keys(hudCache).forEach((k) => delete hudCache[k]);
      UI.hudTick();
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
