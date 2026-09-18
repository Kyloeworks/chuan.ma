/* 牌面资产 v1 —— 质感升级前的归档快照，仅用于对照与回归，**不是运行时代码**。
 * 来源：git 190016b:web/tiles-ui.js
 * 由 web/_fix_baseline.cjs 导出。运行时代码是 web/tiles-ui.js（v2）。
 */
/* 川麻麻将牌面资产 · 程序化 SVG（零依赖，33 个牌面：27 张 + 牌背 + 万/条/筒 花色牌）
 * 用法：MJTiles.face(tileId) / MJTiles.back()
 *   tileId 0..26  =>  suit = floor(id/9)  rank = id%9+1
 * 设计：viewBox 0 0 60 84（接近真实牌比例），width/height 100% 随容器缩放。
 */
(function () {
  var COL = {
    body: '#f3ecda', bodyEdge: '#cabfa6',
    panel: '#fffdf6', panelEdge: '#e6dfca',
    shadow: 'rgba(80,70,50,.18)',
    wanNum: '#22314f', wanChar: '#c0392b',
    tiao: '#1c7d4d', tiaoDark: '#125c37', tiaoLight: '#5bbf8a',
    tong: '#2f6fb5', tongDark: '#1f4f86', tongRed: '#c0392b',
    back: '#2f6fb5', backDark: '#1f4f86', backAccent: '#e8eef7'
  };

  var X0 = 12, X1 = 48, Y0 = 12, Y1 = 72; // 内容区
  function px(u) { return X0 + u * (X1 - X0); }
  function py(v) { return Y0 + v * (Y1 - Y0); }

  function panel() {
    return '<rect x="1.2" y="1.2" width="57.6" height="81.6" rx="8" fill="' + COL.body + '" stroke="' + COL.bodyEdge + '" stroke-width="1.2"/>' +
      '<rect x="1.2" y="78" width="57.6" height="4.8" rx="3" fill="rgba(120,105,75,.13)"/>' +
      '<rect x="5" y="5" width="50" height="74" rx="5" fill="' + COL.panel + '" stroke="' + COL.panelEdge + '" stroke-width="0.9"/>';
  }

  /* ---------- 筒（圆圈靶心） ---------- */
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

  function dot(cx, cy, r) {
    return '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r + '" fill="' + COL.tong + '" stroke="' + COL.tongDark + '" stroke-width="0.8"/>' +
      '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (r * 0.6).toFixed(2) + '" fill="#fffdf6"/>' +
      '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (r * 0.28).toFixed(2) + '" fill="' + COL.tongRed + '"/>';
  }

  function tongPips(n) {
    var pts = DOTS[n], r = DOT_R[n], s = '';
    for (var i = 0; i < pts.length; i++) s += dot(px(pts[i][0]), py(pts[i][1]), r);
    return s;
  }

  /* ---------- 条（竹节） ---------- */
  function stick(cx, cy, w, h) {
    var x = cx - w / 2, y = cy - h / 2;
    return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + (w * 0.45).toFixed(1) + '" fill="' + COL.tiao + '"/>' +
      '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (w * 0.34).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="' + (w * 0.3).toFixed(1) + '" fill="' + COL.tiaoLight + '" opacity="0.55"/>' +
      '<line x1="' + x.toFixed(1) + '" y1="' + (cy - h * 0.17).toFixed(1) + '" x2="' + (x + w).toFixed(1) + '" y2="' + (cy - h * 0.17).toFixed(1) + '" stroke="' + COL.tiaoDark + '" stroke-width="1.1"/>' +
      '<line x1="' + x.toFixed(1) + '" y1="' + (cy + h * 0.17).toFixed(1) + '" x2="' + (x + w).toFixed(1) + '" y2="' + (cy + h * 0.17).toFixed(1) + '" stroke="' + COL.tiaoDark + '" stroke-width="1.1"/>';
  }

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

  function tiaoSticks(n) {
    var pts = STICKS[n], h = STICK_H[n], w = h * 0.42, s = '';
    for (var i = 0; i < pts.length; i++) s += stick(px(pts[i][0]), py(pts[i][1]), w, h);
    return s;
  }

  /* 一索 = 幺鸡（鸟） */
  function tiaoBird() {
    return '<g>' +
      '<ellipse cx="30" cy="46" rx="12" ry="15" fill="' + COL.tiao + '"/>' +
      '<path d="M30 31 q-9 -6 -6 -16 q7 4 9 12 z" fill="' + COL.tiaoDark + '"/>' +
      '<circle cx="30" cy="25" r="8.5" fill="' + COL.tiao + '"/>' +
      '<path d="M30 17 q3 -7 8 -8 q-1 6 -5 9 z" fill="' + COL.tongRed + '"/>' +
      '<circle cx="27" cy="24" r="1.7" fill="#0d2e1c"/>' +
      '<path d="M38 26 l7 3 l-7 3 z" fill="#d99a2b"/>' +
      '<path d="M18 50 q-8 6 -10 16 q10 -2 14 -9 z" fill="' + COL.tiaoLight + '" opacity="0.85"/>' +
      '<path d="M42 50 q8 6 10 16 q-10 -2 -14 -9 z" fill="' + COL.tiaoLight + '" opacity="0.85"/>' +
      '<path d="M22 60 l-3 12 M38 60 l3 12" stroke="' + COL.tiaoDark + '" stroke-width="2" stroke-linecap="round"/>' +
      '</g>';
  }

  function tiaoContent(n) {
    if (n === 1) return tiaoBird();
    return tiaoSticks(n);
  }

  /* ---------- 万（汉字） ---------- */
  var CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function wanContent(n) {
    return '<text x="30" y="34" text-anchor="middle" font-size="30" font-weight="700" ' +
      'font-family="KaiTi,STKaiti,SimSun,STSong,serif" fill="' + COL.wanNum + '">' + CN[n] + '</text>' +
      '<text x="30" y="70" text-anchor="middle" font-size="27" font-weight="700" ' +
      'font-family="KaiTi,STKaiti,SimSun,STSong,serif" fill="' + COL.wanChar + '">萬</text>';
  }

  function face(id) {
    var suit = Math.floor(id / 9), rank = (id % 9) + 1;
    var content = suit === 0 ? wanContent(rank) : (suit === 1 ? tiaoContent(rank) : tongPips(rank));
    return '<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" ' +
      'style="display:block;border-radius:8px">' + panel() + content + '</svg>';
  }

  /* ---------- 牌背 ---------- */
  function back() {
    var dots = '';
    for (var r = 0; r < 3; r++) for (var c = 0; c < 2; c++) {
      dots += '<circle cx="' + (22 + c * 16) + '" cy="' + (24 + r * 18) + '" r="3.4" fill="' + COL.backAccent + '" opacity="0.5"/>';
    }
    return '<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="display:block;border-radius:8px">' +
      '<rect x="1.2" y="1.2" width="57.6" height="81.6" rx="8" fill="' + COL.body + '" stroke="' + COL.bodyEdge + '" stroke-width="1.2"/>' +
      '<rect x="6" y="6" width="48" height="72" rx="6" fill="' + COL.back + '" stroke="' + COL.backDark + '" stroke-width="1.2"/>' +
      '<rect x="9.5" y="9.5" width="41" height="65" rx="4" fill="none" stroke="' + COL.backAccent + '" stroke-width="0.9" opacity="0.6"/>' +
      dots + '</svg>';
  }

  window.MJTiles = { face: face, back: back, CN: CN };
})();
