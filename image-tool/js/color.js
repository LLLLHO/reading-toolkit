/* 色彩数学：sRGB <-> CIELab，全部查表加速，供像素级循环使用 */
(function (global) {
  'use strict';

  var S2L = new Float32Array(256);
  for (var i = 0; i < 256; i++) {
    var c = i / 255;
    S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  var LUT_N = 4096;
  var L2S = new Float32Array(LUT_N + 1);
  for (var j = 0; j <= LUT_N; j++) {
    var v = j / LUT_N;
    L2S[j] = (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255;
  }

  var CBRT_N = 2048, CBRT_MAX = 1.2;
  var CBRT = new Float32Array(CBRT_N + 2);
  for (var k = 0; k <= CBRT_N; k++) CBRT[k] = Math.cbrt(k / CBRT_N * CBRT_MAX);

  var EPS = 216 / 24389, KAPPA = 24389 / 27;

  function fLab(t) {
    if (t <= 0) return 16 / 116;
    if (t <= EPS) return (KAPPA * t + 16) / 116;
    if (t >= CBRT_MAX) return Math.cbrt(t);
    var f = t / CBRT_MAX * CBRT_N, i0 = f | 0;
    return CBRT[i0] + (CBRT[i0 + 1] - CBRT[i0]) * (f - i0);
  }

  function lin2srgb(c) {
    if (c <= 0) return 0;
    if (c >= 1) return 255;
    var f = c * LUT_N, i0 = f | 0;
    return L2S[i0] + (L2S[i0 + 1] - L2S[i0]) * (f - i0);
  }

  /* 整张图一次转 Lab，返回 Float32Array(3n) */
  function imageToLab(data, n) {
    var lab = new Float32Array(n * 3);
    for (var i = 0, p = 0, q = 0; i < n; i++, p += 4, q += 3) {
      var r = S2L[data[p]], g = S2L[data[p + 1]], b = S2L[data[p + 2]];
      var X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
      var Y = (0.2126729 * r + 0.7151522 * g + 0.0721750 * b);
      var Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
      var fy = fLab(Y);
      lab[q] = 116 * fy - 16;
      lab[q + 1] = 500 * (fLab(X) - fy);
      lab[q + 2] = 200 * (fy - fLab(Z));
    }
    return lab;
  }

  var _o = new Float32Array(3);

  /* 结果写入 _o，避免每像素分配对象 */
  function lab2rgb(L, a, b) {
    var fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    var x = fx * fx * fx, y = fy * fy * fy, z = fz * fz * fz;
    if (x <= EPS) x = (116 * fx - 16) / KAPPA;
    if (y <= EPS) y = (116 * fy - 16) / KAPPA;
    if (z <= EPS) z = (116 * fz - 16) / KAPPA;
    var X = 0.95047 * x, Y = y, Z = 1.08883 * z;
    var R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
    var G = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
    var B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
    _o[0] = lin2srgb(R); _o[1] = lin2srgb(G); _o[2] = lin2srgb(B);
  }

  function rgb2lab1(r, g, b) {
    var R = S2L[r & 255], G = S2L[g & 255], B = S2L[b & 255];
    var X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
    var Y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B);
    var Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
    var fy = fLab(Y);
    return [116 * fy - 16, 500 * (fLab(X) - fy), 200 * (fy - fLab(Z))];
  }

  var _lab = new Float32Array(3);

  /* 供逐像素循环内联调用，结果写入 _lab，不分配对象 */
  function rgb2labFast(r, g, b) {
    var R = S2L[r], G = S2L[g], B = S2L[b];
    var X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
    var Y = (0.2126729 * R + 0.7151522 * G + 0.0721750 * B);
    var Z = (0.0193339 * R + 0.1191920 * G + 0.9503041 * B) / 1.08883;
    var fy = fLab(Y);
    _lab[0] = 116 * fy - 16;
    _lab[1] = 500 * (fLab(X) - fy);
    _lab[2] = 200 * (fy - fLab(Z));
    return _lab;
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function hex2rgb(h) {
    h = String(h).replace('#', '').trim();
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgb2hex(r, g, b) {
    var s = ((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16);
    return '#' + s.slice(1);
  }

  function lab2lch(L, a, b) {
    return [L, Math.sqrt(a * a + b * b), Math.atan2(b, a)];
  }

  global.Color = {
    S2L: S2L,
    imageToLab: imageToLab,
    lab2rgb: lab2rgb,
    rgb2lab: rgb2lab1,
    rgb2labFast: rgb2labFast,
    lin2srgb: lin2srgb,
    hex2rgb: hex2rgb,
    rgb2hex: rgb2hex,
    lab2lch: lab2lch,
    clamp: clamp,
    _o: _o,
    _lab: _lab
  };
})(window);
