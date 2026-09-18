/* 川麻视觉设计令牌 · 单一源 (single source of truth)
 * ---------------------------------------------------------------------------
 * 为什么存在：牌面（tiles-ui.js）、GPU 牌桌（pixi-table.js）、三处页面样式
 * 原先各写一份色值，改一处必漂移。本文件把「色板 + 质感参数」集中定义，
 * 由三处共同消费：
 *   - 浏览器：<script src=tokens.js> → window.CMTokens（build.mjs 内联到每个页面）
 *   - Node   ：视觉回归脚本用 new Function('window', src) 取同一份值做断言
 *   - 样式   ：build.mjs 把 /*__TOKENS_CSS__*/ 替换为 CMTokens.css()，产出 :root{...}
 *
 * 契约（改本文件会同时影响牌面 / 牌桌 / 页面样式，改动即全局生效）：
 *   CMTokens.geo      牌面几何（viewBox 单位，非像素）
 *   CMTokens.tile     牌身与内凹面板
 *   CMTokens.wan/tiao/tong/back   各花色墨色
 *   CMTokens.felt     桌面绒布与桌边
 *   CMTokens.side     2.5D 牌体厚度侧边
 *   CMTokens.ui       UI 层（与既有 --accent 等变量名对齐，便于样式平滑迁移）
 *   CMTokens.fx       质感开关与强度（高光 / 内阴影 / 纹理密度 / 暗角）
 *   CMTokens.css()    产出 :root{...} 字符串
 * ---------------------------------------------------------------------------
 */
(function (root) {
  'use strict';

  var T = {
    version: '1.0.0',

    /* ── 牌面几何（viewBox 60×84，接近真实牌 0.714 比例） ── */
    geo: {
      vbW: 60, vbH: 84,
      rOuter: 8,      // 牌身外圆角
      rPanel: 5,      // 内凹面板圆角
      edge: 1.2,      // 牌身描边宽
      panelInset: 5,  // 面板相对牌身内缩
      panelEdgeW: 0.9
    },

    /* ── 牌身：象牙白实体感（顶亮 → 底暗 + 顶部高光 + 底部内阴影） ── */
    tile: {
      top: '#fdf9ee',
      mid: '#f6efdd',
      bot: '#e7dcc3',
      edge: '#c6b99c',
      edgeHi: 'rgba(255,255,255,.55)',   // 顶部 1px 高光线
      innerLo: 'rgba(138,118,84,.16)',   // 底部内阴影
      innerHi: 'rgba(255,255,255,.7)',   // 顶部内高光
      // 内凹面板（刻面）：比牌身略亮，四周有内阴影制造凹陷
      pTop: '#fffefa',
      pBot: '#f7f2e5',
      pEdge: '#e2dac5',
      pInHi: 'rgba(255,255,255,.95)',
      pInLo: 'rgba(150,132,96,.12)'
    },

    /* ── 万：靛黑汉字 + 朱红「萬」，带刻字高光/暗影 ── */
    wan: {
      ink: '#1e2b45',
      inkHi: 'rgba(255,255,255,.42)',   // 刻字顶部高光
      inkLo: 'rgba(24,34,54,.30)',      // 刻字底部暗影
      char: '#bf3626',
      charHi: 'rgba(255,255,255,.34)',
      charLo: 'rgba(110,32,20,.34)'
    },

    /* ── 条：竹节绿（三段渐变 = 暗 / 亮 / 暗，模拟圆柱） ── */
    tiao: {
      dark: '#0f5233',
      mid: '#1c7d4d',
      lit: '#22995e',
      hi: '#6cc896',
      nodeDark: '#0b3d26',
      birdBody: '#1c7d4d',
      birdDark: '#0f5233',
      birdWing: '#6cc896',
      beak: '#d99a2b',
      comb: '#c0392b',
      eye: '#0d2e1c'
    },

    /* ── 筒：蓝环 + 朱红靶心（环面径向渐变 + 高光弧） ── */
    tong: {
      rimDark: '#24569a',
      face: '#3f86cf',
      faceHi: '#8fbdec',
      core: '#c0392b',
      coreDark: '#8f2a1f',
      coreHi: 'rgba(255,255,255,.5)',
      white: '#fffdf6'
    },

    /* ── 牌背：织物蓝 + 斜织纹 + 边框高光 ── */
    back: {
      top: '#3a7cc4',
      bot: '#1e4d84',
      edge: '#173e6d',
      inner: '#e8eef7',
      weave: 'rgba(232,238,247,.13)',
      weft: 'rgba(12,36,66,.20)',
      hi: 'rgba(255,255,255,.32)'
    },

    /* ── 桌面绒布：中央柔和光斑 → 边缘深绿 + 定向拉丝 + 暗角 ── */
    felt: {
      hot: '#2e7f5b',     // 光斑中心（0）
      m1: '#1f6847',      // 0.4
      m2: '#14503a',      // 0.72
      deep: '#0a2c1e',    // 1
      slubHi: 'rgba(255,255,255,.055)',  // 拉丝亮丝
      slubLo: 'rgba(0,0,0,.075)',        // 拉丝暗丝
      vign: 'rgba(3,16,10,.72)',         // 四角暗角
      // 桌边三环
      rimOuter: '#061c12',
      rimGold: '#d9b45c',
      rimGoldHi: 'rgba(255,232,168,.55)',
      rimInner: '#6fae8c',
      ui: '#2f6b4f'       // 页面用绒布色（.stage 背景兜底）
    },

    /* ── 2.5D 牌体厚度侧边（顶亮 → 底暗，不再是纯色平涂） ── */
    side: {
      top: '#e8dcbc',
      bot: '#a8956e',
      edge: '#8d7b5a'
    },

    /* ── 落地阴影分层（近影紧而深 / 远影散而淡） ── */
    shadow: {
      nearA: 0.30, nearDy: 2, nearBlur: 3,
      farA: 0.14, farDy: 6, farBlur: 10,
      color: 0x000000
    },

    /* ── UI 层：与既有 CSS 变量名对齐（--accent / --gold / --felt ...） ── */
    ui: {
      bg: '#f5f6f8',
      card: '#ffffff',
      ink: '#1a1d21',
      sub: '#5b6470',
      line: '#e4e8ed',
      accent: '#1f6feb',
      accentHi: '#3d8ef8',
      accentLo: '#1a5fd0',
      gold: '#c9971f',
      wan: '#c0392b',
      tiao: '#1e8e5a',
      tong: '#2b6cb0',
      // 牌桌深色外壳
      shellBg: '#0f1418',
      shellHead: '#161c22',
      shellLine: '#232b33',
      mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
    },

    /* ── 质感开关与强度（想降噪/回退时只改这里，不用翻绘制代码） ── */
    fx: {
      tileGloss: 1,      // 牌身高光/内阴影总开关系数 0~1
      panelDepth: 1,     // 内凹面板的凹陷强度
      weave: 1,          // 牌背织纹强度
      feltSlub: 2600,    // 绒布拉丝根数
      feltWeave: 1400,   // 绒布斜织纹根数
      feltVignette: true,
      shadowLayers: 2
    }
  };

  /* ── 产出 :root{...}：由 build.mjs 注入模板与 site.css ── */
  T.css = function () {
    var u = T.ui, f = T.felt, t = T.tile;
    var v = [
      ['--bg', u.bg], ['--card', u.card], ['--ink', u.ink], ['--sub', u.sub],
      ['--line', u.line], ['--accent', u.accent], ['--gold', u.gold],
      ['--felt', f.ui], ['--wan', u.wan], ['--tiao', u.tiao], ['--tong', u.tong],
      ['--mono', u.mono],
      ['--cm-accent-hi', u.accentHi], ['--cm-accent-lo', u.accentLo],
      ['--cm-shell-bg', u.shellBg], ['--cm-shell-head', u.shellHead], ['--cm-shell-line', u.shellLine],
      ['--cm-tile-top', t.top], ['--cm-tile-mid', t.mid], ['--cm-tile-bot', t.bot],
      ['--cm-tile-edge', t.edge], ['--cm-panel-top', t.pTop], ['--cm-panel-bot', t.pBot],
      ['--cm-panel-edge', t.pEdge],
      ['--cm-felt-hot', f.hot], ['--cm-felt-deep', f.deep],
      ['--cm-rim-gold', f.rimGold], ['--cm-rim-outer', f.rimOuter]
    ];
    var out = ':root{\n';
    for (var i = 0; i < v.length; i++) out += '  ' + v[i][0] + ':' + v[i][1] + ';\n';
    return out + '}\n';
  };

  root.CMTokens = T;
})(typeof window !== 'undefined' ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this));
