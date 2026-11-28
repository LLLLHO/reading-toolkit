/* 调色引擎：局部改色 + 两图色调统一 */
(function (global) {
  'use strict';

  var Color = global.Color;
  var Adjust = {};

  /* ---------- 局部改色 ----------
     核心：只动 Lab 的 a/b（色度），L（明度）默认完整保留，
     所以褶皱、阴影、高光纹理不会糊掉。
     work.lab 为 null 时当场算（导出大图用，避免分配上百 MB 缓存）
     rect = [x0,y0,x1,y1] 时只重算这一块（笔刷拖动时用） */
  Adjust.recolor = function (work, mask, p, out, rect) {
    var w = work.w, h = work.h;
    var x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (rect) {
      x0 = Math.max(0, Math.floor(rect[0])); y0 = Math.max(0, Math.floor(rect[1]));
      x1 = Math.min(w - 1, Math.ceil(rect[2])); y1 = Math.min(h - 1, Math.ceil(rect[3]));
      if (x1 < x0 || y1 < y0) return;
    }
    var lab = work.lab, bd = work.base.data, od = out.data;

    /* 先把这块区域的底图恢复 */
    if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) {
      od.set(bd);
    } else {
      var rowLen = (x1 - x0 + 1) * 4, start = (y0 * w + x0) * 4;
      for (var yy = y0; yy <= y1; yy++, start += w * 4) {
        od.set(bd.subarray(start, start + rowLen), start);
      }
    }

    var st = p.strength;
    if (st <= 0.0001) return;

    var rad = p.hue * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var sat = p.sat, lum = p.lum, keep = p.keep, tint = p.tint;
    var tC = p.tC || 0, tL = p.tL || 0;
    var useTint = tint > 0.001;
    var flat = useTint && keep < 0.999;
    var o = Color._o;

    for (var y = y0; y <= y1; y++) {
      var i = y * w + x0;
      var p4 = i * 4;
      for (var x = x0; x <= x1; x++, i++, p4 += 4) {
        var m = st;
        if (mask) {
          var mv = mask[i];
          if (mv === 0) continue;
          m = mv * (1 / 255) * st;
        }
        var L, a, b;
        if (lab) {
          var q = i * 3;
          L = lab[q]; a = lab[q + 1]; b = lab[q + 2];
        } else {
          Color.rgb2labFast(bd[p4], bd[p4 + 1], bd[p4 + 2]);
          L = Color._lab[0]; a = Color._lab[1]; b = Color._lab[2];
        }
        var a2 = a * cos - b * sin;
        var b2 = a * sin + b * cos;
        a2 *= sat; b2 *= sat;
        if (useTint) {
          var len = Math.sqrt(a2 * a2 + b2 * b2);
          if (len > 0.01) {
            var f = (len * (1 - tint) + tC * tint) / len;
            a2 *= f; b2 *= f;
          }
        }
        var L2 = L + lum;
        if (flat) L2 = L2 * keep + tL * (1 - keep);

        Color.lab2rgb(L + (L2 - L) * m, a + (a2 - a) * m, b + (b2 - b) * m);
        od[p4] = o[0]; od[p4 + 1] = o[1]; od[p4 + 2] = o[2];
      }
    }
  };

  /* ---------- 第二层及以后：叠在已经改过的画面上 ----------
     读的是 out 当前的 RGB，转 Lab 后做同样的色相旋转，再按 mask 权重混回去。
     第一层仍走 recolor（基于原图 Lab），所以单层结果与旧版完全一致。 */
  function recolorOnto(work, mask, p, out, rect) {
    var w = work.w, h = work.h;
    var x0 = 0, y0 = 0, x1 = w - 1, y1 = h - 1;
    if (rect) {
      x0 = Math.max(0, Math.floor(rect[0])); y0 = Math.max(0, Math.floor(rect[1]));
      x1 = Math.min(w - 1, Math.ceil(rect[2])); y1 = Math.min(h - 1, Math.ceil(rect[3]));
      if (x1 < x0 || y1 < y0) return;
    }
    var st = p.strength;
    if (st <= 0.0001) return;

    var rad = p.hue * Math.PI / 180;
    var cos = Math.cos(rad), sin = Math.sin(rad);
    var sat = p.sat, lum = p.lum, keep = p.keep, tint = p.tint;
    var tC = p.tC || 0, tL = p.tL || 0;
    var useTint = tint > 0.001;
    var flat = useTint && keep < 0.999;
    var od = out.data, o = Color._o, labv = Color._lab;

    for (var y = y0; y <= y1; y++) {
      var i = y * w + x0;
      var p4 = i * 4;
      for (var x = x0; x <= x1; x++, i++, p4 += 4) {
        var m = st;
        if (mask) {
          var mv = mask[i];
          if (mv === 0) continue;
          m = mv * (1 / 255) * st;
        }
        if (m <= 0.0015) continue;

        Color.rgb2labFast(od[p4], od[p4 + 1], od[p4 + 2]);
        var L = labv[0], a = labv[1], b = labv[2];
        var a2 = a * cos - b * sin;
        var b2 = a * sin + b * cos;
        a2 *= sat; b2 *= sat;
        if (useTint) {
          var len = Math.sqrt(a2 * a2 + b2 * b2);
          if (len > 0.01) {
            var f = (len * (1 - tint) + tC * tint) / len;
            a2 *= f; b2 *= f;
          }
        }
        var L2 = L + lum;
        if (flat) L2 = L2 * keep + tL * (1 - keep);

        Color.lab2rgb(L + (L2 - L) * m, a + (a2 - a) * m, b + (b2 - b) * m);
        od[p4] = o[0]; od[p4 + 1] = o[1]; od[p4 + 2] = o[2];
      }
    }
  }

  /* 多层合成：layers = [{ mask, p, on }]，按顺序叠加到 out */
  Adjust.recolorLayers = function (work, layers, out, rect) {
    var eff = [];
    for (var i = 0; i < layers.length; i++) {
      var L = layers[i];
      if (!L || L.on === false) continue;
      if (!L.p || L.p.strength <= 0.0001) continue;
      eff.push(L);
    }
    if (!eff.length) {
      Adjust.recolor(work, null, { strength: 0 }, out, rect);
      return;
    }
    Adjust.recolor(work, eff[0].mask, eff[0].p, out, rect);
    for (var k = 1; k < eff.length; k++) {
      recolorOnto(work, eff[k].mask, eff[k].p, out, rect);
    }
  };

  /* 取样区域的平均色度色相与彩度（按彩度加权，避免灰色像素干扰） */
  Adjust.sampleRegion = function (work, mask) {
    var lab = work.lab, n = work.w * work.h;
    var wsum = 0, sa = 0, sb = 0, sL = 0, swl = 0;
    for (var i = 0, p3 = 0; i < n; i++, p3 += 3) {
      var w = mask ? mask[i] / 255 : 1;
      if (w <= 0.01) continue;
      var a = lab[p3 + 1], b = lab[p3 + 2];
      var c = Math.sqrt(a * a + b * b);
      var wt = w * (c + 0.5);
      sa += a * wt; sb += b * wt; wsum += wt;
      sL += lab[p3] * w; swl += w;
    }
    if (wsum < 1e-6) {
      return { L: 50, a: 0, b: 0, C: 0, H: 0 };
    }
    sa /= wsum; sb /= wsum;
    return {
      L: swl > 0 ? sL / swl : 50,
      a: sa, b: sb,
      C: Math.sqrt(sa * sa + sb * sb),
      H: Math.atan2(sb, sa)
    };
  };

  /* ---------- 色调统一 ---------- */

  /* 一次遍历统计 Lab 均值/标准差 + 三通道直方图 */
  Adjust.analyze = function (lab, n) {
    var sL = 0, sa = 0, sb = 0, qL = 0, qa = 0, qb = 0;
    var hL = new Int32Array(256), hA = new Int32Array(256), hB = new Int32Array(256);
    for (var i = 0, q = 0; i < n; i++, q += 3) {
      var L = lab[q], a = lab[q + 1], b = lab[q + 2];
      sL += L; sa += a; sb += b;
      qL += L * L; qa += a * a; qb += b * b;
      var iL = (L * 2.55) | 0; if (iL < 0) iL = 0; else if (iL > 255) iL = 255;
      var iA = (a + 128) | 0; if (iA < 0) iA = 0; else if (iA > 255) iA = 255;
      var iB = (b + 128) | 0; if (iB < 0) iB = 0; else if (iB > 255) iB = 255;
      hL[iL]++; hA[iA]++; hB[iB]++;
    }
    var mL = sL / n, ma = sa / n, mb = sb / n;
    var vL = Math.max(1e-3, qL / n - mL * mL);
    var va = Math.max(1e-3, qa / n - ma * ma);
    var vb = Math.max(1e-3, qb / n - mb * mb);
    return {
      mL: mL, ma: ma, mb: mb,
      sL: Math.sqrt(vL), sa: Math.sqrt(va), sb: Math.sqrt(vb),
      hL: hL, hA: hA, hB: hB, n: n
    };
  };

  function cdf(h) {
    var c = new Float64Array(256), acc = 0;
    for (var i = 0; i < 256; i++) { acc += h[i]; c[i] = acc; }
    for (i = 0; i < 256; i++) c[i] /= acc || 1;
    return c;
  }

  function matchLUT(hs, hr) {
    var cs = cdf(hs), cr = cdf(hr);
    var lut = new Float32Array(256);
    var j = 0;
    for (var i = 0; i < 256; i++) {
      while (j < 255 && cr[j] < cs[i]) j++;
      lut[i] = j;
    }
    return lut;
  }

  Adjust.buildModel = function (method, st, sr) {
    var C = Color.clamp;
    if (method === 'light') {
      var sc = C(sr.sL / st.sL, 0.55, 1.8);
      /* 色度保持原样：Ax/Bx=1，偏移 0 */
      return { type: 'light', Lx: sc, Lb: sr.mL - sc * st.mL, Ax: 1, Ab: 0, Bx: 1, Bb: 0 };
    }
    if (method === 'strong') {
      return {
        type: 'hist',
        lL: matchLUT(st.hL, sr.hL),
        lA: matchLUT(st.hA, sr.hA),
        lB: matchLUT(st.hB, sr.hB)
      };
    }
    var lx = C(sr.sL / st.sL, 0.45, 2.4);
    var ax = C(sr.sa / st.sa, 0.35, 2.6);
    var bx = C(sr.sb / st.sb, 0.35, 2.6);
    return {
      type: 'affine',
      Lx: lx, Lb: sr.mL - lx * st.mL,
      Ax: ax, Ab: sr.ma - ax * st.ma,
      Bx: bx, Bb: sr.mb - bx * st.mb
    };
  };

  Adjust.applyModel = function (work, model, strength, out) {
    var n = work.w * work.h, lab = work.lab, od = out.data, bd = work.base.data;
    var o = Color._o;
    var s = strength;
    var Lx = model.Lx, Lb = model.Lb, Ax = model.Ax, Ab = model.Ab, Bx = model.Bx, Bb = model.Bb;
    var lL = model.lL, lA = model.lA, lB = model.lB;

    for (var i = 0, p4 = 0, q = 0; i < n; i++, p4 += 4, q += 3) {
      var L, a, b;
      if (lab) { L = lab[q]; a = lab[q + 1]; b = lab[q + 2]; }
      else {
        Color.rgb2labFast(bd[p4], bd[p4 + 1], bd[p4 + 2]);
        L = Color._lab[0]; a = Color._lab[1]; b = Color._lab[2];
      }
      var L2, a2, b2;
      if (Lx !== undefined) {
        L2 = L * Lx + Lb;
        a2 = a * Ax + Ab;
        b2 = b * Bx + Bb;
      } else {
        var iL = (L * 2.55) | 0; if (iL > 255) iL = 255;
        var iA = (a + 128) | 0; if (iA < 0) iA = 0; else if (iA > 255) iA = 255;
        var iB = (b + 128) | 0; if (iB < 0) iB = 0; else if (iB > 255) iB = 255;
        L2 = lL[iL] / 2.55;
        a2 = lA[iA] - 128;
        b2 = lB[iB] - 128;
      }
      Color.lab2rgb(L + (L2 - L) * s, a + (a2 - a) * s, b + (b2 - b) * s);
      od[p4] = o[0]; od[p4 + 1] = o[1]; od[p4 + 2] = o[2]; od[p4 + 3] = 255;
    }
  };

  global.Adjust = Adjust;
})(window);
