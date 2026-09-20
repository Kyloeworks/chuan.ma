/* 识牌教学页（learn-tiles.html）逻辑
 * ---------------------------------------------------------------------------
 * 这一页的定位是「把牌面资产接进课程」：
 *   - 讲哪张牌，页面上就画哪张牌 —— 用的就是牌桌、算牌器同一份 tiles-ui.js，
 *     不存在「插图画得跟真牌不一样」的漂移（这是纯图片方案做不到的）。
 *   - 最后两个练习直接用真实牌面出题，做完就能上桌。
 *
 * 依赖加载顺序（build.mjs 保证）：tokens.js → glyphs.js → tiles-ui.js → 本文件。
 * MJTiles 缺失时整体降级为「只剩文字」，不抛错、不白屏。
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  var MJ = window.MJTiles;
  var SUIT = ['万', '条', '筒'];
  var SUIT_EN = ['characters', 'bamboo', 'dots'];
  var SUIT_PY = ['wàn', 'tiáo', 'tǒng'];
  var NUM_PY = ['', 'yī', 'èr', 'sān', 'sì', 'wǔ', 'liù', 'qī', 'bā', 'jiǔ'];

  function nameOf(id) { return ((id % 9) + 1) + ' ' + SUIT[Math.floor(id / 9)]; }
  function spokenOf(id) { return NUM_PY[(id % 9) + 1] + ' ' + SUIT_PY[Math.floor(id / 9)]; }

  /* ---------------- ① 牌面占位符 → 真实牌面 ----------------
   * HTML 里写 <span class="face lg" data-face="9"></span>，这里把 SVG 填进去。
   * 尺寸写在占位符自己的 class 上（不是 data-size）：这样「这一页用了几档尺寸」
   * 在 HTML 里一眼看得见，样式审计也能据 class 判断 .face.lg 到底有没有人在用。
   * data-face 允许逗号分隔多张（各自独立成牌），目前页面没有用到。 */
  function renderFaces(scope) {
    if (!MJ) return 0;
    var list = (scope || document).querySelectorAll('[data-face]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var toks = el.getAttribute('data-face').split(',')
        .map(function (t) { return t.trim(); })
        .filter(function (t) { return !!t; });
      var html = '', j;
      for (j = 0; j < toks.length; j++) {
        var svg = toks[j] === 'back' ? MJ.back() : MJ.face(parseInt(toks[j], 10));
        html += toks.length > 1 ? '<span class="face">' + svg + '</span>' : svg;
      }
      el.innerHTML = html;
    }
    return list.length;
  }

  /* ---------------- ② 一副牌总览：三行九列，每行一个花色 ---------------- */
  function buildDeck() {
    var host = document.getElementById('deck');
    if (!host || !MJ) return;
    var out = '', s, r;
    for (s = 0; s < 3; s++) {
      out += '<div class="suitrow">' +
        '<div class="suitcap"><b class="zh">' + SUIT[s] + '</b> ' + SUIT_EN[s] +
        ' <span class="zh">' + SUIT_PY[s] + '</span></div><div class="deck">';
      for (r = 0; r < 9; r++) {
        var id = s * 9 + r;
        out += '<div class="cell"><span class="face">' + MJ.face(id) + '</span>' +
          '<span class="cn">' + ((id % 9) + 1) + '<i>' + SUIT[s] + '</i></span></div>';
      }
      out += '</div></div>';
    }
    host.innerHTML = out;
  }

  /* ---------------- ③ 练习一：看牌认名 ----------------
   * 干扰项不是随机的：优先放**真实牌桌上最容易认错的那几张**（2条/3条、6筒/8筒、
   * 2万/3万），认错一次的收获比认对十次大。 */
  var CONFUSE = { 10: [11], 11: [10], 23: [25], 25: [23], 1: [2], 2: [1] };

  function distractors(id, n) {
    var pool = [], seen = {}, i;
    function add(x) { if (x >= 0 && x <= 26 && x !== id && !seen[x]) { seen[x] = 1; pool.push(x); } }
    var conf = CONFUSE[id] || [];
    for (i = 0; i < conf.length; i++) add(conf[i]);
    add((id % 9) + 9 * ((Math.floor(id / 9) + 1) % 3));   // 同数字、另一花色
    add((id % 9) + 9 * ((Math.floor(id / 9) + 2) % 3));   // 再另一花色
    while (pool.length < n) add(Math.floor(Math.random() * 27));
    // 洗牌，取前 n
    for (i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool.slice(0, n);
  }

  function DrillName() {
    var host = document.getElementById('drillName');
    if (!host || !MJ) return;
    var right = 0, total = 0, streak = 0, best = 0, answer = 0, locked = false;

    host.innerHTML =
      '<div class="q" id="dnQ"></div>' +
      '<div class="opts" id="dnOpts"></div>' +
      '<p class="fb" id="dnFb"></p>' +
      '<div class="score"><span id="dnScore"></span><button class="btn" id="dnNext" type="button">Next tile →</button></div>';

    var q = host.querySelector('#dnQ'), opts = host.querySelector('#dnOpts'),
      fb = host.querySelector('#dnFb'), score = host.querySelector('#dnScore'),
      next = host.querySelector('#dnNext');

    function paint() {
      var hold = Math.random() < 0.35;                     // 三成概率出牌背，逼你回忆而不是扫答案
      q.innerHTML = '<span class="face xl">' + (hold ? MJ.back() : MJ.face(answer)) + '</span>';
      q.setAttribute('data-hold', hold ? '1' : '0');
      var picks = distractors(answer, 3), all = picks.concat([answer]);
      // 选项按牌序排列，避免「正确答案总在同一个位置」
      all.sort(function (a, b) { return a - b; });
      opts.innerHTML = all.map(function (id) {
        return '<button class="btn" type="button" data-id="' + id + '">' +
          nameOf(id) + '<span class="py">' + spokenOf(id) + '</span></button>';
      }).join('');
    }

    function ask() {
      locked = false;
      // 出题避免与上一题重复
      var prev = answer;
      do { answer = Math.floor(Math.random() * 27); } while (answer === prev);
      paint();
      fb.textContent = 'Which tile is this? Name it before you click.';
      fb.className = 'fb';
    }

    opts.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-id]') : null;
      if (!b || locked) return;
      locked = true;
      var pick = parseInt(b.getAttribute('data-id'), 10);
      total++;
      var status = '';
      if (pick === answer) {
        right++; streak++; if (streak > best) best = streak;
        b.className = 'btn ok';
        fb.className = 'fb ok';
        status = 'Correct — ' + nameOf(answer) + ' <span class="zh">' + spokenOf(answer) + '</span>';
      } else {
        streak = 0;
        b.className = 'btn no';
        var c = opts.querySelector('button[data-id="' + answer + '"]');
        if (c) c.className = 'btn ok';
        fb.className = 'fb no';
        status = 'Not quite. That was ' + nameOf(answer) + ' <span class="zh">' + spokenOf(answer) +
          '</span>, not ' + nameOf(pick) + '.';
      }
      // 认错的教学点直接给出来：这几张是新手互认错的常客
      if (answer === 9) status += ' Remember: one bamboo is the <b>bird</b> <span class="zh">幺鸡</span>.';
      if (answer === 16) status += ' Eight bamboo: four over four, M over W — the hourglass.';
      if (answer === 23) status += ' Six dots is two columns of three — count one column, not the tile.';
      if (answer === 25) status += ' Eight dots is two columns of four — one column taller than six dots.';
      fb.innerHTML = status;
      // 出题时若盖着牌背，答完亮出正面
      if (q.getAttribute('data-hold') === '1') {
        q.innerHTML = '<span class="face xl">' + MJ.face(answer) + '</span>';
      }
      score.textContent = right + ' / ' + total + ' correct · streak ' + streak + ' · best ' + best;
    });

    next.addEventListener('click', ask);
    score.textContent = '0 / 0 correct · streak 0 · best 0';
    ask();
  }

  /* ---------------- ④ 练习二：定缺（13 张里哪一门最薄） ----------------
   * 这是 lesson 的正题：实战第一件事就是「分门 → 数张 → 丢最薄的一门」。
   * 用真实牌墙随机发 13 张，判定最薄的那一门；并列时都算对。 */
  function DrillVoid() {
    var host = document.getElementById('drillVoid');
    if (!host || !MJ) return;
    var right = 0, total = 0, hand = [], thin = [];

    host.innerHTML =
      '<div class="hand" id="dvHand"></div>' +
      '<div class="opts three" id="dvOpts"></div>' +
      '<p class="fb" id="dvFb"></p>' +
      '<div class="score"><span id="dvScore"></span><button class="btn" id="dvNext" type="button">Deal again →</button></div>';

    var handEl = host.querySelector('#dvHand'), opts = host.querySelector('#dvOpts'),
      fb = host.querySelector('#dvFb'), score = host.querySelector('#dvScore'),
      next = host.querySelector('#dvNext');

    function deal() {
      // 108 张牌：27 种 × 4 张，每种最多发 4 张
      var left = [], i, k;
      for (i = 0; i < 27; i++) for (k = 0; k < 4; k++) left.push(i);
      hand = [];
      for (i = 0; i < 13; i++) hand.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]);
      hand.sort(function (a, b) { return a - b; });

      var cnt = [0, 0, 0];
      for (i = 0; i < hand.length; i++) cnt[Math.floor(hand[i] / 9)]++;
      var min = Math.min(cnt[0], cnt[1], cnt[2]);
      thin = [];
      for (i = 0; i < 3; i++) if (cnt[i] === min) thin.push(i);

      handEl.innerHTML = hand.map(function (id) {
        return '<span class="face">' + MJ.face(id) + '</span>';
      }).join('');
      opts.innerHTML = [0, 1, 2].map(function (s) {
        return '<button class="btn" type="button" data-suit="' + s + '">' +
          '<b class="zh">' + SUIT[s] + '</b> ' + SUIT_EN[s] + '</button>';
      }).join('');
      fb.className = 'fb';
      fb.textContent = 'Count the three suits, then choose the one you would drop.';
    }

    opts.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button[data-suit]') : null;
      if (!b || b.disabled) return;
      var pick = parseInt(b.getAttribute('data-suit'), 10);
      var cnt = [0, 0, 0], i;
      for (i = 0; i < hand.length; i++) cnt[Math.floor(hand[i] / 9)]++;
      total++;
      var ok = thin.indexOf(pick) >= 0;
      if (ok) right++;
      var all = opts.querySelectorAll('button');
      for (i = 0; i < all.length; i++) {
        var s = parseInt(all[i].getAttribute('data-suit'), 10);
        all[i].disabled = true;
        if (thin.indexOf(s) >= 0) all[i].className = 'btn ok';
        else if (s === pick) all[i].className = 'btn no';
      }
      fb.className = 'fb ' + (ok ? 'ok' : 'no');
      fb.innerHTML = (ok ? 'Right — ' : 'No — ') +
        'the hand is ' + cnt[0] + ' 万 · ' + cnt[1] + ' 条 · ' + cnt[2] + ' 筒, so you throw ' +
        '<b class="zh">' + SUIT[thin[0]] + '</b> (' + thin.map(function (s) { return SUIT[s]; }).join(' or ') + ').';
      score.textContent = right + ' / ' + total + ' correct';
    });

    next.addEventListener('click', deal);
    score.textContent = '0 / 0 correct';
    deal();
  }

  /* ---------------- 启动 ----------------
   * 直接跑，不等 DOMContentLoaded：脚本链内联在 </body> 之前，运行时整个 body
   * 已经解析完了。等事件反而会引入不确定性（构建产物与 jsdom 冒烟的时序不一致）。 */
  renderFaces(document);
  buildDeck();
  DrillName();
  DrillVoid();
})();
