/* 川麻麻将牌面资产 v2 · 程序化 SVG（零依赖，33 个牌面：27 张 + 牌背）
 * ---------------------------------------------------------------------------
 * 用法：MJTiles.face(tileId) / MJTiles.back() / MJTiles.CN
 *   tileId 0..26 =>  suit = floor(id/9)  rank = id%9+1
 *
 * 视觉契约（v2，2026-09-19 质感升级）：
 *   - 牌身是**凸起**：垂直渐变「顶亮 → 底暗」+ 顶部外缘高光 + 底部外缘暗边
 *   - 面板是**凹陷**：顶部内侧暗（上壁背光）+ 底部内侧亮（下壁受光）—— 方向与牌身相反
 *   - 花色是**实体**：万=刻字（下方 0.9 单位亮色副本露边）、条=圆柱（横向暗→亮→暗）、
 *     筒=球面（径向渐变 + 左上高光点）
 *   - 色板与强度全部来自 web/tokens.js，本文件不硬写色值
 *
 * ⚠ 两个必须守住的约束（破坏会静默失效）：
 *   1. 外层 <svg> 必须原样保留 `width="100%" height="100%"` ——
 *      pixi-table.js 的 svgToTexture() 靠字符串精确匹配它来换尺寸，换了就渲不出纹理。
 *   2. 每张牌自带的 <defs> 渐变 id 必须**全局唯一**（自增 uid 保证）——
 *      同一页面/同一张联系表里 33 张牌同框时，同名 id 会互相抢渐变（浏览器只认第一个）。
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  /* ---------------- 令牌（取不到时用与 tokens.js 一致的兜底值） ---------------- */
  var T = (typeof window !== 'undefined' && window.CMTokens) || null;
  function pick(pathStr, fb) {
    if (!T) return fb;
    var o = T, ps = pathStr.split('.');
    for (var i = 0; i < ps.length; i++) {
      if (o === null || o === undefined || o[ps[i]] === undefined) return fb;
      o = o[ps[i]];
    }
    return o;
  }
  var FX = {
    gloss: pick('fx.tileGloss', 1),
    panel: pick('fx.panelDepth', 1),
    weave: pick('fx.weave', 1)
  };

  var COL = {
    /* 牌身（凸起） */
    bodyTop: pick('tile.top', '#fdf9ee'),
    bodyMid: pick('tile.mid', '#f6efdd'),
    bodyBot: pick('tile.bot', '#e7dcc3'),
    bodyEdge: pick('tile.edge', '#c6b99c'),
    innerHi: pick('tile.innerHi', 'rgba(255,255,255,.7)'),
    innerLo: pick('tile.innerLo', 'rgba(138,118,84,.16)'),
    /* 内凹面板 */
    pTop: pick('tile.pTop', '#fffefa'),
    pBot: pick('tile.pBot', '#f7f2e5'),
    pEdge: pick('tile.pEdge', '#e2dac5'),
    pInHi: pick('tile.pInHi', 'rgba(255,255,255,.95)'),
    pInLo: pick('tile.pInLo', 'rgba(150,132,96,.12)'),
    /* 万 */
    wanInk: pick('wan.ink', '#1e2b45'),
    wanInkBot: pick('wan.inkBot', '#2c3c5c'),
    wanInkLo: pick('wan.inkLo', 'rgba(24,34,54,.30)'),
    wanHi: pick('wan.inkHi', 'rgba(255,255,255,.42)'),
    wanChar: pick('wan.char', '#bf3626'),
    wanCharBot: pick('wan.charBot', '#9c2a1c'),
    wanCharLo: pick('wan.charLo', 'rgba(110,32,20,.34)'),
    wanCharHi: pick('wan.charHi', 'rgba(255,255,255,.34)'),
    /* 条（兜底值必须与 tokens.js 保持一致，否则回归脚本走兜底时会拿到另一套颜色） */
    tiaoDark: pick('tiao.dark', '#176b43'),
    tiaoMid: pick('tiao.mid', '#1c7d4d'),
    tiaoLit: pick('tiao.lit', '#2aa86a'),
    tiaoHi: pick('tiao.hi', '#6cc896'),
    tiaoNode: pick('tiao.nodeDark', '#0b3d26'),
    birdBody: pick('tiao.birdBody', '#1c7d4d'),
    birdDark: pick('tiao.birdDark', '#0f5233'),
    birdWing: pick('tiao.birdWing', '#6cc896'),
    beak: pick('tiao.beak', '#d99a2b'),
    comb: pick('tiao.comb', '#c0392b'),
    eye: pick('tiao.eye', '#0d2e1c'),
    /* 筒 */
    tongRim: pick('tong.rimDark', '#24569a'),
    tongFace: pick('tong.face', '#3f86cf'),
    tongHi: pick('tong.faceHi', '#8fbdec'),
    tongCore: pick('tong.core', '#c0392b'),
    tongCoreDark: pick('tong.coreDark', '#8f2a1f'),
    tongCoreLit: pick('tong.coreLit', '#e0604f'),
    tongCoreHi: pick('tong.coreHi', 'rgba(255,255,255,.5)'),
    tongWhite: pick('tong.white', '#fffdf6'),
    /* 牌背 */
    bkTop: pick('back.top', '#3a7cc4'),
    bkMid: pick('back.mid', '#2a6aad'),
    bkBot: pick('back.bot', '#1e4d84'),
    bkEdge: pick('back.edge', '#173e6d'),
    bkInner: pick('back.inner', '#e8eef7'),
    bkWeave: pick('back.weave', 'rgba(232,238,247,.13)'),
    bkWeft: pick('back.weft', 'rgba(12,36,66,.20)'),
    bkHi: pick('back.hi', 'rgba(255,255,255,.32)')
  };

  /* ---------------- id 唯一化（同页多张牌不抢渐变） ---------------- */
  var uid = 0;
  function nid(role) { uid++; return 'cm' + uid + '-' + role; }

  /* ---------------- 几何 ---------------- */
  var W = 60, H = 84;
  var X0 = 12, X1 = 48, Y0 = 12, Y1 = 72;      // 花色内容区
  var BX = 1.2, BY = 1.2, BW = 57.6, BH = 81.6, BR = 8;   // 牌身
  var PX = 5, PY = 5, PW = 50, PH = 74, PR = 5;           // 内凹面板
  function px(u) { return X0 + u * (X1 - X0); }
  function py(v) { return Y0 + v * (Y1 - Y0); }
  function f1(n) { return (Math.round(n * 10) / 10).toFixed(1); }

  /* ---------------- 每张牌一个 defs 收集器（同参数的渐变在本张牌内复用） ---------------- */
  function Defs() { this.list = []; this.cache = {}; }
  Defs.prototype.linear = function (role, x1, y1, x2, y2, stops) {
    var key = 'L|' + x1 + ',' + y1 + ',' + x2 + ',' + y2 + '|' + JSON.stringify(stops);
    if (this.cache[key]) return this.cache[key];
    var id = nid(role), s = '';
    for (var i = 0; i < stops.length; i++) {
      s += '<stop offset="' + stops[i][0] + '" stop-color="' + stops[i][1] + '"' +
        (stops[i][2] !== undefined ? ' stop-opacity="' + stops[i][2] + '"' : '') + '/>';
    }
    this.list.push('<linearGradient id="' + id + '" x1="' + x1 + '" y1="' + y1 +
      '" x2="' + x2 + '" y2="' + y2 + '">' + s + '</linearGradient>');
    this.cache[key] = id;
    return id;
  };
  Defs.prototype.radial = function (role, cx, cy, r, fx, fy, stops) {
    var key = 'R|' + cx + ',' + cy + ',' + r + ',' + fx + ',' + fy + '|' + JSON.stringify(stops);
    if (this.cache[key]) return this.cache[key];
    var id = nid(role), s = '';
    for (var i = 0; i < stops.length; i++) {
      s += '<stop offset="' + stops[i][0] + '" stop-color="' + stops[i][1] + '"' +
        (stops[i][2] !== undefined ? ' stop-opacity="' + stops[i][2] + '"' : '') + '/>';
    }
    this.list.push('<radialGradient id="' + id + '" cx="' + cx + '" cy="' + cy + '" r="' + r +
      '" fx="' + fx + '" fy="' + fy + '">' + s + '</radialGradient>');
    this.cache[key] = id;
    return id;
  };
  Defs.prototype.clip = function (role, rectAttr) {
    var key = 'C|' + rectAttr;
    if (this.cache[key]) return this.cache[key];
    var id = nid(role);
    this.list.push('<clipPath id="' + id + '">' + rectAttr + '</clipPath>');
    this.cache[key] = id;
    return id;
  };
  Defs.prototype.out = function () {
    return this.list.length ? '<defs>' + this.list.join('') + '</defs>' : '';
  };

  /* ================= 牌体：凸起牌身 + 凹陷面板 ================= */
  function shell(D) {
    var bodyG = D.linear('body', 0, 0, 0, 1, [
      [0, COL.bodyTop], [0.5, COL.bodyMid], [1, COL.bodyBot]
    ]);
    var footG = D.linear('foot', 0, 0, 0, 1, [
      [0, COL.innerLo, 0], [1, COL.innerLo]
    ]);
    var panelG = D.linear('panel', 0, 0, 0, 1, [
      [0, COL.pTop], [1, COL.pBot]
    ]);
    // 凹陷面板：上壁背光（暗，向下渐隐）/ 下壁受光（亮，向上渐隐）
    var panTopSh = D.linear('pshade', 0, 0, 0, 1, [
      [0, COL.pInLo, FX.panel], [1, COL.pInLo, 0]
    ]);
    var panBotHi = D.linear('plit', 0, 1, 0, 0, [
      [0, COL.pInHi, FX.panel], [1, COL.pInHi, 0]
    ]);
    var clip = D.clip('bodyclip', '<rect x="' + BX + '" y="' + BY + '" width="' + BW +
      '" height="' + BH + '" rx="' + BR + '"/>');

    var s = '';
    // 牌身
    s += '<rect x="' + BX + '" y="' + BY + '" width="' + BW + '" height="' + BH + '" rx="' + BR +
      '" fill="url(#' + bodyG + ')"/>';
    s += '<g clip-path="url(#' + clip + ')">';
    // 顶部外缘高光（凸起的受光棱）
    s += '<rect x="' + BX + '" y="' + BY + '" width="' + BW + '" height="' + f1(9 * FX.gloss) +
      '" fill="url(#' + D.linear('toplit', 0, 0, 0, 1, [[0, COL.innerHi, FX.gloss], [1, COL.innerHi, 0]]) + ')"/>';
    // 底部外缘内阴影（凸起落回桌面）
    s += '<rect x="' + BX + '" y="' + f1(BY + BH - 11) + '" width="' + BW + '" height="11" fill="url(#' + footG + ')"/>';
    s += '</g>';
    // 牌身描边（画在渐变之上，边缘才干净）
    s += '<rect x="' + BX + '" y="' + BY + '" width="' + BW + '" height="' + BH + '" rx="' + BR +
      '" fill="none" stroke="' + COL.bodyEdge + '" stroke-width="1.2"/>';
    // 内凹面板
    s += '<rect x="' + PX + '" y="' + PY + '" width="' + PW + '" height="' + PH + '" rx="' + PR +
      '" fill="url(#' + panelG + ')" stroke="' + COL.pEdge + '" stroke-width="0.9"/>';
    s += '<g clip-path="url(#' + D.clip('panelclip', '<rect x="' + PX + '" y="' + PY +
      '" width="' + PW + '" height="' + PH + '" rx="' + PR + '"/>') + ')">';
    s += '<rect x="' + PX + '" y="' + PY + '" width="' + PW + '" height="4" fill="url(#' + panTopSh + ')"/>';
    s += '<rect x="' + PX + '" y="' + f1(PY + PH - 3) + '" width="' + PW + '" height="3" fill="url(#' + panBotHi + ')"/>';
    s += '</g>';
    return s;
  }

  /* ================= 万：刻字 ================= */
  var CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var KAI = 'KaiTi,STKaiti,SimSun,STSong,serif';

  function engraved(D, glyph, cy, size, fillTop, fillBot, hi, lo, role) {
    var g = D.linear(role, 0, 0, 0, 1, [[0, fillTop], [0.62, fillTop], [1, fillBot]]);
    var s = '';
    // 下移 0.9 的亮色副本：凹刻的下壁受光，在字下方露出亮边
    s += '<text x="30" y="' + f1(cy + 0.9) + '" text-anchor="middle" font-size="' + size +
      '" font-weight="700" font-family="' + KAI + '" fill="' + hi + '">' + glyph + '</text>';
    // 上移 0.35 的暗色副本：上壁背光
    s += '<text x="30" y="' + f1(cy - 0.35) + '" text-anchor="middle" font-size="' + size +
      '" font-weight="700" font-family="' + KAI + '" fill="' + lo + '">' + glyph + '</text>';
    s += '<text x="30" y="' + cy + '" text-anchor="middle" font-size="' + size +
      '" font-weight="700" font-family="' + KAI + '" fill="url(#' + g + ')">' + glyph + '</text>';
    return s;
  }
  function wanContent(D, n) {
    return engraved(D, CN[n], 34, 30, COL.wanInk, COL.wanInkBot, COL.wanHi, COL.wanInkLo, 'wanink') +
      engraved(D, '萬', 70, 27, COL.wanChar, COL.wanCharBot, COL.wanCharHi, COL.wanCharLo, 'wanchar');
  }

  /* ================= 条：圆柱竹节 ================= */
  var STICKS = {
    2: [[0.5, 0.25], [0.5, 0.75]],
    3: [[0.5, 0.2], [0.26, 0.74], [0.74, 0.74]],
    4: [[0.26, 0.25], [0.74, 0.25], [0.26, 0.75], [0.74, 0.75]],
    5: [[0.2, 0.2], [0.8, 0.2], [0.5, 0.5], [0.2, 0.8], [0.8, 0.8]],
    6: [[0.3, 0.16], [0.7, 0.16], [0.3, 0.5], [0.7, 0.5], [0.3, 0.84], [0.7, 0.84]],
    7: [[0.5, 0.12], [0.22, 0.5], [0.5, 0.5], [0.78, 0.5], [0.22, 0.88], [0.5, 0.88], [0.78, 0.88]],
    8: [[0.16, 0.26], [0.39, 0.26], [0.61, 0.26], [0.84, 0.26], [0.16, 0.76], [0.39, 0.76], [0.61, 0.76], [0.84, 0.76]],
    9: [[0.16, 0.16], [0.5, 0.16], [0.84, 0.16], [0.16, 0.5], [0.5, 0.5], [0.84, 0.5], [0.16, 0.84], [0.5, 0.84], [0.84, 0.84]]
  };
  var STICK_H = { 2: 17, 3: 16, 4: 15, 5: 14, 6: 14.5, 7: 12.5, 8: 13, 9: 12.5 };

  function stick(D, cx, cy, w, h) {
    // 横向渐变：圆柱受光 —— 两侧收暗，但亮区要够宽，否则整根竹子发沉（实测过：
    // 暗端压到 #0f5233 时，高饱和绿像素占比从 0.016 掉到 0.002，视觉明显变闷）。
    var g = D.linear('tiao', 0, 0, 1, 0, [
      [0, COL.tiaoDark], [0.12, COL.tiaoMid], [0.44, COL.tiaoLit],
      [0.62, COL.tiaoMid], [0.9, COL.tiaoMid], [1, COL.tiaoDark]
    ]);
    var x = cx - w / 2, y = cy - h / 2, r = w * 0.42;
    var s = '';
    s += '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(h) +
      '" rx="' + f1(r) + '" fill="url(#' + g + ')"/>';
    // 节线（竹节）+ 节线下方高光
    var n1 = cy - h * 0.17, n2 = cy + h * 0.17;
    s += '<line x1="' + f1(x) + '" y1="' + f1(n1) + '" x2="' + f1(x + w) + '" y2="' + f1(n1) +
      '" stroke="' + COL.tiaoNode + '" stroke-width="1.05"/>';
    s += '<line x1="' + f1(x) + '" y1="' + f1(n1 + 1.1) + '" x2="' + f1(x + w) + '" y2="' + f1(n1 + 1.1) +
      '" stroke="' + COL.tiaoHi + '" stroke-width="0.7" opacity="0.5"/>';
    s += '<line x1="' + f1(x) + '" y1="' + f1(n2) + '" x2="' + f1(x + w) + '" y2="' + f1(n2) +
      '" stroke="' + COL.tiaoNode + '" stroke-width="1.05"/>';
    s += '<line x1="' + f1(x) + '" y1="' + f1(n2 + 1.1) + '" x2="' + f1(x + w) + '" y2="' + f1(n2 + 1.1) +
      '" stroke="' + COL.tiaoHi + '" stroke-width="0.7" opacity="0.5"/>';
    return s;
  }
  function tiaoSticks(D, n) {
    var pts = STICKS[n], h = STICK_H[n], w = h * 0.42, s = '';
    for (var i = 0; i < pts.length; i++) s += stick(D, px(pts[i][0]), py(pts[i][1]), w, h);
    return s;
  }

  /* 一索 = 幺鸡 */
  function tiaoBird(D) {
    var bodyG = D.radial('birdbody', 0.38, 0.32, 0.78, 0.36, 0.3, [
      [0, COL.birdWing], [0.55, COL.birdBody], [1, COL.birdDark]
    ]);
    return '<g>' +
      '<ellipse cx="30" cy="46" rx="12" ry="15" fill="url(#' + bodyG + ')"/>' +
      '<path d="M30 31 q-9 -6 -6 -16 q7 4 9 12 z" fill="' + COL.birdDark + '"/>' +
      '<circle cx="30" cy="25" r="8.5" fill="' + COL.birdBody + '"/>' +
      '<circle cx="27.2" cy="22.6" r="3.4" fill="' + COL.birdWing + '" opacity="0.55"/>' +
      '<path d="M30 17 q3 -7 8 -8 q-1 6 -5 9 z" fill="' + COL.comb + '"/>' +
      '<circle cx="27" cy="24" r="1.7" fill="' + COL.eye + '"/>' +
      '<circle cx="26.5" cy="23.3" r="0.6" fill="#ffffff" opacity="0.8"/>' +
      '<path d="M38 26 l7 3 l-7 3 z" fill="' + COL.beak + '"/>' +
      '<path d="M18 50 q-8 6 -10 16 q10 -2 14 -9 z" fill="' + COL.birdWing + '" opacity="0.85"/>' +
      '<path d="M42 50 q8 6 10 16 q-10 -2 -14 -9 z" fill="' + COL.birdWing + '" opacity="0.85"/>' +
      '<path d="M22 60 l-3 12 M38 60 l3 12" stroke="' + COL.birdDark + '" stroke-width="2" stroke-linecap="round"/>' +
      '</g>';
  }

  /* ================= 筒：球面靶心 ================= */
  var DOTS = {
    1: [[0.5, 0.5]],
    2: [[0.5, 0.2], [0.5, 0.8]],
    3: [[0.16, 0.18], [0.5, 0.5], [0.84, 0.82]],
    4: [[0.22, 0.22], [0.78, 0.22], [0.22, 0.78], [0.78, 0.78]],
    5: [[0.16, 0.16], [0.84, 0.16], [0.5, 0.5], [0.16, 0.84], [0.84, 0.84]],
    6: [[0.22, 0.14], [0.78, 0.14], [0.22, 0.5], [0.78, 0.5], [0.22, 0.86], [0.78, 0.86]],
    7: [[0.12, 0.12], [0.5, 0.12], [0.88, 0.12], [0.22, 0.62], [0.78, 0.62], [0.22, 0.9], [0.78, 0.9]],
    8: [[0.22, 0.06], [0.78, 0.06], [0.22, 0.35], [0.78, 0.35], [0.22, 0.65], [0.78, 0.65], [0.22, 0.94], [0.78, 0.94]],
    9: [[0.14, 0.14], [0.5, 0.14], [0.86, 0.14], [0.14, 0.5], [0.5, 0.5], [0.86, 0.5], [0.14, 0.86], [0.5, 0.86], [0.86, 0.86]]
  };
  var DOT_R = { 1: 12.5, 2: 9, 3: 7.6, 4: 7.4, 5: 6.8, 6: 6.4, 7: 5.6, 8: 5.4, 9: 5.4 };

  function dot(D, cx, cy, r) {
    var ringG = D.radial('tongring', 0.36, 0.3, 0.85, 0.34, 0.26, [
      [0, COL.tongHi], [0.42, COL.tongFace], [1, COL.tongRim]
    ]);
    var coreG = D.radial('tongcore', 0.36, 0.3, 0.85, 0.34, 0.26, [
      [0, COL.tongCoreLit], [0.5, COL.tongCore], [1, COL.tongCoreDark]
    ]);
    var s = '';
    // 外环（球面）
    s += '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + r + '" fill="url(#' + ringG + ')"/>';
    s += '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + r + '" fill="none" stroke="' +
      COL.tongRim + '" stroke-width="0.55" opacity="0.55"/>';
    // 白环（凹槽）
    s += '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(r * 0.6) + '" fill="' + COL.tongWhite + '"/>';
    // 靶心
    s += '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(r * 0.28) + '" fill="url(#' + coreG + ')"/>';
    // 左上高光点（球面反射）
    s += '<circle cx="' + f1(cx - r * 0.42) + '" cy="' + f1(cy - r * 0.46) + '" r="' + f1(Math.max(0.7, r * 0.16)) +
      '" fill="#ffffff" opacity="0.5"/>';
    s += '<circle cx="' + f1(cx - r * 0.2) + '" cy="' + f1(cy - r * 0.22) + '" r="' + f1(Math.max(0.5, r * 0.09)) +
      '" fill="' + COL.tongCoreHi + '" opacity="0.7"/>';
    return s;
  }
  function tongPips(D, n) {
    var pts = DOTS[n], r = DOT_R[n], s = '';
    for (var i = 0; i < pts.length; i++) s += dot(D, px(pts[i][0]), py(pts[i][1]), r);
    return s;
  }

  /* ================= 组装：牌面 ================= */
  function face(id) {
    var suit = Math.floor(id / 9), rank = (id % 9) + 1;
    var D = new Defs();
    var content = suit === 0 ? wanContent(D, rank)
      : (suit === 1 ? (rank === 1 ? tiaoBird(D) : tiaoSticks(D, rank)) : tongPips(D, rank));
    var body = shell(D);
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" ' +
      'width="100%" height="100%" style="display:block;border-radius:8px">' +
      D.out() + body + content + '</svg>';
  }

  /* ================= 组装：牌背（织物 + 边框高光） ================= */
  function back() {
    var D = new Defs();
    var faceG = D.linear('bkface', 0, 0, 0, 1, [
      [0, COL.bkTop], [0.55, COL.bkMid], [1, COL.bkBot]
    ]);
    var bodyG = D.linear('bkbody', 0, 0, 0, 1, [
      [0, COL.bodyTop], [1, COL.bodyBot]
    ]);
    var clip = D.clip('bkclip', '<rect x="6" y="6" width="48" height="72" rx="6"/>');
    var s = '';
    s += '<rect x="' + BX + '" y="' + BY + '" width="' + BW + '" height="' + BH + '" rx="' + BR +
      '" fill="url(#' + bodyG + ')"/>';
    s += '<rect x="' + BX + '" y="' + BY + '" width="' + BW + '" height="' + BH + '" rx="' + BR +
      '" fill="none" stroke="' + COL.bodyEdge + '" stroke-width="1.2"/>';
    s += '<rect x="6" y="6" width="48" height="72" rx="6" fill="url(#' + faceG + ')"/>';
    s += '<g clip-path="url(#' + clip + ')">';
    // 斜织纹（±45° 细线，两向交叉 = 织物）
    var wv = '', i;
    for (i = -72; i < 108; i += 3.4) {
      wv += '<line x1="' + i + '" y1="0" x2="' + (i + 72) + '" y2="84" stroke="' + COL.bkWeave +
        '" stroke-width="' + (0.55 * FX.weave).toFixed(2) + '"/>';
    }
    for (i = -24; i < 108; i += 3.4) {
      wv += '<line x1="' + i + '" y1="0" x2="' + (i - 72) + '" y2="84" stroke="' + COL.bkWeft +
        '" stroke-width="' + (0.45 * FX.weave).toFixed(2) + '"/>';
    }
    s += wv;
    // 顶部受光 / 底部内阴影
    s += '<rect x="6" y="6" width="48" height="7" fill="url(#' + D.linear('bkhi', 0, 0, 0, 1,
      [[0, COL.bkHi, FX.gloss], [1, COL.bkHi, 0]]) + ')"/>';
    s += '<rect x="6" y="' + (6 + 72 - 8) + '" width="48" height="8" fill="url(#' +
      D.linear('bklo', 0, 0, 0, 1, [[1, 'rgba(3,20,40,.30)', FX.gloss], [0, 'rgba(3,20,40,0)']]) + ')"/>';
    s += '</g>';
    // 内框亮线
    s += '<rect x="9.5" y="9.5" width="41" height="65" rx="4" fill="none" stroke="' + COL.bkInner +
      '" stroke-width="0.9" opacity="0.55"/>';
    s += '<rect x="6" y="6" width="48" height="72" rx="6" fill="none" stroke="' + COL.bkEdge +
      '" stroke-width="1.2"/>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" ' +
      'width="100%" height="100%" style="display:block;border-radius:8px">' + D.out() + s + '</svg>';
  }

  window.MJTiles = { face: face, back: back, CN: CN, version: '2.0.0' };
})();
