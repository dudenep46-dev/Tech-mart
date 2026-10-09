/* ==========================================================================
   TechMart Empire: Ultra Simulator - render3d.js
   Dependency-free 3D renderer (perspective projection on Canvas 2D).
   - Angled "dollhouse" camera, lit/shaded 3D shelves, glass phone cases,
     counter with POS, crates, plant, walls with signage.
   - 3D characters: legs/torso/arms/head with walk cycle, arm swing, facing,
     idle breathing, carried bags/boxes. Render positions are low-pass
     filtered so 4-direction pathing never looks jerky.
   - Static scenery is cached; per frame only objects + people are drawn,
     depth-sorted (insertion sort on a reused array, zero allocation).
   ========================================================================== */
(function (global) {
  'use strict';
  const TM = global.TM;
  const Config = TM.Config;
  const R = (TM.Render3D = {});

  const PITCH = 55 * Math.PI / 180;
  const SIN = Math.sin(PITCH), COS = Math.cos(PITCH);
  const WALL_H = 2.6;
  const TAU = Math.PI * 2;

  let W = 1, H = 1, DPR = 1;
  const cam = { cx: 0, cy: 0, cz: 0, F: 1, X0: 0, Y0: 0 };
  let staticCv = null, staticKey = '', vigCv = null;
  let lastTime = 0;

  const P = [];
  for (let i = 0; i < 24; i++) P.push({ x: 0, y: 0, s: 1 });
  const A = P[20], B = P[21], C2 = P[22], D2 = P[23];
  const BB = { x0: 0, y0: 0, x1: 0, y1: 0 };

  /* ------------------------------ projection ------------------------------ */
  function proj(x, y, z, o) {
    const px = x - cam.cx, py = y - cam.cy, pz = z - cam.cz;
    const yc = py * COS - pz * SIN;
    const zc = -py * SIN - pz * COS;
    const s = cam.F / zc;
    o.x = cam.X0 + px * s;
    o.y = cam.Y0 - yc * s;
    o.s = s;
    return o;
  }

  function setupCamera(g) {
    const cols = g.cols, rows = g.rows;
    const D = Math.max(cols, rows) * 1.55;
    cam.cx = cols / 2; cam.cy = 0.5 + SIN * D; cam.cz = rows / 2 - 0.1 + COS * D;
    cam.F = 1; cam.X0 = 0; cam.Y0 = 0;
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    const pts = [
      [1, 0, rows + 0.1], [cols - 1, 0, rows + 0.1], [1, WALL_H + 0.15, 1], [cols - 1, WALL_H + 0.15, 1],
      [1, WALL_H, rows - 1], [cols - 1, WALL_H, rows - 1], [cols - 1, 0, rows - 0.7], [1, 0, 1]
    ];
    for (let i = 0; i < pts.length; i++) {
      proj(pts[i][0], pts[i][1], pts[i][2], A);
      if (A.x < minX) minX = A.x; if (A.x > maxX) maxX = A.x;
      if (A.y < minY) minY = A.y; if (A.y > maxY) maxY = A.y;
    }
    const F = Math.min((W * 0.97) / (maxX - minX), (H * 0.96) / (maxY - minY));
    cam.F = F;
    cam.X0 = W / 2 - F * (minX + maxX) / 2;
    cam.Y0 = H / 2 - F * (minY + maxY) / 2;
  }

  /* -------------------------------- helpers -------------------------------- */
  const shadeCache = new Map();
  function shade(hex, f) {
    const key = hex + '|' + f;
    let v = shadeCache.get(key);
    if (v) return v;
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; } else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
    v = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
    shadeCache.set(key, v);
    return v;
  }

  function poly4(c, a, b, d, e, fill, stroke) {
    c.beginPath();
    c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.lineTo(d.x, d.y); c.lineTo(e.x, e.y);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.stroke(); }
    if (a.x < BB.x0) BB.x0 = a.x; if (b.x < BB.x0) BB.x0 = b.x; if (d.x < BB.x0) BB.x0 = d.x; if (e.x < BB.x0) BB.x0 = e.x;
    if (a.x > BB.x1) BB.x1 = a.x; if (b.x > BB.x1) BB.x1 = b.x; if (d.x > BB.x1) BB.x1 = d.x; if (e.x > BB.x1) BB.x1 = e.x;
    if (a.y < BB.y0) BB.y0 = a.y; if (b.y < BB.y0) BB.y0 = b.y; if (d.y < BB.y0) BB.y0 = d.y; if (e.y < BB.y0) BB.y0 = e.y;
    if (a.y > BB.y1) BB.y1 = a.y; if (b.y > BB.y1) BB.y1 = b.y; if (d.y > BB.y1) BB.y1 = d.y; if (e.y > BB.y1) BB.y1 = e.y;
  }

  function resetBB() { BB.x0 = 1e9; BB.y0 = 1e9; BB.x1 = -1e9; BB.y1 = -1e9; }

  // rectangle on a plane of constant z (front-facing)
  function rectZ(c, x0, y0, x1, y1, z, fill, stroke) {
    proj(x0, y0, z, A); proj(x1, y0, z, B); proj(x1, y1, z, C2); proj(x0, y1, z, D2);
    poly4(c, A, B, C2, D2, fill, stroke);
  }

  // axis-aligned box with top / front / side faces
  function box(c, x0, z0, x1, z1, y0, y1, topC, frontC, sideC, line) {
    const a = P[0], b = P[1], d = P[2], e = P[3];
    resetBB();
    const sx = (x0 + x1) / 2 < cam.cx ? x1 : x0;
    proj(sx, y0, z1, a); proj(sx, y0, z0, b); proj(sx, y1, z0, d); proj(sx, y1, z1, e);
    poly4(c, a, b, d, e, sideC, line);
    proj(x0, y0, z1, a); proj(x1, y0, z1, b); proj(x1, y1, z1, d); proj(x0, y1, z1, e);
    poly4(c, a, b, d, e, frontC, line);
    proj(x0, y1, z0, a); proj(x1, y1, z0, b); proj(x1, y1, z1, d); proj(x0, y1, z1, e);
    poly4(c, a, b, d, e, topC, line);
  }

  function floorQuad(c, x0, z0, x1, z1, fill, stroke) {
    proj(x0, 0, z0, A); proj(x1, 0, z0, B); proj(x1, 0, z1, C2); proj(x0, 0, z1, D2);
    poly4(c, A, B, C2, D2, fill, stroke);
  }

  function ellipse(c, x, y, rx, ry) { c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); }

  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /* ------------------------------ hit testing ------------------------------ */
  const hits = [];
  let nHits = 0;
  function addHit(type, id) {
    let h = hits[nHits];
    if (!h) { h = hits[nHits] = { type: '', id: null, x0: 0, y0: 0, x1: 0, y1: 0 }; }
    h.type = type; h.id = id; h.x0 = BB.x0 - 4; h.y0 = BB.y0 - 4; h.x1 = BB.x1 + 4; h.y1 = BB.y1 + 4;
    nHits++;
  }
  R.pick = function (px, py) {
    for (let i = nHits - 1; i >= 0; i--) {
      const h = hits[i];
      if (px >= h.x0 && px <= h.x1 && py >= h.y0 && py <= h.y1) return h;
    }
    return null;
  };

  /* ------------------------------ static scene ------------------------------ */
  function buildStatic(g, st) {
    const cols = g.cols, rows = g.rows;
    const fl = Config.FLOORS[st.theme.floor] || Config.FLOORS[0];
    const wl = Config.WALLS[st.theme.wall] || Config.WALLS[0];
    if (!staticCv) staticCv = document.createElement('canvas');
    staticCv.width = W; staticCv.height = H;
    const c = staticCv.getContext('2d');
    const a = P[4], b = P[5], d = P[6], e = P[7];
    c.lineJoin = 'round';

    // backdrop
    const bg = c.createRadialGradient(W / 2, H * 0.5, H * 0.05, W / 2, H * 0.5, Math.max(W, H) * 0.78);
    bg.addColorStop(0, '#1d2d4d'); bg.addColorStop(1, '#04070d');
    c.fillStyle = bg; c.fillRect(0, 0, W, H);

    // soft ground shadow around the building
    proj(0.4, 0, rows + 0.4, a); proj(cols - 0.4, 0, rows + 0.4, b); proj(cols - 0.4, 0, 0.6, d); proj(0.4, 0, 0.6, e);
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.save(); c.filter = 'blur(' + Math.round(10 * DPR) + 'px)'; poly4(c, a, b, d, e, 'rgba(0,0,0,.45)', null); c.restore();

    // floor
    floorQuad(c, 1, 1, cols - 1, rows - 1, fl.b, null);
    for (let z = 1; z < rows - 1; z++) for (let x = 1; x < cols - 1; x++) if (((x + z) & 1) === 1) floorQuad(c, x, z, x + 1, z + 1, fl.a, null);
    // doorway tile + mat
    floorQuad(c, 1, rows - 1, 2, rows, shade(fl.a, -0.05), null);
    floorQuad(c, 1.12, rows - 0.85, 1.88, rows - 0.15, '#7f1d1d', 'rgba(0,0,0,.35)');
    floorQuad(c, 1.2, rows - 0.75, 1.8, rows - 0.25, '#991b1b', null);
    // grout
    c.lineWidth = 1; c.strokeStyle = 'rgba(15,23,42,.10)';
    c.beginPath();
    for (let x = 1; x <= cols - 1; x++) { proj(x, 0, 1, a); proj(x, 0, rows - 1, b); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
    for (let z = 1; z <= rows - 1; z++) { proj(1, 0, z, a); proj(cols - 1, 0, z, b); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); }
    c.stroke();
    // glossy sheen (light falls from the back wall)
    proj(1, 0, 1, a); proj(1, 0, rows - 1, e);
    const sheen = c.createLinearGradient(0, a.y, 0, e.y);
    sheen.addColorStop(0, 'rgba(255,255,255,.22)'); sheen.addColorStop(0.55, 'rgba(255,255,255,.04)'); sheen.addColorStop(1, 'rgba(0,0,0,.10)');
    floorQuad(c, 1, 1, cols - 1, rows - 1, sheen, null);
    // soft light pools
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let zz = 3; zz < rows - 1; zz += 4) {
      for (let xx = 3; xx < cols - 1; xx += 5) {
        proj(xx, 0, zz, a);
        const rg = c.createRadialGradient(a.x, a.y, 0, a.x, a.y, 2.6 * a.s);
        rg.addColorStop(0, 'rgba(255,255,240,.10)'); rg.addColorStop(1, 'rgba(255,255,240,0)');
        c.fillStyle = rg; ellipse(c, a.x, a.y, 2.6 * a.s, 2.6 * a.s * SIN); c.fill();
      }
    }
    c.restore();
    // queue footprints + cashier mat
    c.lineWidth = Math.max(1, 1.2 * DPR);
    g.queue.forEach((q) => floorQuad(c, q.x + 0.26, q.y + 0.26, q.x + 0.74, q.y + 0.74, 'rgba(250,204,21,.07)', 'rgba(250,204,21,.28)'));
    floorQuad(c, g.cashier.x + 0.08, g.cashier.y + 0.08, g.cashier.x + 0.92, g.cashier.y + 0.92, 'rgba(15,23,42,.20)', null);

    // ----- back wall -----
    proj(1, 0, 1, a); proj(cols - 1, 0, 1, b); proj(cols - 1, WALL_H, 1, d); proj(1, WALL_H, 1, e);
    const wg = c.createLinearGradient(0, e.y, 0, a.y);
    wg.addColorStop(0, shade(wl.c, -0.2)); wg.addColorStop(0.55, wl.c); wg.addColorStop(1, shade(wl.c, 0.12));
    poly4(c, a, b, d, e, wg, null);
    rectZ(c, 1, 0, cols - 1, 0.16, 1, wl.d, null);                       // baseboard
    rectZ(c, 1, WALL_H - 0.14, cols - 1, WALL_H, 1, shade(wl.d, 0.35), null); // cornice
    c.save();
    c.shadowColor = '#67e8f9'; c.shadowBlur = 14 * DPR;
    rectZ(c, 1, WALL_H - 0.3, cols - 1, WALL_H - 0.25, 1, '#a5f3fc', null);
    c.restore();
    // phone display panels
    const tiers = Config.TIER_COLORS;
    for (let px = 1.5, pi = 0; px + 2.1 < cols - 1; px += 2.45, pi++) {
      rectZ(c, px, 0.9, px + 2.1, 1.78, 1, 'rgba(8,15,30,.62)', 'rgba(255,255,255,.22)');
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 8; k++) {
          const col = tiers[(pi * 3 + r * 5 + k * 7) % tiers.length];
          rectZ(c, px + 0.1 + k * 0.245, 1.0 + (2 - r) * 0.27, px + 0.1 + k * 0.245 + 0.14, 1.0 + (2 - r) * 0.27 + 0.2, 1, shade(col, -0.05), null);
        }
      }
    }
    // signage
    function sign(x0, x1, text, plate, neon) {
      proj(x0, 1.9, 1, a); proj(x1, 2.38, 1, b);
      const wpx = b.x - a.x, hpx = a.y - b.y;
      rectZ(c, x0, 1.9, x1, 2.38, 1, plate, neon);
      c.save();
      c.shadowColor = neon; c.shadowBlur = 12 * DPR;
      c.fillStyle = '#fff7d6'; c.textAlign = 'center'; c.textBaseline = 'middle';
      let fs = hpx * 0.56;
      c.font = '800 ' + fs + 'px system-ui, sans-serif';
      while (c.measureText(text).width > wpx * 0.9 && fs > 6) { fs -= 1; c.font = '800 ' + fs + 'px system-ui, sans-serif'; }
      c.fillText(text, (a.x + b.x) / 2, (a.y + b.y) / 2 + 1);
      c.restore();
    }
    c.lineWidth = Math.max(1.5, 2 * DPR);
    const sw = Math.min(cols - 5, 6.4);
    sign(cols / 2 - sw / 2, cols / 2 + sw / 2, st.storeName, '#0b1220', '#fbbf24');
    if (cols >= 16) {
      sign(1.4, 3.7, 'PHONES', '#0b2a5b', '#38bdf8');
      sign(cols - 3.7, cols - 1.4, 'REPAIRS', '#0b2a5b', '#38bdf8');
    }
    // ambient occlusion on the floor along the back wall
    proj(1, 0, 1, a); proj(1, 0, 1.9, e);
    const ao = c.createLinearGradient(0, a.y, 0, e.y);
    ao.addColorStop(0, 'rgba(0,0,0,.32)'); ao.addColorStop(1, 'rgba(0,0,0,0)');
    floorQuad(c, 1, 1, cols - 1, 1.9, ao, null);

    // ----- left wall -----
    proj(1, 0, rows - 1, a); proj(1, 0, 1, b); proj(1, WALL_H, 1, d); proj(1, WALL_H, rows - 1, e);
    const lg = c.createLinearGradient(0, e.y, 0, a.y);
    lg.addColorStop(0, shade(wl.c, -0.42)); lg.addColorStop(1, shade(wl.c, -0.22));
    poly4(c, a, b, d, e, lg, null);
    for (let z = 2.2; z + 1.7 < rows - 1; z += 3.6) {
      proj(1, 0.95, z, a); proj(1, 0.95, z + 1.6, b); proj(1, 2.0, z + 1.6, d); proj(1, 2.0, z, e);
      const pg = c.createLinearGradient(a.x, a.y, d.x, d.y);
      pg.addColorStop(0, '#38bdf8'); pg.addColorStop(1, '#a78bfa');
      poly4(c, a, b, d, e, pg, 'rgba(255,255,255,.7)');
      proj(1, 1.15, z + 0.2, a); proj(1, 1.15, z + 1.4, b); proj(1, 1.3, z + 1.4, d); proj(1, 1.3, z + 0.2, e);
      poly4(c, a, b, d, e, 'rgba(255,255,255,.55)', null);
    }
    proj(1, 0, rows - 1, a); proj(1, 0, 1, b); proj(1, 0.16, 1, d); proj(1, 0.16, rows - 1, e);
    poly4(c, a, b, d, e, wl.d, null);
    // ----- right wall (with windows) -----
    proj(cols - 1, 0, 1, a); proj(cols - 1, 0, rows - 1, b); proj(cols - 1, WALL_H, rows - 1, d); proj(cols - 1, WALL_H, 1, e);
    const rg2 = c.createLinearGradient(0, e.y, 0, a.y);
    rg2.addColorStop(0, shade(wl.c, -0.3)); rg2.addColorStop(1, shade(wl.c, -0.08));
    poly4(c, a, b, d, e, rg2, null);
    for (let z = 2.2; z + 2 < rows - 1; z += 4.2) {
      proj(cols - 1, 0.8, z, a); proj(cols - 1, 0.8, z + 2, b); proj(cols - 1, 2.1, z + 2, d); proj(cols - 1, 2.1, z, e);
      const sg = c.createLinearGradient(0, e.y, 0, a.y);
      sg.addColorStop(0, '#7dd3fc'); sg.addColorStop(1, '#e0f2fe');
      poly4(c, a, b, d, e, sg, '#f8fafc');
      proj(cols - 1, 0.8, z + 1, a); proj(cols - 1, 2.1, z + 1, b);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = '#f8fafc'; c.stroke();
      // light spill on the floor
      proj(cols - 1, 0, z, a); proj(cols - 1, 0, z + 2, b); proj(cols - 3.6, 0, z + 3.0, d); proj(cols - 3.6, 0, z + 1.0, e);
      poly4(c, a, b, d, e, 'rgba(255,255,255,.09)', null);
    }
    proj(cols - 1, 0, 1, a); proj(cols - 1, 0, rows - 1, b); proj(cols - 1, 0.16, rows - 1, d); proj(cols - 1, 0.16, 1, e);
    poly4(c, a, b, d, e, wl.d, null);

    // vignette (drawn over everything each frame)
    if (!vigCv) vigCv = document.createElement('canvas');
    vigCv.width = W; vigCv.height = H;
    const v = vigCv.getContext('2d');
    const vg = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.45)');
    v.fillStyle = vg; v.fillRect(0, 0, W, H);
  }

  /* ------------------------------ object drawing ------------------------------ */
  function drawShelf(c, s, slot) {
    const cat = Config.CATEGORIES[s.cat];
    const x0 = slot.x, x1 = slot.x + 2, z0 = slot.y, z1 = slot.y + 1, h = 1.45;
    const a = P[8], b = P[9], d = P[10], e = P[11];
    // contact shadow
    proj(x0 - 0.02, 0, z0 + 0.1, a); proj(x1 + 0.22, 0, z0 + 0.1, b); proj(x1 + 0.22, 0, z1 + 0.16, d); proj(x0 - 0.02, 0, z1 + 0.16, e);
    poly4(c, a, b, d, e, 'rgba(0,0,0,.20)', null);
    c.lineWidth = Math.max(1, DPR);
    box(c, x0, z0, x1, z1, 0, h, '#f8fafc', '#e5eaf2', '#b3bfce', 'rgba(15,23,42,.35)');
    const bx0 = BB.x0, by0 = BB.y0, bx1 = BB.x1, by1 = BB.y1;
    // recessed interior
    rectZ(c, x0 + 0.07, 0.07, x1 - 0.07, h - 0.34, z1, '#9fb0c4', null);
    rectZ(c, x0 + 0.07, 0.07, x1 - 0.07, h - 0.34, z1, 'rgba(0,0,0,.10)', null);
    const total = 24;
    let filled = Math.ceil((s.stock / cat.capacity) * total);
    if (s.stock > 0 && filled < 1) filled = 1;
    const innerW = x1 - x0 - 0.3;
    for (let lv = 0; lv < 3; lv++) {
      const by = 0.1 + lv * 0.38;
      rectZ(c, x0 + 0.07, by - 0.035, x1 - 0.07, by, z1, '#eef2f7', null);
      for (let k = 0; k < 8; k++) {
        const idx = lv * 8 + k;
        if (idx >= filled) continue;
        const ph = 0.22 + ((k + lv) % 3) * 0.04;
        const px = x0 + 0.16 + (k * innerW) / 8;
        const col = shade(cat.color, ((k + lv * 2) % 3 - 1) * 0.16);
        rectZ(c, px, by, px + 0.17, by + ph, z1, col, null);
        rectZ(c, px, by + ph - 0.045, px + 0.17, by + ph, z1, 'rgba(255,255,255,.35)', null);
      }
    }
    // header band
    rectZ(c, x0 + 0.04, h - 0.3, x1 - 0.04, h - 0.04, z1, cat.color, null);
    rectZ(c, x0 + 0.04, h - 0.3, x1 - 0.04, h - 0.22, z1, 'rgba(255,255,255,.25)', null);
    proj(x0 + 0.04, h - 0.04, z1, a); proj(x1 - 0.04, h - 0.3, z1, b);
    const fs = Math.max(7, (a.y - b.y) * 0.5);
    c.font = '800 ' + fs + 'px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#ffffff';
    c.fillText(cat.icon + ' ' + cat.name.split(' ').pop().toUpperCase(), (a.x + b.x) / 2, (a.y + b.y) / 2 + 1);
    // stock chip
    const ratio = s.stock / cat.capacity;
    proj((x0 + x1) / 2, h + 0.2, z0 + 0.5, a);
    const cw = 0.62 * a.s, chh = 0.2 * a.s;
    c.fillStyle = 'rgba(15,23,42,.82)'; rrect(c, a.x - cw / 2, a.y - chh / 2, cw, chh, chh / 2); c.fill();
    c.fillStyle = ratio < 0.25 ? '#ef4444' : ratio < 0.55 ? '#f59e0b' : '#22c55e';
    rrect(c, a.x - cw / 2 + 2, a.y - chh / 2 + 2, Math.max(chh - 4, (cw - 4) * ratio), chh - 4, (chh - 4) / 2); c.fill();
    c.fillStyle = '#fff'; c.font = '800 ' + Math.max(7, chh * 0.62) + 'px system-ui, sans-serif';
    c.fillText(s.stock + '/' + cat.capacity, a.x, a.y + 1);
    if (s.stock === 0) {
      c.font = Math.max(10, 0.3 * a.s) + 'px sans-serif';
      c.fillText('❗', a.x + cw / 2 + 0.14 * a.s, a.y);
    }
    BB.x0 = Math.min(BB.x0, bx0); BB.y0 = Math.min(by0, a.y - chh); BB.x1 = Math.max(bx1, BB.x1); BB.y1 = by1;
    addHit('shelf', s.id);
  }

  function drawCase(c, i, cs, p) {
    const x0 = cs.x + 0.04, x1 = cs.x + 0.96, z0 = 1.04, z1 = 1.96;
    const a = P[8], b = P[9], d = P[10], e = P[11];
    proj(x0, 0, z0 + 0.1, a); proj(x1 + 0.18, 0, z0 + 0.1, b); proj(x1 + 0.18, 0, z1 + 0.14, d); proj(x0, 0, z1 + 0.14, e);
    poly4(c, a, b, d, e, 'rgba(0,0,0,.20)', null);
    c.lineWidth = Math.max(1, DPR);
    box(c, x0, z0, x1, z1, 0, 0.5, '#475569', '#1e293b', '#0f172a', 'rgba(0,0,0,.4)');
    rectZ(c, x0 + 0.04, 0.05, x1 - 0.04, 0.085, z1, '#22d3ee', null);
    if (p) {
      const cx = cs.x + 0.5, zz = 1.52;
      const body = p.reserved ? '#64748b' : p.color;
      proj(cx - 0.12, 0.52, zz + 0.05, a); proj(cx + 0.12, 0.52, zz + 0.05, b); proj(cx + 0.12, 0.94, zz - 0.07, d); proj(cx - 0.12, 0.94, zz - 0.07, e);
      poly4(c, a, b, d, e, body, 'rgba(0,0,0,.5)');
      proj(cx - 0.095, 0.56, zz + 0.045, a); proj(cx + 0.095, 0.56, zz + 0.045, b); proj(cx + 0.095, 0.9, zz - 0.06, d); proj(cx - 0.095, 0.9, zz - 0.06, e);
      const sg = c.createLinearGradient(a.x, a.y, d.x, d.y);
      sg.addColorStop(0, '#e0f2fe'); sg.addColorStop(1, '#2563eb');
      poly4(c, a, b, d, e, sg, null);
    }
    box(c, x0, z0, x1, z1, 0.5, 0.98, 'rgba(224,242,254,.30)', 'rgba(186,230,253,.16)', 'rgba(147,197,253,.24)', 'rgba(255,255,255,.55)');
    rectZ(c, x0 + 0.06, 0.55, x0 + 0.13, 0.94, z1, 'rgba(255,255,255,.28)', null);
    const bx0 = BB.x0, by0 = BB.y0, bx1 = BB.x1, by1 = BB.y1;
    if (p) {
      proj(cs.x + 0.5, 1.2, 1.5, a);
      const t = '$' + p.price;
      c.font = '800 ' + Math.max(8, 0.2 * a.s) + 'px system-ui, sans-serif';
      const tw = c.measureText(t).width + 0.16 * a.s, th = 0.26 * a.s;
      c.fillStyle = '#ffffff'; rrect(c, a.x - tw / 2, a.y - th / 2, tw, th, th / 2); c.fill();
      c.strokeStyle = '#0ea5e9'; c.lineWidth = Math.max(1, DPR); c.stroke();
      c.fillStyle = '#0f172a'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(t, a.x, a.y + 1);
      BB.y0 = Math.min(by0, a.y - th / 2);
    } else { BB.y0 = by0; }
    BB.x0 = bx0; BB.x1 = bx1; BB.y1 = by1;
    addHit('case', i);
  }

  function drawCounter(c, g, st, ready, time) {
    const x0 = g.counter.x, x1 = g.counter.x + 2, z0 = g.counter.y + 0.04, z1 = g.counter.y + 0.96, h = 0.82;
    const a = P[8], b = P[9], d = P[10], e = P[11];
    proj(x0, 0, z0 + 0.1, a); proj(x1 + 0.2, 0, z0 + 0.1, b); proj(x1 + 0.2, 0, z1 + 0.16, d); proj(x0, 0, z1 + 0.16, e);
    poly4(c, a, b, d, e, 'rgba(0,0,0,.22)', null);
    c.lineWidth = Math.max(1, DPR);
    box(c, x0, z0, x1, z1, 0, h, '#111a2e', '#7c3f1d', '#55270f', 'rgba(0,0,0,.4)');
    rectZ(c, x0 + 0.06, 0.1, x1 - 0.06, 0.5, z1, '#8f4a22', null);
    rectZ(c, x0 + 0.06, h - 0.07, x1 - 0.06, h - 0.03, z1, '#fbbf24', null);
    // top highlight
    proj(x0, h, z1 - 0.12, a); proj(x1, h, z1 - 0.12, b); proj(x1, h, z1, d); proj(x0, h, z1, e);
    poly4(c, a, b, d, e, 'rgba(255,255,255,.12)', null);
    // POS monitor
    box(c, x0 + 0.78, z0 + 0.3, x0 + 0.86, z0 + 0.4, h, h + 0.18, '#334155', '#1e293b', '#0f172a', null);
    proj(x0 + 0.38, h + 0.16, z0 + 0.42, a); proj(x0 + 1.26, h + 0.16, z0 + 0.42, b); proj(x0 + 1.26, h + 0.66, z0 + 0.34, d); proj(x0 + 0.38, h + 0.66, z0 + 0.34, e);
    poly4(c, a, b, d, e, '#0b1220', '#334155');
    proj(x0 + 0.44, h + 0.21, z0 + 0.415, a); proj(x0 + 1.2, h + 0.21, z0 + 0.415, b); proj(x0 + 1.2, h + 0.61, z0 + 0.35, d); proj(x0 + 0.44, h + 0.61, z0 + 0.35, e);
    const sg = c.createLinearGradient(a.x, d.y, b.x, a.y);
    sg.addColorStop(0, '#34d399'); sg.addColorStop(1, '#0ea5e9');
    poly4(c, a, b, d, e, sg, null);
    const mid = (a.x + b.x) / 2, my = (a.y + d.y) / 2;
    c.fillStyle = 'rgba(255,255,255,.9)'; c.font = '800 ' + Math.max(7, 0.2 * a.s) + 'px system-ui, sans-serif';
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(ready ? 'PAY' : 'TOTAL', mid, my);
    // keypad + card terminal
    box(c, x0 + 0.3, z0 + 0.55, x0 + 0.85, z0 + 0.8, h, h + 0.04, '#1f2937', '#111827', '#0b1220', null);
    box(c, x0 + 1.35, z0 + 0.5, x0 + 1.62, z0 + 0.8, h, h + 0.1, '#1f2937', '#111827', '#0b1220', null);
    rectZ(c, x0 + 1.4, h + 0.03, x0 + 1.58, h + 0.08, z0 + 0.8, '#22d3ee', null);
    const bx0 = BB.x0, by0 = BB.y0, bx1 = BB.x1, by1 = BB.y1;
    BB.x0 = Math.min(bx0, mid); BB.y0 = Math.min(by0, my - 20); BB.x1 = Math.max(bx1, mid); BB.y1 = by1;
    addHit('counter', 0);
    if (ready && st.staff.cashier === 0) {
      const al = 0.4 + 0.4 * Math.sin(time / 160);
      c.lineWidth = Math.max(2, 3 * DPR);
      floorQuad(c, x0 - 0.1, z1 + 0.1, x1 + 0.1, z1 + 0.75, 'rgba(34,197,94,' + (al * 0.25).toFixed(2) + ')', 'rgba(34,197,94,' + al.toFixed(2) + ')');
      proj(x0 + 1, 1.75 + Math.sin(time / 220) * 0.06, z0 + 0.5, a);
      c.font = Math.max(12, 0.34 * a.s) + 'px sans-serif';
      c.fillText('👆', a.x, a.y);
    }
  }

  function drawCrates(c, g) {
    const bx = g.backroom.x, bz = g.backroom.y;
    c.lineWidth = Math.max(1, DPR);
    const a = P[8], b = P[9], d = P[10], e = P[11];
    proj(bx + 0.05, 0, bz + 0.2, a); proj(bx + 1.1, 0, bz + 0.2, b); proj(bx + 1.1, 0, bz + 1.05, d); proj(bx + 0.05, 0, bz + 1.05, e);
    poly4(c, a, b, d, e, 'rgba(0,0,0,.2)', null);
    box(c, bx + 0.12, bz + 0.15, bx + 0.62, bz + 0.65, 0, 0.5, '#e0b374', '#c28b45', '#9a6a30', 'rgba(60,35,10,.5)');
    rectZ(c, bx + 0.32, 0, bx + 0.42, 0.5, bz + 0.65, 'rgba(255,255,255,.35)', null);
    box(c, bx + 0.52, bz + 0.45, bx + 0.92, bz + 0.85, 0, 0.36, '#d9a45f', '#b9823f', '#8f6330', 'rgba(60,35,10,.5)');
    box(c, bx + 0.2, bz + 0.22, bx + 0.54, bz + 0.56, 0.5, 0.82, '#e8bf86', '#cc9650', '#a07138', 'rgba(60,35,10,.5)');
    rectZ(c, bx + 0.32, 0.5, bx + 0.4, 0.82, bz + 0.56, 'rgba(255,255,255,.4)', null);
  }

  function drawPlant(c, g) {
    const px = g.cols - 2, pz = 1;
    c.lineWidth = Math.max(1, DPR);
    const a = P[8];
    proj(px + 0.5, 0, pz + 0.55, a);
    ellipse(c, a.x + 0.06 * a.s, a.y + 0.02 * a.s, 0.3 * a.s, 0.3 * a.s * SIN); c.fillStyle = 'rgba(0,0,0,.2)'; c.fill();
    box(c, px + 0.28, pz + 0.33, px + 0.72, pz + 0.77, 0, 0.34, '#b45309', '#92400e', '#78350f', 'rgba(0,0,0,.35)');
    const leaves = [[0, 0.78, 0.2], [-0.2, 0.66, 0.16], [0.2, 0.68, 0.16], [-0.08, 0.98, 0.15], [0.1, 1.0, 0.14], [0, 0.52, 0.13]];
    for (let i = 0; i < leaves.length; i++) {
      proj(px + 0.5 + leaves[i][0], leaves[i][1], pz + 0.55, a);
      const r = leaves[i][2] * a.s;
      const gr = c.createRadialGradient(a.x - r * 0.3, a.y - r * 0.3, r * 0.1, a.x, a.y, r);
      gr.addColorStop(0, '#86efac'); gr.addColorStop(1, '#15803d');
      c.fillStyle = gr; ellipse(c, a.x, a.y, r, r * 0.9); c.fill();
    }
  }

  function drawLedge(c, g, st, time) {
    const cols = g.cols, rows = g.rows;
    const wl = Config.WALLS[st.theme.wall] || Config.WALLS[0];
    c.lineWidth = Math.max(1, DPR);
    box(c, 2.1, rows - 1, cols - 1, rows - 0.7, 0, 0.5, '#e2e8f0', shade(wl.c, -0.12), shade(wl.c, -0.3), 'rgba(0,0,0,.3)');
    box(c, 1.96, rows - 1, 2.1, rows - 0.7, 0, 1.2, shade(wl.d, 0.2), shade(wl.d, 0), shade(wl.d, -0.2), 'rgba(0,0,0,.3)');
    const a = P[8];
    proj(2.8, 0.95, rows - 0.7, a);
    const w = 0.9 * a.s, hh = 0.3 * a.s;
    c.fillStyle = '#04120a'; rrect(c, a.x - w / 2, a.y - hh / 2, w, hh, hh * 0.25); c.fill();
    c.save();
    c.strokeStyle = '#22c55e'; c.shadowColor = '#22c55e'; c.shadowBlur = 8 * DPR; c.lineWidth = Math.max(1, 1.5 * DPR); c.stroke();
    c.fillStyle = TM.state.phase === 'open' ? '#4ade80' : '#f87171';
    c.font = '800 ' + hh * 0.6 + 'px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(TM.state.phase === 'open' ? 'OPEN' : 'CLOSED', a.x, a.y + 1);
    c.restore();
  }

  /* ------------------------------ characters ------------------------------ */
  const PANTS = ['#1e293b', '#334155', '#3f3f46', '#1e3a5f'];
  const AA = P[12], BBp = P[13], CC = P[14], DD = P[15], EE = P[16], FF = P[17];

  function limb(c, p, q, w, col, outline) {
    c.lineCap = 'round';
    c.strokeStyle = outline; c.lineWidth = w + Math.max(1.5, 1.6 * DPR);
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
    c.strokeStyle = col; c.lineWidth = w;
    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(q.x, q.y); c.stroke();
  }

  function animate(e, dt) {
    if (e._init !== true) {
      e._init = true; e._rx = e.x; e._ry = e.y; e._ph = Math.random() * 6; e._hx = 0; e._hz = 1; e._v = 0; e._seed = Math.random() * 100;
    }
    const dx = e.x - e._rx, dy = e.y - e._ry;
    if (dx * dx + dy * dy > 2.5) { e._rx = e.x; e._ry = e.y; e._v = 0; return; }
    const k = 1 - Math.exp(-dt * 14);
    const mx = dx * k, my = dy * k;
    e._rx += mx; e._ry += my;
    const moved = Math.sqrt(mx * mx + my * my);
    e._v += ((moved / dt) - e._v) * Math.min(1, dt * 9);
    e._ph += moved * 6.4;
    let tx = e._hx, tz = e._hz;
    if (moved > 0.0006 && e._v > 0.35) { tx = mx / moved; tz = my / moved; }
    else {
      switch (e.state) {
        case 'queueing': case 'atCounter': tx = 1; tz = 0; break;
        case 'browsing': tx = 0; tz = -1; break;
        case 'toShelf': tx = 0; tz = -1; break;
        default: break;
      }
    }
    const t = Math.min(1, dt * 10);
    let nx = e._hx + (tx - e._hx) * t, nz = e._hz + (tz - e._hz) * t;
    const l = Math.sqrt(nx * nx + nz * nz) || 1;
    e._hx = nx / l; e._hz = nz / l;
  }

  function person(c, e, o, time) {
    const x = e._rx, z = e._ry, hx = e._hx, hz = e._hz;
    const lx = -hz, lz = hx;
    const v = Math.min(1, e._v / 1.5), ph = e._ph;
    const sw = Math.sin(ph) * 0.17 * v;
    const bob = Math.abs(Math.cos(ph)) * 0.035 * v + Math.sin(time / 560 + e._seed) * 0.007 * (1 - v);
    const hipY = 0.44 + bob;
    const outline = 'rgba(8,12,24,.55)';
    const sc = proj(x, 0, z, AA).s;
    // shadow
    const rs = 0.3 * sc;
    c.fillStyle = 'rgba(0,0,0,.14)'; ellipse(c, AA.x, AA.y, rs * 1.3, rs * 1.3 * SIN); c.fill();
    c.fillStyle = 'rgba(0,0,0,.24)'; ellipse(c, AA.x, AA.y, rs * 0.85, rs * 0.85 * SIN); c.fill();
    const lw = 0.118 * sc, tw = 0.31 * sc, aw = 0.1 * sc;

    // legs (far one first)
    const dA = lz * 0.075 + hz * sw, dB = -lz * 0.075 - hz * sw;
    for (let pass = 0; pass < 2; pass++) {
      const first = dA < dB;
      const sgn = (pass === 0) === first ? 1 : -1;
      const sg = sgn * sw;
      const lift = (sgn * Math.cos(ph) > 0 ? sgn * Math.cos(ph) * 0.07 : 0) * v;
      proj(x + lx * 0.075 * sgn, hipY, z + lz * 0.075 * sgn, BBp);
      proj(x + lx * 0.075 * sgn + hx * sg, lift + 0.03, z + lz * 0.075 * sgn + hz * sg, CC);
      limb(c, BBp, CC, lw, o.pants, outline);
      proj(x + lx * 0.075 * sgn + hx * (sg + 0.075), lift + 0.03, z + lz * 0.075 * sgn + hz * (sg + 0.075), DD);
      limb(c, CC, DD, lw * 0.95, '#0f172a', outline);
    }

    // arms: far, torso, near
    const reach = e.state === 'browsing';
    const armDepth = lz;
    for (let pass = 0; pass < 3; pass++) {
      if (pass === 1) {
        proj(x + hx * 0.045 * v, hipY + 0.02, z + hz * 0.045 * v, BBp);
        proj(x + hx * 0.06 * v, 0.8 + bob, z + hz * 0.06 * v, CC);
        limb(c, BBp, CC, tw, o.shirt, outline);
        c.save(); c.globalAlpha = 0.5;
        BBp.x -= tw * 0.2; CC.x -= tw * 0.2;
        limb(c, BBp, CC, tw * 0.3, shade(o.shirt, 0.35), 'rgba(0,0,0,0)');
        c.restore();
        if (o.vest) {
          proj(x + hx * 0.05 * v, hipY + 0.2, z + hz * 0.05 * v, DD);
          proj(x + hx * 0.05 * v, hipY + 0.2, z + hz * 0.05 * v, DD);
          c.strokeStyle = 'rgba(250,250,210,.85)'; c.lineWidth = Math.max(1.5, 0.03 * sc); c.lineCap = 'butt';
          proj(x + lx * 0.16, hipY + 0.2, z + lz * 0.16 + hz * 0.05 * v, EE);
          proj(x - lx * 0.16, hipY + 0.2, z - lz * 0.16 + hz * 0.05 * v, FF);
          c.beginPath(); c.moveTo(EE.x, EE.y); c.lineTo(FF.x, FF.y); c.stroke();
        }
        continue;
      }
      const sgn = (pass === 0) === (armDepth >= 0) ? -1 : 1; // pass0: far side, pass2: near side
      let fwd = -sgn * sw * 0.95, hy = 0.5 + bob;
      if (reach && sgn === 1) { fwd = 0.25 + Math.sin(time / 260 + e._seed) * 0.05; hy = 0.72 + Math.sin(time / 260 + e._seed) * 0.03; }
      if (o.box) { fwd = 0.2; hy = 0.6 + bob; }
      proj(x + lx * 0.18 * sgn, 0.76 + bob, z + lz * 0.18 * sgn, BBp);
      proj(x + lx * (o.box ? 0.1 : 0.2) * sgn + hx * fwd, hy, z + lz * (o.box ? 0.1 : 0.2) * sgn + hz * fwd, CC);
      limb(c, BBp, CC, aw, o.shirt, outline);
      c.fillStyle = o.skin; ellipse(c, CC.x, CC.y, aw * 0.62, aw * 0.62); c.fill();
      if (o.bag && sgn === 1) {
        const bw = 0.2 * sc, bh = 0.24 * sc;
        c.fillStyle = '#fbbf24'; rrect(c, CC.x - bw / 2, CC.y + 0.02 * sc, bw, bh, bw * 0.15); c.fill();
        c.strokeStyle = '#b45309'; c.lineWidth = Math.max(1, DPR); c.stroke();
        c.beginPath(); c.arc(CC.x, CC.y + 0.02 * sc, bw * 0.28, Math.PI, 0); c.stroke();
        c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(CC.x - bw * 0.35, CC.y + 0.06 * sc, bw * 0.18, bh * 0.6);
      }
    }
    if (o.box) {
      proj(x + hx * 0.24, 0.62 + bob, z + hz * 0.24, CC);
      const bw = 0.3 * sc;
      c.fillStyle = '#c28b45'; rrect(c, CC.x - bw / 2, CC.y - bw * 0.4, bw, bw * 0.8, bw * 0.1); c.fill();
      c.strokeStyle = '#7a5223'; c.lineWidth = Math.max(1, DPR); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(CC.x - bw * 0.05, CC.y - bw * 0.4, bw * 0.1, bw * 0.8);
    }

    // head
    const headY = 0.93 + bob;
    proj(x + hx * 0.012, headY, z + hz * 0.012, EE);
    const hr = 0.152 * EE.s;
    // neck
    proj(x, 0.82 + bob, z, FF);
    c.fillStyle = shade(o.skin, -0.12); c.fillRect(FF.x - hr * 0.3, FF.y - hr * 0.5, hr * 0.6, hr * 0.7);
    const away = hz < -0.35;
    c.fillStyle = away ? o.hair : o.skin;
    ellipse(c, EE.x, EE.y, hr, hr * 1.04); c.fill();
    c.strokeStyle = outline; c.lineWidth = Math.max(1.2, 1.4 * DPR); c.stroke();
    if (!away) {
      // hair cap / fringe
      c.fillStyle = o.hat || o.hair;
      c.beginPath(); c.ellipse(EE.x, EE.y - hr * 0.1, hr * 1.04, hr * 1.0, 0, Math.PI * 1.02, TAU * 1.0 - 0.02); c.closePath(); c.fill();
      if (hz > 0.3) { c.beginPath(); c.ellipse(EE.x, EE.y - hr * 0.42, hr * 0.98, hr * 0.32, 0, 0, Math.PI); c.fill(); }
      if (o.hat) { c.fillStyle = shade(o.hat, -0.2); c.fillRect(EE.x - hr * 1.15, EE.y - hr * 0.35, hr * 2.3, hr * 0.14); }
      if (hz > 0.02) {
        const eyeY = headY + 0.01;
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          proj(x + hx * 0.14 + lx * 0.058 * sgn, eyeY, z + hz * 0.14 + lz * 0.058 * sgn, FF);
          c.fillStyle = '#ffffff'; ellipse(c, FF.x, FF.y, hr * 0.2, hr * 0.24); c.fill();
          c.fillStyle = '#0f172a'; ellipse(c, FF.x + hx * hr * 0.05, FF.y, hr * 0.11, hr * 0.15); c.fill();
        }
        if (hz > 0.45) {
          proj(x + hx * 0.145, headY - 0.06, z + hz * 0.145, FF);
          c.strokeStyle = 'rgba(120,40,40,.8)'; c.lineWidth = Math.max(1, DPR); c.beginPath(); c.arc(FF.x, FF.y - hr * 0.08, hr * 0.2, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
        }
      }
    } else if (o.hat) {
      c.fillStyle = o.hat; c.beginPath(); c.ellipse(EE.x, EE.y - hr * 0.1, hr * 1.04, hr * 1.0, 0, Math.PI, TAU); c.fill();
    }
    // cheek light for a rounded look
    c.fillStyle = 'rgba(255,255,255,.18)'; ellipse(c, EE.x - hr * 0.35, EE.y - hr * 0.3, hr * 0.3, hr * 0.22); c.fill();
    return EE.y - hr; // top of head (screen)
  }

  /* --------------------------------- frame --------------------------------- */
  const items = [];
  for (let i = 0; i < 200; i++) items.push({ z: 0, k: 0, r: null, n: 0 });

  function ensure(g, st) {
    const key = [TM.Layout.version, st.theme.floor, st.theme.wall, st.storeName, W, H].join('|');
    if (key === staticKey && staticCv) return;
    staticKey = key;
    setupCamera(g);
    buildStatic(g, st);
  }

  R.resize = function (w, h, dpr) {
    W = Math.max(1, w | 0); H = Math.max(1, h | 0); DPR = dpr || 1;
    staticKey = '';
  };

  R.draw = function (c, time, env) {
    const st = env.st, g = env.g;
    const dt = Math.max(0.001, Math.min(0.1, (time - lastTime) / 1000));
    lastTime = time;
    ensure(g, st);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.drawImage(staticCv, 0, 0);
    c.lineJoin = 'round';
    nHits = 0;

    // gather depth-sorted items
    let n = 0;
    function push(z, k, r) { const it = items[n++]; it.z = z; it.k = k; it.r = r; }
    for (let i = 0; i < st.shelves.length; i++) {
      const slot = g.slotMap[st.shelves[i].slot];
      if (slot) push(slot.y + 1, 1, st.shelves[i]);
    }
    const listed = {};
    for (let i = 0; i < st.phones.bench.length; i++) { const p = st.phones.bench[i]; if (p.listed) listed[p.slot] = p; }
    for (let i = 0; i < g.cases.length; i++) push(2, 2, g.cases[i]);
    push(g.counter.y + 1, 3, null);
    push(g.backroom.y + 1.1, 4, null);
    push(2, 5, null);
    push(g.rows - 0.7, 6, null);
    const cash = env.cashier;
    animate(cash, dt);
    push(cash._ry, 7, cash);
    for (let i = 0; i < env.stockers.length; i++) { const s = env.stockers[i]; animate(s, dt); push(s._ry, 8, s); }
    for (let i = 0; i < env.pool.length; i++) { const p = env.pool[i]; if (!p.active) { p._init = false; continue; } animate(p, dt); push(p._ry, 9, p); }
    for (let i = 1; i < n; i++) {
      const it = items[i];
      let j = i - 1;
      const iz = it.z, ik = it.k, ir = it.r;
      while (j >= 0 && items[j].z > iz) { items[j + 1].z = items[j].z; items[j + 1].k = items[j].k; items[j + 1].r = items[j].r; j--; }
      items[j + 1].z = iz; items[j + 1].k = ik; items[j + 1].r = ir;
    }

    for (let i = 0; i < n; i++) {
      const it = items[i];
      switch (it.k) {
        case 1: drawShelf(c, it.r, g.slotMap[it.r.slot]); break;
        case 2: drawCase(c, it.r.i, it.r, listed[it.r.i] || null); break;
        case 3: drawCounter(c, g, st, env.ready, time); break;
        case 4: drawCrates(c, g); break;
        case 5: drawPlant(c, g); break;
        case 6: drawLedge(c, g, st, time); break;
        case 7: {
          const auto = st.staff.cashier > 0;
          const top = person(c, it.r, { shirt: auto ? '#16a34a' : '#0ea5e9', skin: '#f5d0b0', hair: '#1f2937', pants: '#1e293b' }, time);
          proj(it.r._rx, 0, it.r._ry, A);
          c.font = '800 ' + Math.max(8, 0.19 * A.s) + 'px system-ui, sans-serif';
          c.textAlign = 'center'; c.textBaseline = 'middle';
          const lab = auto ? 'CASHIER' : 'YOU';
          const lw2 = c.measureText(lab).width + 0.14 * A.s;
          c.fillStyle = 'rgba(15,23,42,.8)'; rrect(c, A.x - lw2 / 2, A.y + 0.1 * A.s, lw2, 0.24 * A.s, 0.12 * A.s); c.fill();
          c.fillStyle = '#fff'; c.fillText(lab, A.x, A.y + 0.22 * A.s);
          BB.x0 = A.x - 0.3 * A.s; BB.x1 = A.x + 0.3 * A.s; BB.y0 = top; BB.y1 = A.y + 0.3 * A.s;
          addHit('counter', 1);
          break;
        }
        case 8: {
          const s = it.r;
          person(c, s, { shirt: '#f59e0b', skin: '#e0ac82', hair: '#111827', pants: '#334155', vest: true, hat: '#facc15', box: s.carry > 0 }, time);
          break;
        }
        default: {
          const p = it.r;
          const idx = p.shirt.length > 3 ? p.shirt.charCodeAt(2) % 4 : 0;
          const top = person(c, p, { shirt: p.shirt, skin: p.skin, hair: p.hair, pants: PANTS[idx], bag: p.cart.items.length > 0 || !!p.cart.phone }, time);
          if (p.state === 'queueing' || p.state === 'atCounter') {
            const f = p.patience / p.maxPatience;
            proj(p._rx, 0, p._ry, A);
            if (f < 0.55) {
              c.font = Math.max(11, 0.32 * A.s) + 'px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
              c.fillText(f < 0.28 ? '😠' : '😐', A.x, top - 0.16 * A.s);
            }
            if (p.state === 'atCounter') {
              const w = 0.6 * A.s, hh = 0.09 * A.s, bx = A.x - w / 2, by = top - 0.1 * A.s;
              c.fillStyle = 'rgba(15,23,42,.85)'; rrect(c, bx - 1, by - 1, w + 2, hh + 2, hh / 2); c.fill();
              c.fillStyle = '#22c55e'; rrect(c, bx, by, Math.max(hh, w * Math.max(0, Math.min(1, 1 - p.proc / p.procMax))), hh, hh / 2); c.fill();
            }
          } else if (p.state === 'browsing') {
            proj(p._rx, 0, p._ry, A);
            c.font = Math.max(11, 0.3 * A.s) + 'px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText('💭', A.x, top - 0.12 * A.s);
          }
        }
      }
    }

    // floating texts (billboards)
    for (let i = 0; i < env.floaters.length; i++) {
      const f = env.floaters[i];
      if (!f.active) continue;
      proj(f.x, 1.25 + f.t * 0.75, f.y + 0.7 * f.t + 0.9, A);
      c.globalAlpha = Math.max(0, Math.min(1, 1.4 - f.t));
      const fs = Math.max(12, 0.36 * A.s);
      c.font = '800 ' + fs + 'px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = Math.max(3, fs * 0.2); c.strokeStyle = 'rgba(8,12,24,.9)'; c.strokeText(f.text, A.x, A.y);
      c.fillStyle = f.color; c.fillText(f.text, A.x, A.y);
    }
    c.globalAlpha = 1;

    // time-of-day grading + vignette
    const t = st.clock;
    if (t > 0.7) { c.fillStyle = 'rgba(255,120,30,' + (((t - 0.7) / 0.3) * 0.2).toFixed(3) + ')'; c.fillRect(0, 0, W, H); }
    else if (t < 0.08) { c.fillStyle = 'rgba(80,120,255,' + ((0.08 - t) * 1.2).toFixed(3) + ')'; c.fillRect(0, 0, W, H); }
    if (vigCv) c.drawImage(vigCv, 0, 0);
  };
})(typeof window !== 'undefined' ? window : globalThis);
