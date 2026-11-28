/* 选区（遮罩）引擎：笔刷 / 魔棒 / 点选同类色 / 套索 / 羽化 */
(function (global) {
  'use strict';

  var Mask = {};

  Mask.create = function (w, h) {
    return new Uint8Array(w * h);
  };

  /* 沿线段连续盖印，避免快速拖动时出现断点 */
  Mask.brush = function (m, w, h, x0, y0, x1, y1, radius, hardness, add) {
    var dist = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    var step = Math.max(1, radius * 0.2);
    var steps = Math.max(1, Math.ceil(dist / step));
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      Mask.stamp(m, w, h, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, hardness, add);
    }
  };

  Mask.stamp = function (m, w, h, cx, cy, r, hardness, add) {
    var hr = r * hardness;
    var x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    var y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    var r2 = r * r;
    var hr2 = hardness >= 0.999 ? r2 : hr * hr;
    var soft = r - hr;
    for (var y = y0; y <= y1; y++) {
      var dy = y - cy, dy2 = dy * dy;
      var row = y * w;
      for (var x = x0; x <= x1; x++) {
        var dx = x - cx, d2 = dx * dx + dy2;
        if (d2 > r2) continue;
        var v = 1;
        if (d2 > hr2 && soft > 0.001) {
          var d = Math.sqrt(d2);
          v = 1 - (d - hr) / soft;
          v = v * v * (3 - 2 * v);
        }
        var i = row + x;
        if (add) {
          var nv = v * 255;
          if (nv > m[i]) m[i] = nv;
        } else {
          m[i] = m[i] * (1 - v);
        }
      }
    }
  };

  /* 复用的临时缓冲，避免容差重放时反复分配几十 MB */
  var _stack = null;

  /* 魔棒：颜色距离（Lab ΔE），contiguous=只连通的区域
     lw 是亮度差的权重：调低一点，同一件衣服的褶皱阴影更容易一起选中
     out 可选：传入可复用的缓冲（会被清零） */
  Mask.wand = function (lab, w, h, sx, sy, tol, contiguous, lw, out) {
    var n0 = w * h;
    if (out && out.length === n0) out.fill(0);
    else out = new Uint8Array(n0);
    var si = sy * w + sx;
    var L0 = lab[si * 3], A0 = lab[si * 3 + 1], B0 = lab[si * 3 + 2];
    var tol2 = tol * tol;
    var n = w * h, i, q, dL, dA, dB, d2;
    var kl = lw === undefined ? 1 : lw;

    if (!contiguous) {
      var lo = tol * 0.55, span = tol * 0.65;
      var inv = 1 / span;
      for (i = 0, q = 0; i < n; i++, q += 3) {
        dL = (lab[q] - L0) * kl; dA = lab[q + 1] - A0; dB = lab[q + 2] - B0;
        d2 = dL * dL + dA * dA + dB * dB;
        if (d2 <= lo * lo) {
          out[i] = 255;
        } else if (d2 < (lo + span) * (lo + span)) {
          var v = 1 - (Math.sqrt(d2) - lo) * inv;
          v = v * v * (3 - 2 * v);
          out[i] = v * 255;
        }
      }
      return out;
    }

    var stack = (_stack && _stack.length >= n) ? _stack : (_stack = new Int32Array(n));
    var sp = 0;
    stack[sp++] = si;
    out[si] = 255;
    while (sp > 0) {
      i = stack[--sp];
      var x = i % w, y = (i - x) / w;
      if (x > 0) sp = tryPush(i - 1);
      if (x < w - 1) sp = tryPush(i + 1);
      if (y > 0) sp = tryPush(i - w);
      if (y < h - 1) sp = tryPush(i + w);
    }
    return out;

    function tryPush(j) {
      if (out[j]) return sp;
      var q3 = j * 3;
      var eL = (lab[q3] - L0) * kl, eA = lab[q3 + 1] - A0, eB = lab[q3 + 2] - B0;
      if (eL * eL + eA * eA + eB * eB <= tol2) {
        out[j] = 255;
        stack[sp++] = j;
      }
      return sp;
    }
  };

  /* 套索：多边形扫描线填充，返回 0/255 遮罩 */
  Mask.lasso = function (w, h, pts) {
    var out = new Uint8Array(w * h);
    if (pts.length < 3) return out;
    var minY = Infinity, maxY = -Infinity, i;
    for (i = 0; i < pts.length; i++) {
      if (pts[i].y < minY) minY = pts[i].y;
      if (pts[i].y > maxY) maxY = pts[i].y;
    }
    var y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(h - 1, Math.ceil(maxY));
    var xs = [];
    for (var y = y0; y <= y1; y++) {
      xs.length = 0;
      var yc = y + 0.5;
      for (i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
          xs.push(a.x + (yc - a.y) / (b.y - a.y) * (b.x - a.x));
        }
      }
      xs.sort(function (p, q) { return p - q; });
      for (var k = 0; k + 1 < xs.length; k += 2) {
        var xa = Math.max(0, Math.round(xs[k]));
        var xb = Math.min(w - 1, Math.round(xs[k + 1]));
        var row = y * w;
        for (var x = xa; x <= xb; x++) out[row + x] = 255;
      }
    }
    return out;
  };

  /* 把 src 合并进 dst，add=1 取较大值，add=0 取较小值（减去） */
  Mask.merge = function (dst, src, add) {
    for (var i = 0; i < dst.length; i++) {
      var v = src[i];
      if (add) { if (v > dst[i]) dst[i] = v; }
      else { var nv = 255 - v; if (nv < dst[i]) dst[i] = nv; }
    }
  };

  Mask.invert = function (m) {
    for (var i = 0; i < m.length; i++) m[i] = 255 - m[i];
  };

  /* 分离式盒式模糊两遍 ≈ 高斯，半径单位 px
     非破坏式：调用方每次从「未羽化的原始选区」重新调用，不要对同一份反复调 */
  var _f1 = null, _f2 = null;

  Mask.feather = function (m, w, h, r) {
    if (r <= 0) return;
    var n = w * h;
    if (!_f1 || _f1.length < n) { _f1 = new Float32Array(n); _f2 = new Float32Array(n); }
    var tmp = _f1, tmp2 = _f2;
    var i, x, y, sum;
    var inv = 1 / (r + r + 1);
    for (y = 0; y < h; y++) {
      var row = y * w;
      sum = 0;
      for (x = -r; x <= r; x++) sum += m[row + Math.min(w - 1, Math.max(0, x))];
      for (x = 0; x < w; x++) {
        tmp[row + x] = sum * inv;
        sum += m[row + Math.min(w - 1, x + r + 1)] - m[row + Math.max(0, x - r)];
      }
    }
    for (x = 0; x < w; x++) {
      sum = 0;
      for (y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (y = 0; y < h; y++) {
        m[y * w + x] = sum * inv;
        sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    /* 第二遍让过渡更接近高斯 */
    for (y = 0; y < h; y++) {
      var r2 = y * w;
      sum = 0;
      for (x = -r; x <= r; x++) sum += m[r2 + Math.min(w - 1, Math.max(0, x))];
      for (x = 0; x < w; x++) {
        tmp2[r2 + x] = sum * inv;
        sum += m[r2 + Math.min(w - 1, x + r + 1)] - m[r2 + Math.max(0, x - r)];
      }
    }
    for (x = 0; x < w; x++) {
      sum = 0;
      for (y = -r; y <= r; y++) sum += tmp2[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (y = 0; y < h; y++) {
        m[y * w + x] = sum * inv;
        sum += tmp2[Math.min(h - 1, y + r + 1) * w + x] - tmp2[Math.max(0, y - r) * w + x];
      }
    }
  };

  Mask.count = function (m) {
    var c = 0;
    for (var i = 0; i < m.length; i++) if (m[i] > 8) c++;
    return c;
  };

  global.Mask = Mask;
})(window);
