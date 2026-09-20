/* 川麻 2.5D 牌桌 —— PixiJS v8 渲染层（画布负责牌桌/牌/动效，DOM 负责按钮与弹层）
 * 依赖全局：ChuanMa（规则内核）、PIXI（pixi.js v8）、MJTiles（SVG 牌面）
 *
 * 布局模型（统一四家，避免四份重复代码）
 *   OUT[s]   ：桌面中心 → 该座位的单位向量
 *   right[s] ：该玩家面朝中心时的「右手方向」= (out.y, -out.x)
 *   牌面旋转 rot = atan2(-out.x, out.y) —— 牌顶永远指向桌心
 *   seat 0 下（你） / 1 右（下家） / 2 上（对家） / 3 左（上家）
 */
(function () {
  var CM = window.ChuanMa, MJ = window.MJTiles;
  var HUMAN = 0, SEATS = CM.SEATS;
  var MJT = CM.tileLabel;
  var AR = 0.714, TAU = Math.PI * 2;

  var SUITS = [{ zh: '万', en: 'wan' }, { zh: '条', en: 'tiao' }, { zh: '筒', en: 'tong' }];
  var SEAT_KEY = ['you', 'next', 'opp', 'prev'];
  var OUT = [{ x: 0, y: 1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: 0 }];
  // 牌面旋转（牌顶指向桌心）：下 0° / 右 -90° / 上 180° / 左 90°
  var ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
  var SEAT_C = [0x74c2ff, 0x6fe3a6, 0xffd06a, 0xff9ec8];
  var GOLD = 0xf2c14e;

  /* ================= 视觉令牌（web/tokens.js） =================
     色值与质感强度不在这里硬写：改材质只改 tokens.js 一处。
     取不到 CMTokens 时用与 tokens.js 完全一致的兜底值。 */
  var TOK = (typeof window !== 'undefined' && window.CMTokens) || null;
  function tk(pathStr, fb) {
    if (!TOK) return fb;
    var o = TOK, ps = pathStr.split('.');
    for (var i = 0; i < ps.length; i++) {
      if (o === null || o === undefined || o[ps[i]] === undefined) return fb;
      o = o[ps[i]];
    }
    return o;
  }
  var V = {
    feltHot: tk('felt.hot', '#2e7f5b'),
    feltM1: tk('felt.m1', '#1f6847'),
    feltM2: tk('felt.m2', '#14503a'),
    feltDeep: tk('felt.deep', '#0a2c1e'),
    slubHi: tk('felt.slubHi', 'rgba(255,255,255,.055)'),
    slubLo: tk('felt.slubLo', 'rgba(0,0,0,.075)'),
    vign: tk('felt.vign', 'rgba(3,16,10,.72)'),
    rimOuter: tk('felt.rimOuter', '#061c12'),
    rimGold: tk('felt.rimGold', '#d9b45c'),
    rimGoldHi: tk('felt.rimGoldHi', 'rgba(255,232,168,.55)'),
    rimInner: tk('felt.rimInner', '#6fae8c'),
    stage: tk('felt.stage', '#0b2a1c'),
    sideTop: tk('side.top', '#e8dcbc'),
    sideBot: tk('side.bot', '#a8956e'),
    sideEdge: tk('side.edge', '#8d7b5a'),
    shNearA: tk('shadow.nearA', 0.30),
    shFarA: tk('shadow.farA', 0.14),
    shadowLayers: tk('fx.shadowLayers', 2)
  };
  var FXN = {
    slub: tk('fx.feltSlub', 2600),
    weave: tk('fx.feltWeave', 1400),
    vignette: tk('fx.feltVignette', true) !== false
  };

  /* 确定性伪随机：桌面绒布纹理必须可复现 ——
     原来用 Math.random()，同一尺寸的纹理每次重建都不一样，
     截图指纹每次都变，回归基线就永远比不出「真变化」还是「噪声」。 */
  var _seed = 20260919;
  function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
  /** 0xRRGGBB 线性插值（牌厚渐变分段用） */
  function mixHex(a, b, t) {
    var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    var r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | bl;
  }
  function hex2num(h) { return parseInt(String(h).replace('#', ''), 16); }

  var T = {
    zh: {
      title: '川麻 2.5D · 血战到底',
      help: '说明', demo: '自动演示', demoStop: '停止演示', newGame: '新开一局', lang: 'EN',
      you: '你', next: '下家 →', opp: '对家', prev: '← 上家',
      wall: '牌墙', turn: '轮到', dealer: '庄', shanten: '离下叫', shantenUnit: ' 张',
      claimT: '可以鸣牌', kong: '杠', pong: '碰', pass: '过', ck: '暗杠', ak: '补杠', win: '胡',
      hintTurn: '轮到你打牌 —— 点牌选中，再点一次打出',
      hintMiss: '还有缺门牌，必须先打完（只能点缺门牌）',
      hintArmed: function (tl) { return '已选 ' + tl + ' · 再点一次打出（点空白取消）'; },
      declareT: '定缺 —— 选一门要打光的牌',
      declareSub: '川麻开局必选一门「缺门」：必须先打完，且胡牌时手上不能有它。建议选张数最少的一门。',
      recommend: '推荐', start: '开始', again: '再来一局', close: '关闭',
      setupT: '开局设置',
      setupSub: '先定规则，再发牌。开局后每人 13 张，然后由你选一门「缺门」。',
      seatPick: '谁先起手（庄）',
      seatHint: '庄家先摸第 14 张，有先手优势。',
      teachLbl: '教学提示',
      langLbl: '语言',
      optOn: '开', optOff: '关',
      startGame: '开始对局',
      settings: '改设置',
      idleT: '准备开始',
      idleSub: '在「开局设置」里选好难度与起手位，再点「开始对局」。',
      settled: '本局结束', r3: '3 家已胡', rw: '牌墙摸完 · 流局',
      seat: '座位', status: '结果', winTile: '和的牌', fan: '番种',
      stWon: '胡', stReady: '下叫', stNot: '未下叫', won: '胡', reveal: '亮牌',
      logcap: '对局记录', lastDiscard: '刚刚打出',
      helpBody: '<b>渲染</b>：牌桌与牌由 <b>PixiJS（GPU）</b>绘制，按钮/弹层为 DOM（混合架构）。<br>' +
        '<b>座位</b>：你在下；<b>下家</b>在右、<b>上家</b>在左，四家围桌而坐，牌面朝向桌心。<br>' +
        '<b>底部教学条</b>：常驻显示「离下叫还差几张」；下叫时金框虚线牌就是你在等的牌，右下角数字是还剩几张。<br>' +
        '<b>★ 推荐</b>：金色光晕那张是建议打出的牌，教学条右侧会说明理由（打它之后进张多少张）。<br>' +
        '<b>出牌要确认两次</b>：点一下先把手牌<b>提起</b>（金框标出，防手滑），再点同一张才真正打出；点桌面空白处可取消。<br>' +
        '<b>难度</b>：右上角可切 新手 / 标准 / 困难 —— 只改对手的强弱，不改规则。<br>' +
        '<b>结算</b>：终局按「番数×底分」计分，另算杠分、查叫、查花猪、退税，给出每家净分。<br>' +
        '<b>动作按钮</b>：牌桌中间会弹出「胡 / 碰 / 杠 / 过」——<b>要不要胡由你决定</b>，系统不会替你胡。<br>' +
        '<b>血战到底</b>：一家胡后本局继续，直到 3 家胡或牌墙摸完。<br>' +
        '<b>川麻用语</b>：下叫＝听牌 · 大对子＝碰碰胡 · 金钩钓＝四副全副露单钓将 · 十八罗汉＝四副全杠 · 查叫＝查大叫 · 幺鸡＝一条。',
      evDeclare: function (s, su) { return s + ' 定缺 ' + su; },
      evDiscard: function (s, tl) { return s + ' 打出 ' + tl; },
      evPong: function (s, tl) { return s + ' 碰 ' + tl; },
      evKong: function (s, tl) { return s + ' 杠 ' + tl; },
      evWinSelf: function (s, tl, f) { return '🎉 ' + s + ' 自摸 ' + tl + '（' + f + ' 番）'; },
      evWinRon: function (s, tl, by, f) { return '🎉 ' + s + ' 胡 ' + tl + '（' + by + ' 点炮，' + f + ' 番）'; },
      evEnd: '本局结算',
      // —— 教学脚手架 ——
      teachReady: '已下叫',
      teachDeadWait: '已听牌，但所听的牌已经全被打完（死叫）',
      teachWait: function (n) { return '可和 ' + n + ' 张'; },
      teachShanten: function (n) { return n <= 0 ? '已下叫' : '还差 ' + n + ' 张下叫'; },
      teachImprove: function (n) { return '进张 ' + n + ' 张'; },
      teachReason: function (t, cnt) { return '打 ' + t + ' → 进张 ' + cnt + ' 张'; },
      teachWinReason: function (t, f) { return '打 ' + t + ' → 下叫（' + f + '）'; },
      teachMustMiss: '还有缺门牌，必须先打完',
      teachCanWin: '可以胡了 —— 点牌桌中间的「胡」按钮',
      teachFlowerPig: '尚未打缺 · 流局要赔花猪',
      teachWaiting: '叫牌：',
      winBanner: function (f) { return '你胡了！' + f + ' 番'; },
      winBannerSelf: '自摸',
      winBannerRon: '点炮',
      pts: '分',
      diffLbl: '难度',
      dEasy: '新手', dNormal: '标准', dHard: '困难',
      scoreTitle: '本局得分',
      colSeat: '座位', colNet: '净分', colDetail: '明细',
      detailFan: '胡牌', detailKong: '杠', detailReady: '查叫', detailPig: '花猪', detailRefund: '退税',
      youWon: '你赢了', fanUnit: ' 番',
      scoreNote: '分 = 番数 × 底分(1)，单局封顶 32 番；自摸由尚未胡牌者各付一份，点炮由放炮者独付；流局时未下叫者赔下叫者（查叫），未打缺者赔花猪；未胡者收到的杠分退还。',
      diagOk: function (r, n, fps) { return 'PixiJS ' + r + ' · ' + n + ' 纹理 · ' + fps + 'fps'; },
      diagFail: 'PixiJS 不可用',
      bootTtl: '正在加载牌桌素材…',
      bootTex: function (d, n) { return '牌面素材 ' + d + '/' + n; },
      bootGpu: '初始化渲染器（GPU）',
      bootScene: '准备牌桌',
      bootReady: '就绪',
      bootFail: '素材加载失败，牌桌无法启动。'
    },
    en: {
      title: 'Chuanma 2.5D · Blood Battle',
      help: 'Help', demo: 'Auto demo', demoStop: 'Stop demo', newGame: 'New game', lang: '中文',
      you: 'You', next: 'Right →', opp: 'Across', prev: '← Left',
      wall: 'Wall', turn: 'Turn', dealer: 'D', shanten: 'To ready', shantenUnit: '',
      claimT: 'Claim', kong: 'Kong', pong: 'Pong', pass: 'Pass', ck: 'Concealed', ak: 'Added', win: 'Win',
      hintTurn: 'Your turn — click a tile to select, click it again to discard',
      hintMiss: 'Clear your missing suit first (only those tiles clickable)',
      hintArmed: function (tl) { return 'Selected ' + tl + ' — click again to discard (click empty space to cancel)'; },
      declareT: 'Declare Missing Suit',
      declareSub: 'Pick one suit to clear. You must discard it all first, and a winning hand must not contain it.',
      recommend: 'PICK', start: 'Start', again: 'Play again', close: 'Close',
      setupT: 'Round setup',
      setupSub: 'Set the rules before the tiles are dealt. After the deal you pick the suit to clear.',
      seatPick: 'Who starts (dealer)',
      seatHint: 'The dealer draws the 14th tile and moves first.',
      teachLbl: 'Coaching',
      langLbl: 'Language',
      optOn: 'On', optOff: 'Off',
      startGame: 'Start round',
      settings: 'Change setup',
      idleT: 'Ready to start',
      idleSub: 'Pick difficulty and who starts in “Round setup”, then press “Start round”.',
      settled: 'Round over', r3: '3 players won', rw: 'Wall empty · draw',
      seat: 'Seat', status: 'Result', winTile: 'Win tile', fan: 'Fan',
      stWon: 'Won', stReady: 'Ready', stNot: 'Not ready', won: 'Won', reveal: 'Revealed',
      logcap: 'Game log', lastDiscard: 'Last discard',
      helpBody: '<b>Rendering</b>: table and tiles are drawn with <b>PixiJS (GPU)</b>; buttons stay DOM.<br>' +
        '<b>Seats</b>: you at the bottom; <b>Right</b> is next, <b>Left</b> the previous — all four sit around the table, tiles facing the centre.<br>' +
        '<b>Hand</b>: auto-sorted; the <b>tile just drawn sits apart on the right</b> and re-sorts after you discard.<br>' +
        '<b>River</b>: discards are laid neatly in <b>two rows</b> in front of each player.<br>' +
        '<b>Gold glow</b> = suggested discard. Opponents\' hands are tile backs.<br>' +
        '<b>Discarding takes two clicks</b>: the first click <b>lifts the tile</b> (gold outline, so a slip of the finger costs nothing), the second click on that same tile actually plays it. Click empty table space to cancel.<br>' +
        '<b>Reveal</b>: on a win the hand turns face-up, winning tile gold and set apart.<br>' +
        '<b>Action buttons</b>: Hu / Pong / Kong / Pass appear mid-table — <b>the decision to win is yours</b>, nothing wins for you automatically.<br>' +
        '<b>Blood Battle</b>: play continues until 3 wins or the wall empties.<br>' +
        '<b>Sichuan terms</b>: 下叫 (ready) = listening; 大对子 = all triplets; 金钩钓 = four exposed melds, single-tile wait; 十八罗汉 = four kongs; 查叫 = ready check; 幺鸡 = the 1 of bamboo.',
      evDeclare: function (s, su) { return s + ' missing: ' + su; },
      evDiscard: function (s, tl) { return s + ' discards ' + tl; },
      evPong: function (s, tl) { return s + ' pongs ' + tl; },
      evKong: function (s, tl) { return s + ' kongs ' + tl; },
      evWinSelf: function (s, tl, f) { return '🎉 ' + s + ' self-draw ' + tl + ' (' + f + ' fan)'; },
      evWinRon: function (s, tl, by, f) { return '🎉 ' + s + ' wins ' + tl + ' (' + by + ' discard, ' + f + ' fan)'; },
      evEnd: 'Round settled',
      teachReady: 'Ready',
      teachDeadWait: 'Ready — but every tile you wait on is gone',
      teachWait: function (n) { return n + ' winning tiles left'; },
      teachShanten: function (n) { return n <= 0 ? 'Ready' : n + ' away from ready'; },
      teachImprove: function (n) { return n + ' tiles improve'; },
      teachReason: function (t, cnt) { return 'Discard ' + t + ' → ' + cnt + ' tiles improve'; },
      teachWinReason: function (t, f) { return 'Discard ' + t + ' → READY (' + f + ')'; },
      teachMustMiss: 'Clear your missing suit first',
      teachCanWin: 'You can win — press the Hu button on the table',
      teachFlowerPig: 'Missing suit not cleared · flower-pig penalty',
      teachWaiting: 'Waiting on:',
      winBanner: function (f) { return 'YOU WIN! ' + f + ' fan'; },
      winBannerSelf: 'self-draw',
      winBannerRon: 'on discard',
      pts: 'pts',
      diffLbl: 'Level',
      dEasy: 'Easy', dNormal: 'Normal', dHard: 'Hard',
      scoreTitle: 'Round score',
      colSeat: 'Seat', colNet: 'Net', colDetail: 'Breakdown',
      detailFan: 'Win', detailKong: 'Kong', detailReady: 'Ready', detailPig: 'Pig', detailRefund: 'Refund',
      youWon: 'You win', fanUnit: ' fan',
      scoreNote: 'Points = fan × base (1), capped at 32 fan per round. Self-draw: each player not yet won pays. Discard win: the discarder pays alone. On a draw, non-ready players pay ready players (big call) and uncleared players pay the flower-pig penalty; kong points received by non-winners are refunded.',
      diagOk: function (r, n, fps) { return 'PixiJS ' + r + ' · ' + n + ' tex · ' + fps + 'fps'; },
      diagFail: 'PixiJS unavailable',
      bootTtl: 'Loading table assets…',
      bootTex: function (d, n) { return 'Tile art ' + d + '/' + n; },
      bootGpu: 'Starting the renderer (GPU)',
      bootScene: 'Preparing the table',
      bootReady: 'Ready',
      bootFail: 'Assets failed to load — the table cannot start.'
    }
  };

  var state = {
    g: null, lang: 'zh', demo: false, timer: null, overlay: null,
    loggedUpTo: 0, logLines: [],
    app: null, world: null, fx: null, tex: {}, texCount: 0, ready: false,
    tweens: [], particles: [], pulses: [], boxes: [], fxStats: null,
    fxSeen: 0, pendingDeal: false, hideHandsUntil: 0, feltTex: null, feltKey: '',
    rendererName: '', needRender: false,
    haltHumanWin: false,     // 测试用：推进到「人类可以胡」就停住，把决定权留给按钮
    dbg: [],                 // 诊断：pump 每步轨迹（环形，最多 200 条）
    haltHit: false,          // 测试用：上一步已因 haltHumanWin 停住 → pump 立即退出
    diff: 'normal',          // 对手难度（B）
    started: false,          // 是否已开局（false = 先显示「开局设置」，不自动发牌）
    dealerSeat: 0,           // 起手位（庄）：庄家先摸第 14 张
    teachOn: true,           // 教学提示开关
    teach: null,             // 本帧教学信息（A）
    banner: null,            // 胡牌横幅 {seat, fans, selfDraw, until}
    recTile: -1,
    selId: -1,               // 出牌二次确认：已选中的牌（tile id），-1 = 无
    selSlot: -1,             // 该牌在手牌槽位里的索引 —— 用槽位而非 id，避免同 id 的多张一起抬起
  };
  state.fxStats = { deals: 0, flights: 0, rings: 0, bursts: 0 };

  function t() { return T[state.lang]; }
  function seatName(s) { return t()[SEAT_KEY[s]]; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function gfx() { return new PIXI.Graphics(); }

  /* ================= 控制器（与 DOM 版同源） ================= */
  function afterWinCheck() { if (CM.isGameOver(state.g)) { CM.settleRound(state.g); return true; } return false; }
  function botActAfterDraw(seat) {
    var g = state.g, p = g.players[seat];
    if (CM.canSelfWin(p, p.melds.length)) { CM.applySelfWin(g, seat); return; }
    var ck = CM.botConcealedKongTile(g, seat, state.diff); if (ck >= 0) { CM.applyConcealedKong(g, seat, ck); return; }
    var ak = CM.botAddedKongTile(g, seat, state.diff); if (ak >= 0) { CM.applyAddedKong(g, seat, ak); return; }
    CM.discard(g, seat, CM.botDiscardTile(g, seat, state.diff));
  }
  function resolveHumanPass() {
    var g = state.g, c = g.claim;
    var br = c.ron.filter(function (s) { return s !== HUMAN; });
    if (br.length) { CM.applyRon(g, br[0]); afterWinCheck(); return; }
    var bk = c.kong.filter(function (s) { return s !== HUMAN; });
    if (bk.length && state.diff !== 'easy') { CM.applyKong(g, bk[0]); return; }
    var bp = c.pong.filter(function (s) { return s !== HUMAN; });
    if (bp.length && CM.botShouldPong(g, bp[0], state.diff)) { CM.applyPong(g, bp[0]); return; }
    CM.passClaim(g);
  }
  /** 「我」此刻是否可以胡（自摸 或 别人点炮）——UI 与测试共用同一判据 */
  function humanWinReady() {
    var g = state.g;
    if (!g || g.phase !== 'playing') return false;
    var my = g.players[HUMAN];
    if (my.won) return false;
    if (g.claim) return g.claim.ron.indexOf(HUMAN) >= 0;
    return g.turn === HUMAN && CM.canSelfWin(my, my.melds.length);
  }
  /** 当前该给玩家哪些动作按钮（UI 与测试共用同一判据） */
  function actionFlags() {
    var out = { win: false, kong: false, pong: false, ck: false, ak: false, pass: false };
    var G = state.g;
    if (!G || G.phase !== 'playing') return out;
    var my = G.players[HUMAN];
    if (my.won) return out;
    var c = G.claim;
    var canRon = !!c && c.ron.indexOf(HUMAN) >= 0;
    var canCKong = !!c && c.kong.indexOf(HUMAN) >= 0;
    var canPong = !!c && c.pong.indexOf(HUMAN) >= 0;
    var myTurn = !c && G.turn === HUMAN;
    out.win = canRon || (myTurn && CM.canSelfWin(my, my.melds.length));
    out.kong = canCKong;
    out.pong = canPong;
    if (myTurn) {
      out.ck = CM.botConcealedKongTile(G, HUMAN) >= 0;
      out.ak = CM.botAddedKongTile(G, HUMAN) >= 0;
    }
    out.pass = canRon || canCKong || canPong;
    return out;
  }
  /** 测试用：此刻该停下把决定权交给按钮吗（返回 true 表示已停住，pump 需立刻退出） */
  function haltHere() {
    if (!state.haltHumanWin || !humanWinReady()) return false;
    state.haltHit = true;
    return true;
  }
  function humanAutoAct() {
    var g = state.g;
    if (g.phase === 'declareMissing') { CM.declareMissing(g, HUMAN, CM.botMissingSuit(g, HUMAN)); return; }
    if (g.claim) {
      var c = g.claim;
      if (c.ron.indexOf(HUMAN) >= 0) { if (haltHere()) return; CM.applyRon(g, HUMAN); afterWinCheck(); return; }
      if (c.kong.indexOf(HUMAN) >= 0) { CM.applyKong(g, HUMAN); return; }
      if (c.pong.indexOf(HUMAN) >= 0 && CM.botShouldPong(g, HUMAN)) { CM.applyPong(g, HUMAN); return; }
      resolveHumanPass(); return;
    }
    var my = g.players[HUMAN];
    // 摸牌由 pump 单点负责并就地消费掉 pendingDraw —— 这里只负责「摸完之后做什么」。
    // （之前把「本回合是否已摸」记在牌墙指针上做去重：三家胡完后轮次会回到同一人而中间无人摸牌，
    //   指针不变 → 每次都被判为「已摸」→ 手牌被抽干。现已彻底去掉该去重。）
    if (CM.canSelfWin(my, my.melds.length)) {
      if (haltHere()) return;
      CM.applySelfWin(g, HUMAN); afterWinCheck(); return;
    }
    var ck = CM.botConcealedKongTile(g, HUMAN); if (ck >= 0) { CM.applyConcealedKong(g, HUMAN, ck); return; }
    var ak = CM.botAddedKongTile(g, HUMAN); if (ak >= 0) { CM.applyAddedKong(g, HUMAN, ak); return; }
    CM.discard(g, HUMAN, CM.botDiscardTile(g, HUMAN));
  }
  /** budget：一次推进的最大循环步数（演示模式用 1，实现「动作级」节奏） */
  function pump(budget) {
    var g = state.g, guard = 0, max = budget || 200000;
    while (guard++ < max) {
      if (g.phase === 'finished') return;
      // 测试用：已停在「我此刻可以胡」→ 立刻退出循环（避免重复消费这一次摸牌）
      if (state.haltHit) { requestRender(); return; }
      if (state.dbg) {
        try {
          state.dbg.push([guard, g.phase === 'playing' ? 'P' : g.phase[0], g.wallPointer,
            g.pendingDraw ? 1 : 0, g.claim ? 1 : 0, g.turn,
            shapeOf(g.players[HUMAN]), g.wall.length, state.demo ? 1 : 0]);
          if (state.dbg.length > 200) state.dbg.shift();
        } catch (e) { /* ignore */ }
      }
      if (g.phase === 'declareMissing') {
        var pending = false;
        for (var i = 0; i < SEATS.length; i++) {
          var s = SEATS[i];
          if (g.players[s].missing === -1) {
            if (s === HUMAN) { if (state.demo) humanAutoAct(); else pending = true; }
            else CM.declareMissing(g, s, CM.botMissingSuit(g, s));
          }
        }
        if (pending) return;
        continue;
      }
      if (g.claim) {
        var c = g.claim;
        var humanInClaim = c.ron.indexOf(HUMAN) >= 0 || c.pong.indexOf(HUMAN) >= 0 || c.kong.indexOf(HUMAN) >= 0;
        var humanCanRon = c.ron.indexOf(HUMAN) >= 0;
        // 非演示：只要「我」能做动作（胡/碰/杠）就停下等玩家点按钮；
        // 测试暂停（haltHumanWin）：只在「能胡」时停下，碰杠仍由代打处理，好让牌局继续推进
        if (humanInClaim && (state.haltHumanWin ? humanCanRon : !state.demo)) { requestRender(); return; }
        if (c.ron.length) { CM.applyRon(g, c.ron.indexOf(HUMAN) >= 0 ? HUMAN : c.ron[0]); afterWinCheck(); continue; }
        // 演示模式：由代打决定碰/杠；非演示时上面已停下等玩家点按钮
        if (c.pong.indexOf(HUMAN) >= 0 || c.kong.indexOf(HUMAN) >= 0) { humanAutoAct(); continue; }
        resolveHumanPass(); continue;
      }
      // ⚠️ 牌墙摸完只在「摸不到牌」那一刻结束（draw 返回 false），**不在摸到之后**结束。
      // 若在摸完之后就结算，该家会带着 14 张手牌进入查叫判定，而被判「未下叫」——
      // 这正是玩家报的「我最后听牌了，查叫却说我没叫」。摸到最后一张仍可自摸（海底）
      // 或打出一张（被别人点炮/碰），之后才流局。
      if (g.pendingDraw) {
        var seat = g.turn;
        if (seat === HUMAN) {
          if (g.wall.length === 0) { CM.settleRound(g); return; }
          CM.draw(g, HUMAN);
          g.pendingDraw = false;   // 这一次摸牌已消费（后面只等「打哪张 / 胡 / 杠」的决定）
          requestRender();
          if (!state.demo) return; // 非演示：停下等玩家（自摸点「胡」，否则点手牌打出）
          // 演示：落到下面的「seat2 === HUMAN」分支代打，避免这里重复摸牌
        } else {
          if (!CM.draw(g, seat)) { CM.settleRound(g); return; }
          botActAfterDraw(seat); continue;
        }
      }
      var seat2 = g.turn;
      if (seat2 === HUMAN) {
        if (state.demo) { humanAutoAct(); continue; }
        requestRender();
        return;     // 等玩家：胡 / 碰杠 / 出牌
      }
      var p2 = g.players[seat2];
      if (CM.canSelfWin(p2, p2.melds.length)) { CM.applySelfWin(g, seat2); afterWinCheck(); continue; }
      CM.discard(g, seat2, CM.botDiscardTile(g, seat2));
    }
  }
  /** 清空「待确认出牌」的选中态（出牌 / 鸣牌 / 换局时都要清） */
  function clearSelection() { state.selId = -1; state.selSlot = -1; }
  function act(fn) { return function () { clearSelection(); fn(); pump(); render(); }; }
  var humanDeclare = function (suit) { clearSelection(); CM.declareMissing(state.g, HUMAN, suit); state.overlay = null; pump(); render(); };
  var humanDiscard = function (tile) { clearSelection(); CM.discard(state.g, HUMAN, tile); pump(); render(); };
  var humanWin = act(function () {
    var g = state.g, c = g.claim;
    if (c && c.ron.indexOf(HUMAN) >= 0) CM.applyRon(g, HUMAN);
    else if (CM.canSelfWin(g.players[HUMAN], g.players[HUMAN].melds.length)) CM.applySelfWin(g, HUMAN);
    afterWinCheck();
  });
  var humanPong = act(function () { CM.applyPong(state.g, HUMAN); });
  var humanKong = act(function () { CM.applyKong(state.g, HUMAN); });
  var humanPass = act(function () { resolveHumanPass(); });
  var humanCK = act(function () { var k = CM.botConcealedKongTile(state.g, HUMAN); if (k >= 0) CM.applyConcealedKong(state.g, HUMAN, k); });
  var humanAK = act(function () { var k = CM.botAddedKongTile(state.g, HUMAN); if (k >= 0) CM.applyAddedKong(state.g, HUMAN, k); });

  /** 进入「开局设置」：不建牌局、不发牌，等玩家选好再开始 */
  function openSetup() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.demo = false;
    state.started = false;
    state.overlay = 'setup';
    state.g = null;                 // 无牌局 → render 走「准备开始」画面
    state.logLines = []; state.loggedUpTo = 0;
    state.teach = null; state.recTile = -1;
    clearFx();
  }
  /** 按当前设置真正开局：发牌动画 → 选缺门 → 对局 */
  function startGame() {
    state.started = true;
    state.overlay = null;
    newGame();
  }
  function newGame() {
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    state.demo = false; state.overlay = null; state.started = true;
    state.g = CM.createGame(HUMAN, CM.defaultRules, CM.defaultScoring);
    // 起手位（庄）：createGame 固定 dealer = 0；declareMissing 收尾时会用 g.dealer 重置 turn，
    // 所以这里只改 dealer 即可让选中的一家先摸第 14 张。
    if (state.dealerSeat) state.g.dealer = state.dealerSeat;
    state.loggedUpTo = 0; state.logLines = [];
    state.fxSeen = state.g.history.length;
    state.pendingDeal = true;
    clearFx();
    pump(); render();
  }

  /* ================= 首屏资产加载进度 ================= */
  /**
   * 牌面纹理（28 张 SVG→canvas→Texture）与 Pixi 渲染器初始化都是异步的。
   * 早先这段就是一片空白，用户分不清「正在加载」还是「卡死了」—— 现在把进度摆出来，
   * 加载完再淡出，露出下面已经画好的「开局设置」。
   * 阶段权重：牌面素材 0→80%（每张 +1）· 渲染器 80→92% · 首帧 92→100%。
   */
  // ⚠️ 这个对象**不能**叫 `boot` —— 文件末尾有 `async function boot()`，同作用域下
  //   `var boot = {...}` 会覆盖掉那个函数声明，`boot()` 一调用就 "not a function"，
  //   整个页面脚本静默死掉（`__PIXI_TABLE__` 永远是 undefined，而构建与 jsdom 都发现不了）。
  var bootUI = { el: null, bar: null, pct: null, step: null, ttl: null, err: null, ratio: 0, t0: 0, done: false };

  function bootEls() {
    if (!bootUI.el) {
      bootUI.el = document.getElementById('boot');
      bootUI.bar = document.getElementById('bootBar');
      bootUI.pct = document.getElementById('bootPct');
      bootUI.step = document.getElementById('bootStep');
      bootUI.ttl = document.getElementById('bootTtl');
      bootUI.err = document.getElementById('bootErr');
    }
    return !!bootUI.el;
  }
  function bootReset() {
    if (!bootEls()) return;
    bootUI.t0 = performance.now();
    bootUI.done = false;
    bootUI.el.classList.remove('gone');
    bootUI.el.style.display = '';
    bootUI.ttl.textContent = t().bootTtl;
    bootPaint(0.03, t().bootTtl);
  }
  function bootPaint(ratio, label) {
    if (!bootEls()) return;
    // 进度只增不减：28 张纹理是并行生成的，完成顺序不保证，否则进度条会来回跳
    bootUI.ratio = Math.max(bootUI.ratio, Math.max(0, Math.min(1, ratio)));
    var p = Math.round(bootUI.ratio * 100);
    bootUI.bar.style.width = p + '%';
    bootUI.pct.textContent = p + '%';
    if (label) bootUI.step.textContent = label;
    // 结构化出口：DOM 文本之外再镜像一份，供真机探针断言（不依赖文案）
    window.__PIXI_TABLE__ = window.__PIXI_TABLE__ || {};
    window.__PIXI_TABLE__.boot = {
      ratio: +bootUI.ratio.toFixed(3), pct: p, done: bootUI.done,
      label: bootUI.step.textContent, ms: Math.round(performance.now() - bootUI.t0),
    };
  }
  /**
   * 加载完成：先把进度条走满并显示「就绪」，再淡出加载层。
   *
   * 最短展示时长 BOOT_MIN_MS：本机实测整套素材只要 ~400ms，不加下限的话进度条一闪而过，
   * 比不显示更容易被误认为「页面卡了一下」。停留到下限再淡出，读起来才像一次正常的加载。
   * 注意 done 是**立刻**标记的（供探针判定加载已完成），只有淡出被推迟。
   */
  var BOOT_MIN_MS = 520;
  function bootFinish() {
    if (!bootEls()) return;
    bootUI.done = true;
    bootPaint(1, t().bootReady);
    var wait = Math.max(0, BOOT_MIN_MS - (performance.now() - bootUI.t0));
    setTimeout(function () {
      bootUI.el.classList.add('gone');
      setTimeout(function () { if (bootUI.el) bootUI.el.style.display = 'none'; }, 420);
    }, wait);
  }
  /** 加载失败：把加载层留在屏幕上并写明原因，而不是让它一直转 */
  function bootError(msg) {
    if (!bootEls()) return;
    bootUI.err.hidden = false;
    bootUI.err.textContent = t().bootFail + ' ' + msg;
    window.__PIXI_TABLE__ = window.__PIXI_TABLE__ || {};
    window.__PIXI_TABLE__.boot = {
      ratio: +bootUI.ratio.toFixed(3), pct: Math.round(bootUI.ratio * 100),
      done: false, label: bootUI.step.textContent, error: String(msg),
    };
  }

  /* ================= 纹理：SVG → canvas → Texture ================= */
  function svgToTexture(svg, w, h) {
    return new Promise(function (resolve) {
      var sized = svg.replace('width="100%" height="100%"', 'width="' + w + '" height="' + h + '"');
      var url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml;charset=utf-8' }));
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(PIXI.Texture.from(c));
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  /** 逐张生成牌面纹理；onStep(done,total) 用于首屏进度（并行完成，顺序不保证） */
  async function buildTextures(onStep) {
    var TW = 132, TH = 185, n = 0, jobs = [], done = 0, total = 28;
    function stepTex() { done++; if (onStep) onStep(done, total); }
    for (var id = 0; id < 27; id++) {
      jobs.push((function (i) { return svgToTexture(MJ.face(i), TW, TH).then(function (tx) { stepTex(); return [i, tx]; }); })(id));
    }
    jobs.push(svgToTexture(MJ.back(), TW, TH).then(function (tx) { stepTex(); return ['back', tx]; }));
    var res = await Promise.all(jobs);
    for (var k = 0; k < res.length; k++) { if (res[k][1]) { state.tex[res[k][0]] = res[k][1]; n++; } }
    state.texCount = n;
  }

  /* ================= Pixi 场景 ================= */
  async function initPixi() {
    var app = new PIXI.Application();
    await app.init({
      background: V.stage,
      resizeTo: document.getElementById('stage'),
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: ['webgpu', 'webgl'],
      powerPreference: 'high-performance',
    });
    document.getElementById('stage').appendChild(app.canvas);
    state.app = app;
    state.world = new PIXI.Container();
    state.fx = new PIXI.Container();
    app.stage.addChild(state.world);
    app.stage.addChild(state.fx);
    app.ticker.add(tick);
  }

  function tick(tk) {
    var dt = Math.min(tk.deltaMS / 1000, 0.05);
    var now = performance.now();
    updateTweens(dt);
    updateParticles(dt);
    for (var i = 0; i < state.pulses.length; i++) {
      var q = state.pulses[i];
      if (q.obj.destroyed) continue;
      var s = 0.5 + 0.5 * Math.sin(now / q.period + (q.phase || 0));
      q.obj.alpha = q.min + (q.max - q.min) * s;
      if (q.s0 !== undefined) q.obj.scale.set(q.s0 + (q.s1 - q.s0) * s);
    }
    if (state.needRender && state.ready) { state.needRender = false; render(); }
  }
  /** 帧内合并重绘：避免多张牌同时落位时触发 N 次全量重绘 */
  function requestRender() { state.needRender = true; }

  /* ================= 补间 / 粒子 / 脉冲 ================= */
  function updateTweens(dt) {
    if (!state.tweens.length) return;
    var keep = [];
    for (var i = 0; i < state.tweens.length; i++) {
      var tw = state.tweens[i];
      if (tw.delay > 0) { tw.delay -= dt; keep.push(tw); continue; }
      tw.el += dt;
      var p = clamp(tw.el / tw.dur, 0, 1);
      var e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; // easeInOutCubic
      if (tw.linear) e = p;
      try { tw.onUpdate(e); } catch (err) { /* 目标可能已被回收 */ }
      if (p < 1) keep.push(tw); else if (tw.onDone) tw.onDone();
    }
    state.tweens = keep;
  }
  function tween(dur, onUpdate, onDone, delay, linear) {
    state.tweens.push({ el: 0, dur: dur, delay: delay || 0, onUpdate: onUpdate, onDone: onDone, linear: linear });
  }
  function pulse(obj, opts) {
    opts = opts || {};
    state.pulses.push({
      obj: obj, period: opts.period || 700, min: opts.min !== undefined ? opts.min : 0.25,
      max: opts.max !== undefined ? opts.max : 0.9, phase: opts.phase || 0,
      s0: opts.s0, s1: opts.s1
    });
  }
  function updateParticles(dt) {
    if (!state.particles.length) return;
    var keep = [];
    for (var i = 0; i < state.particles.length; i++) {
      var p = state.particles[i];
      p.life += dt;
      var k = p.life / p.max;
      if (k >= 1) { if (p.o.parent) p.o.parent.removeChild(p.o); p.o.destroy(); continue; }
      p.vy += 760 * dt;
      p.o.x += p.vx * dt; p.o.y += p.vy * dt;
      p.o.rotation += p.spin * dt;
      p.o.alpha = k < 0.15 ? k / 0.15 : (1 - k) / 0.85;
      p.o.scale.set(1 - 0.35 * k);
      keep.push(p);
    }
    state.particles = keep;
  }
  function clearFx() {
    state.tweens = []; state.particles = []; state.pulses = [];
    if (state.fx) state.fx.removeChildren().forEach(function (c) { c.destroy({ children: true }); });
  }

  /* ================= 牌节点（2.5D：世界对齐阴影 + 旋转牌面） =================
   * 牌体 = 三层：落地阴影（分层）→ 厚度侧壁（明暗渐变）→ 旋转牌面。
   *
   * ⚠ 牌厚渐变的可见范围只有**最下方 depth 高**的一条带（上方被牌面完全盖住），
   *   所以渐变必须映射到「可见带」上（visTop..visTop+depth），
   *   若按整个牌高 fh 铺渐变，可见带只落在渐变末尾 12% 内 —— 等于看不出渐变。
   */
  function tileNode(id, w, h, opts) {
    opts = opts || {};
    var rot = opts.rot || 0;
    var c = new PIXI.Container();
    var depth = Math.max(3, Math.round(Math.min(w, h) * 0.17));
    var rad = Math.max(3, Math.min(w, h) * 0.14);
    var swap = Math.abs(Math.sin(rot)) > 0.5;      // 旋转 90° → 脚印宽高互换
    var fw = swap ? h : w, fh = swap ? w : h;
    var sideTop = -fh / 2 + depth;                 // 厚度侧壁矩形顶部
    var visTop = fh / 2;                           // 牌面下沿 = 可见带起点
    // ① 落地阴影：分层（近影紧而深 + 远影散而淡）＝ 有重量感的接触阴影
    var sh = gfx();
    if (V.shadowLayers > 1) {
      sh.roundRect(-fw / 2 + 4, -fh / 2 + depth + 8, fw, fh, rad).fill({ color: 0x000000, alpha: V.shFarA * 0.55 });
    }
    sh.roundRect(-fw / 2 + 2, -fh / 2 + depth + 3, fw, fh, rad).fill({ color: 0x000000, alpha: V.shNearA });
    c.addChild(sh);
    // ② 厚度侧壁：圆角遮罩 + 分段渐变（顶亮 → 底暗）
    var sideMask = gfx();
    sideMask.roundRect(-fw / 2, sideTop, fw, fh, rad).fill({ color: 0xffffff });
    c.addChild(sideMask);
    var side = gfx();
    var steps = 6, cTop = hex2num(V.sideTop), cBot = hex2num(V.sideBot);
    for (var i = 0; i < steps; i++) {
      var t0 = i / steps, t1 = (i + 1) / steps;
      // 可见带 [visTop, visTop+depth] ← 完整渐变；带以上填暗端（反正被牌面盖住）
      var y0 = visTop + depth * t0, hh = depth * (t1 - t0) + 0.9;
      side.rect(-fw / 2, y0, fw, hh).fill({ color: mixHex(cTop, cBot, (t0 + t1) / 2) });
    }
    side.rect(-fw / 2, sideTop, fw, Math.max(0, visTop - sideTop)).fill({ color: cTop });
    side.mask = sideMask;
    c.addChild(side);
    // 侧壁轮廓（下沿圆角靠它勾出来）
    var edge = gfx();
    edge.roundRect(-fw / 2, sideTop, fw, fh, rad).stroke({ width: 1, color: hex2num(V.sideEdge), alpha: 0.7 });
    c.addChild(edge);
    // ③ 牌面（旋转到朝桌心）
    var face = new PIXI.Container();
    face.rotation = rot;
    if (opts.glow) {
      var gl = gfx();
      gl.roundRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, rad + 3).stroke({ width: 3, color: GOLD, alpha: 0.95 });
      face.addChild(gl);
    }
    var tex = id === -1 ? state.tex.back : state.tex[id];
    if (tex) { var sp = new PIXI.Sprite(tex); sp.anchor.set(0.5); sp.width = w; sp.height = h; face.addChild(sp); }
    else { var ph = gfx(); ph.roundRect(-w / 2, -h / 2, w, h, rad).fill({ color: 0xf3ecda }); face.addChild(ph); }
    c.addChild(face);
    c.__face = face;
    return c;
  }
  /* ================= 视口分档缩放（k）=================
     一个系数同时驱动「牌桌尺寸」与「所有文字/按钮」：避免 4K 上牌和字都显得小。
     档位按「舞台可用区 / 设计基准(1440×800)」的比值向下取档（保证永不溢出），
     比值 = min(W/1440, H/800)，落在哪一档就取哪一档的 k。 */
  var REF = { W: 1440, H: 720 };   // 设计基准＝舞台可用区（不含顶栏）
  var TIERS = [
    { id: 'xs', k: 0.72 },   // 小窗 / 笔记本分屏
    { id: 'sm', k: 0.85 },
    { id: 'md', k: 1.00 },   // 设计基准（≈1440×800 浏览器）
    { id: 'lg', k: 1.25 },   // 1080p 全屏
    { id: 'xl', k: 1.55 },   // 1440p / 2.5K
    { id: 'xxl', k: 2.00 },  // 1600p / 大屏
    { id: '4k', k: 2.50 }    // 4K 全屏
  ];
  /** 取「比值最接近」的一档（对数距离），避免刚好差一点就掉一档 */
  function pickTierIdx(W, H) {
    var raw = Math.min((W || REF.W) / REF.W, (H || REF.H) / REF.H);
    var idx = 0, best = Infinity;
    for (var i = 0; i < TIERS.length; i++) {
      var d = Math.abs(Math.log(TIERS[i].k) - Math.log(Math.max(0.2, raw)));
      if (d < best) { best = d; idx = i; }
    }
    return idx;
  }
  function applyTier() {
    var st = document.getElementById('stage');
    var winW = window.innerWidth || REF.W;
    var winH = window.innerHeight || REF.H + 48;
    var W = (st && st.clientWidth) || winW;
    var H = (st && st.clientHeight) || Math.max(320, winH - 48);
    // 舞台可能处于瞬时布局（0 或明显偏小）→ 退回窗口尺寸判断，避免误降到最小档
    if (W < winW * 0.6 || H < winH * 0.5) { W = winW; H = Math.max(320, winH - 48); }
    var i = pickTierIdx(W, H);
    state.tier = TIERS[i].id;
    state.k = TIERS[i].k;
    try { document.documentElement.style.setProperty('--k', String(state.k)); } catch (e) { /* ignore */ }
    return i;
  }
  /* 只在「舞台尺寸真的变了」时重新定档，返回档位是否发生变化。
     避免两个问题：① 每帧重算定档没意义；② ResizeObserver 与 --k 改变顶栏高度
     之间存在回路 —— 档位没变就不重绘，回路自然收敛。 */
  var lastStageKey = '';
  function applyTierOnStageChange() {
    var st = document.getElementById('stage');
    if (!st) return false;
    var key = st.clientWidth + 'x' + st.clientHeight;
    if (key === lastStageKey) return false;
    lastStageKey = key;
    var before = state.tier;
    applyTier();
    return state.tier !== before;
  }

  function label(text, size, color, weight) {
    return new PIXI.Text({
      text: text,
      style: { fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
        fontSize: Math.max(8, size * (state.k || 1)), fill: color, fontWeight: weight || '600' }
    });
  }

  /* ================= 布局 ================= */
  function metrics(W, H) {
    var k = state.k || 1;
    // 牌宽：随档放大；上限由「高度占比」和「13 张 + 摸牌位横向放得下」共同约束
    var byW = (((W - 48 * k) / 14) - 4 * k) / AR;
    var handH = clamp(82.5 * k, 34, Math.min(H * 0.135, byW));
    return {
      W: W, H: H, PAD: 12 * k,
      handH: handH, handW: handH * AR,
      oppH: handH * 0.62, meldH: handH * 0.70, riverH: handH * 0.44,
      bottomPad: 58 * k, labelGap: 24 * k,   // 底部留出「教学条」的位置
      stripH: 58 * k
    };
  }
  function seatFrame(s, M) {
    var W = M.W, H = M.H;
    var out = OUT[s], right = { x: out.y, y: -out.x };
    var rot = ROT[s];
    var isMe = s === HUMAN, isSide = out.x !== 0;
    var hH = isMe ? M.handH : M.oppH, hW = hH * AR;
    var edge = isSide ? (M.PAD + hH / 2)
      : (out.y > 0 ? M.PAD + M.bottomPad + hH / 2 : M.PAD + M.labelGap + hH / 2);
    var halfExt = isSide ? W / 2 : H / 2;
    var cx = W / 2 + out.x * (halfExt - edge);
    var cy = H / 2 + out.y * (halfExt - edge);
    var mH = isMe ? M.meldH : M.meldH * 0.80;
    var rH = isMe ? M.riverH : M.riverH * 0.88;
    var mDist = hH / 2 + 8 + mH / 2;
    var rDist = hH / 2 + 8 + mH + 9 + rH / 2;
    return {
      s: s, out: out, right: right, rot: rot, isMe: isMe, isSide: isSide,
      hx: cx, hy: cy, hH: hH, hW: hW,
      meldX: cx - out.x * mDist, meldY: cy - out.y * mDist, meldH: mH,
      riverX: cx - out.x * rDist, riverY: cy - out.y * rDist, riverH: rH,
      color: SEAT_C[s]
    };
  }
  /** 手牌槽位：主体按序排列，刚摸到的牌（或胡牌）在「右手边」留间隔单独排开 */
  function handPlan(p) {
    var tiles = CM.concealedTiles(p);
    var sepId = -1, winTile = -1;
    if (p.won && p.winInfo) {
      winTile = p.winInfo.tile;
      sepId = winTile;
      if (p.winInfo.selfDraw) { var a = tiles.indexOf(sepId); if (a >= 0) tiles.splice(a, 1); }
    } else if (p.lastDrawn >= 0 && p.hand[p.lastDrawn] > 0) {
      sepId = p.lastDrawn;
      var b = tiles.indexOf(sepId); if (b >= 0) tiles.splice(b, 1);
    }
    return { tiles: tiles, sepId: sepId, winTile: winTile };
  }
  function handSlots(F, plan, shift) {
    var gap = F.hW + 4, sepExtra = F.hW * 0.55, n = plan.tiles.length;
    var offs = [];
    for (var i = 0; i < n; i++) offs.push(i * gap);
    if (plan.sepId >= 0) offs.push(n * gap + sepExtra);
    var span = offs.length ? offs[offs.length - 1] : 0;
    var start = -span / 2 + (shift || 0), out = [];
    for (var k = 0; k < offs.length; k++) {
      var o = start + offs[k];
      out.push({
        id: k < n ? plan.tiles[k] : plan.sepId,
        sep: k >= n,
        x: F.hx + F.right.x * o, y: F.hy + F.right.y * o, rot: F.rot
      });
    }
    return { slots: out, span: span, band: span + F.hW, total: offs.length, start: start };
  }
  function box(name, x, y, w, h) { state.boxes.push({ name: name, x: x, y: y, w: w, h: h }); }
  function boxFromBand(name, F, along, thick, len, extra) {
    // along: 沿 right 的长度 len；thick: 沿 out 的厚度；extra: 沿 out 的外推（手牌等）
    var cx = F.hx + F.right.x * (extra || 0), cy = F.hy + F.right.y * (extra || 0);
    if (F.isSide) box(name, cx - thick / 2, cy - len / 2, thick, len);
    else box(name, cx - len / 2, cy - thick / 2, len, thick);
  }

  /* ================= 场景绘制 =================
   * 绒布（毛毡）质感四层，缺一层就会退化成「均匀噪点＝塑料」：
   *   ① 中央柔和光斑（径向渐变：桌面中段受顶灯，四周落暗）
   *   ② 定向拉丝：短横线段而非方点 —— 噪点无方向性是塑料感的主因，绒布绒毛有走向
   *   ③ 斜织纹：±40° 细密交叉网，是毛毡底布的结构
   *   ④ 暗角：径向遮罩把四角压暗，画面重心落到中央
   */
  function feltTexture(W, H) {
    var cw = Math.max(2, Math.round(W)), ch = Math.max(2, Math.round(H));
    var key = cw + 'x' + ch;
    if (state.feltKey === key && state.feltTex) return state.feltTex;
    if (state.feltTex) { try { state.feltTex.destroy(true); } catch (e) { /* noop */ } state.feltTex = null; }
    var c = document.createElement('canvas'); c.width = cw; c.height = ch;
    var x = c.getContext('2d');

    // ① 中央光斑：光源略偏下（观察者这一侧），中心到边缘四段过渡
    var grd = x.createRadialGradient(cw * 0.5, ch * 0.6, Math.min(cw, ch) * 0.04,
      cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.78);
    grd.addColorStop(0, V.feltHot);
    grd.addColorStop(0.4, V.feltM1);
    grd.addColorStop(0.72, V.feltM2);
    grd.addColorStop(1, V.feltDeep);
    x.fillStyle = grd; x.fillRect(0, 0, cw, ch);

    // ② 定向拉丝：短横线段，长度/粗细/透明度微抖 —— 这是「绒毛」而不是「噪点」
    x.lineCap = 'round';
    for (var i = 0; i < FXN.slub; i++) {
      var px = rnd() * cw, py = rnd() * ch, len = 2.5 + rnd() * 8;
      x.strokeStyle = rnd() < 0.52 ? V.slubHi : V.slubLo;
      x.lineWidth = 0.7 + rnd() * 0.6;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + len, py + (rnd() - 0.5) * 1.1);
      x.stroke();
    }
    // ③ 斜织纹：两组交叉斜线（毛毡底布的经纬）
    for (var j = 0; j < FXN.weave; j++) {
      var wx = rnd() * cw, wy = rnd() * ch, wl = 3 + rnd() * 5;
      x.strokeStyle = rnd() < 0.5 ? 'rgba(255,255,255,.028)' : 'rgba(0,0,0,.045)';
      x.lineWidth = 0.6;
      x.beginPath();
      if (j % 2) { x.moveTo(wx, wy); x.lineTo(wx + wl * 0.77, wy + wl * 0.64); }
      else { x.moveTo(wx, wy); x.lineTo(wx + wl * 0.77, wy - wl * 0.64); }
      x.stroke();
    }
    // ④ 暗角
    if (FXN.vignette) {
      var vg = x.createRadialGradient(cw * 0.5, ch * 0.5, Math.min(cw, ch) * 0.34,
        cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.76);
      vg.addColorStop(0, 'rgba(3,16,10,0)');
      vg.addColorStop(0.72, 'rgba(3,16,10,.34)');
      vg.addColorStop(1, V.vign);
      x.fillStyle = vg; x.fillRect(0, 0, cw, ch);
    }

    var tex = PIXI.Texture.from(c);
    state.feltTex = tex; state.feltKey = key;
    return tex;
  }
  function drawFelt(W, H) {
    var sp = new PIXI.Sprite(feltTexture(W, H));
    sp.width = W; sp.height = H;
    // 出牌二次确认：点桌面空白处 = 取消已选中的牌（手牌节点在 felt 之上，点手牌不会走到这里）
    sp.eventMode = 'static';
    sp.on('pointerdown', function () { if (state.selId >= 0) { clearSelection(); render(); } });
    state.world.addChild(sp);
    // 桌边四环：外框暗边 → 金线 → 金线内高光（内发光感）→ 内侧绒倒角
    var rim = gfx();
    rim.roundRect(5, 5, W - 10, H - 10, 20).stroke({ width: 4, color: hex2num(V.rimOuter), alpha: 0.85 });
    rim.roundRect(9, 9, W - 18, H - 18, 17).stroke({ width: 2, color: hex2num(V.rimGold), alpha: 0.45 });
    rim.roundRect(11, 11, W - 22, H - 22, 16).stroke({ width: 1, color: hex2num(V.rimGold), alpha: 0.22 });
    rim.roundRect(13, 13, W - 26, H - 26, 15).stroke({ width: 1, color: hex2num(V.rimInner), alpha: 0.25 });
    state.world.addChild(rim);
  }

  function drawSeat(s, F, M) {
    var G = state.g, p = G.players[s], isMe = s === HUMAN;
    var isTurn = G.phase === 'playing' && G.turn === s && !p.won && !G.claim;
    var plan = handPlan(p);
    var faceUp = p.won || isMe;
    var hide = performance.now() < state.hideHandsUntil;
    // 教学「听牌幽灵牌」：手牌右侧列出所有能和且还有剩余的牌
    var teach = isMe ? state.teach : null;
    var ghosts = (teach && teach.kind === 'live' && !p.won && !hide && teach.waiting) ? teach.waiting : [];
    var gStep = F.hW * 0.66 + 4, gw = ghosts.length ? ghosts.length * gStep + F.hW * 0.5 : 0;
    var hs = handSlots(F, plan, isMe ? -gw / 2 : 0);
    var i, node;

    // —— 手牌
    // 出牌二次确认：第一次点牌只把牌「提起」1/3 牌高待确认，再点同一张才真正打出。
    // 选中态按**槽位索引**记忆（同 id 的多张牌只抬一张），并随轮次/手牌变化自动失效。
    if (isMe && (p.won || hide || G.phase !== 'playing' || G.turn !== HUMAN || G.claim)) clearSelection();
    var selAlive = false;
    if (!hide) {
      for (i = 0; i < hs.slots.length; i++) {
        var sl = hs.slots[i];
        var isWinTile = p.won && sl.id === plan.winTile;
        var legal = isMe && G.phase === 'playing' && G.turn === HUMAN && !G.claim && !p.won &&
          (!CM.holdsMissingSuit(p) || CM.suitOf(sl.id) === p.missing);
        var recThis = isMe && !p.won && sl.id === state.recTile;
        var armed = isMe && !p.won && legal && state.selSlot === i && state.selId === sl.id;
        if (armed) selAlive = true;
        var yBase = armed ? sl.y - F.hH / 3 : sl.y;   // 提起量 = 牌高的 1/3
        if (armed) {                                  // 待确认牌加一圈金框，和「推荐牌」的光晕区分开
          var hb = gfx();
          var hw2 = F.hW * 0.5, hh2 = F.hH * 0.5;
          hb.roundRect(sl.x - hw2 - 3, yBase - hh2 - 3, hw2 * 2 + 6, hh2 * 2 + 6, Math.max(3, F.hW * 0.14));
          hb.stroke({ width: 2.5, color: GOLD, alpha: 0.95 });
          state.world.addChild(hb);
        }
        node = tileNode(faceUp ? sl.id : -1, F.hW, F.hH, {
          rot: sl.rot, glow: isWinTile || recThis
        });
        node.position.set(sl.x, yBase);
        node.__id = sl.id; node.__sep = sl.sep; node.__slot = i; node.__yBase = yBase;
        if (isMe && !p.won) {
          node.eventMode = legal ? 'static' : 'none';
          node.cursor = legal ? 'pointer' : 'default';
          node.alpha = legal ? 1 : 0.42;
          (function (nd) {
            nd.on('pointerover', function () { if (nd.alpha > 0.6) { nd.y = nd.__yBase - 12; nd.scale.set(1.06); } });
            nd.on('pointerout', function () { nd.y = nd.__yBase; nd.scale.set(1); });
            nd.on('pointerdown', function () {
              if (nd.alpha <= 0.6) return;                        // 非法牌（缺门没打完等）不可点
              if (state.selSlot === nd.__slot && state.selId === nd.__id) {
                humanDiscard(nd.__id);                            // 第二次点同一张 → 真正打出
              } else {
                state.selId = nd.__id; state.selSlot = nd.__slot;  // 第一次点 → 只提起待确认
                render();
              }
            });
          })(node);
          if (recThis) pulse(node, { period: 620, min: 0.72, max: 1 });
        }
        state.world.addChild(node);
      }
      // 选中的那张已经不在手牌里（被副露吃掉 / 换了轮次）→ 清掉脏状态
      if (isMe && state.selId >= 0 && !selAlive) clearSelection();
      // —— 听牌提示：把「你在等什么牌」直接摆到手牌右边（虚线金框 + 剩余张数）
      for (i = 0; i < ghosts.length; i++) {
        var gx = hs.start + hs.span + F.hW * 0.85 + gStep * i;
        var gn = tileNode(ghosts[i].tile, F.hW * 0.62, F.hH * 0.62, { rot: F.rot });
        gn.position.set(F.hx + F.right.x * gx, F.hy + F.right.y * gx);
        gn.alpha = 0.94;
        state.world.addChild(gn);
        var frame = gfx();
        var fw2 = F.hW * 0.62, fh2 = F.hH * 0.62, rr = Math.max(3, fw2 * 0.14);
        if (F.isSide) frame.roundRect(gn.x - fh2 / 2 - 3, gn.y - fw2 / 2 - 3, fh2 + 6, fw2 + 6, rr + 3);
        else frame.roundRect(gn.x - fw2 / 2 - 3, gn.y - fh2 / 2 - 3, fw2 + 6, fh2 + 6, rr + 3);
        frame.stroke({ width: 2, color: GOLD, alpha: 0.95 });
        state.world.addChild(frame);
        pulse(frame, { period: 900, min: 0.45, max: 1 });
        var cnt = label(String(ghosts[i].left), 11, '#ffe6a3', '800');
        cnt.anchor.set(0.5, 0);
        cnt.position.set(gn.x, gn.y + (F.isSide ? fw2 / 2 : fh2 / 2) + 2);
        state.world.addChild(cnt);
      }
      boxFromBand('hand' + s, F, null, F.hH, hs.band + gw, 0);
    }

    // —— 副露（暗杠显示牌背）
    if (p.melds.length) {
      var mH = F.meldH, mW = mH * AR, step = mW + 2, grpGap = mW * 0.95;
      var segs = [], total = 0;
      for (i = 0; i < p.melds.length; i++) {
        var cnt = p.melds[i].type === 'kong' ? 4 : 3;
        segs.push({ m: p.melds[i], cnt: cnt, len: cnt * step - 2 });
        total += cnt * step - 2 + grpGap;
      }
      total -= grpGap;
      var off = -total / 2;
      for (i = 0; i < segs.length; i++) {
        for (var k = 0; k < segs[i].cnt; k++) {
          var id = segs[i].m.concealed ? -1 : segs[i].m.tile;
          var mn = tileNode(id, mW, mH, { rot: F.rot });
          mn.position.set(F.meldX + F.right.x * (off + step / 2), F.meldY + F.right.y * (off + step / 2));
          state.world.addChild(mn);
          off += step;
        }
        off += grpGap - step;
      }
      var meldLen = total + mW;
      if (F.isSide) box('meld' + s, F.meldX - mH / 2, F.meldY - meldLen / 2, mH, meldLen);
      else box('meld' + s, F.meldX - meldLen / 2, F.meldY - mH / 2, meldLen, mH);
    }

    // —— 牌河：门前有序「两排」，按出牌顺序逐张填
    var n = p.river.length;
    if (n) {
      var per = Math.max(6, Math.ceil(n / 2));   // 保证「门前两排」：n>12 时自动加宽每排
      var rows = Math.ceil(n / per);
      var rH = F.riverH, rW = rH * AR;
      var stp = rW + 3, rowStep = rH + 3;
      for (i = 0; i < n; i++) {
        if (state.flySkip && state.flySkip[s + ':' + i]) continue;
        var row = Math.floor(i / per), col = i % per;
        var cntR = Math.min(per, n - row * per);
        var o2 = (col - (cntR - 1) / 2) * stp;
        var d2 = row * rowStep;
        var rn = tileNode(p.river[i], rW, rH, { rot: F.rot });
        rn.position.set(F.riverX + F.right.x * o2 - F.out.x * d2, F.riverY + F.right.y * o2 - F.out.y * d2);
        state.world.addChild(rn);
        // 最后一打：细白框 + 呼吸，标出「刚刚打出」是哪张（只加描边，不改位置/体积）
        if (i === n - 1) {
          var lf = gfx(), lw = rW, lh = rH;
          if (F.isSide) lf.roundRect(rn.x - lh / 2 - 2, rn.y - lw / 2 - 2, lh + 4, lw + 4, 5);
          else lf.roundRect(rn.x - lw / 2 - 2, rn.y - lh / 2 - 2, lw + 4, lh + 4, 5);
          lf.stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
          state.world.addChild(lf);
          pulse(lf, { period: 1100, min: 0.3, max: 1 });
        }
      }
      var rivLen = per * stp, rivThick = rows * rowStep;
      if (F.isSide) box('river' + s, F.riverX - rivThick / 2, F.riverY - rivLen / 2, rivThick, rivLen);
      else box('river' + s, F.riverX - rivLen / 2, F.riverY - rivThick / 2, rivLen, rivThick);
    }

    // —— 轮到谁：呼吸高亮框
    if (isTurn) {
      var pad = 9;
      var along = hs.band + pad * 2, thick = F.hH + pad * 2;
      var hlx = F.hx + F.right.x * 0, hly = F.hy;
      var p2 = gfx();
      if (F.isSide) p2.roundRect(hlx - thick / 2, hly - along / 2, thick, along, 14);
      else p2.roundRect(hlx - along / 2, hly - thick / 2, along, thick, 14);
      p2.stroke({ width: 2.5, color: F.color, alpha: 1 });
      state.world.addChild(p2);
      pulse(p2, { period: 900, min: 0.28, max: 0.95 });
    }
    // —— 胡牌金框
    if (p.won) {
      var wpad = 12, walong = hs.band + wpad * 2, wthick = F.hH + wpad * 2;
      var wf = gfx();
      if (F.isSide) wf.roundRect(F.hx - wthick / 2, F.hy - walong / 2, wthick, walong, 16);
      else wf.roundRect(F.hx - walong / 2, F.hy - wthick / 2, walong, wthick, 16);
      wf.stroke({ width: 3, color: GOLD, alpha: 0.9 });
      state.world.addChild(wf);
    }
  }

  function seatLabel(s, W, H, M) {
    var G = state.g, p = G.players[s], isMe = s === HUMAN, k = state.k || 1;
    var isTurn = G.phase === 'playing' && G.turn === s && !G.won && !G.claim;
    var txt = seatName(s) + ' · ' + CM.totalOf(p.hand) +
      (G.dealer === s ? ' · ' + t().dealer : '') +
      (p.missing >= 0 ? ' · 缺' + SUITS[p.missing].zh : '') +
      (p.won ? ' · ' + t().won : '');
    var lb = label(txt, 12.5, isTurn || p.won ? '#ffffff' : '#bcd6c6', isTurn ? '800' : '600');
    var bgW = lb.width + 16 * k, bgH = 22 * k;
    var pos;
    if (s === 2) pos = { x: W / 2, y: 6 * k, ax: 0.5, ay: 0 };
    else if (s === 1) pos = { x: W - 10 * k, y: 6 * k, ax: 1, ay: 0 };
    else if (s === 3) pos = { x: 10 * k, y: 6 * k, ax: 0, ay: 0 };
    else pos = { x: W / 2, y: H - 6 * k, ax: 0.5, ay: 1 };
    var bg = gfx();
    var bx = pos.x - pos.ax * bgW, by = pos.y - pos.ay * bgH;
    bg.roundRect(bx, by, bgW, bgH, 11 * k).fill({ color: isTurn ? 0x0d3a53 : 0x0a2619, alpha: isTurn ? 0.92 : 0.72 });
    bg.roundRect(bx, by, bgW, bgH, 11 * k).stroke({ width: isTurn ? 2 : 1.2, color: SEAT_C[s], alpha: isTurn ? 1 : 0.5 });
    state.world.addChild(bg);
    lb.anchor.set(pos.ax, pos.ay);
    lb.position.set(pos.x - pos.ax * 8 * k, pos.y - pos.ay * 3 * k);
    state.world.addChild(lb);
    if (isTurn) pulse(bg, { period: 900, min: 0.55, max: 1 });
    box('label' + s, bx, by, bgW, bgH);
  }

  function drawCenter(W, H, M) {
    var G = state.g, cx = W / 2, cy = H / 2, k = state.k || 1;
    var pw = 224 * k, ph = 132 * k;
    var pad = gfx();
    pad.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 20 * k)
      .fill({ color: 0x0a2a1b, alpha: 0.82 })
      .stroke({ width: 2, color: 0xd9b45c, alpha: 0.42 });
    state.world.addChild(pad);
    box('center', cx - pw / 2, cy - ph / 2, pw, ph);

    var wall = label(String(G.wall.length), 46, '#ffffff', '800');
    wall.anchor.set(0.5); wall.position.set(cx, cy - 30 * k);
    state.world.addChild(wall);
    var wc = label(t().wall, 11.5, '#8fb8a2', '700');
    wc.anchor.set(0.5); wc.position.set(cx, cy - 2 * k);
    state.world.addChild(wc);

    var trTxt = G.phase === 'playing' ? (t().turn + '  ' + seatName(G.turn)) : t().settled;
    var tr = label(trTxt, 14, G.phase === 'playing' ? '#ffe6a3' : '#c8d6cd', '800');
    tr.anchor.set(0.5); tr.position.set(cx, cy + 20 * k);
    state.world.addChild(tr);

    if (G.lastDiscard) {
      var rH = M.riverH * 1.06, rW = rH * AR;
      var ln = tileNode(G.lastDiscard.tile, rW, rH, { rot: 0, glow: true });
      ln.position.set(cx, cy + 48 * k);
      state.world.addChild(ln);
    }
    // 方位小指示（下家 / 上家）
    var dirs = [
      { s: 1, x: cx + 130 * k, y: cy, txt: '▶' },
      { s: 3, x: cx - 130 * k, y: cy, txt: '◀' }
    ];
    for (var i = 0; i < dirs.length; i++) {
      var dl = label(dirs[i].txt, 15, '#' + SEAT_C[dirs[i].s].toString(16).padStart(6, '0'), '800');
      dl.anchor.set(0.5); dl.position.set(dirs[i].x, dirs[i].y);
      state.world.addChild(dl);
    }
  }

  function drawHandHint(W, H, M) { /* 已并入底部教学条 drawTeachStrip */ }

  /* ================= 动效 ================= */
  function fxFlyTile(id, from, to, w, h, rot, dur, delay, onDone) {
    var node = tileNode(id, w, h, { rot: rot });
    node.position.set(from.x, from.y);
    node.alpha = 0;
    state.fx.addChild(node);
    var mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - Math.max(20, Math.abs(to.y - from.y) * 0.18) };
    tween(dur, function (e) {
      node.alpha = Math.min(1, e * 4);
      var u = 1 - e;
      node.x = u * u * from.x + 2 * u * e * mid.x + e * e * to.x;
      node.y = u * u * from.y + 2 * u * e * mid.y + e * e * to.y;
      node.rotation = rot;
      node.scale.set(0.72 + 0.28 * e);
    }, function () {
      if (node.parent) node.parent.removeChild(node);
      node.destroy({ children: true });
      if (onDone) onDone();
    }, delay);
    state.fxStats.flights++;
    return node;
  }
  function fxRing(x, y, r0, r1, dur, color, width) {
    var c = gfx();
    c.position.set(x, y);
    state.fx.addChild(c);
    tween(dur, function (e) {
      c.clear();
      c.circle(0, 0, r0 + (r1 - r0) * e).stroke({ width: width || 3, color: color, alpha: 1 - e });
    }, function () { if (c.parent) c.parent.removeChild(c); c.destroy(); });
    state.fxStats.rings++;
  }
  function fxBurst(x, y, n, colors, spread, speed) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU, sp = speed * (0.45 + Math.random() * 0.75);
      var sz = 3 + Math.random() * 4.5;
      var gg = gfx();
      if (Math.random() < 0.5) gg.circle(0, 0, sz).fill({ color: colors[i % colors.length] });
      else gg.roundRect(-sz, -sz * 0.7, sz * 2, sz * 1.4, 1.6).fill({ color: colors[i % colors.length] });
      gg.position.set(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread);
      state.fx.addChild(gg);
      state.particles.push({
        o: gg, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
        life: 0, max: 0.85 + Math.random() * 0.75, spin: (Math.random() - 0.5) * 12
      });
    }
    state.fxStats.bursts++;
  }
  /** 发牌：从牌墙（桌心）依次飞向四家手牌位 */
  function playDeal(W, H, M) {
    var G = state.g, cx = W / 2, cy = H / 2;
    var perSeat = [];
    for (var s = 0; s < 4; s++) {
      var F = seatFrame(s, M);
      var p = G.players[s];
      var plan = { tiles: CM.concealedTiles(p).slice(0, 13), sepId: -1 };
      while (plan.tiles.length < 13) plan.tiles.push(0);
      var hs = handSlots(F, plan);
      perSeat.push({ F: F, slots: hs.slots });
    }
    var dur = 0.42, total = 0;
    for (var r = 0; r < 13; r++) {
      for (var q = 0; q < 4; q++) {
        var slot = perSeat[q].slots[r];
        if (!slot) continue;
        var F2 = perSeat[q].F;
        var d = r * 0.026;
        fxFlyTile(q === HUMAN ? slot.id : -1, { x: cx, y: cy }, { x: slot.x, y: slot.y },
          F2.hW, F2.hH, slot.rot, dur, d);
        total = Math.max(total, d + dur);
      }
    }
    state.fxStats.deals++;
    state.hideHandsUntil = performance.now() + total * 1000 + 60;
    tween(total + 0.08, function () { }, function () { state.hideHandsUntil = 0; requestRender(); });
  }
  function playDiscard(seat, tile, W, H, M) {
    var F = seatFrame(seat, M);
    var river = state.g.players[seat].river;
    var n = river.length;
    if (!n) return;
    var per = Math.max(6, Math.ceil(n / 2));
    var row = Math.floor((n - 1) / per), col = (n - 1) % per;
    var cntR = Math.min(per, n - row * per);
    var rH = F.riverH, rW = rH * AR, stp = rW + 3, rowStep = rH + 3;
    var o = (col - (cntR - 1) / 2) * stp, d = row * rowStep;
    var to = { x: F.riverX + F.right.x * o - F.out.x * d, y: F.riverY + F.right.y * o - F.out.y * d };
    state.flySkip = state.flySkip || {};
    var key = seat + ':' + (n - 1);
    state.flySkip[key] = 1;
    fxFlyTile(tile, { x: F.hx, y: F.hy }, to, rW, rH, F.rot, 0.34, 0, function () {
      delete state.flySkip[key];
      requestRender();
    });
  }
  function playRing(seat, M, color) {
    var F = seatFrame(seat, M);
    var x = F.meldX, y = F.meldY;
    fxRing(x, y, Math.min(F.meldH, F.hW) * 0.35, Math.max(F.meldH, F.hW) * 1.8, 0.6, color, 3.5);
    fxRing(x, y, Math.min(F.meldH, F.hW) * 0.2, Math.max(F.meldH, F.hW) * 1.15, 0.45, 0xfff0c0, 2);
  }
  function playWin(seat, M) {
    var F = seatFrame(seat, M);
    var x = F.hx, y = F.hy;
    fxRing(x, y, 10, Math.max(M.W, M.H) * 0.22, 0.85, GOLD, 5);
    fxRing(x, y, 6, Math.max(M.W, M.H) * 0.14, 0.6, 0xfff3c8, 2.5);
    fxBurst(x, y, 46, [GOLD, 0xfff0b8, 0xff8f5a, 0xffffff], 60, 330);
    [0.12, 0.3, 0.48].forEach(function (dl) {
      tween(0.3, function () { }, function () {
        fxBurst(x + (Math.random() - 0.5) * 120, y + (Math.random() - 0.5) * 70, 16,
          [GOLD, 0xffe6a0, 0xffffff], 30, 260);
      }, dl);
    });
    // 胡牌横幅（新手最容易漏掉的反馈）
    var p = state.g.players[seat];
    var win = p.winInfo;
    var pts = 0;
    if (state.g.settlement) pts = state.g.settlement.seats[seat].fanPoints;
    state.banner = {
      seat: seat, fans: win ? win.fans.total : 0, selfDraw: win ? win.selfDraw : false,
      pts: pts, until: performance.now() + 2600
    };
    tween(2.6, function () { }, function () { requestRender(); });
  }
  function processEvents(W, H, M) {
    var G = state.g, from = state.fxSeen;
    if (from > G.history.length) { state.fxSeen = G.history.length; return; }
    for (var i = from; i < G.history.length; i++) {
      var e = G.history[i];
      if (e.type === 'discard') playDiscard(e.seat, e.tile, W, H, M);
      else if (e.type === 'pong') playRing(e.seat, M, GOLD);
      else if (e.type === 'kong') playRing(e.seat, M, 0x9fdcff);
      else if (e.type === 'win') playWin(e.seat, M);
    }
    state.fxSeen = G.history.length;
  }

  /* ================= 渲染 ================= */
  /** 本帧教学信息：向听进度 / 听什么牌 / 推荐弃牌的理由
   *  关键：手牌 14 张（轮到我）时，"是否听牌"必须按**打完之后**那 13 张判断，
   *  否则 winningTiles 会当成 15 张算，永远返回空。 */
  function computeTeach() {
    var G = state.g, my = G.players[HUMAN];
    if (!G || G.phase !== 'playing' || my.won) return null;
    var melds = my.melds.length;
    var mustMiss = CM.holdsMissingSuit(my);
    var need = 13 - melds * 3;              // 我回合外应有的手牌张数
    var total = CM.totalOf(my.hand);
    var myTurn = G.turn === HUMAN && !G.claim;
    var sh = CM.handShanten(my);

    // 可见牌（我的手牌 + 四家牌河 + 明牌副露）→ 用于算「还剩几张」
    var vis = new Array(27).fill(0);
    for (var t = 0; t < 27; t++) vis[t] += my.hand[t];
    for (var s = 0; s < 4; s++) {
      var q = G.players[s];
      for (var i = 0; i < q.river.length; i++) vis[q.river[i]]++;
      for (var m = 0; m < q.melds.length; m++) {
        var md = q.melds[m];
        if (md.concealed) continue;
        vis[md.tile] += md.type === 'kong' ? 4 : 3;
      }
    }

    // 推荐弃牌：只要手里有"多出来的那一张"就算，与是否轮到我解耦
    // （轮不到我时不算出来也没关系，只是显示层会按回合门控）
    var rec = -1, recInfo = null;
    if (!mustMiss && total === need + 1) {
      var opts = CM.analyzeDiscards(my.hand, melds).filter(function (o) { return my.hand[o.tile] > 0; });
      if (opts.length) {
        opts.sort(function (a, b) {
          if (a.shanten !== b.shanten) return a.shanten - b.shanten;
          if (a.ukeireCount !== b.ukeireCount) return b.ukeireCount - a.ukeireCount;
          return a.tile - b.tile;
        });
        rec = opts[0].tile;
        recInfo = { shanten: opts[0].shanten, count: opts[0].ukeireCount };
      }
    }

    // 听牌判定：用「打完那一张之后」的那副手牌
    var waiting = [], waitLeft = 0, shAfter = sh, waitingRaw = 0;
    var canProbe = !mustMiss && (total === need || (total === need + 1 && rec >= 0));
    if (canProbe) {
      var probe = total === need + 1;
      if (probe) my.hand[rec]--;
      shAfter = CM.shanten(my.hand, melds);
      if (shAfter <= 0) {
        var wt = CM.winningTiles(my.hand, melds);
        waitingRaw = wt.length;
        for (var k = 0; k < wt.length; k++) {
          if (my.missing >= 0 && Math.floor(wt[k] / 9) === my.missing) continue;
          var left = CM.remainingOf(vis, wt[k]);
          if (left > 0) { waiting.push({ tile: wt[k], left: left }); waitLeft += left; }
        }
      }
      if (probe) my.hand[rec]++;
    }

    var improving = 0;
    if (!mustMiss && sh > 0) improving = CM.improvingTiles(my.hand, melds).length;
    // 死叫：手牌已经听牌（向听 0），但可和的那几张牌一张都不剩（全被打完 / 全落在缺门里）。
    // 这时 waiting 为空但并不是「没下叫」—— 教学条要说清，否则玩家只看到「离下叫 0 张」却等不到牌。
    var deadWait = canProbe && shAfter <= 0 && waitingRaw > 0 && waiting.length === 0;
    return {
      kind: 'live', sh: sh, shAfter: shAfter, shEff: (recInfo ? recInfo.shanten : sh),
      myTurn: myTurn, mustMiss: mustMiss,
      waiting: waiting, waitLeft: waitLeft, improving: improving, rec: rec, recInfo: recInfo,
      deadWait: deadWait,
      // 诊断用（探针读取）
      diag: { need: need, total: total, melds: melds, canProbe: canProbe, waitingRaw: waitingRaw,
              turn: G.turn, hasClaim: !!G.claim,
              pendingDraw: G.pendingDraw, wallPointer: G.wallPointer, wallLen: G.wall.length,
              lastDrawn: my.lastDrawn,
              drewPtr: -1,
              drewSameG: false }
    };
  }

  /** 底部教学条：向听进度 / 听牌提示 / 推荐牌的理由 —— 新手最缺的就是这一条 */
  function drawTeachStrip(W, H, M) {
    var G = state.g, my = G.players[HUMAN];
    var T0 = t();
    var y0 = H - M.stripH;
    box('strip', 0, y0, W, M.stripH);

    var bg = gfx();
    bg.roundRect(8, y0 + 6, W - 16, M.stripH - 12, 12).fill({ color: 0x071e13, alpha: 0.72 });
    bg.roundRect(8, y0 + 6, W - 16, M.stripH - 12, 12).stroke({ width: 1.5, color: 0x2f6b4f, alpha: 0.7 });
    state.world.addChild(bg);

    var teach = state.teach;
    var winNow = humanWinReady();
    var msg = '', col = '#cfe6d8';
    if (my.won) {
      var f = my.winInfo ? my.winInfo.fans.total : 0;
      msg = '🎉 ' + T0.youWon + ' · ' + f + ' 番';
      col = '#ffe6a3';
    } else if (winNow) {
      msg = '🎉 ' + T0.teachCanWin;
      col = '#ffe07a';
    } else if (state.selId >= 0 && G.turn === HUMAN && !G.claim) {
      // 出牌二次确认：牌已提起，等第二次点击
      msg = '🎯 ' + T0.hintArmed(MJT(state.selId));
      col = '#ffe6a3';
    } else if (teach && teach.mustMiss) {
      msg = '⚠ ' + T0.teachMustMiss;
      col = '#ffc98a';
    } else if (teach) {
      // 有效距离：有推荐牌时，用「打完那张之后」的距离 —— 这才是你实际所处的进度。
      // （手牌多一张时，原始向听会失真：可能算出 0 却一张都和不了）
      var shEff = (typeof teach.shEff === 'number') ? teach.shEff : teach.sh;
      if (teach.waiting.length) {
        msg = (teach.myTurn && teach.rec >= 0 ? '打这张就下叫 · ' : '✅ ') +
          T0.teachReady + ' · ' + T0.teachWait(teach.waitLeft);
        col = '#9ff0bd';
      } else if (teach.deadWait) {
        msg = '⚠ ' + T0.teachDeadWait;
        col = '#ffc98a';
      } else if (shEff <= 0) {
        msg = '✅ ' + T0.teachReady;
        col = '#9ff0bd';
      } else {
        msg = T0.teachShanten(shEff) + (teach.improving ? ' · ' + T0.teachImprove(teach.improving) : '');
      }
    }
    var main = label(msg, 15, col, '800');
    main.anchor.set(0.5, 0.5);
    main.position.set(W / 2, y0 + 20);
    state.world.addChild(main);

    // 左：座位信息　右：推荐牌的理由
    var seatTxt = T0.you + ' · ' + CM.totalOf(my.hand) + ' 张' +
      (G.dealer === HUMAN ? ' · ' + T0.dealer : '') +
      (my.missing >= 0 ? ' · 缺' + SUITS[my.missing].zh : '');
    var L = label(seatTxt, 12, '#8fb8a2', '600');
    L.anchor.set(0, 0.5); L.position.set(20, y0 + 44);
    state.world.addChild(L);

    if (teach && teach.rec >= 0 && teach.recInfo && G.turn === HUMAN && !G.claim) {
      var rt = MJT(teach.rec);
      var reason = teach.recInfo.shanten <= 0
        ? T0.teachWinReason(rt, T0.teachReady)
        : T0.teachReason(rt, teach.recInfo.count);
      var R = label('★ ' + reason, 12.5, '#ffe6a3', '700');
      R.anchor.set(1, 0.5); R.position.set(W - 20, y0 + 44);
      state.world.addChild(R);
    } else if (teach && teach.waiting.length) {
      var R3 = label(T0.teachWaiting + ' ' + teach.waiting.map(function (w) { return MJT(w.tile) + '(' + w.left + ')'; }).join(' '), 12.5, '#9ff0bd', '700');
      R3.anchor.set(1, 0.5); R3.position.set(W - 20, y0 + 44);
      state.world.addChild(R3);
    } else if (teach && teach.mustMiss) {
      var R2 = label(T0.teachFlowerPig, 12, '#ffc98a', '600');
      R2.anchor.set(1, 0.5); R2.position.set(W - 20, y0 + 44);
      state.world.addChild(R2);
    }
  }

  /** 胡牌横幅：大字 + 番种（现在胡了只有日志里一行，新手根本注意不到） */
  function drawBanner(W, H, M) {
    var b = state.banner;
    if (!b || performance.now() > b.until) { state.banner = null; return; }
    var p = state.g.players[b.seat];
    var txt = seatName(b.seat) + ' ' + (b.seat === HUMAN ? t().winBanner(b.fans) : t().evWinSelf(seatName(b.seat), '', b.fans));
    var fans = p.winInfo ? p.winInfo.fans.items.map(function (x) { return x.name; }).join(' · ') : '';
    var line2 = (b.selfDraw ? t().winBannerSelf : t().winBannerRon) +
      (fans ? ' · ' + fans : '') + (b.pts ? ' · ' + b.pts + ' ' + t().pts : '');
    var main = label(b.seat === HUMAN ? t().winBanner(b.fans) : seatName(b.seat) + ' ' + t().won + ' ' + b.fans + ' ' + '番', 34, '#ffe6a3', '800');
    main.anchor.set(0.5);
    var big = main.width + 80, bh = 108;
    var c = gfx();
    c.roundRect(W / 2 - big / 2, H / 2 - bh / 2 - 10, big, bh, 20)
      .fill({ color: 0x08251a, alpha: 0.9 })
      .stroke({ width: 3, color: GOLD, alpha: 0.95 });
    state.world.addChild(c);
    main.position.set(W / 2, H / 2 - 26);
    state.world.addChild(main);
    var sub = label((b.seat === HUMAN ? t().you : seatName(b.seat)) + ' · ' + line2, 14, '#cfe6d8', '700');
    sub.anchor.set(0.5);
    sub.position.set(W / 2, H / 2 + 20);
    state.world.addChild(sub);
    pulse(c, { period: 640, min: 0.72, max: 1 });
  }

  function render() {
    if (!state.ready || !state.app) { renderChrome(); return; }
    try {
      var W = state.app.screen.width, H = state.app.screen.height;
      var M = metrics(W, H);
      state.pulses = [];
      state.boxes = [];
      state.world.removeChildren().forEach(function (c) { c.destroy({ children: true }); });

      // 出牌二次确认：stage 兜底命中区（点在舞台空白、没落到任何物体上时也能取消选中）
      // ⚠️ hitArea 用 app.screen（PIXI 自己维护的矩形），别 new PIXI.Rectangle ——
      // build.mjs 只具名导出了 6 个 PIXI 符号，产物里没有 Rectangle，会在真机直接抛错。
      state.app.stage.eventMode = 'static';
      state.app.stage.hitArea = state.app.screen;
      if (!state.stageBound) {
        state.stageBound = true;
        state.app.stage.on('pointerdown', function (e) {
          if (e.target === state.app.stage && state.selId >= 0) { clearSelection(); render(); }
        });
      }

      // 未开局：处于「开局设置」时只画桌面 + 提示，绝不发牌
      if (!state.g) {
        drawFelt(W, H);
        drawIdle(W, H, M);
        drawActionsDOM(W, H);
        renderChrome(); renderOverlay(); renderLog();
        window.__PIXI_TABLE__.layout = { W: W, H: H, boxes: state.boxes, overflow: 0, idle: true, phase: 'setup', actions: actionFlags(), winReady: false, tier: state.tier || null, uiK: +(state.k || 1).toFixed(2) };
        window.__PIXI_TABLE__.fx = { deals: state.fxStats.deals, flights: state.fxStats.flights, rings: 0, bursts: 0, live: 0, tweens: 0 };
        return;
      }

      // 推荐弃牌（供手牌渲染高亮）
      var my = state.g.players[HUMAN];
      state.recTile = -1;
      if (state.teachOn && state.g.phase === 'playing' && state.g.turn === HUMAN && !my.won && !state.g.claim) {
        try { state.recTile = CM.botDiscardTile(state.g, HUMAN, 'normal'); } catch (e2) { state.recTile = -1; }
      }
      state.teach = state.teachOn ? computeTeach() : null;

      if (state.pendingDeal) { state.pendingDeal = false; try { playDeal(W, H, M); } catch (e3) { state.hideHandsUntil = 0; } }
      processEvents(W, H, M); // 先登记「飞行中」的牌（flySkip），再绘制静态场景，避免同张牌画两次

      drawFelt(W, H);
      drawCenter(W, H, M);
      for (var s = 0; s < 4; s++) { var F = seatFrame(s, M); drawSeat(s, F, M); }
      for (var s2 = 1; s2 < 4; s2++) seatLabel(s2, W, H, M);   // 座 0 的信息并入底部教学条
      drawTeachStrip(W, H, M);
      drawBanner(W, H, M);

      drawActionsDOM(W, H);
      renderChrome();
      renderOverlay();
      renderLog();
      publishDiag(W, H, M);
    } catch (e) { fail('render: ' + (e && e.message)); }
  }

  function publishDiag(W, H, M) {
    var over = 0, i, b;
    for (i = 0; i < state.boxes.length; i++) {
      b = state.boxes[i];
      if (b.x < -1 || b.y < -1 || b.x + b.w > W + 1 || b.y + b.h > H + 1) over++;
    }
    window.__PIXI_TABLE__.layout = {
      W: W, H: H, boxes: state.boxes, overflow: over,
      handH: +M.handH.toFixed(1), riverH: +M.riverH.toFixed(1),
      tier: state.tier || null, uiK: +(state.k || 1).toFixed(2),
      // 出牌二次确认：已提起待确认的牌（-1 = 无）
      selTile: state.selId, selSlot: state.selSlot,
      // 座位朝向：应为 [0, -90, 180, 90]（牌顶朝向桌心）
      rots: SEATS.map(function (s) { return Math.round(seatFrame(s, M).rot * 180 / Math.PI); }),
      // 刚摸的牌是否排在「右手边」（沿 right 方向位于主体之后）
      sepAtEnd: SEATS.map(function (s) {
        var F = seatFrame(s, M), pl = handPlan(state.g.players[s]), hs = handSlots(F, pl);
        if (pl.sepId < 0 || pl.tiles.length === 0) return null;
        var a = hs.slots[pl.tiles.length - 1], b = hs.slots[hs.slots.length - 1];
        var da = (a.x - F.hx) * F.right.x + (a.y - F.hy) * F.right.y;
        var db = (b.x - F.hx) * F.right.x + (b.y - F.hy) * F.right.y;
        return db > da + 1;
      }),
      rows: SEATS.map(function (s) {
        var n = state.g.players[s].river.length;
        return n ? Math.ceil(n / Math.max(6, Math.ceil(n / 2))) : 0;
      }),
      rivers: SEATS.map(function (s) { return state.g.players[s].river.length; }),
      draws: state.g.wallPointer,
      phase: state.g.phase,
      won: SEATS.map(function (s) { return state.g.players[s].won; }),
      winCount: state.g.winCount,
      humanWon: state.g.players[HUMAN].won,
      diff: state.diff,
      dealer: state.g.dealer,
      // 第一张被摸走的牌属于哪个座位（应与所选庄家一致）
      firstDraw: (function () {
        for (var h = 0; h < state.g.history.length; h++) if (state.g.history[h].type === 'draw') return state.g.history[h].seat;
        return -1;
      })(),
      turn: state.g.turn,
      netBySeat: state.g.settlement ? state.g.settlement.seats.map(function (x) { return x.net; }) : null,
      teach: state.teach ? {
        sh: state.teach.sh,
        shEff: state.teach.shEff,
        shAfter: state.teach.shAfter,
        myTurn: state.teach.myTurn,
        mustMiss: state.teach.mustMiss,
        deadWait: !!state.teach.deadWait,
        waitingKinds: state.teach.waiting.length,
        waitLeft: state.teach.waitLeft,
        recTile: state.teach.rec,
        recImprove: state.teach.recInfo ? state.teach.recInfo.count : 0,
        diag: state.teach.diag,
      } : null,
      handTiles: SEATS.map(function (s) {
        var p = state.g.players[s], pl = handPlan(p);
        return { main: pl.tiles.length, sep: pl.sepId >= 0 ? 1 : 0, melds: p.melds.length, won: p.won };
      }),
      // 当前给玩家的动作按钮（胡/碰/杠/过）—— 与 UI 同一判据
      actions: actionFlags(),
      winReady: humanWinReady(),
      // 牌形不变量：正常应恒为 13 或 14（探针据此抓「没摸牌就出牌」的抽干问题）
      shape: shapeOf(state.g.players[HUMAN]),
      // 原始手牌张数 / 标准张数（不含副露）——终局形态断言用：
      // 未胡者在结算时必须恰好等于标准张数，否则就是「带着多摸的那张进入查叫」。
      rawHands: SEATS.map(function (s) {
        var q = state.g.players[s], n = 0;
        for (var i = 0; i < 27; i++) n += q.hand[i];
        return n;
      }),
      expectHands: SEATS.map(function (s) {
        var q = state.g.players[s], k = 0;
        for (var m = 0; m < q.melds.length; m++) if (q.melds[m].type === 'kong') k++;
        return 13 - 3 * q.melds.length - k;   // 杠多占一张，必须一并扣掉
      }),
      meldsOf: SEATS.map(function (s) { return state.g.players[s].melds.length; }),
      kongsOf: SEATS.map(function (s) {
        var q = state.g.players[s], k = 0;
        for (var m = 0; m < q.melds.length; m++) if (q.melds[m].type === 'kong') k++;
        return k;
      }),
      readyAtEnd: (state.g.readyAtEnd || []).slice(),
      // 是否自摸（点炮胡时那张和牌不进手牌，只记在 winInfo 里 → 手牌张数不自增）
      winSelf: SEATS.map(function (s) {
        var p = state.g.players[s];
        return !!(p.won && p.winInfo && p.winInfo.selfDraw);
      }),
      dbg: state.dbg.slice(-40),
      shapes: SEATS.map(function (s) { return shapeOf(state.g.players[s]); })
    };
    window.__PIXI_TABLE__.fx = {
      deals: state.fxStats.deals, flights: state.fxStats.flights,
      rings: state.fxStats.rings, bursts: state.fxStats.bursts,
      live: state.particles.length, tweens: state.tweens.length
    };
  }

  /* ================= DOM 层（按钮/弹层/日志） ================= */
  function renderChrome() {
    var G = state.g;
    document.getElementById('ttl').textContent = t().title;
    document.getElementById('helpBtn').textContent = t().help;
    document.getElementById('demoBtn').textContent = state.demo ? t().demoStop : t().demo;
    document.getElementById('newBtn').textContent = t().newGame;
    document.getElementById('langBtn').textContent = t().lang;
    document.getElementById('logcap').textContent = t().logcap;
    var lb = document.getElementById('logBtn');
    if (lb) lb.textContent = (document.getElementById('drawer').className.indexOf('open') >= 0 ? '▾ ' : '▸ ') + t().logcap;
    document.getElementById('hstat').innerHTML = G ? (
      '<span>' + t().wall + ' <b>' + G.wall.length + '</b></span>' +
      '<span>' + t().turn + ' <b>' + (G.phase === 'playing' ? seatName(G.turn) : '—') + '</b></span>' +
      '<span>' + t().shanten + ' <b>' + CM.handShanten(G.players[HUMAN]) + '</b>' + (t().shantenUnit || '') + '</span>' +
      (G.settlement ? '<span>' + t().pts + ' <b>' + (G.settlement.seats[HUMAN].net > 0 ? '+' : '') + G.settlement.seats[HUMAN].net + '</b></span>' : '')
    ) : '';
    // 难度选择器
    var dl = document.getElementById('diffLbl');
    if (dl) {
      dl.textContent = t().diffLbl;
      var txt = { easy: t().dEasy, normal: t().dNormal, hard: t().dHard };
      document.querySelectorAll('#diffs .dbtn').forEach(function (b) {
        b.textContent = txt[b.dataset.d];
        b.className = 'dbtn' + (b.dataset.d === state.diff ? ' on' : '');
      });
    }
    var d = document.getElementById('diag');
    if (d.dataset.status === 'ok') d.textContent = t().diagOk(state.rendererName, state.texCount, Math.round(state.app ? state.app.ticker.FPS : 0));
  }
  /** 牌形不变量：手牌张数 + 3×副露数 + 杠数 —— 正常恒为 13 或 14 */
  function shapeOf(p) {
    var n = 0, k = 0;
    for (var i = 0; i < 27; i++) n += p.hand[i];
    for (var m = 0; m < p.melds.length; m++) if (p.melds[m].type === 'kong') k++;
    return n + 3 * p.melds.length + k;
  }
  function drawActionsDOM(W, H) {
    var G = state.g;
    var box = document.getElementById('actions');
    if (!G) { if (box) box.innerHTML = ''; return; }   // 未开局（开局设置阶段）无动作按钮
    var my = G.players[HUMAN];
    if (!box) {
      box = document.createElement('div');
      box.id = 'actions';
      box.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);z-index:6';
      document.getElementById('stage').appendChild(box);
    }
    var html = '', F = actionFlags();
    // 胡（自摸 / 点炮）：只给按钮，绝不代替玩家决定
    if (F.win) html += '<button class="btn hu" id="aWin">' + t().win + '</button>';
    if (F.kong) html += '<button class="btn pri" id="aKong">' + t().kong + '</button>';
    if (F.pong) html += '<button class="btn pri" id="aPong">' + t().pong + '</button>';
    if (F.ck) html += '<button class="btn" id="aCK">' + t().ck + '</button>';
    if (F.ak) html += '<button class="btn" id="aAK">' + t().ak + '</button>';
    if (F.pass) html += '<button class="btn" id="aPass">' + t().pass + '</button>';
    box.innerHTML = html;
    var b;
    if ((b = document.getElementById('aWin'))) b.onclick = humanWin;
    if ((b = document.getElementById('aKong'))) b.onclick = humanKong;
    if ((b = document.getElementById('aPong'))) b.onclick = humanPong;
    if ((b = document.getElementById('aPass'))) b.onclick = humanPass;
    if ((b = document.getElementById('aCK'))) b.onclick = humanCK;
    if ((b = document.getElementById('aAK'))) b.onclick = humanAK;
    box.style.top = Math.round(H / 2 + 84 * (state.k || 1)) + 'px';
  }
  function declareModal() {
    var G = state.g, my = G.players[HUMAN];
    var cnt = [0, 1, 2].map(function (s) { return CM.suitCount(my.hand, s); });
    var rec = CM.botMissingSuit(G, HUMAN);
    var h = '<div class="modal"><h2>' + t().declareT + '</h2><p class="lead">' + t().declareSub + '</p><div class="miss-pick">';
    for (var s = 0; s < 3; s++) {
      h += '<div class="mp' + (s === rec ? ' recommend' : '') + '" data-suit="' + s + '">' +
        '<div class="big">' + SUITS[s].zh + '</div><div class="cnt">' + cnt[s] + '</div>' +
        (s === rec ? '<div class="recs">★ ' + t().recommend + '</div>' : '') + '</div>';
    }
    return h + '</div></div>';
  }
  function resultModal() {
    var G = state.g, S = G.settlement;
    var order = [0, 1, 2, 3].slice().sort(function (a, b) {
      return (S ? S.seats[b].net : 0) - (S ? S.seats[a].net : 0);
    });
    var rows = '';
    for (var i = 0; i < order.length; i++) {
      var s = order[i], p = G.players[s];
      var status = p.won ? t().stWon + ' ' + p.winInfo.fans.total + t().fanUnit : (G.readyAtEnd[s] ? t().stReady : t().stNot);
      var net = S ? S.seats[s].net : 0;
      var parts = [];
      if (S) {
        var x = S.seats[s];
        if (x.fanPoints) parts.push(t().detailFan + ' +' + x.fanPoints);
        if (x.kongIn) parts.push(t().detailKong + ' +' + x.kongIn);
        if (x.kongOut) parts.push(t().detailKong + ' −' + x.kongOut);
        if (x.readyIn) parts.push(t().detailReady + ' +' + x.readyIn);
        if (x.readyOut) parts.push(t().detailReady + ' −' + x.readyOut);
        if (x.flowerPigOut) parts.push(t().detailPig + ' −' + x.flowerPigOut);
        if (x.refundIn) parts.push(t().detailRefund + ' +' + x.refundIn);
        if (x.refundOut) parts.push(t().detailRefund + ' −' + x.refundOut);
      }
      // 中国习惯：正分红、负分绿
      var col = net > 0 ? '#c0392b' : net < 0 ? '#1c7d4d' : '#5b6470';
      rows += '<tr class="' + (s === HUMAN ? 'me' : '') + '"><td>' + seatName(s) + '</td><td>' + status + '</td>' +
        '<td>' + (p.winInfo ? MJT(p.winInfo.tile) : '—') + '</td>' +
        '<td style="font-weight:800;color:' + col + '">' + (net > 0 ? '+' : '') + net + '</td>' +
        '<td style="color:var(--sub);font-size:var(--fs-meta)">' + (parts.join('　') || '—') + '</td></tr>';
    }
    var myNet = S ? S.seats[HUMAN].net : 0;
    var headline = t().settled + ' — ' + (G.winCount >= 3 ? t().r3 : t().rw) +
      '　|　' + t().you + ' ' + (myNet > 0 ? '+' : '') + myNet + ' ' + t().pts;
    return '<div class="modal"><h2>' + headline + '</h2>' +
      '<table class="res-table"><thead><tr><th>' + t().colSeat + '</th><th>' + t().status + '</th>' +
      '<th>' + t().winTile + '</th><th>' + t().colNet + '</th><th>' + t().colDetail + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div style="margin-top:var(--sp-sm);font-size:var(--fs-meta);color:var(--sub)">' + t().scoreNote + '</div>' +
      '<div style="margin-top:var(--sp-lg);display:flex;gap:var(--sp-md)"><button class="btn pri" id="againBtn">' + t().again + '</button><button class="btn" id="settingsBtn">' + t().settings + '</button><button class="btn" id="closeRes">' + t().close + '</button></div></div>';
  }
  /** 开局设置：难度 / 起手位（庄）/ 教学提示 / 语言 */
  function setupModal() {
    function pills(k, opts, cur) {
      var s = '<div class="pills">';
      for (var i = 0; i < opts.length; i++) {
        s += '<button class="pill' + (String(cur) === String(opts[i].v) ? ' on' : '') +
          '" data-k="' + k + '" data-v="' + opts[i].v + '">' + opts[i].t + '</button>';
      }
      return s + '</div>';
    }
    var h = '<div class="modal"><h2>' + t().setupT + '</h2><p class="lead">' + t().setupSub + '</p>';
    h += '<div class="sgroup"><div class="slbl">' + t().diffLbl + '</div>' +
      pills('diff', [{ v: 'easy', t: t().dEasy }, { v: 'normal', t: t().dNormal }, { v: 'hard', t: t().dHard }], state.diff) + '</div>';
    h += '<div class="sgroup"><div class="slbl">' + t().seatPick + '</div>' +
      pills('dealer', [0, 1, 2, 3].map(function (s) { return { v: s, t: seatName(s) }; }), state.dealerSeat) +
      '<div class="shint">' + t().seatHint + '</div></div>';
    h += '<div class="sgroup"><div class="slbl">' + t().teachLbl + '</div>' +
      pills('teach', [{ v: '1', t: t().optOn }, { v: '0', t: t().optOff }], state.teachOn ? '1' : '0') + '</div>';
    h += '<div class="sgroup"><div class="slbl">' + t().langLbl + '</div>' +
      pills('lang', [{ v: 'zh', t: '中文' }, { v: 'en', t: 'English' }], state.lang) + '</div>';
    h += '<div style="margin-top:var(--sp-xl);display:flex;gap:var(--sp-md)">' +
      '<button class="btn pri" id="startGameBtn">' + t().startGame + '</button>' +
      '<button class="btn" id="helpBtn2">' + t().help + '</button></div></div>';
    return h;
  }
  /** 未开局时的桌面提示（开局设置期间） */
  function drawIdle(W, H, M) {
    var cx = W / 2, cy = H / 2;
    var ttl = label(t().idleT, 22, '#eaf5ee', '800');
    ttl.anchor.set(0.5); ttl.position.set(cx, cy - 14);
    state.world.addChild(ttl);
    var sub = label(t().idleSub, 13, '#9dbfab', '600');
    sub.anchor.set(0.5); sub.position.set(cx, cy + 20);
    state.world.addChild(sub);
  }
  function helpModal() {
    return '<div class="modal"><h2>' + t().help + '</h2><div class="legendbox">' + t().helpBody + '</div>' +
      '<div style="margin-top:var(--sp-lg)"><button class="btn" id="helpClose">' + t().close + '</button></div></div>';
  }
  function renderOverlay() {
    var G = state.g, ov = document.getElementById('overlay'), content = null;
    if (state.overlay === 'setup') content = setupModal();
    else if (!G) { ov.className = 'overlay'; ov.innerHTML = ''; return; }
    else if (state.overlay === 'help') content = helpModal();
    else if (state.overlay === 'result') content = resultModal();
    // 结算弹层：phase=finished 时自动弹出；玩家点过「关闭」后（overlay='none'）不再弹回，
    // 否则「关闭」按钮点了没反应（旧版就是这个 bug）。
    else if (G.phase === 'finished' && state.overlay !== 'none') content = resultModal();
    else if (G.phase === 'declareMissing' && G.players[HUMAN].missing === -1) content = declareModal();
    if (!content) { ov.className = 'overlay'; ov.innerHTML = ''; return; }
    ov.className = 'overlay show'; ov.innerHTML = content;
    ov.querySelectorAll('.mp').forEach(function (el) { el.onclick = function () { humanDeclare(+el.dataset.suit); }; });
    ov.querySelectorAll('.pill').forEach(function (el) {
      el.onclick = function () {
        var k = el.dataset.k, v = el.dataset.v;
        if (k === 'diff') state.diff = v;
        else if (k === 'dealer') state.dealerSeat = +v;
        else if (k === 'teach') state.teachOn = v === '1';
        else if (k === 'lang') state.lang = v;
        render();
      };
    });
    var b;
    if ((b = document.getElementById('startGameBtn'))) b.onclick = startGame;
    if ((b = document.getElementById('againBtn'))) b.onclick = startGame;
    if ((b = document.getElementById('settingsBtn'))) b.onclick = function () { openSetup(); render(); };
    if ((b = document.getElementById('helpBtn2'))) b.onclick = function () { state.overlay = 'help'; render(); };
    if ((b = document.getElementById('closeRes'))) b.onclick = function () { state.overlay = 'none'; render(); };
    if ((b = document.getElementById('helpClose'))) b.onclick = function () { state.overlay = state.g ? null : 'setup'; render(); };
  }
  function renderLog() {
    var G = state.g; if (!G) return;
    var lines = [];
    for (var i = state.loggedUpTo; i < G.history.length; i++) {
      var e = G.history[i], s = e.seat !== undefined ? seatName(e.seat) : '';
      var by = e.by !== undefined && e.by >= 0 ? seatName(e.by) : '';
      var tl = e.tile !== undefined ? MJT(e.tile) : '', line = null;
      if (e.type === 'declareMissing') line = t().evDeclare(s, SUITS[G.players[e.seat].missing].zh);
      else if (e.type === 'discard') line = t().evDiscard(s, tl);
      else if (e.type === 'pong') line = t().evPong(s, tl);
      else if (e.type === 'kong') line = t().evKong(s, tl);
      else if (e.type === 'win') { var rec = G.players[e.seat].winInfo; line = e.by >= 0 ? t().evWinRon(s, tl, by, rec ? rec.fans.total : '?') : t().evWinSelf(s, tl, rec ? rec.fans.total : '?'); }
      else if (e.type === 'roundEnd') line = t().evEnd;
      if (line) lines.push(line);
    }
    state.loggedUpTo = G.history.length;
    state.logLines = state.logLines.concat(lines);
    if (state.logLines.length > 150) state.logLines = state.logLines.slice(-150);
    var el = document.getElementById('log');
    el.innerHTML = state.logLines.map(function (l, i) { return '<div><span class="n">' + (i + 1) + '</span>' + l + '</div>'; }).join('');
    el.scrollTop = el.scrollHeight;
  }

  function fail(msg) {
    var d = document.getElementById('diag');
    d.dataset.status = 'fail';
    d.textContent = t().diagFail + '：' + msg;
    window.__PIXI_TABLE__ = Object.assign(window.__PIXI_TABLE__ || {}, { ready: false, error: String(msg) });
    bootError(msg);   // 加载层留在屏幕上写明原因，别让用户对着一个转不完的进度条
  }

  /* ================= 启动 ================= */
  async function boot() {
    window.__PIXI_TABLE__ = { ready: false };
    bootReset();                                    // 首屏加载层：先把进度摆出来
    try {
      if (!PIXI) throw new Error('PIXI bundle missing');
      await buildTextures(function (d, n) { bootPaint(0.80 * d / n, t().bootTex(d, n)); });
      bootPaint(0.82, t().bootGpu);
      await initPixi();
      state.rendererName = (state.app.renderer && (state.app.renderer.name || (state.app.renderer.constructor && state.app.renderer.constructor.name))) || 'renderer';
      state.ready = true;
      var d = document.getElementById('diag');
      d.dataset.status = 'ok';
      d.textContent = t().diagOk(state.rendererName, state.texCount, 0);
      window.__PIXI_TABLE__ = Object.assign(window.__PIXI_TABLE__ || {}, { ready: true, renderer: state.rendererName, textures: state.texCount });
      bootPaint(0.94, t().bootScene);
      applyTierOnStageChange();          // 按舞台尺寸定档（牌与字体同步缩放）
      openSetup();
      render();
      bootFinish();                      // 资产齐了、首帧也画完了，才淡出加载层进入开局界面
      // ⚠ 档位必须跟着**舞台实际尺寸**走，不能只靠 window.resize。
      //   踩过的坑：窗口在页面加载完成之后才被改大小（探针的 device-metrics override、
      //   浏览器恢复会话、或用户把窗口拉大），此时若 resize 事件早于 ready 或被吞掉，
      //   档位就一直停在首帧的尺寸上 —— 实测舞台已经是 1440×813 仍停留在 xs/k=0.72，
      //   牌和字全比设计值小 28%，而页面不报任何错。
      //   另一个反馈回路：--k 本身会改变顶栏高度 → 改变舞台高度 → 又该重新定档。
      //   ResizeObserver 直接盯舞台，把这个回路闭掉；档位没变就不重绘，避免抖动。
      if (typeof ResizeObserver === 'function') {
        var stageEl = document.getElementById('stage');
        if (stageEl) {
          new ResizeObserver(function () {
            if (state.ready && applyTierOnStageChange()) render();
          }).observe(stageEl);
        }
      }
      window.addEventListener('resize', function () {
        if (!state.ready) return;
        applyTierOnStageChange();
        render();
      });
    } catch (e) { fail((e && e.message) || e); }
  }

  document.getElementById('logBtn').onclick = function () {
    var d = document.getElementById('drawer');
    d.className = d.className.indexOf('open') >= 0 ? 'drawer' : 'drawer open';
    renderChrome();
    if (d.className.indexOf('open') >= 0) {
      var el = document.getElementById('log');
      if (el) el.scrollTop = el.scrollHeight;
    }
  };
  document.getElementById('newBtn').onclick = function () { if (state.ready) { openSetup(); render(); } };
  document.getElementById('demoBtn').onclick = function () {
    if (!state.ready) return;
    if (state.demo) {
      state.demo = false;
      if (state.timer) { clearInterval(state.timer); state.timer = null; }
      render(); return;
    }
    // 还在「开局设置」（无牌局）时点演示：先按当前设置开局，否则按钮点了等于没反应、还顺手关掉了设置弹层
    if (!state.g) startGame();
    state.overlay = null; state.demo = true;
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () {
      if (!state.g || state.g.phase === 'finished') {
        clearInterval(state.timer); state.timer = null; state.demo = false; render(); return;
      }
      pump(1); render();
    }, 320);
    render();
  };
  document.getElementById('helpBtn').onclick = function () { state.overlay = state.overlay === 'help' ? null : 'help'; render(); };
  document.getElementById('langBtn').onclick = function () { state.lang = state.lang === 'zh' ? 'en' : 'zh'; render(); };
  document.querySelectorAll('#diffs .dbtn').forEach(function (b) {
    b.onclick = function () { state.diff = b.dataset.d; render(); };
  });

  /* 只读测试钩子：供无头浏览器验证「胡牌粒子 / 高光」确实会被触发（不改变任何游戏规则） */
  window.__CM_TESTHOOK__ = {
    runToEnd: function () {
      if (!state.g) return false;
      var saved = state.demo;
      state.demo = true;               // 用自动代打把本局推到结束
      try { pump(); } finally { state.demo = saved; }
      render();
      return true;
    },
    /** 确定性推进 n 个循环步（人类自动代打），用于「推进到某个阶段再断言」 */
    advance: function (n) {
      if (!state.g) return false;
      var saved = state.demo;
      state.demo = true;
      try { pump(n || 1); } finally { state.demo = saved; }
      render();
      return true;
    },
    /** 推进到「人类可以胡」的那一刻停下（不替玩家胡），用于验证「胡」按钮 */
    stepToHumanWin: function () {
      if (!state.g) return false;
      var savedDemo = state.demo;
      state.haltHumanWin = true;
      state.haltHit = false;
      state.demo = true;
      try { pump(); } finally { state.haltHumanWin = false; state.haltHit = false; state.demo = savedDemo; }
      render();
      return humanWinReady();
    },
    /** 诊断用：开启代打逐步记录（清空并开始记录） */
    dbgOn: function () { state.dbg = []; return true; },
    /** 推进到「轮到人类打牌」的时刻停下（碰到鸣牌决策点就直接过），供探针做真实点击 */
    stepToHumanTurn: function () {
      if (!state.g) return false;
      for (var i = 0; i < 300; i++) {
        var G = state.g, my = G.players[HUMAN];
        if (G.phase !== 'playing') break;
        // ⚠️ 成功分支也要 render()：pump 里的摸牌只打了 requestRender 标记，layout 仍是上一帧的
        //   （手牌数会少 1），探针据此断言会读到旧值。
        if (!G.claim && !my.won && G.turn === HUMAN && !G.pendingDraw) { render(); return true; }
        if (G.claim) { resolveHumanPass(); continue; }   // 停在可碰/可杠/可胡的点 → 直接过，继续推
        pump();                                          // 非演示态：pump 自己会在人类行动点停下
      }
      render();
      return false;
    },
    /** 探针用：第一张「此刻可打出」手牌的画布坐标（供 CDP 真实点击） */
    handPoint: function () {
      var G = state.g;
      if (!G || G.phase !== 'playing') return null;
      var p = G.players[HUMAN];
      if (G.turn !== HUMAN || G.claim || p.won || performance.now() < state.hideHandsUntil) return null;
      var W = state.app.screen.width, H = state.app.screen.height;
      var M = metrics(W, H), F = seatFrame(HUMAN, M);
      var teach = state.teach;
      var ghosts = (teach && teach.kind === 'live' && !p.won && teach.waiting) ? teach.waiting : [];
      var gStep = F.hW * 0.66 + 4, gw = ghosts.length ? ghosts.length * gStep + F.hW * 0.5 : 0;
      var hs = handSlots(F, handPlan(p), -gw / 2);
      for (var i = 0; i < hs.slots.length; i++) {
        var sl = hs.slots[i];
        var legal = (!CM.holdsMissingSuit(p) || CM.suitOf(sl.id) === p.missing);
        if (legal) return { x: sl.x, y: sl.y, tile: sl.id, slot: i, W: W, H: H };
      }
      return null;
    },
    fxWin: function (seat) { playWin(seat, metrics(state.app.screen.width, state.app.screen.height)); return true; },
    fxRing: function (seat) {
      var M = metrics(state.app.screen.width, state.app.screen.height);
      playRing(seat, M, GOLD); playRing(seat, M, 0x9fdcff); return true;
    }
  };

  boot();
})();
