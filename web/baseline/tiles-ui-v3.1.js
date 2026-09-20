/* 牌面资产 v3.1 —— 归档快照，仅用于对照与回归，**不是运行时代码**。
 * 来源：git HEAD:web/tiles-ui.js
 * 由 web/fix-baseline.cjs 导出。运行时代码是 web/tiles-ui.js。
 */
/* 川麻麻将牌面资产 v3.1 · 程序化 SVG（零依赖，33 个牌面：27 张 + 牌背）
 * ---------------------------------------------------------------------------
 * 用法：MJTiles.face(tileId) / MJTiles.back() / MJTiles.CN
 *   tileId 0..26 =>  suit = floor(id/9)  rank = id%9+1
 *
 * 视觉契约（v3，2026-09-19 吸收开源资产经验后升级）：
 *   - 统一光源：**左上方**（方位角约 45°）。牌身倒角高光、内凹面板明暗、
 *     条/筒的受光面全部服从这一个方向 —— 此前牌身假设纯顶光、筒心高光却在左上，互相矛盾。
 *   - 牌身是**凸起**：垂直渐变「顶亮 → 底暗」+ 左上偏置的柔和高光 + 底部外缘暗边
 *   - 面板是**凹陷**：顶部内侧暗（上壁背光）+ 底部内侧亮（下壁受光）—— 方向与牌身相反
 *   - 汉字是**内嵌矢量路径**（见下方字形引擎），不再依赖系统字体
 *   - 花色是**实体**：条=圆柱（横向暗→亮→暗）、筒=球面（径向渐变 + 左上高光点）
 *   - 色板与强度全部来自 web/tokens.js，本文件不硬写色值
 *
 * 视觉契约（v3.1，2026-09-20 条子对齐实体牌面画法）：
 *   - **红色定位节**：5 条正中一根红、7 条最上一根红、9 条中间一行三根红
 *     （见 RED_STICKS）。这是实体牌的通行画法，也是新手最快建立「颜色 → 牌名」
 *     条件反射的三张牌。红色节与绿色节**同结构、同受光**，只换色系。
 *   - **8 条改传统锯齿版式**：顶部四条倒 M（W）+ 底部四条 M，中间收腰成沙漏轮廓
 *     （见 ZIG_U / ZIG_ROW / zigSegments8）。此前是 2×4 的平铺方阵，与实体牌不符。
 *
 * ⚠ 三个必须守住的约束（破坏会静默失效）：
 *   1. 外层 <svg> 必须原样保留 `width="100%" height="100%"` ——
 *      pixi-table.js 的 svgToTexture() 靠字符串精确匹配它来换尺寸，换了就渲不出纹理。
 *   2. 每张牌自带的 <defs> 渐变 id 必须**全局唯一**（自增 uid 保证）——
 *      同一页面/同一张联系表里 33 张牌同框时，同名 id 会互相抢渐变（浏览器只认第一个）。
 *   3. 必须在 tiles-ui.js **之前**引入 web/glyphs.js（汉字轮廓数据）——
 *      否则万子退化成空白面板（face() 不报错，只是没字）。
 *
 * 依赖：web/tokens.js（色板）、web/glyphs.js（汉字轮廓）。两者缺失时各自走兜底/跳过。
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
    weave: pick('fx.weave', 1),
    edge: pick('fx.edgeLight', 1)
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
    /* 条 · 红色定位节（5 / 7 / 9 条用来「一眼认出」的那几根） */
    tiaoRedDark: pick('tiao.red.dark', '#8f2a1f'),
    tiaoRedMid: pick('tiao.red.mid', '#a92e1f'),
    tiaoRedLit: pick('tiao.red.lit', '#c0392b'),
    tiaoRedHi: pick('tiao.red.hi', '#e8907c'),
    tiaoRedNode: pick('tiao.red.nodeDark', '#5c130a'),
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

  /* 竹节的两套色板。除了色系不同，**结构与画法必须完全一致** ——
     红色定位节是「同一根竹子换了个颜色」，不是另一种材质；一旦亮度层次不一样，
     5/7/9 条上的红节会像贴上去的贴纸。role 用于渐变 id 命名，便于调试时分辨。 */
  var PAL_TIAO = {
    dark: COL.tiaoDark, mid: COL.tiaoMid, lit: COL.tiaoLit,
    hi: COL.tiaoHi, node: COL.tiaoNode, role: 'tiao'
  };
  var PAL_TIAO_RED = {
    dark: COL.tiaoRedDark, mid: COL.tiaoRedMid, lit: COL.tiaoRedLit,
    hi: COL.tiaoRedHi, node: COL.tiaoRedNode, role: 'tiaored'
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

  /* ================= 汉字轮廓引擎（内嵌矢量路径，零字体依赖） =================
   * 为什么不用 <text font-family="KaiTi,SimSun">：
   *   1. 楷体/宋体是 Windows 专有字体 —— Linux / Android / iOS 上会静默回退成
   *      黑体或默认 serif，「萬」和数字的字形与字距在每台设备上都不一样。
   *   2. SVG 被当作图片光栅化时（pixi-table.js 的 svgToTexture 走的就是这条路：
   *      Image → canvas → 纹理），字体解析更不可控，缺字直接成方块。
   *   3. 把专有字体的派生轮廓公开发布有授权风险。
   *
   * 做法：web/tools/extract-glyphs.py 从 Noto Serif TC Bold（SIL OFL 1.1）抽出
   * 十个字形的轮廓（字体 em 坐标系，upem=1000），运行期做一次仿射拟合后直接画 <path>。
   * 这是权威开源牌面资产（FluffyStuff/riichi-mahjong-tiles）的通行做法：
   * 全部手绘/追踪路径、零字体依赖 —— 跨设备像素一致的前提条件。
   * ========================================================================= */
  var GL = (typeof window !== 'undefined' && window.CMGlyphs) || null;

  /* 对路径做仿射拟合。支持的命令集：M L H V C Q Z
   *   —— 与 web/tools/extract-glyphs.py 的 ALLOWED_CMDS 必须保持同步。
   * C / Q / L / M 的参数成对（C 三对、Q 两对）；**H / V 是单坐标命令**
   *   —— CJK 轮廓里横竖笔画大量使用（实测 67 个 H、44 个 V），
   *     漏掉它们会让后续坐标整体错位，产出一串 NaN：字会整块消失，
   *     而且页面不报任何错。所以这里不静默兜底，命令不认识 / 参数不成对就抛错。
   * Z 无参数。仿射变换下贝塞尔控制点同步变换，曲线形状不变。 */
  var PATH_CMDS = 'MLHVCQZ';
  function fitPath(d, sx, sy, dx, dy) {
    var out = '', re = /([A-Za-z])([^A-Za-z]*)/g, m;
    while ((m = re.exec(d)) !== null) {
      var c = m[1].toUpperCase();
      if (PATH_CMDS.indexOf(c) < 0) throw new Error('fitPath: 未支持的路径命令 "' + m[1] + '"');
      var n = (m[2].match(/-?\d*\.?\d+/g) || []).map(parseFloat);
      out += c;
      if (c === 'Z') continue;
      var i;
      if (c === 'H') { for (i = 0; i < n.length; i++) out += (i ? ' ' : '') + f1(n[i] * sx + dx); continue; }
      if (c === 'V') { for (i = 0; i < n.length; i++) out += (i ? ' ' : '') + f1(n[i] * sy + dy); continue; }
      if (n.length % 2) {
        throw new Error('fitPath: ' + c + ' 的参数为奇数个（' + n.length + '），命令集假定已变');
      }
      for (i = 0; i < n.length; i += 2) {
        out += (i ? ' ' : '') + f1(n[i] * sx + dx) + ' ' + f1(n[i + 1] * sy + dy);
      }
    }
    return out;
  }

  /* 把某个字以「墨迹包围盒中心」对齐到 (cx, cy)，字号 size＝em 边长（viewBox 单位）。
     用墨迹中心而非字体基线：牌面是图形排版，一 / 二 / 萬 的墨迹在 em 里的位置
     各不相同（「一」只有 0.15em 高、居中在 0.46em 处），按基线对齐会让它明显偏上。 */
  var pathCache = {};
  function glyphPath(ch, cx, cy, size) {
    if (!GL || !GL.glyphs || !GL.glyphs[ch]) return null;
    var key = ch + '|' + cx + '|' + cy + '|' + size;
    if (pathCache[key]) return pathCache[key];
    var g = GL.glyphs[ch], s = size / GL.upem;
    var bx = (g.b[0] + g.b[2]) / 2, by = (g.b[1] + g.b[3]) / 2;
    // 字体坐标系 y 轴向上、SVG 向下 —— sy 取负实现翻转
    var d = fitPath(g.d, s, -s, cx - bx * s, cy + by * s);
    pathCache[key] = d;
    return d;
  }
  function glyphsReady() {
    return !!(GL && GL.glyphs && GL.glyphs['萬']);
  }

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

  /* ================= 牌体：凸起牌身 + 凹陷面板 =================
   * 单一光源：左上方（方位角 45°、略高于水平），全牌面服从这一个方向。
   * 按朗伯余弦定律，凸起的四壁受光：
   *   上壁（法线朝上）受光 → 顶部高光；下壁背光 → 底部暗边
   *   左壁受光 → 左内缘亮线；右壁背光 → 右内缘暗线
   * 凹陷面板的四壁**方向完全相反**（这正是凹与凸的判据，也是这里唯一不能省的一步）：
   *   上内壁投影 → 顶部内侧暗；下内壁受光 → 底部内侧亮
   *   左内壁背光 → 左内缘暗；右内壁受光 → 右内缘亮
   * 光强用多档渐变而非两档线性 —— 两档会在带边缘留下可见的硬转折。
   * （参考资产 FluffyStuff/riichi-mahjong-tiles 的 Front.svg 用高斯模糊的白/黑异形色块
   *   表达同一件事；我们改用多档渐变，因为牌面还要经 canvas 光栅化成 pixi 纹理，
   *   滤镜在 Image→canvas 这条路上既慢又不可靠。）
   */
  function shell(D) {
    var bodyG = D.linear('body', 0, 0, 0, 1, [
      [0, COL.bodyTop], [0.5, COL.bodyMid], [1, COL.bodyBot]
    ]);
    var panelG = D.linear('panel', 0, 0, 0, 1, [
      [0, COL.pTop], [1, COL.pBot]
    ]);
    // 凸起 · 顶部高光：轴向略向右下偏置 → 左上更亮，读作「光从左上来」
    var topHi = D.linear('toplit', 0, 0, 0.3, 1, [
      [0, COL.innerHi, FX.gloss], [0.45, COL.innerHi, FX.gloss * 0.34], [1, COL.innerHi, 0]
    ]);
    // 凸起 · 底部暗边（垂直落回桌面，纯垂直方向才是对的）
    var footLo = D.linear('foot', 0, 0, 0, 1, [
      [0, COL.innerLo, 0], [0.55, COL.innerLo, COL.innerLo === '' ? 0 : 1], [1, COL.innerLo]
    ]);
    // 凸起 · 左内缘亮线 / 右内缘暗线
    var edgeHi = D.linear('ledge', 0, 0, 1, 0, [
      [0, COL.innerHi, FX.edge], [1, COL.innerHi, 0]
    ]);
    var edgeLo = D.linear('redge', 0, 0, 1, 0, [
      [0, COL.innerLo, 0], [1, COL.innerLo, FX.edge]
    ]);
    // 凹陷面板 · 上内壁投影 / 下内壁受光
    var panTopSh = D.linear('pshade', 0, 0, 0, 1, [
      [0, COL.pInLo, FX.panel], [1, COL.pInLo, 0]
    ]);
    var panBotHi = D.linear('plit', 0, 1, 0, 0, [
      [0, COL.pInHi, FX.panel], [1, COL.pInHi, 0]
    ]);
    // 凹陷面板 · 左内壁背光 / 右内壁受光（与凸起相反）
    var panLeftSh = D.linear('pleft', 0, 0, 1, 0, [
      [0, COL.pInLo, FX.panel], [1, COL.pInLo, 0]
    ]);
    var panRightHi = D.linear('pright', 0, 0, 1, 0, [
      [0, COL.pInHi, 0], [1, COL.pInHi, FX.panel]
    ]);
    var clip = D.clip('bodyclip', '<rect x="' + BX + '" y="' + BY + '" width="' + BW +
      '" height="' + BH + '" rx="' + BR + '"/>');
    var pclip = D.clip('panelclip', '<rect x="' + PX + '" y="' + PY +
      '" width="' + PW + '" height="' + PH + '" rx="' + PR + '"/>');

    var s = '';
    // 牌身
    s += '<rect x="' + BX + '" y="' + BY + '" width="' + BW + '" height="' + BH + '" rx="' + BR +
      '" fill="url(#' + bodyG + ')"/>';
    s += '<g clip-path="url(#' + clip + ')">';
    s += '<rect x="' + BX + '" y="' + BY + '" width="' + BW + '" height="' + f1(9 * FX.gloss) +
      '" fill="url(#' + topHi + ')"/>';
    s += '<rect x="' + BX + '" y="' + f1(BY + BH - 11) + '" width="' + BW + '" height="11" fill="url(#' + footLo + ')"/>';
    s += '<rect x="' + BX + '" y="' + BY + '" width="3" height="' + BH + '" fill="url(#' + edgeHi + ')"/>';
    s += '<rect x="' + f1(BX + BW - 3.5) + '" y="' + BY + '" width="3.5" height="' + BH +
      '" fill="url(#' + edgeLo + ')"/>';
    s += '</g>';
    // 牌身描边（画在渐变之上，边缘才干净）
    s += '<rect x="' + BX + '" y="' + BY + '" width="' + BW + '" height="' + BH + '" rx="' + BR +
      '" fill="none" stroke="' + COL.bodyEdge + '" stroke-width="1.2"/>';
    // 内凹面板
    s += '<rect x="' + PX + '" y="' + PY + '" width="' + PW + '" height="' + PH + '" rx="' + PR +
      '" fill="url(#' + panelG + ')" stroke="' + COL.pEdge + '" stroke-width="0.9"/>';
    s += '<g clip-path="url(#' + pclip + ')">';
    s += '<rect x="' + PX + '" y="' + PY + '" width="' + PW + '" height="4" fill="url(#' + panTopSh + ')"/>';
    s += '<rect x="' + PX + '" y="' + f1(PY + PH - 3) + '" width="' + PW + '" height="3" fill="url(#' + panBotHi + ')"/>';
    s += '<rect x="' + PX + '" y="' + PY + '" width="2.5" height="' + PH + '" fill="url(#' + panLeftSh + ')"/>';
    s += '<rect x="' + f1(PX + PW - 2.5) + '" y="' + PY + '" width="2.5" height="' + PH +
      '" fill="url(#' + panRightHi + ')"/>';
    s += '</g>';
    return s;
  }

  /* ================= 万：刻字 ================= */
  var CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

  /* 万子版式：数字占上段、萬占下段，两块墨迹合起来在面板里垂直居中。
     字号以「最高墨迹」为准统一取一个值 —— 若让每个数字各自撑满，
     一（墨迹只有 0.15em 高）会胖得离谱、九（0.93em）又会被压小。

     下面的数值是按「墨迹包围盒」而不是 em 框推出来的（Noto Serif TC Bold 实测）：
       九 墨迹高 0.933em → size 29 时 27.1 单位，是九个字里最高的那个，它决定上段高度；
       萬 墨迹高 0.937em → size 26 时 24.4 单位。
     当前排布：数字 12.8~39.8、萬 46.9~71.2，面板内区 5~79 —— 上下各留约 8 单位，
     两段之间留 7 单位。改字号时务必同步跑 npm run smoke（tiles.smoke 会断言不越界、不重叠）。 */
  var WAN_LAYOUT = { numSize: 29, numY: 26.3, charSize: 26, charY: 59.1, cx: 30 };

  function engraved(D, glyph, cy, size, fillTop, fillBot, hi, lo, role) {
    var cx = WAN_LAYOUT.cx;
    var d = glyphPath(glyph, cx, cy, size);
    if (d === null) return '';        // 轮廓缺失时整字跳过，不吐出半个字
    var g = D.linear(role, 0, 0, 0, 1, [[0, fillTop], [0.62, fillTop], [1, fillBot]]);
    var s = '';
    // 下移 0.9 的亮色副本：凹刻的下壁受光，在字下方露出亮边
    s += '<path d="' + glyphPath(glyph, cx, cy + 0.9, size) + '" fill="' + hi + '"/>';
    // 上移 0.35 的暗色副本：上壁背光
    s += '<path d="' + glyphPath(glyph, cx, cy - 0.35, size) + '" fill="' + lo + '"/>';
    s += '<path d="' + d + '" fill="url(#' + g + ')"/>';
    return s;
  }
  function wanContent(D, n) {
    var L = WAN_LAYOUT;
    return engraved(D, CN[n], L.numY, L.numSize, COL.wanInk, COL.wanInkBot,
      COL.wanHi, COL.wanInkLo, 'wanink') +
      engraved(D, '萬', L.charY, L.charSize, COL.wanChar, COL.wanCharBot,
        COL.wanCharHi, COL.wanCharLo, 'wanchar');
  }

  /* ================= 条：圆柱竹节 =================
   * 版式遵循实体牌面的通行画法（不是随便摆满）：
   *   2 条两竖 · 3 条上一下二 · 4 条两列各二 · 5 条四角 + 正中 · 6 条上三下三
   *   7 条上一下三下三 · 8 条上四下四锯齿（见下方 zigSegments8）· 9 条三行三列
   * 坐标是面板内区的归一值（u 横向、v 纵向，0..1），**行优先**：先上后下、同行先左后右。
   * 索引顺序有意义 —— RED_STICKS 就是按索引指定「哪几根是红节」。 */
  var STICKS = {
    2: [[0.5, 0.25], [0.5, 0.75]],
    3: [[0.5, 0.2], [0.26, 0.74], [0.74, 0.74]],
    4: [[0.26, 0.25], [0.74, 0.25], [0.26, 0.75], [0.74, 0.75]],
    5: [[0.2, 0.2], [0.8, 0.2], [0.5, 0.5], [0.2, 0.8], [0.8, 0.8]],
    6: [[0.3, 0.16], [0.7, 0.16], [0.3, 0.5], [0.7, 0.5], [0.3, 0.84], [0.7, 0.84]],
    7: [[0.5, 0.12], [0.22, 0.5], [0.5, 0.5], [0.78, 0.5], [0.22, 0.88], [0.5, 0.88], [0.78, 0.88]],
    9: [[0.16, 0.16], [0.5, 0.16], [0.84, 0.16], [0.16, 0.5], [0.5, 0.5], [0.84, 0.5], [0.16, 0.84], [0.5, 0.84], [0.84, 0.84]]
  };
  var STICK_H = { 2: 17, 3: 16, 4: 15, 5: 14, 6: 14.5, 7: 12.5, 9: 12.5 };

  /* ---- 红色定位节（2026-09-20）：真实牌面用红色标出条子的锚点，
   *      让玩家不看数字也能秒认这三张牌。索引对应 STICKS 的行优先顺序。
   *        5 条 → 正中一根（索引 2）          视觉中心一个红点
   *        7 条 → 最上面一根（索引 0）        顶部一个红点
   *        9 条 → 中间一整行三根（索引 3,4,5）横向一条红带
   *      三张牌各占一种「红的位置类型」（点 / 顶 / 带），互不混淆。 */
  var RED_STICKS = { 5: { 2: 1 }, 7: { 0: 1 }, 9: { 3: 1, 4: 1, 5: 1 } };

  /* ---- 8 条：传统「顶部四条倒 M（W 形）+ 底部四条 M 形」锯齿版式
   *      （实体牌面的通行画法：俗称坦克 / BMW / 脚开开 —— 下方 M、上方 W）
   *
   *      做法：两组共用同一条横向锯齿折线（5 个顶点 → 4 段），每段摆一根竹节并
   *      按段的方向旋转。两个关键细节，少一个就散架：
   *        ① 竹节**两端各外延 10%**，使相邻两根在折点处搭接 —— 否则折点处有豁口，
   *           4 根各自转了点角度的短棒读不出连续的 M / W。
   *        ② 上行为倒 M（首顶点在高位）、下行为 M（首顶点在低位），两行的峰谷
   *           横向对齐 —— 于是中间收腰，整体呈「沙漏」轮廓，这正是八条的辨识特征。 */
  var ZIG_U = [0.06, 0.28, 0.5, 0.72, 0.94];        // 折线顶点横向位置（等距，两端略内收）
  var ZIG_ROW = {
    w: [0.055, 0.435, 0.055, 0.435, 0.055],          // 上行 = 倒 M（谷在中列，指向下）
    m: [0.945, 0.565, 0.945, 0.565, 0.945]           // 下行 = M（峰在中列，指向上）
  };
  var STICK8 = { w: 5.8, over: 0.10 };

  /** 生成 8 条的 8 段竹节坐标：cx/cy 段中点、len 段长（含两端外延）、rot 旋转角（度） */
  function zigSegments8() {
    var segs = [], rows = [ZIG_ROW.w, ZIG_ROW.m], r, i;
    for (r = 0; r < rows.length; r++) {
      var vs = rows[r];
      for (i = 0; i < ZIG_U.length - 1; i++) {
        var x1 = px(ZIG_U[i]), y1 = py(vs[i]), x2 = px(ZIG_U[i + 1]), y2 = py(vs[i + 1]);
        var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);
        segs.push({
          cx: (x1 + x2) / 2, cy: (y1 + y2) / 2,
          len: len * (1 + STICK8.over * 2),
          // 竹节默认竖着画（长度沿 +y）。要把 (0,1) 转到 (dx,dy)，SVG 顺时针旋转角为
          // atan2(-dx, dy)；写成 atan2(dx, dy) 会让整个锯齿反向（M 变 W），不报错。
          rot: Math.atan2(-dx, dy) * 180 / Math.PI
        });
      }
    }
    return segs;
  }

  function stick(D, cx, cy, w, h, rot, pal) {
    var P = pal || PAL_TIAO;
    // 横向渐变：圆柱受光 —— 两侧收暗，但亮区要够宽，否则整根竹子发沉（实测过：
    // 暗端压到 #0f5233 时，高饱和绿像素占比从 0.016 掉到 0.002，视觉明显变闷）。
    var g = D.linear(P.role, 0, 0, 1, 0, [
      [0, P.dark], [0.12, P.mid], [0.44, P.lit],
      [0.62, P.mid], [0.9, P.mid], [1, P.dark]
    ]);
    var x = cx - w / 2, y = cy - h / 2, r = w * 0.42;
    var s = '';
    s += '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(h) +
      '" rx="' + f1(r) + '" fill="url(#' + g + ')"/>';
    // 节线（竹节）+ 节线下方高光
    var n1 = cy - h * 0.17, n2 = cy + h * 0.17;
    s += '<line x1="' + f1(x) + '" y1="' + f1(n1) + '" x2="' + f1(x + w) + '" y2="' + f1(n1) +
      '" stroke="' + P.node + '" stroke-width="1.05"/>';
    s += '<line x1="' + f1(x) + '" y1="' + f1(n1 + 1.1) + '" x2="' + f1(x + w) + '" y2="' + f1(n1 + 1.1) +
      '" stroke="' + P.hi + '" stroke-width="0.7" opacity="0.5"/>';
    s += '<line x1="' + f1(x) + '" y1="' + f1(n2) + '" x2="' + f1(x + w) + '" y2="' + f1(n2) +
      '" stroke="' + P.node + '" stroke-width="1.05"/>';
    s += '<line x1="' + f1(x) + '" y1="' + f1(n2 + 1.1) + '" x2="' + f1(x + w) + '" y2="' + f1(n2 + 1.1) +
      '" stroke="' + P.hi + '" stroke-width="0.7" opacity="0.5"/>';
    // 旋转只在 8 条上用得到（rot=0 时不包 <g>，保持既有牌面的输出逐字节不变）
    if (!rot) return s;
    return '<g transform="rotate(' + f1(rot) + ' ' + f1(cx) + ' ' + f1(cy) + ')">' + s + '</g>';
  }

  function tiaoSticks(D, n) {
    if (n === 8) {
      var segs = zigSegments8(), s8 = '', k;
      for (k = 0; k < segs.length; k++) {
        s8 += stick(D, segs[k].cx, segs[k].cy, STICK8.w, segs[k].len, segs[k].rot, null);
      }
      return s8;
    }
    var pts = STICKS[n], h = STICK_H[n], w = h * 0.42, s = '', red = RED_STICKS[n] || null;
    for (var i = 0; i < pts.length; i++) {
      s += stick(D, px(pts[i][0]), py(pts[i][1]), w, h, 0, red && red[i] ? PAL_TIAO_RED : null);
    }
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

  window.MJTiles = {
    face: face, back: back, CN: CN, version: '3.1.0',
    glyphsReady: glyphsReady,      // 万子字形轮廓是否就位（构建链完整性自检用）
    WAN_LAYOUT: WAN_LAYOUT,        // 万子版式参数（冒烟测试据此校验墨迹不越界）
    RED_STICKS: RED_STICKS,        // 条子红色定位节（哪几根是红的）——牌面契约，冒烟测试据此断言
    STICK8: STICK8,                // 8 条单节宽度与外延比例
    ZIG_U: ZIG_U, ZIG_ROW: ZIG_ROW // 8 条锯齿折线（横向顶点 + 两行的峰谷位置）
  };
})();
