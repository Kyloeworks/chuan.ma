/* 川麻视觉设计令牌 · 单一源 (single source of truth)
 * ---------------------------------------------------------------------------
 * 为什么存在：牌面（tiles-ui.js）、GPU 牌桌（pixi-table.js）、三处页面样式
 * 原先各写一份色值，改一处必漂移。本文件把「色板 + 质感参数」集中定义，
 * 由三处共同消费：
 *   - 浏览器：<script src=tokens.js> → window.CMTokens（build.mjs 内联到每个页面）
 *   - Node   ：视觉回归脚本用 new Function('window', src) 取同一份值做断言
 *   - 样式   ：build.mjs 把模板里的 __TOKENS_CSS__ 占位注释替换为 CMTokens.css()，产出 :root{...}
 *             （坑：别在注释里写出「注释结束符」的完整字符序列，那会提前闭合本注释，
 *              导致 new Function(src) 直接语法报错 —— 2026-09-19 实际踩到过）
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
      inkBot: '#2c3c5c',                // 字形渐变下端（比 ink 略亮，刻痕里也有层次）
      inkHi: 'rgba(255,255,255,.42)',   // 刻字顶部高光
      inkLo: 'rgba(24,34,54,.30)',      // 刻字底部暗影
      char: '#bf3626',
      charBot: '#9c2a1c',
      charHi: 'rgba(255,255,255,.34)',
      charLo: 'rgba(110,32,20,.34)'
    },

    /* ── 条：竹节绿（横向渐变 = 圆柱：暗 / 亮 / 暗）
     *   暗端刻意不压太深：圆柱感靠「亮度差」而不是「把两侧做黑」——
     *   暗端一旦落到高饱和绿之外，整根竹子会发闷（实测 chroma.green 0.021→0.003）。 */
    tiao: {
      dark: '#176b43',
      mid: '#1c7d4d',
      lit: '#2aa86a',
      hi: '#6cc896',
      nodeDark: '#0b3d26',
      birdBody: '#1c7d4d',
      birdDark: '#0f5233',
      birdWing: '#6cc896',
      beak: '#d99a2b',
      comb: '#c0392b',
      eye: '#0d2e1c',

      /* 红色定位节（2026-09-20）——真实牌面用红色标出条子的「锚点」，
       * 让玩家不看数字也能秒认这四张牌：
       *   5 条 = 正中一根红   · 7 条 = 最上面一根红
       *   9 条 = 中间一整行三根红
       * 结构与绿竹节完全同构（同一条圆柱横向渐变 + 同款竹节线），只换色系。
       * 红选**朱红**而不是警示红：牌面是奶油底，亮度不够的红会读成脏褐色。
       * 暗端沿用筒心暗部 #8f2a1f，使全牌面的红属于同一族。 */
      red: {
        dark: '#8f2a1f',
        mid: '#a92e1f',
        lit: '#c0392b',
        hi: '#e8907c',
        nodeDark: '#5c130a'
      }
    },

    /* ── 筒：蓝环 + 朱红靶心（环面径向渐变 + 高光弧） ── */
    tong: {
      rimDark: '#24569a',
      face: '#3f86cf',
      faceHi: '#8fbdec',
      core: '#c0392b',
      coreDark: '#8f2a1f',
      coreLit: '#e0604f',
      coreHi: 'rgba(255,255,255,.5)',
      white: '#fffdf6'
    },

    /* ── 牌背：织物蓝 + 斜织纹 + 边框高光 ── */
    back: {
      top: '#3a7cc4',
      mid: '#2a6aad',
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
      ui: '#2f6b4f',      // 页面用绒布色（.stage 背景兜底）
      stage: '#0b2a1c'    // canvas 清屏色（PixiJS background）
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
      tiaoTile: '#1c7d4d',   // 牌面竹绿（比文字绿深一档，用于色块/徽章）
      tiaoRed: '#c0392b',    // 牌面红竹节（5/7/9 条的定位节，用于图例与说明文字）
      tong: '#2b6cb0',
      // 牌桌深色外壳
      shellBg: '#0f1418',
      shellHead: '#161c22',
      shellLine: '#232b33',
      mono: 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
    },

    /* ── 牌桌外壳（深色 HUD）细色板 ── */
    shell: {
      headInk: '#e9edf2',
      dim: '#93a1b0',
      faint: '#6b7784',
      panel: '#1b2229',
      panelLine: '#2c353f',
      panelInk: '#dfe6ee',
      link: '#4b9bff',
      linkHi: '#8ec2ff',
      btnHi: '#cfe0f0',
      accentEdge: '#7ab2ff',
      okBg: '#14351f', okInk: '#7fd8a5',
      failBg: '#3b1717', failInk: '#f19a90',
      easy: '#0f6e56',
      hard: '#a32d2d',
      me: '#f6f9ff',
      drawerBg: 'rgba(14,20,26,.95)',
      drawerLine: '#2b343d',
      drawerInk: '#c3cdd8',
      overlay: 'rgba(8,12,16,.72)'
    },

    /* ── 质感开关与强度（想降噪/回退时只改这里，不用翻绘制代码） ── */
    fx: {
      tileGloss: 1,      // 牌身高光/内阴影总开关系数 0~1
      panelDepth: 1,     // 内凹面板的凹陷强度
      edgeLight: 1,      // 凸起牌身左右内缘的受光/背光强度（统一光源＝左上）
      weave: 1,          // 牌背织纹强度
      feltSlub: 2600,    // 绒布拉丝根数
      feltWeave: 1400,   // 绒布斜织纹根数
      feltVignette: true,
      shadowLayers: 2
    },

    /* ── 版式尺度（全站唯一来源） ──────────────────────────────────────────
       为什么要有这一节：此前四套样式（site.css / 算牌器 / 牌面页 / 牌桌）各写各的，
       静态样式里就散出 20 个字号、20 个间距、10 个圆角，同一个语义的元素跨页不一致
       （h1 分别是 31 / 22 / 24）。「层次」不是靠调某些值做出来的，是靠**只有这几档**做出来的。
       规则：样式表里不允许出现字面量 px 的字号/间距/圆角，一律引用 --fs-* / --sp-* / --r-* / --lh-*。
       每档都有明确角色，新增元素时先选角色，不要新造数值。 */
    scale: {
      // 字号：9 档 + 1 个显示级数字。小字到正文逐级递增，标题层明确断开
      fs: {
        meta: 12,     // 角标 / kicker / pill / 表头 / 页脚 / 图注
        small: 13,    // 导航链接 / 次级说明 / 小按钮
        dense: 14,    // 表格正文 / 牌面编码 / 卡片副标题
        ui: 15,       // 界面正文（工具页，密度优先）
        body: 16,     // 阅读正文 / 导语
        h3: 18,       // 三级标题 / 卡片标题
        h2: 22,       // 二级标题
        h1: 28,       // 一级标题（全站唯一，跨页一致）
        num: 40       // 显示级数字（算牌器结果，唯一例外档）
      },
      // 间距：4px 体系，hair=2 只用于发丝级微调（如描边内侧留白）
      // ⚠ 键名直接拼成 CSS 变量名（--sp-<key>），所以带数字的键必须与 CSS 里的写法完全一致。
      //   踩过：这里写 x3l 生成 --sp-x3l，CSS 里写的是 var(--sp-3xl) —— 全部引用静默失效
      //   （CSS 变量未定义时整条声明被丢弃，不报错、控制台也不提示）。
      sp: {
        hair: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20,
        xxl: 24, '3xl': 32, '4xl': 40, '5xl': 64
      },
      // 圆角：3 档 + 胶囊。小控件 / 卡片面板 / 大面板 / 胶囊标签
      radius: { sm: 6, md: 12, lg: 20, full: 999 },
      // 边框层次：3 档，含义固定 —— 发丝描边 / 分隔条 / 强调色条
      bw: { hair: 1, rule: 2, accent: 4 },
      // 行高：3 档，按「用途」而不是按元素挑
      lh: { tight: 1.25, ui: 1.5, body: 1.7 }
    },

    /* ── 汉字轮廓（web/glyphs.js，由 tools/extract-glyphs.py 从 OFL 字体抽取） ──
       不再使用系统字体渲染「萬 / 一~九」：跨设备字形不一致，且 SVG 光栅化为
       pixi 纹理时缺字会直接成方块。此处仅记录来源与授权，供审计与再生成。
       字体风格选了**楷体**而非宋体：宋体横画天生细（一二三 的墨量只有其他字
       三分之一），而牌面需要匀重笔画；牌河尺寸下楷体的「一」墨迹是宋体的 1.6 倍。 */
    glyphs: {
      source: 'LXGW WenKai TC Bold',
      upstream: 'https://github.com/lxgw/LxgwWenKai',
      license: 'SIL Open Font License 1.1',
      licenseFile: 'docs/OFL.txt',
      generator: 'web/tools/extract-glyphs.py',
      chars: '一二三四五六七八九萬'
    }
  };

  /* ── 产出 :root{...}：由 build.mjs 注入模板与 site.css ── */
  T.css = function () {
    var u = T.ui, f = T.felt, t = T.tile, s = T.shell, sc = T.scale;
    var v = [
      // UI 层：沿用既有变量名，样式表可平滑迁移
      ['--bg', u.bg], ['--card', u.card], ['--ink', u.ink], ['--sub', u.sub],
      ['--line', u.line], ['--accent', u.accent], ['--gold', u.gold],
      ['--felt', f.ui], ['--wan', u.wan], ['--tiao', u.tiao], ['--tong', u.tong],
      ['--mono', u.mono],
      // 质感层
      ['--cm-tiao-tile', u.tiaoTile],
      ['--cm-tiao-red', u.tiaoRed],
      ['--cm-accent-hi', u.accentHi], ['--cm-accent-lo', u.accentLo],
      ['--cm-tile-top', t.top], ['--cm-tile-mid', t.mid], ['--cm-tile-bot', t.bot],
      ['--cm-tile-edge', t.edge], ['--cm-panel-top', t.pTop], ['--cm-panel-bot', t.pBot],
      ['--cm-panel-edge', t.pEdge],
      ['--cm-felt-hot', f.hot], ['--cm-felt-deep', f.deep],
      ['--cm-rim-gold', f.rimGold], ['--cm-rim-outer', f.rimOuter],
      // 牌桌外壳
      ['--cm-shell-bg', u.shellBg], ['--cm-shell-head', u.shellHead], ['--cm-shell-line', u.shellLine],
      ['--cm-head-ink', s.headInk], ['--cm-dim', s.dim], ['--cm-faint', s.faint],
      ['--cm-panel', s.panel], ['--cm-panel-line', s.panelLine], ['--cm-panel-ink', s.panelInk],
      ['--cm-link', s.link], ['--cm-link-hi', s.linkHi],
      ['--cm-btn-hi', s.btnHi], ['--cm-accent-edge', s.accentEdge],
      ['--cm-ok-bg', s.okBg], ['--cm-ok-ink', s.okInk],
      ['--cm-fail-bg', s.failBg], ['--cm-fail-ink', s.failInk],
      ['--cm-easy', s.easy], ['--cm-hard', s.hard], ['--cm-me', s.me],
      ['--cm-drawer-bg', s.drawerBg], ['--cm-drawer-line', s.drawerLine], ['--cm-drawer-ink', s.drawerInk],
      ['--cm-overlay', s.overlay], ['--cm-stage', f.stage]
    ];
    // 版式尺度：命名与 T.scale 一一对应，样式表只引用这些变量
    var groups = [
      ['--fs-', sc.fs, 'px'], ['--sp-', sc.sp, 'px'],
      ['--r-', sc.radius, 'px'], ['--bw-', sc.bw, 'px'], ['--lh-', sc.lh, '']
    ];
    for (var g = 0; g < groups.length; g++) {
      var pre = groups[g][0], obj = groups[g][1], unit = groups[g][2];
      for (var k in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) v.push([pre + k, obj[k] + unit]);
      }
    }
    var out = ':root{\n';
    for (var i = 0; i < v.length; i++) out += '  ' + v[i][0] + ':' + v[i][1] + ';\n';
    return out + '}\n';
  };

  root.CMTokens = T;
})(typeof window !== 'undefined' ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this));
