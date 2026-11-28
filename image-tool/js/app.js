/* 调色台 · 主控：状态、渲染、手势、选区、导出 */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = Color.clamp;
  var isMobile = function () { return window.matchMedia('(max-width:860px)').matches; };

  /* ================= 状态 ================= */
  var S = {
    mode: 'single',
    tool: 'pick',
    add: true,
    brush: 60, hard: 0.7, tol: 16, feather: 2,
    p: { hue: 0, sat: 1, lum: 0, keep: 1, tint: 0, strength: 1, tC: 0, tL: 0, target: null },
    layers: [],
    curLayer: 0,
    layerSeq: 0,
    renaming: -1,
    view: { z: 1, px: 0, py: 0 },
    compare: false,
    showMask: false,
    flashUntil: 0,
    autoAll: false,
    eyeDrop: false,
    busy: false,
    full: null,
    single: null,
    h: { ref: null, targets: [], cur: 0, method: 'standard', strength: 1, stage: null },
    exp: { fmt: 'image/png', scale: 1, q: 0.92 },
    lassoPts: [],
    draw: null,
    drawing: false,
    panStart: null,
    hist: [], future: [],
    pendingSlot: 'tgt'
  };

  var cv, ctx, stage, loupe, loupeCtx;
  var ptrs = new Map();
  var pinch = null;
  var rafId = 0;

  /* ================= 小工具 ================= */
  function toast(msg, ms) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.classList.remove('is-on'); }, ms || 2400);
  }

  function setBusy(on, text) {
    S.busy = on;
    if (text) $('#busyText').textContent = text;
    $('#busy').classList.toggle('is-on', on);
  }

  function fitCanvas(src, maxLong) {
    var w = src.width || src.naturalWidth;
    var h = src.height || src.naturalHeight;
    var k = 1;
    if (Math.max(w, h) > maxLong) k = maxLong / Math.max(w, h);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function newImageData(w, h) {
    try { return new ImageData(w, h); }
    catch (e) {
      var c = document.createElement('canvas');
      c.width = w; c.height = h;
      return c.getContext('2d').createImageData(w, h);
    }
  }

  function makeBundle(srcCanvas, maxLong) {
    var wc = fitCanvas(srcCanvas, maxLong);
    var w = wc.width, h = wc.height;
    var base = wc.getContext('2d').getImageData(0, 0, w, h);
    var lab = Color.imageToLab(base.data, w * h);

    var off = document.createElement('canvas'); off.width = w; off.height = h;
    var offCtx = off.getContext('2d');
    offCtx.putImageData(base, 0, 0);

    var baseCv = document.createElement('canvas'); baseCv.width = w; baseCv.height = h;
    baseCv.getContext('2d').putImageData(base, 0, 0);

    var overlay = document.createElement('canvas'); overlay.width = w; overlay.height = h;

    return {
      work: { w: w, h: h, base: base, lab: lab, out: newImageData(w, h) },
      off: off, offCtx: offCtx, baseCv: baseCv,
      overlay: overlay, overlayCtx: overlay.getContext('2d'),
      overlayImg: newImageData(w, h),
      mask: Mask.create(w, h), maskHas: false, maskCount: 0
    };
  }

  function active() { return S.mode === 'single' ? S.single : S.h.stage; }

  /* ================= 渲染 ================= */
  function requestRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(function () { rafId = 0; render(); });
  }

  function viewT() {
    var B = active();
    var cw = stage.clientWidth, ch = stage.clientHeight;
    var fit = 1;
    if (B) {
      fit = Math.min((cw - 40) / B.work.w, (ch - 40) / B.work.h);
      if (!isFinite(fit) || fit <= 0) fit = 1;
      fit = Math.min(fit, 1);
    }
    return { cw: cw, ch: ch, fit: fit, z: fit * S.view.z };
  }

  function render() {
    var B = active();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cw = stage.clientWidth, ch = stage.clientHeight;
    if (!cw || !ch) return;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr);
      cv.height = Math.round(ch * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    if (!B) { $('#zoomVal').textContent = ''; return; }

    var t = viewT();
    var w = B.work.w, h = B.work.h;
    ctx.save();
    ctx.translate(t.cw / 2 + S.view.px, t.ch / 2 + S.view.py);
    ctx.scale(t.z, t.z);
    ctx.imageSmoothingEnabled = t.z < 1;
    ctx.imageSmoothingQuality = 'high';

    ctx.fillStyle = '#fff';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.drawImage(S.compare ? B.baseCv : B.off, -w / 2, -h / 2);

    if (!S.compare && S.mode === 'single' && (S.showMask || performance.now() < S.flashUntil)) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(B.overlay, -w / 2, -h / 2);
      ctx.globalAlpha = 1;
    }

    if (S.lassoPts.length > 1) {
      ctx.strokeStyle = '#2f6bf6';
      ctx.lineWidth = 1.5 / t.z;
      ctx.setLineDash([5 / t.z, 4 / t.z]);
      ctx.beginPath();
      ctx.moveTo(S.lassoPts[0].x - w / 2, S.lassoPts[0].y - h / 2);
      for (var i = 1; i < S.lassoPts.length; i++) {
        ctx.lineTo(S.lassoPts[i].x - w / 2, S.lassoPts[i].y - h / 2);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (S.draw && (S.tool === 'brush' || S.tool === 'erase') && S.mode === 'single') {
      ctx.beginPath();
      ctx.arc(S.draw.x - w / 2, S.draw.y - h / 2, Math.max(1, S.brush / 2), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      ctx.lineWidth = 2.4 / t.z;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(23,27,33,.75)';
      ctx.lineWidth = 1 / t.z;
      ctx.stroke();
    }
    ctx.restore();

    $('#zoomVal').textContent = Math.round(t.z * 100) + '%';
  }

  function screenToImage(sx, sy) {
    var B = active(), t = viewT();
    return {
      x: (sx - t.cw / 2 - S.view.px) / t.z + B.work.w / 2,
      y: (sy - t.ch / 2 - S.view.py) / t.z + B.work.h / 2
    };
  }

  function setZoomAt(nz, sx, sy) {
    var B = active();
    if (!B) return;
    nz = clamp(nz, 0.2, 24);
    var t = viewT();
    var ix = (sx - t.cw / 2 - S.view.px) / t.z + B.work.w / 2;
    var iy = (sy - t.ch / 2 - S.view.py) / t.z + B.work.h / 2;
    S.view.z = nz;
    var t2 = viewT();
    S.view.px = sx - t2.cw / 2 - (ix - B.work.w / 2) * t2.z;
    S.view.py = sy - t2.ch / 2 - (iy - B.work.h / 2) * t2.z;
  }

  /* ================= 改色层 ================= */
  function freshP() {
    return { hue: 0, sat: 1, lum: 0, keep: 1, tint: 0, strength: 1, tC: 0, tL: 0, target: null };
  }

  function cloneP(p) {
    var o = {};
    for (var k in p) o[k] = p[k];
    return o;
  }

  /* 一层的选区由三部分决定：手绘底 base + 点选种子 picks + 羽化 feather。
     mask 永远是它们的派生物，所以羽化/容差随时能改，而且反复重算也不会越糊。 */
  var _pickBuf = null;

  function makeLayer(w, h, full) {
    S.layerSeq++;
    var L = {
      id: S.layerSeq,
      name: '层 ' + S.layerSeq,
      base: Mask.create(w, h),
      picks: [],
      tol: S.tol,
      feather: S.feather,
      noFeather: !!full,
      p: freshP(),
      on: true,
      mask: Mask.create(w, h)
    };
    if (full) {
      L.base.fill(255);
      L.mask.fill(255);
    }
    return L;
  }

  function rebuildMask(L) {
    var B = S.single;
    if (!B || !L) return;
    var w = B.work.w, h = B.work.h, n = w * h;
    var m = L.mask;
    m.set(L.base);
    if (L.picks.length && B.work.lab) {
      if (!_pickBuf || _pickBuf.length !== n) _pickBuf = new Uint8Array(n);
      for (var i = 0; i < L.picks.length; i++) {
        var s = L.picks[i];
        Mask.wand(B.work.lab, w, h, s.x, s.y, L.tol, s.c, s.c ? 0.75 : 0.55, _pickBuf);
        Mask.merge(m, _pickBuf, s.add ? 1 : 0);
      }
    }
    if (!L.noFeather && L.feather > 0) Mask.feather(m, w, h, L.feather);
  }

  function rebuildAllMasks() {
    for (var i = 0; i < S.layers.length; i++) rebuildMask(S.layers[i]);
  }

  var rebuildTimer = 0, rebuildLast = 0;
  /* 节流而不是防抖：连续拖滑杆时每 110ms 重算一次，拖动过程中就能看到变化 */
  function scheduleRebuild() {
    if (rebuildTimer) return;
    var gap = Math.max(0, 110 - (Date.now() - rebuildLast));
    rebuildTimer = setTimeout(function () {
      rebuildTimer = 0;
      rebuildLast = Date.now();
      var L = S.layers[S.curLayer];
      if (!L) return;
      rebuildMask(L);
      rebuildOverlay();
      refreshMask();
      renderLayers();
      applyFull();
    }, gap);
  }

  var toastAt = {};
  function toastOnce(key, msg) {
    var now = Date.now();
    if (toastAt[key] && now - toastAt[key] < 4000) return;
    toastAt[key] = now;
    toast(msg, 3200);
  }

  function layerDirty(L) {
    var p = L.p;
    return !!(p.hue || p.sat !== 1 || p.lum || p.tint > 0.001 || p.strength < 0.999);
  }

  /* 把 S.p / bundle.mask 指向当前层，其余代码不必关心层的存在 */
  function bindLayer() {
    var L = S.layers[S.curLayer];
    if (!L) return;
    S.p = L.p;
    if (S.single) S.single.mask = L.mask;
  }

  function layerPct(L) {
    var B = S.single;
    if (!B) return 0;
    return Mask.count(L.mask) / (B.work.w * B.work.h) * 100;
  }

  var layerIcons = {
    eye: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".45"/><path d="M4 20L20 4" stroke="currentColor" stroke-width="1.6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  };

  function renderLayers() {
    var box = $('#layers');
    if (!box) return;
    box.innerHTML = '';
    S.layers.forEach(function (L, i) {
      var d = document.createElement('div');
      d.className = 'layer' + (i === S.curLayer ? ' is-on' : '') + (L.on === false ? ' is-off' : '');

      var dot = document.createElement('span');
      dot.className = 'layer-dot';
      d.appendChild(dot);

      var nm = document.createElement('span');
      nm.className = 'layer-name';
      nm.textContent = L.name;
      d.appendChild(nm);

      var pct = document.createElement('span');
      pct.className = 'layer-pct';
      var v = layerPct(L);
      pct.textContent = v > 99.5 ? '全图' : v.toFixed(0) + '%';
      d.appendChild(pct);

      var eye = document.createElement('button');
      eye.className = 'layer-btn';
      eye.title = L.on === false ? '启用这一层' : '暂时关掉这一层';
      eye.innerHTML = L.on === false ? layerIcons.eyeOff : layerIcons.eye;
      eye.onclick = function (e) {
        e.stopPropagation();
        pushHistory();
        L.on = L.on === false;
        renderLayers();
        applyFull();
      };
      d.appendChild(eye);

      var del = document.createElement('button');
      del.className = 'layer-btn';
      del.title = '删除这一层';
      del.innerHTML = layerIcons.trash;
      del.onclick = function (e) {
        e.stopPropagation();
        removeLayer(i);
      };
      d.appendChild(del);

      d.onclick = function () { setLayer(i); };
      d.ondblclick = function (e) {
        e.stopPropagation();
        renameLayer(i);
      };
      box.appendChild(d);
    });
    $('#layerHint').textContent = !S.layers.length
      ? '载入图片后这里会出现第一层'
      : S.layers.length > 1
        ? '当前在「' + (S.layers[S.curLayer] ? S.layers[S.curLayer].name : '') + '」，改色只作用于这一层'
        : '点选只选一块区域；要改第二处不同颜色，先「＋ 新建」一层';
    paintLayerDots();
  }

  /* 色点跟着色相走，拖动滑块时只改 style，不重建 DOM */
  function paintLayerDots() {
    var box = $('#layers');
    if (!box) return;
    var nodes = box.children;
    for (var i = 0; i < nodes.length && i < S.layers.length; i++) {
      var L = S.layers[i], dot = nodes[i].querySelector('.layer-dot');
      if (!dot) continue;
      var idle = !L.p.target && !layerDirty(L);
      dot.classList.toggle('is-idle', idle);
      dot.style.background = L.p.target
        ? Color.rgb2hex(L.p.target[0], L.p.target[1], L.p.target[2])
        : idle ? '' : 'hsl(' + (((L.p.hue % 360) + 360) % 360) + ',70%,55%)';
    }
  }

  var dotsRaf = 0;
  function scheduleLayerDots() {
    if (dotsRaf) return;
    dotsRaf = requestAnimationFrame(function () { dotsRaf = 0; paintLayerDots(); });
  }

  function setLayer(i) {
    if (!S.single || i < 0 || i >= S.layers.length || i === S.curLayer) return;
    S.curLayer = i;
    bindLayer();
    rebuildOverlay(); refreshMask(); renderLayers();
    syncColorUI();
    applyFull();
  }

  function addLayer(quiet) {
    var B = S.single;
    if (!B) return;
    if (S.layers.length >= 8) { toast('最多 8 层，够用了吧'); return; }
    pushHistory();
    var L = makeLayer(B.work.w, B.work.h, false);
    S.layers.push(L);
    S.curLayer = S.layers.length - 1;
    bindLayer();
    rebuildOverlay(); refreshMask(); renderLayers();
    syncColorUI();
    applyFull();
    if (!quiet) toast('已新建「' + L.name + '」，现在点选这一层要改的区域');
  }

  function removeLayer(i) {
    if (S.layers.length <= 1) { toast('至少要留一层'); return; }
    pushHistory();
    var name = S.layers[i].name;
    S.layers.splice(i, 1);
    if (S.curLayer >= S.layers.length) S.curLayer = S.layers.length - 1;
    else if (S.curLayer > i) S.curLayer--;
    bindLayer();
    rebuildOverlay(); refreshMask(); renderLayers();
    syncColorUI();
    applyFull();
    toast('已删除「' + name + '」');
  }

  function renameLayer(i) {
    var L = S.layers[i];
    if (!L) return;
    var v = window.prompt('给这一层起个名字', L.name);
    if (v === null) return;
    v = v.trim().slice(0, 10);
    if (!v) return;
    L.name = v;
    renderLayers();
  }

  /* ================= 选区状态 ================= */
  function maxHistory() {
    /* 每步快照要拷一份当前所有层的 mask，层数越多留的步数越少 */
    var n = Math.max(1, S.layers.length);
    return Math.max(3, Math.min(20, Math.round(36 / n)));
  }

  function pushHistory() {
    if (!S.single || S.mode !== 'single' || !S.layers.length) return;
    S.hist.push(takeSnapshot());
    while (S.hist.length > maxHistory()) S.hist.shift();
    S.future.length = 0;
    syncUndo();
  }

  function snapLayer(L) {
    return {
      id: L.id, name: L.name,
      base: new Uint8Array(L.base),
      picks: L.picks.map(function (s) { return { x: s.x, y: s.y, c: s.c, add: s.add }; }),
      tol: L.tol, feather: L.feather, noFeather: L.noFeather,
      p: cloneP(L.p), on: L.on
    };
  }

  function reviveLayer(s, w, h) {
    return {
      id: s.id, name: s.name,
      base: new Uint8Array(s.base),
      picks: s.picks.map(function (q) { return { x: q.x, y: q.y, c: q.c, add: q.add }; }),
      tol: s.tol, feather: s.feather, noFeather: s.noFeather,
      p: cloneP(s.p), on: s.on,
      mask: Mask.create(w, h)
    };
  }

  function restoreSnapshot(s) {
    var B = S.single;
    S.layers = s.layers.map(function (L) { return reviveLayer(L, B.work.w, B.work.h); });
    S.curLayer = Math.min(s.cur, S.layers.length - 1);
    bindLayer();
    rebuildAllMasks();
    renderLayers();
    syncColorUI();
    syncUndo(); rebuildOverlay(); refreshMask(); applyFull();
  }

  function takeSnapshot() {
    return {
      layers: S.layers.map(snapLayer),
      cur: S.curLayer
    };
  }

  function syncUndo() {
    $('[data-act="undo"]').style.opacity = S.hist.length ? 1 : .32;
    $('[data-act="redo"]').style.opacity = S.future.length ? 1 : .32;
  }

  function undo() {
    if (!S.hist.length) return;
    S.future.push(takeSnapshot());
    restoreSnapshot(S.hist.pop());
  }

  function redo() {
    if (!S.future.length) return;
    S.hist.push(takeSnapshot());
    restoreSnapshot(S.future.pop());
  }

  function rebuildOverlay() {
    var B = active();
    if (!B) return;
    var m = B.mask, od = B.overlayImg.data;
    for (var i = 0, p = 0; i < m.length; i++, p += 4) {
      var v = m[i];
      if (v) { od[p] = 255; od[p + 1] = 64; od[p + 2] = 54; od[p + 3] = v * 0.45; }
      else if (od[p + 3]) od[p + 3] = 0;
    }
    B.overlayCtx.putImageData(B.overlayImg, 0, 0);
  }

  function rebuildOverlayRect(x0, y0, x1, y1) {
    var B = active();
    var w = B.work.w, h = B.work.h, m = B.mask, od = B.overlayImg.data;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(w - 1, Math.ceil(x1)); y1 = Math.min(h - 1, Math.ceil(y1));
    if (x1 < x0 || y1 < y0) return;
    for (var y = y0; y <= y1; y++) {
      var row = y * w;
      for (var x = x0; x <= x1; x++) {
        var i = row + x, p = i * 4, v = m[i];
        if (v) { od[p] = 255; od[p + 1] = 64; od[p + 2] = 54; od[p + 3] = v * 0.45; }
        else od[p + 3] = 0;
      }
    }
    B.overlayCtx.putImageData(B.overlayImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  function refreshMask() {
    var B = active();
    if (!B) return;
    B.maskCount = Mask.count(B.mask);
    B.maskHas = B.maskCount > 0;
    if (S.mode !== 'single') return;
    S.autoAll = B.maskCount === B.work.w * B.work.h;
    var hint = $('#maskHint');
    if (!B.maskHas) {
      hint.textContent = '这一层还是空的，调色不会生效。用「点选」点一下图片上的颜色试试。';
      hint.classList.add('warn');
    } else if (S.autoAll) {
      hint.textContent = '这一层是全图，点一下图片就能缩到局部';
      hint.classList.remove('warn');
    } else {
      hint.textContent = '这一层选中 ' + (B.maskCount / (B.work.w * B.work.h) * 100).toFixed(1) + '% 的画面';
      hint.classList.remove('warn');
    }
  }

  function autoAllOff() {
    if (!S.autoAll) return;
    var L = S.layers[S.curLayer];
    if (L) { L.base.fill(0); L.picks = []; L.noFeather = false; }
    S.autoAll = false;
  }

  /* ================= 改色执行 ================= */
  function applyRecolor(rect) {
    var B = active();
    if (!B) return;
    Adjust.recolorLayers(B.work, S.layers, B.work.out, rect);
    if (rect) {
      var w = B.work.w, h = B.work.h;
      var x0 = Math.max(0, Math.floor(rect[0])), y0 = Math.max(0, Math.floor(rect[1]));
      var x1 = Math.min(w - 1, Math.ceil(rect[2])), y1 = Math.min(h - 1, Math.ceil(rect[3]));
      if (x1 >= x0 && y1 >= y0) {
        B.offCtx.putImageData(B.work.out, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
      }
    } else {
      B.offCtx.putImageData(B.work.out, 0, 0);
    }
    requestRender();
  }

  function applyFull() {
    var B = S.single;
    if (S.mode !== 'single' || !B) return;
    Adjust.recolorLayers(B.work, S.layers, B.work.out, null);
    B.offCtx.putImageData(B.work.out, 0, 0);
    scheduleLayerDots();
    requestRender();
  }

  /* ================= 手势 ================= */
  function localPt(e) {
    var r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e) {
    var B = active();
    if (!B || S.busy) return;
    ptrs.set(e.pointerId, localPt(e));
    try { cv.setPointerCapture(e.pointerId); } catch (err) { }

    if (ptrs.size === 2) { startPinch(); return; }
    if (ptrs.size > 2) return;

    var pt = localPt(e);
    var ip = screenToImage(pt.x, pt.y);

    if (S.mode === 'harmonize' || S.tool === 'pan' || e.button === 1) {
      cv.classList.add('grabbing');
      S.panStart = { x: pt.x, y: pt.y, px: S.view.px, py: S.view.py };
      return;
    }

    if (S.eyeDrop) { sampleTargetColor(ip); return; }

    if (S.tool !== 'brush' && S.tool !== 'erase') S.draw = null;

    if (S.tool === 'brush' || S.tool === 'erase') {
      pushHistory();
      autoAllOff();
      S.drawing = true;
      S.draw = { x: ip.x, y: ip.y, last: ip, add: S.tool === 'brush' ? S.add : false, dirty: null };
      paintTo(ip);
      if (e.pointerType === 'touch') showLoupe(pt, ip);
    } else if (S.tool === 'lasso') {
      S.lassoPts = [ip];
      requestRender();
    } else if (S.tool === 'wand') {
      doWand(ip, true);
    } else if (S.tool === 'pick') {
      doWand(ip, false);
    }
  }

  function onMove(e) {
    var B = active();
    if (!B) return;
    var pt = localPt(e);
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, pt);

    if (pinch && ptrs.size >= 2) {
      var a = [];
      ptrs.forEach(function (v) { a.push(v); });
      var cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2;
      var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      S.view.z = clamp(pinch.z * (d / (pinch.d || 1)), 0.2, 24);
      var t = viewT();
      S.view.px = cx - t.cw / 2 - (pinch.ix - B.work.w / 2) * t.z;
      S.view.py = cy - t.ch / 2 - (pinch.iy - B.work.h / 2) * t.z;
      requestRender();
      return;
    }

    if (S.panStart) {
      S.view.px = S.panStart.px + (pt.x - S.panStart.x);
      S.view.py = S.panStart.py + (pt.y - S.panStart.y);
      requestRender();
      return;
    }

    var ip = screenToImage(pt.x, pt.y);

    if (S.tool === 'brush' || S.tool === 'erase') {
      if (S.drawing) {
        S.draw.x = ip.x; S.draw.y = ip.y;
        paintTo(ip);
        if (e.pointerType === 'touch') showLoupe(pt, ip);
      } else {
        S.draw = { x: ip.x, y: ip.y };
      }
      requestRender();
    } else if (S.tool === 'lasso' && S.lassoPts.length) {
      S.lassoPts.push(ip);
      requestRender();
    } else {
      S.draw = { x: ip.x, y: ip.y };
      requestRender();
    }
  }

  function onUp(e) {
    ptrs.delete(e.pointerId);
    cv.classList.remove('grabbing');
    hideLoupe();

    if (pinch && ptrs.size < 2) pinch = null;
    if (S.panStart) { if (ptrs.size === 0) S.panStart = null; return; }

    if (S.tool === 'lasso' && S.lassoPts.length > 2) {
      var B = active(), L = S.layers[S.curLayer];
      pushHistory();
      autoAllOff();
      var tmp = Mask.lasso(B.work.w, B.work.h, S.lassoPts);
      Mask.merge(L.base, tmp, S.add ? 1 : 0);
      L.noFeather = false;
      S.lassoPts = [];
      finishSelection();
      return;
    }
    S.lassoPts = [];

    if (S.drawing) {
      S.drawing = false;
      S.draw = null;
      finishSelection();
    }
  }

  function startPinch() {
    if (S.drawing) { S.drawing = false; S.draw = null; refreshMask(); applyFull(); }
    var a = [];
    ptrs.forEach(function (v) { a.push(v); });
    var cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2;
    var B = active(), t = viewT();
    pinch = {
      d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y),
      z: S.view.z,
      ix: (cx - t.cw / 2 - S.view.px) / t.z + B.work.w / 2,
      iy: (cy - t.ch / 2 - S.view.py) / t.z + B.work.h / 2
    };
    S.panStart = null;
  }

  /* ================= 笔刷 ================= */
  /* 笔刷画在 base 上；拖动期间把改动直接映到 mask，羽化留到抬手统一做一次，
     否则每涂一笔都会再糊一遍，越涂边缘越软 */
  function paintTo(ip) {
    var B = active();
    var L = S.layers[S.curLayer];
    if (!S.draw || !L) return;
    var r = Math.max(2, S.brush / 2);
    var last = S.draw.last || ip;
    Mask.brush(L.base, B.work.w, B.work.h, last.x, last.y, ip.x, ip.y, r, S.hard, S.draw.add);
    S.draw.last = ip;

    var x0 = Math.min(last.x, ip.x) - r - 2, x1 = Math.max(last.x, ip.x) + r + 2;
    var y0 = Math.min(last.y, ip.y) - r - 2, y1 = Math.max(last.y, ip.y) + r + 2;
    var d = S.draw.dirty;
    if (d) {
      d[0] = Math.min(d[0], x0); d[1] = Math.min(d[1], y0);
      d[2] = Math.max(d[2], x1); d[3] = Math.max(d[3], y1);
    } else {
      S.draw.dirty = [x0, y0, x1, y1];
    }
    if (S.draw.add) B.maskHas = true;
    syncMaskRect(L, x0, y0, x1, y1);
    rebuildOverlayRect(x0, y0, x1, y1);
    applyRecolor([x0, y0, x1, y1]);
  }

  function syncMaskRect(L, x0, y0, x1, y1) {
    var B = active();
    var w = B.work.w, h = B.work.h;
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(w - 1, Math.ceil(x1)); y1 = Math.min(h - 1, Math.ceil(y1));
    if (x1 < x0 || y1 < y0) return;
    var src = L.base, dst = L.mask;
    for (var y = y0; y <= y1; y++) {
      var row = y * w;
      for (var x = x0; x <= x1; x++) dst[row + x] = src[row + x];
    }
  }

  /* 一次性选区收尾：从 base + picks 重建 mask（含羽化）+ 全量重算 */
  function finishSelection() {
    var B = active();
    var L = S.layers[S.curLayer];
    if (!B || !L) return;
    rebuildMask(L);
    rebuildOverlay();
    refreshMask();
    renderLayers();
    S.flashUntil = performance.now() + 900;
    applyFull();
    setTimeout(requestRender, 950);
  }

  /* ================= 选区操作 ================= */
  function doWand(ip, contiguous) {
    var B = active();
    var L = S.layers[S.curLayer];
    if (!B || !L) return;
    var x = Math.round(ip.x), y = Math.round(ip.y);
    if (x < 0 || y < 0 || x >= B.work.w || y >= B.work.h) return;
    pushHistory();
    autoAllOff();
    L.noFeather = false;
    L.tol = S.tol;
    L.picks.push({ x: x, y: y, c: !!contiguous, add: !!S.add });
    finishSelection();
  }

  function selectAll() {
    var B = active(), L = S.layers[S.curLayer];
    if (!B || !L) return;
    pushHistory();
    L.base.fill(255); L.picks = []; L.noFeather = true;
    S.autoAll = true;
    rebuildMask(L);
    rebuildOverlay(); refreshMask(); renderLayers(); applyFull();
  }

  function clearMask() {
    var B = active(), L = S.layers[S.curLayer];
    if (!B || !L) return;
    pushHistory();
    L.base.fill(0); L.picks = []; L.noFeather = false;
    S.autoAll = false;
    rebuildMask(L);
    rebuildOverlay(); refreshMask(); renderLayers(); applyFull();
  }

  function invertMask() {
    var B = active(), L = S.layers[S.curLayer];
    if (!B || !L) return;
    pushHistory();
    rebuildMask(L);
    Mask.invert(L.mask);
    L.base.set(L.mask);
    L.picks = [];
    L.noFeather = true;
    S.autoAll = false;
    rebuildOverlay(); refreshMask(); renderLayers(); applyFull();
  }

  /* ================= 目标色 ================= */
  function applyTargetColor(rgb) {
    var B = S.single;
    if (!B) return;
    var lab = Color.rgb2lab(rgb[0], rgb[1], rgb[2]);
    var tL = lab[0];
    var tC = Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]);
    var tH = Math.atan2(lab[2], lab[1]);
    var reg = Adjust.sampleRegion(B.work, B.maskHas ? B.mask : null);

    var dH = (tH - reg.H) * 180 / Math.PI;
    dH = ((dH + 540) % 360) - 180;
    var sat = reg.C > 2.5 ? clamp(tC / reg.C, 0.5, 2.5) : 1;

    S.p.hue = Math.round(dH);
    S.p.sat = Math.round(sat * 100) / 100;
    S.p.tC = tC;
    S.p.tL = tL;
    S.p.tint = reg.C < 11 ? 0.62 : 0.18;
    S.p.target = rgb;
    syncColorUI();
    applyFull();
  }

  function sampleTargetColor(ip) {
    var B = S.single;
    S.eyeDrop = false;
    $('#btnTarget').classList.remove('is-on');
    if (!B) return;
    var x = Math.round(ip.x), y = Math.round(ip.y);
    if (x < 0 || y < 0 || x >= B.work.w || y >= B.work.h) return;
    var p = (y * B.work.w + x) * 4, d = B.work.base.data;
    applyTargetColor([d[p], d[p + 1], d[p + 2]]);
    toast('已按取到的颜色匹配色相，可继续微调');
  }

  function syncColorUI() {
    $('#rHue').value = S.p.hue;
    $('#rSat').value = Math.round(S.p.sat * 100);
    $('#rLum').value = S.p.lum;
    $('#rKeep').value = Math.round(S.p.keep * 100);
    $('#rTint').value = Math.round(S.p.tint * 100);
    $('#rStrength').value = Math.round(S.p.strength * 100);
    $('#oHue').textContent = S.p.hue + '°';
    $('#oSat').textContent = Math.round(S.p.sat * 100) + '%';
    $('#oLum').textContent = S.p.lum;
    $('#oKeep').textContent = Math.round(S.p.keep * 100) + '%';
    $('#oTint').textContent = Math.round(S.p.tint * 100) + '%';
    $('#oStrength').textContent = Math.round(S.p.strength * 100) + '%';
    if (S.p.target) {
      var hex = Color.rgb2hex(S.p.target[0], S.p.target[1], S.p.target[2]);
      $('#oTarget').textContent = hex.toUpperCase();
      $('#cTarget').value = hex;
    } else {
      $('#oTarget').textContent = '未设置';
    }
    var L = S.layers[S.curLayer];
    if (L) {
      S.tol = L.tol; S.feather = L.feather;
      $('#rTol').value = L.tol; $('#oTol').textContent = L.tol;
      $('#rFeather').value = L.feather; $('#oFeather').textContent = L.feather + ' px';
    }
  }

  /* ================= 载入 ================= */
  function loadImageFile(file, role) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      URL.revokeObjectURL(url);
      if (role === 'harmonize') addHarmonizeImage(img, file);
      else setSingle(img);
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      toast('这张图片读不出来，换一张试试');
    };
    img.src = url;
  }

  function setSingle(img) {
    setBusy(true, '载入图片');
    setTimeout(function () {
      try {
        S.full = fitCanvas(img, isMobile() ? 2600 : 4200);
        var B0 = makeBundle(img, isMobile() ? 1400 : 1600);
        S.single = B0;
        S.layerSeq = 0;
        var L0 = makeLayer(B0.work.w, B0.work.h, true);
        S.layers = [L0];
        S.curLayer = 0;
        B0.mask = L0.mask;
        B0.maskHas = true;
        S.p = L0.p;
        S.autoAll = true;
        S.hist = []; S.future = [];
        S.view = { z: 1, px: 0, py: 0 };
        renderLayers();
        syncColorUI(); syncUndo(); rebuildOverlay(); refreshMask();
        $('#empty').classList.add('is-off');
        $('#meta').textContent = (img.naturalWidth || img.width) + ' × ' + (img.naturalHeight || img.height) +
          '　工作尺寸 ' + S.single.work.w + ' × ' + S.single.work.h;
        applyFull();
      } catch (e) {
        toast('图片太大，浏览器内存不够，换小一点的试试');
      }
      setBusy(false);
    }, 20);
  }

  function makeDemo() {
    var c = document.createElement('canvas');
    c.width = 1240; c.height = 860;
    var g = c.getContext('2d');
    var bg = g.createLinearGradient(0, 0, 0, 860);
    bg.addColorStop(0, '#cfd7e2'); bg.addColorStop(1, '#8b98ab');
    g.fillStyle = bg; g.fillRect(0, 0, 1240, 860);

    g.fillStyle = '#e9e3d6'; g.fillRect(90, 70, 1060, 250);
    g.fillStyle = '#d9d2c2'; g.fillRect(90, 316, 1060, 8);

    g.beginPath();
    g.moveTo(470, 330); g.lineTo(770, 330); g.lineTo(852, 830); g.lineTo(388, 830);
    g.closePath();
    var sg = g.createLinearGradient(420, 330, 820, 830);
    sg.addColorStop(0, '#d4483c'); sg.addColorStop(0.45, '#c0392b'); sg.addColorStop(1, '#8e2b21');
    g.fillStyle = sg; g.fill();

    g.strokeStyle = 'rgba(0,0,0,.12)'; g.lineWidth = 6;
    for (var i = 0; i < 5; i++) {
      g.beginPath();
      g.moveTo(500 + i * 60, 430);
      g.quadraticCurveTo(512 + i * 62, 620, 472 + i * 66, 820);
      g.stroke();
    }

    g.fillStyle = '#e8b48f';
    g.fillRect(586, 268, 68, 70);
    g.beginPath(); g.arc(620, 200, 88, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#3a2b22';
    g.beginPath(); g.arc(620, 168, 90, Math.PI, Math.PI * 2); g.fill();

    g.fillStyle = '#a8967c'; g.fillRect(0, 700, 1240, 160);
    var cg = g.createLinearGradient(0, 700, 0, 860);
    cg.addColorStop(0, 'rgba(255,255,255,.2)'); cg.addColorStop(1, 'rgba(0,0,0,.2)');
    g.fillStyle = cg; g.fillRect(0, 700, 1240, 160);

    g.fillStyle = '#3f6b8f';
    g.beginPath(); g.ellipse(230, 690, 96, 100, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7fa25a';
    g.beginPath(); g.ellipse(1010, 700, 78, 82, 0, 0, Math.PI * 2); g.fill();

    setSingle(c);
  }

  /* ================= 色调统一 ================= */
  function addHarmonizeImage(img, file) {
    setBusy(true, '分析图片');
    setTimeout(function () {
      try {
        var workMax = isMobile() ? 1200 : 1400;
        var cvv = fitCanvas(img, workMax);
        var data = cvv.getContext('2d').getImageData(0, 0, cvv.width, cvv.height);
        var lab = Color.imageToLab(data.data, cvv.width * cvv.height);
        var item = {
          cv: cvv, file: file || null,
          stats: Adjust.analyze(lab, cvv.width * cvv.height),
          w: cvv.width, h: cvv.height
        };
        if (S.pendingSlot === 'ref' || !S.h.ref) {
          S.h.ref = item;
          if (S.h.targets.length) buildHStage();
        } else {
          S.h.targets.push(item);
          S.h.cur = S.h.targets.length - 1;
          buildHStage();
        }
        renderSlots(); renderFilm();
        $('#empty').classList.toggle('is-off', !!(S.h.ref && S.h.targets.length));
        if (S.h.ref && !S.h.targets.length) toast('参考图已就位，再选一张待处理的图');
      } catch (e) {
        toast('这张图处理失败，换一张试试');
      }
      setBusy(false);
    }, 20);
  }

  function buildHStage() {
    var t = S.h.targets[S.h.cur];
    if (!t) { S.h.stage = null; return; }
    var B = makeBundle(t.cv, isMobile() ? 1400 : 1600);
    if (B.work.w !== t.w || B.work.h !== t.h) {
      t.stats = Adjust.analyze(B.work.lab, B.work.w * B.work.h);
      t.w = B.work.w; t.h = B.work.h;
    }
    S.h.stage = B;
    S.view = { z: 1, px: 0, py: 0 };
    $('#empty').classList.toggle('is-off', !(S.h.ref && S.h.targets.length));
    updateHarmonize();
    $('#meta').textContent = '参考 ' + S.h.ref.w + ' × ' + S.h.ref.h +
      '　待处理 ' + S.h.targets.length + ' 张';
  }

  function updateHarmonize() {
    var B = S.h.stage;
    if (!B || !S.h.ref || !S.h.targets.length) { requestRender(); return; }
    var t = S.h.targets[S.h.cur];
    var model = Adjust.buildModel(S.h.method, t.stats, S.h.ref.stats);
    Adjust.applyModel(B.work, model, S.h.strength, B.work.out);
    B.offCtx.putImageData(B.work.out, 0, 0);
    requestRender();
  }

  function renderSlots() {
    var map = [['#slotRef', S.h.ref], ['#slotTgt', S.h.targets[S.h.cur]]];
    map.forEach(function (pair) {
      var el = $(pair[0]), item = pair[1];
      var c = el.querySelector('canvas');
      if (item) {
        el.classList.add('has');
        c.width = item.w; c.height = item.h;
        c.getContext('2d').drawImage(item.cv, 0, 0, item.w, item.h);
      } else {
        el.classList.remove('has');
      }
    });
    $('#slotRef').classList.toggle('is-active', S.pendingSlot === 'ref');
    $('#slotTgt').classList.toggle('is-active', S.pendingSlot === 'tgt');
  }

  function renderFilm() {
    var film = $('#film');
    film.innerHTML = '';
    if (!S.h.targets.length) {
      var d = document.createElement('div');
      d.className = 'film-empty';
      d.textContent = '还没有待处理的图片';
      film.appendChild(d);
      return;
    }
    S.h.targets.forEach(function (t, i) {
      var d = document.createElement('div');
      d.className = 'film-item' + (i === S.h.cur ? ' is-on' : '');
      var im = document.createElement('img');
      im.src = t.cv.toDataURL('image/jpeg', 0.7);
      d.appendChild(im);
      d.onclick = function () {
        S.h.cur = i;
        renderFilm(); renderSlots(); buildHStage();
      };
      film.appendChild(d);
    });
  }

  /* ================= 导出 ================= */
  function upscaleMask(mask, w, h, fw, fh) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d');
    var img = g.createImageData(w, h);
    for (var i = 0, p = 0; i < mask.length; i++, p += 4) {
      var v = mask[i];
      img.data[p] = v; img.data[p + 1] = v; img.data[p + 2] = v; img.data[p + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    var c2 = document.createElement('canvas'); c2.width = fw; c2.height = fh;
    var g2 = c2.getContext('2d');
    g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high';
    g2.drawImage(c, 0, 0, fw, fh);
    var src = g2.getImageData(0, 0, fw, fh).data;
    var m2 = new Uint8Array(fw * fh);
    for (var k = 0, q = 0; k < m2.length; k++, q += 4) m2[k] = src[q];
    return m2;
  }

  function renderSingleExport(scale) {
    var S1 = S.single;
    /* 导出前把每层的选区按各自的羽化/容差重建一遍，保证和预览一致 */
    rebuildAllMasks();
    var src = S.full || S1.baseCv;
    var ow = Math.max(1, Math.round(src.width * scale));
    var oh = Math.max(1, Math.round(src.height * scale));
    var c = document.createElement('canvas'); c.width = ow; c.height = oh;
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, ow, oh);
    var base = g.getImageData(0, 0, ow, oh);
    var out = newImageData(ow, oh);
    var same = (ow === S1.work.w && oh === S1.work.h);
    var layers = [];
    S.layers.forEach(function (L) {
      if (L.on === false || !layerDirty(L)) return;
      layers.push({
        mask: same ? L.mask : upscaleMask(L.mask, S1.work.w, S1.work.h, ow, oh),
        p: L.p,
        on: true
      });
    });
    Adjust.recolorLayers({ w: ow, h: oh, base: base, lab: null }, layers, out, null);
    g.putImageData(out, 0, 0);
    return c;
  }

  function loadFullCanvas(item) {
    return new Promise(function (res) {
      if (!item.file) { res(item.cv); return; }
      var url = URL.createObjectURL(item.file);
      var img = new Image();
      var done = function (c) { URL.revokeObjectURL(url); res(c); };
      img.onload = function () { done(fitCanvas(img, isMobile() ? 3000 : 4200)); };
      img.onerror = function () { done(item.cv); };
      img.src = url;
    });
  }

  function renderHarmonizeExport(index, scale) {
    var t = S.h.targets[index];
    return loadFullCanvas(t).then(function (src) {
      var ow = Math.max(1, Math.round(src.width * scale));
      var oh = Math.max(1, Math.round(src.height * scale));
      var c = document.createElement('canvas'); c.width = ow; c.height = oh;
      var g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, ow, oh);
      var base = g.getImageData(0, 0, ow, oh);
      var lab = Color.imageToLab(base.data, ow * oh);
      var stats = (ow === t.w && oh === t.h) ? t.stats : Adjust.analyze(lab, ow * oh);
      var model = Adjust.buildModel(S.h.method, stats, S.h.ref.stats);
      var out = newImageData(ow, oh);
      Adjust.applyModel({ w: ow, h: oh, base: base, lab: lab }, model, S.h.strength, out);
      g.putImageData(out, 0, 0);
      return c;
    });
  }

  function canvasToBlob(c, fmt, q) {
    return new Promise(function (res, rej) {
      if (c.toBlob) c.toBlob(function (b) { b ? res(b) : rej(new Error('编码失败')); }, fmt, q);
      else rej(new Error('浏览器不支持'));
    });
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function extOf(fmt) {
    return fmt === 'image/jpeg' ? 'jpg' : fmt === 'image/webp' ? 'webp' : 'png';
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function doExport() {
    if (S.mode === 'single') {
      if (!S.single) return;
      setBusy(true, '正在按原图精度渲染，请稍候');
      setTimeout(function () {
        var c;
        try { c = renderSingleExport(S.exp.scale); }
        catch (e) { setBusy(false); toast('这张图太大，浏览器处理不了，先用「缩小一半」再导出'); return; }
        canvasToBlob(c, S.exp.fmt, S.exp.q).then(function (b) {
          download(b, '调色_' + stamp() + '.' + extOf(S.exp.fmt));
          setBusy(false);
          toast('已导出');
        }).catch(function () {
          setBusy(false);
          toast('导出失败，换一种格式试试');
        });
      }, 30);
    } else {
      exportBatch([S.h.cur]);
    }
  }

  function exportBatch(list) {
    if (!S.h.ref || !S.h.targets.length) { toast('还没有可以导出的图'); return; }
    setBusy(true, '批量导出 0 / ' + list.length);
    var i = 0;
    function step() {
      if (i >= list.length) {
        setBusy(false);
        toast('已导出 ' + list.length + ' 张');
        return;
      }
      $('#busyText').textContent = '批量导出 ' + (i + 1) + ' / ' + list.length;
      setTimeout(function () {
        renderHarmonizeExport(list[i], S.exp.scale).then(function (c) {
          return canvasToBlob(c, S.exp.fmt, S.exp.q).then(function (b) {
            download(b, '统一_' + (list[i] + 1) + '_' + stamp() + '.' + extOf(S.exp.fmt));
          });
        }).catch(function () { }).then(function () { i++; step(); });
      }, 40);
    }
    step();
  }

  /* ================= 界面 ================= */
  function switchMode(m) {
    if (S.mode === m) return;
    S.mode = m;
    $('.app').dataset.mode = m;
    $$('.tab').forEach(function (b) { b.classList.toggle('is-on', b.dataset.tab === m); });
    $$('.group[data-only]').forEach(function (g) { g.hidden = g.dataset.only !== m; });
    $('#toolbar').style.display = m === 'single' ? '' : 'none';
    $('#panel').classList.remove('is-open', 'is-full');
    var has = m === 'single' ? !!S.single : (!!S.h.ref && !!S.h.targets.length);
    $('#empty').classList.toggle('is-off', has);
    if (m === 'harmonize') {
      $('#empty').querySelector('h2').textContent = '选两张图片开始';
      $('#empty').querySelector('p').textContent = '先放参考图，再放要调整的图，工具会把后者的明暗和色调对齐到前者';
      $('#panel').classList.add('is-open');
    } else {
      $('#empty').querySelector('h2').textContent = '把图片拖进来';
      $('#empty').querySelector('p').textContent = '也可以 Ctrl + V 粘贴，或点击下面的按钮选择';
    }
    S.view = { z: 1, px: 0, py: 0 };
    S.compare = false;
    requestRender();
  }

  function setTool(t) {
    S.tool = t;
    S.eyeDrop = false;
    $('#btnTarget').classList.remove('is-on');
    $$('#toolbar [data-tool]').forEach(function (b) { b.classList.toggle('is-on', b.dataset.tool === t); });
    cv.classList.toggle('is-pan', t === 'pan');
    if (t !== 'brush' && t !== 'erase') { hideLoupe(); S.draw = null; }
    render();
  }

  function showLoupe(pt, ip) {
    var B = active();
    if (!B) return;
    loupe.style.display = 'block';
    loupe.style.left = Math.max(2, pt.x - 54) + 'px';
    loupe.style.top = Math.max(2, pt.y - 54 - 96) + 'px';
    var g = loupeCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, 216, 216);
    g.fillStyle = '#fff'; g.fillRect(0, 0, 216, 216);
    var zoom = 3.2, sw = 216 / zoom;
    g.imageSmoothingEnabled = false;
    g.drawImage(B.off, ip.x - sw / 2, ip.y - sw / 2, sw, sw, 0, 0, 216, 216);
    g.strokeStyle = 'rgba(47,107,246,.9)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(108, 86); g.lineTo(108, 130);
    g.moveTo(86, 108); g.lineTo(130, 108);
    g.stroke();
  }

  function hideLoupe() { loupe.style.display = 'none'; }

  function bindRange(id, outId, fmt, onChange) {
    var el = $(id), out = $(outId);
    el.addEventListener('input', function () {
      out.textContent = fmt(el.value);
      onChange(el.value);
    });
  }

  function init() {
    cv = $('#cv');
    ctx = cv.getContext('2d');
    stage = $('#stage');
    loupe = $('#loupe');
    loupeCtx = loupe.getContext('2d');
    loupe.width = 216; loupe.height = 216;

    $$('.tab').forEach(function (b) {
      b.onclick = function () { switchMode(b.dataset.tab); };
    });

    function openPicker(role, multi) {
      S.pendingSlot = role;
      $('#file').multiple = !!multi;
      renderSlots();
      $('#file').click();
    }

    $('#btnOpen').onclick = $('#btnPick').onclick = function () {
      if (S.mode === 'harmonize') openPicker(S.h.ref ? 'tgt' : 'ref', false);
      else { $('#file').multiple = false; $('#file').click(); }
    };
    $('#btnDemo').onclick = makeDemo;
    $('#file').onchange = function (e) {
      var fs = e.target.files;
      if (fs && fs.length) {
        if (S.mode === 'harmonize') {
          for (var i = 0; i < fs.length; i++) {
            S.pendingSlot = (i === 0 && !S.h.ref) ? 'ref' : 'tgt';
            loadImageFile(fs[i], 'harmonize');
          }
        } else {
          loadImageFile(fs[0], 'single');
        }
      }
      e.target.value = '';
    };

    var cmp = $('#btnCompare');
    cmp.addEventListener('pointerdown', function (e) { e.preventDefault(); S.compare = true; render(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      cmp.addEventListener(ev, function () { S.compare = false; render(); });
    });

    $('#btnExport').onclick = function () {
      if (S.mode === 'single' && !S.single) { toast('先打开一张图片'); return; }
      if (S.mode === 'harmonize' && (!S.h.ref || !S.h.targets.length)) { toast('先把两张图选好'); return; }
      $('#modal').classList.add('is-on');
    };

    $$('#toolbar [data-tool]').forEach(function (b) {
      b.onclick = function () { setTool(b.dataset.tool); };
    });
    $('[data-act="undo"]').onclick = undo;
    $('[data-act="redo"]').onclick = redo;
    $('[data-act="clear"]').onclick = clearMask;

    $$('#segAdd button').forEach(function (b) {
      b.onclick = function () {
        S.add = b.dataset.a === '1';
        $$('#segAdd button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      };
    });
    bindRange('#rBrush', '#oBrush', function (v) { return v + ' px'; }, function (v) { S.brush = +v; render(); });
    bindRange('#rHard', '#oHard', function (v) { return v + '%'; }, function (v) { S.hard = +v / 100; });
    bindRange('#rTol', '#oTol', function (v) { return v; }, function (v) {
      var L = S.layers[S.curLayer];
      if (!L) return;
      L.tol = +v;
      S.tol = L.tol;
      if (!L.picks.length) {
        toastOnce('tol', '这一层没有用「点选 / 魔棒」生成的选区，容差对它不起作用');
        return;
      }
      scheduleRebuild();
    });
    bindRange('#rFeather', '#oFeather', function (v) { return v + ' px'; }, function (v) {
      var L = S.layers[S.curLayer];
      if (!L) return;
      L.feather = +v;
      S.feather = L.feather;
      if (L.noFeather) {
        toastOnce('featherAll', '这一层是「全选 / 反选」的结果，不需要羽化');
        return;
      }
      scheduleRebuild();
    });

    $('#btnAll').onclick = selectAll;
    $('#btnClearMask').onclick = clearMask;
    $('#btnInvert').onclick = invertMask;
    $('#btnAddLayer').onclick = function () { addLayer(); };

    bindRange('#rHue', '#oHue', function (v) { return v + '°'; }, function (v) {
      S.p.hue = +v; S.p.target = null; $('#oTarget').textContent = '手动'; applyFull();
    });
    bindRange('#rSat', '#oSat', function (v) { return v + '%'; }, function (v) { S.p.sat = +v / 100; applyFull(); });
    bindRange('#rLum', '#oLum', function (v) { return v; }, function (v) { S.p.lum = +v; applyFull(); });
    bindRange('#rKeep', '#oKeep', function (v) { return v + '%'; }, function (v) { S.p.keep = +v / 100; applyFull(); });
    bindRange('#rTint', '#oTint', function (v) { return v + '%'; }, function (v) { S.p.tint = +v / 100; applyFull(); });
    bindRange('#rStrength', '#oStrength', function (v) { return v + '%'; }, function (v) { S.p.strength = +v / 100; applyFull(); });

    $('#btnTarget').onclick = function () {
      S.eyeDrop = !S.eyeDrop;
      $('#btnTarget').classList.toggle('is-on', S.eyeDrop);
      if (S.eyeDrop) toast('点一下图片上你想要的颜色的位置');
    };
    $('#cTarget').oninput = function () { applyTargetColor(Color.hex2rgb(this.value)); };
    $('#btnResetTarget').onclick = function () {
      S.p.target = null; S.p.tint = 0; S.p.tC = 0; S.p.tL = 0;
      syncColorUI(); applyFull();
    };
    $('#chkMask').onchange = function () { S.showMask = this.checked; render(); };

    $('#slotRef').onclick = function () { openPicker('ref', false); };
    $('#slotTgt').onclick = function () { openPicker('tgt', false); };
    $('#btnAddMore').onclick = function () { openPicker('tgt', true); };
    $('#btnClearBatch').onclick = function () {
      S.h.targets = []; S.h.cur = 0; S.h.stage = null;
      renderSlots(); renderFilm(); requestRender();
    };
    $$('#segMethod button').forEach(function (b) {
      b.onclick = function () {
        S.h.method = b.dataset.m;
        $$('#segMethod button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
        var hints = {
          light: '只统一明暗（曝光与对比），完全不动颜色。做拼图、前后对比最安全',
          standard: '按色彩统计量对齐明暗与色调，两张内容相近时最自然',
          strong: '逐通道直方图匹配，反差最大，但可能把画面原本的颜色也改掉'
        };
        $('#methodHint').textContent = hints[b.dataset.m];
        updateHarmonize();
      };
    });
    bindRange('#rHStrength', '#oHStrength', function (v) { return v + '%'; }, function (v) {
      S.h.strength = +v / 100; updateHarmonize();
    });
    $('#btnExportAll').onclick = function () {
      if (!S.h.targets.length) { toast('还没有可以导出的图'); return; }
      exportBatch(S.h.targets.map(function (_, i) { return i; }));
    };

    $('#btnCloseModal').onclick = $('#btnCancelExport').onclick = function () {
      $('#modal').classList.remove('is-on');
    };
    $$('#segFmt button').forEach(function (b) {
      b.onclick = function () {
        S.exp.fmt = b.dataset.f;
        $$('#segFmt button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
        $('#qualityField').style.display = S.exp.fmt === 'image/png' ? 'none' : '';
        $('#exportHint').textContent = S.exp.fmt === 'image/png'
          ? 'PNG 无损，改色后的图建议用它，边缘不会有色块。'
          : S.exp.fmt === 'image/jpeg'
            ? 'JPEG 体积小，但二次压缩会让改色区域出现轻微色块。'
            : 'WebP 体积与质量平衡最好，新版浏览器都支持。';
      };
    });
    $$('#segScale button').forEach(function (b) {
      b.onclick = function () {
        S.exp.scale = +b.dataset.s;
        $$('#segScale button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      };
    });
    bindRange('#rQuality', '#oQuality', function (v) { return v + '%'; }, function (v) { S.exp.q = +v / 100; });
    $('#btnDoExport').onclick = function () {
      $('#modal').classList.remove('is-on');
      doExport();
    };

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', function () {
      if (!S.drawing) { S.draw = null; requestRender(); }
    });
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('dblclick', function () {
      S.view = { z: 1, px: 0, py: 0 };
      requestRender();
    });
    cv.addEventListener('wheel', function (e) {
      if (!active()) return;
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      setZoomAt(S.view.z * Math.exp(-e.deltaY * 0.0016), e.clientX - r.left, e.clientY - r.top);
      requestRender();
    }, { passive: false });

    ['dragenter', 'dragover'].forEach(function (ev) {
      stage.addEventListener(ev, function (e) { e.preventDefault(); stage.classList.add('is-drop'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      stage.addEventListener(ev, function (e) { e.preventDefault(); stage.classList.remove('is-drop'); });
    });
    stage.addEventListener('drop', function (e) {
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadImageFile(f, S.mode === 'harmonize' ? 'harmonize' : 'single');
    });
    window.addEventListener('paste', function (e) {
      var it = e.clipboardData && e.clipboardData.items;
      if (!it) return;
      for (var i = 0; i < it.length; i++) {
        if (it[i].type.indexOf('image') === 0) {
          var f = it[i].getAsFile();
          if (f) loadImageFile(f, S.mode === 'harmonize' ? 'harmonize' : 'single');
          break;
        }
      }
    });

    $('#sheetGrip').onclick = function () {
      $('#panel').classList.toggle('is-open');
    };

    if (window.ResizeObserver) new ResizeObserver(function () { requestRender(); }).observe(stage);
    window.addEventListener('resize', function () { requestRender(); });

    $$('.group[data-only]').forEach(function (g) { g.hidden = g.dataset.only !== 'single'; });
    renderLayers();
    syncUndo();
    render();

    /* 便于截图与快速试用：在地址后加 #demo 直接载入示例图 */
    if (location.hash === '#demo') setTimeout(makeDemo, 150);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
