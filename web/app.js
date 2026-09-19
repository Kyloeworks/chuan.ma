/* 川麻向听计算器 · UI 逻辑（普通脚本，使用全局 ChuanMa 内核） */
(function () {
  var CM = window.ChuanMa;
  var shanten = CM.shanten, winningTiles = CM.winningTiles, improvingTiles = CM.improvingTiles,
      analyzeDiscards = CM.analyzeDiscards, canWin = CM.canWin,
      tileLabel = CM.tileLabel, tileLabelEn = CM.tileLabelEn,
      rankOf = CM.rankOf, suitOf = CM.suitOf, suitCount = CM.suitCount, totalOf = CM.totalOf,
      TILE_KINDS = CM.TILE_KINDS, COPIES = CM.COPIES;

  var SUITS = [
    { zh: '万', en: 'wan', hex: '#c0392b' },
    { zh: '条', en: 'tiao', hex: '#1e8e5a' },
    { zh: '筒', en: 'tong', hex: '#2b6cb0' }
  ];

  var state = { counts: new Array(27).fill(0), melds: 0, missing: -1, lang: 'zh' };

  var T = {
    zh: {
      title: '川麻算牌器',
      sub: '输入手牌 → 实时算出离下叫还差几张、叫牌、该打哪张。纯前端，无账号，不上传。',
      hHand: '手牌',
      melds: '副露',
      meldsUnit: '副',
      missing: '定缺',
      none: '无',
      clear: '清空',
      hint: '左键 +1，右键 / Shift+左键 −1，单张最多 4 张。',
      examples: '试试示例：',
      ex1: '下叫例',
      ex2: '14张待打',
      ex3: '散牌例',
      needMore: function (n, exp) { return '还需 ' + n + ' 张（该手牌应为 ' + exp + ' 张）'; },
      over: function (exp) { return '手牌已满（' + exp + ' 张），点右键减少或清空。'; },
      shantenLbl: '离下叫',
      win: '已和牌！',
      winExpl: '这副牌已经能和了。',
      tenpaiExpl: '已下叫 —— 摸到下面任意一张即可和牌。',
      farExpl: function (k) { return '离下叫还差 ' + k + ' 张。下面是能往前推进的牌。'; },
      tenpaiT: '叫牌（能和的牌）',
      improveT: '进张（能往前推进的牌）',
      remain: '剩余',
      totalT: '合计',
      sheet: '张',
      kindsT: '种',
      discardT: '该打哪张？（按推荐排序）',
      colDiscard: '弃牌',
      colShanten: '离下叫',
      colUkeire: '进张',
      colNote: '说明',
      noteTenpai: '→ 下叫',
      noteBest: '推荐',
      bestIs: function (name) { return '推荐打：' + name; },
      missingHold: function (s) { return '你还持有「' + s + '」门牌。川麻必须先打完缺门牌才能和牌。'; },
      missingFiltered: '（已按定缺过滤：只能打缺门牌）',
      infoMissing: function (s) { return '已设定缺门「' + s + '」：和牌前必须先打光这一门。'; },
      footer: '规则内核：自研川麻（血战到底）引擎 · 向听数已通过 5 万手独立对照验证'
    },
    en: {
      title: 'Chuanma Hand Calculator',
      sub: 'Enter your hand → live distance to ready, winning tiles, and what to discard. Pure front-end, no account, nothing uploaded.',
      hHand: 'Hand',
      melds: 'Melds',
      meldsUnit: '',
      missing: 'Missing suit',
      none: 'None',
      clear: 'Clear',
      hint: 'Left-click +1, right-click / Shift+click −1, max 4 each.',
      examples: 'Try:',
      ex1: 'Ready',
      ex2: '14-tile discard',
      ex3: 'Scattered',
      needMore: function (n, exp) { return n + ' more tile(s) needed (hand should be ' + exp + ').'; },
      over: function (exp) { return 'Hand full (' + exp + ' tiles) — right-click to remove or Clear.'; },
      shantenLbl: 'To ready',
      win: 'Winning hand!',
      winExpl: 'This hand already wins.',
      tenpaiExpl: 'Ready — draw any tile below to win.',
      farExpl: function (k) { return k + ' tile(s) away from ready. These tiles advance your hand.'; },
      tenpaiT: 'Winning tiles',
      improveT: 'Improving tiles (advance shanten)',
      remain: 'left',
      totalT: 'total',
      sheet: 'tiles',
      kindsT: 'kinds',
      discardT: 'What to discard? (ranked)',
      colDiscard: 'Discard',
      colShanten: 'To ready',
      colUkeire: 'Ukeire',
      colNote: 'Note',
      noteTenpai: '→ ready',
      noteBest: 'best',
      bestIs: function (name) { return 'Best discard: ' + name; },
      missingHold: function (s) { return 'You still hold the "' + s + '" suit. In Sichuan mahjong you must clear your missing suit before winning.'; },
      missingFiltered: '(filtered by missing suit: only missing-suit discards)',
      infoMissing: function (s) { return 'Missing suit set to "' + s + '": you must discard this whole suit before winning.'; },
      footer: 'Kernel: self-built Sichuan Blood-Battle engine · shanten cross-checked on 50k hands'
    }
  };

  function t() { return T[state.lang]; }

  function tileName(id) { return state.lang === 'zh' ? tileLabel(id) : tileLabelEn(id); }
  function suitName(s) { return state.lang === 'zh' ? SUITS[s].zh : SUITS[s].en; }
  function suitChar(s) { return state.lang === 'zh' ? SUITS[s].zh : SUITS[s].en; }
  function remaining(id) { var r = COPIES - state.counts[id]; return r > 0 ? r : 0; }
  function total() { return totalOf(state.counts); }

  function chipHTML(id, extra) {
    var s = suitOf(id);
    return '<span class="chip' + (extra ? ' ' + extra : '') + '" style="color:' + SUITS[s].hex + '">' +
      '<span class="mini">' + window.MJTiles.face(id) + '</span>' + tileName(id) +
      '<em>' + t().remain + ' ' + remaining(id) + '</em></span>';
  }

  /* ---------- 渲染手牌选择器 ---------- */
  function renderPicker() {
    var html = '';
    for (var s = 0; s < 3; s++) {
      html += '<div class="suitrow"><div class="st" style="color:' + SUITS[s].hex + '">' + suitChar(s) + '</div><div class="tiles">';
      for (var r = 1; r <= 9; r++) {
        var id = s * 9 + (r - 1);
        var n = state.counts[id];
        html += '<button class="tb' + (n > 0 ? ' on' : '') + '" data-id="' + id + '" style="color:' + SUITS[s].hex + '">' +
          '<span class="tf">' + window.MJTiles.face(id) + '</span>' +
          (n > 0 ? '<span class="n">' + n + '</span>' : '') +
          '</button>';
      }
      html += '</div></div>';
    }
    document.getElementById('picker').innerHTML = html;
  }

  function renderControls() {
    var el = document.getElementById('controls');
    var meldsOpts = '';
    for (var m = 0; m <= 4; m++) meldsOpts += '<option value="' + m + '"' + (state.melds === m ? ' selected' : '') + '>' + m + '</option>';
    var missOpts = '<option value="-1"' + (state.missing === -1 ? ' selected' : '') + '>' + t().none + '</option>';
    for (var s = 0; s < 3; s++) missOpts += '<option value="' + s + '"' + (state.missing === s ? ' selected' : '') + '>' + suitName(s) + '</option>';
    el.innerHTML =
      '<div class="ctrl"><label>' + t().melds + '</label><select id="meldsSel">' + meldsOpts + '</select></div>' +
      '<div class="ctrl"><label>' + t().missing + '</label><select id="missSel">' + missOpts + '</select></div>' +
      '<button class="btn" id="clearBtn">' + t().clear + '</button>' +
      '<span class="btn gh">' + t().hint + '</span>';
    document.getElementById('meldsSel').onchange = function (e) { state.melds = +e.target.value; render(); };
    document.getElementById('missSel').onchange = function (e) { state.missing = +e.target.value; render(); };
    document.getElementById('clearBtn').onclick = function () { state.counts = new Array(27).fill(0); render(); };
  }

  function renderHandline() {
    var ids = [];
    for (var i = 0; i < TILE_KINDS; i++) for (var n = 0; n < state.counts[i]; n++) ids.push(i);
    var el = document.getElementById('handline');
    el.textContent = ids.length ? ids.map(tileName).join('  ') : '';
  }

  function renderExamples() {
    var exs = [
      { label: t().ex1, ids: [0,1,2,3,4,5,6,7,8, 9,9, 18,19] },
      { label: t().ex2, ids: [0,1,2,3,4,5,6,7,8, 9,9, 18,19,26] },
      { label: t().ex3, ids: [0,1,3,4,6, 10,11,13,15,16, 20,23,26] }
    ];
    var html = '<span class="hint" style="margin:0 var(--sp-xs) 0 0">' + t().examples + '</span>';
    html += exs.map(function (e, i) { return '<button class="btn" data-ex="' + i + '">' + e.label + '</button>'; }).join('');
    var el = document.getElementById('examples');
    el.innerHTML = html;
    el.querySelectorAll('button[data-ex]').forEach(function (b) {
      b.onclick = function () {
        state.counts = new Array(27).fill(0);
        exs[+b.dataset.ex].ids.forEach(function (id) { state.counts[id]++; });
        render();
      };
    });
  }

  /* ---------- 结果面板 ---------- */
  function sortDiscards(opts) {
    return opts.slice().sort(function (a, b) {
      if (a.shanten !== b.shanten) return a.shanten - b.shanten;
      if (a.ukeireCount !== b.ukeireCount) return b.ukeireCount - a.ukeireCount;
      if (a.ukeireKinds !== b.ukeireKinds) return b.ukeireKinds - a.ukeireKinds;
      return a.tile - b.tile;
    });
  }

  function ukeireSummary(opt) {
    return opt.ukeireKinds + ' ' + t().kindsT + ' / ' + opt.ukeireCount + ' ' + t().sheet;
  }

  function renderResult() {
    var el = document.getElementById('result');
    var exp = 13 - 3 * state.melds;
    var tot = total();
    var out = '';
    var Tt = t();

    // 定缺提示
    if (state.missing >= 0) {
      out += '<div class="note info">' + Tt.infoMissing(suitName(state.missing)) + '</div>';
    }

    if (tot === exp + 1) {
      // 14 张：该打哪张
      if (canWin(state.counts, state.melds)) {
        out += '<div class="big"><div class="bignum win">✓</div><div class="biglbl">' + Tt.shantenLbl + '</div></div>';
        out += '<p class="explain">' + Tt.winExpl + '</p>';
        el.innerHTML = out; return;
      }
      var opts = analyzeDiscards(state.counts, state.melds);
      // 定缺过滤：还持有缺门牌时只能打缺门牌
      var holding = state.missing >= 0 && suitCount(state.counts, state.missing) > 0;
      var filtered = holding ? opts.filter(function (o) { return suitOf(o.tile) === state.missing; }) : opts;
      var sorted = sortDiscards(filtered.length ? filtered : opts);
      var best = sorted[0];

      out += '<h2>' + Tt.discardT + (holding ? ' <span class="hint">' + Tt.missingFiltered + '</span>' : '') + '</h2>';
      if (best) {
        out += '<div class="note ok">' + Tt.bestIs(tileName(best.tile)) +
          '  ·  ' + Tt.shantenLbl + ' ' + best.shanten + '  ·  ' + ukeireSummary(best) + '</div>';
      }
      out += '<table><thead><tr><th>' + Tt.colDiscard + '</th><th>' + Tt.colShanten + '</th><th>' + Tt.colUkeire + '</th><th>' + Tt.colNote + '</th></tr></thead><tbody>';
      sorted.forEach(function (o, i) {
        var s = suitOf(o.tile);
        var note = o.shanten === 0 ? Tt.noteTenpai : '';
        out += '<tr' + (i === 0 ? ' class="best"' : '') + '>' +
          '<td><span class="chip" style="color:' + SUITS[s].hex + '">' + tileName(o.tile) + '</span>' + (i === 0 ? ' <em style="color:var(--good);font-style:normal;font-size:var(--fs-meta)">' + Tt.noteBest + '</em>' : '') + '</td>' +
          '<td class="num">' + o.shanten + '</td>' +
          '<td class="num">' + o.ukeireKinds + ' / ' + o.ukeireCount + '</td>' +
          '<td>' + note + '</td></tr>';
      });
      out += '</tbody></table>';
      el.innerHTML = out; return;
    }

    if (tot !== exp) {
      // 张数不符
      var d = exp - tot;
      out += '<div class="empty">' + (d > 0 ? Tt.needMore(d, exp) : Tt.over(exp)) + '</div>';
      el.innerHTML = out; return;
    }

    // 13 张（或 13-3*melds）：向听 + 听牌/进张
    var sh = shanten(state.counts, state.melds);
    var cls = sh === -1 ? 'win' : (sh === 0 ? 'z' : '');
    var numTxt = sh === -1 ? '✓' : String(sh);
    out += '<div class="big"><div class="bignum ' + cls + '">' + numTxt + '</div><div class="biglbl">' + Tt.shantenLbl + '</div></div>';

    if (sh === -1) {
      out += '<p class="explain">' + Tt.winExpl + '</p>';
    } else if (sh === 0) {
      out += '<p class="explain">' + Tt.tenpaiExpl + '</p>';
      var wins = winningTiles(state.counts, state.melds);
      var totalLeft = wins.reduce(function (a, id) { return a + remaining(id); }, 0);
      out += '<div class="sec-t">' + Tt.tenpaiT + ' · ' + wins.length + ' ' + Tt.kindsT + ' / ' + totalLeft + ' ' + Tt.sheet + '</div>';
      out += '<div class="chips">' + wins.map(function (id) { return chipHTML(id, 'big'); }).join('') + '</div>';
    } else {
      out += '<p class="explain">' + Tt.farExpl(sh) + '</p>';
      var imp = improvingTiles(state.counts, state.melds);
      var totalLeft2 = imp.reduce(function (a, id) { return a + remaining(id); }, 0);
      out += '<div class="sec-t">' + Tt.improveT + ' · ' + imp.length + ' ' + Tt.kindsT + ' / ' + totalLeft2 + ' ' + Tt.sheet + '</div>';
      out += '<div class="chips">' + (imp.length ? imp.map(function (id) { return chipHTML(id); }).join('') : '<span class="empty">—</span>') + '</div>';
    }

    if (state.missing >= 0 && suitCount(state.counts, state.missing) > 0) {
      out += '<div class="note warn">' + Tt.missingHold(suitName(state.missing)) + '</div>';
    }
    el.innerHTML = out;
  }

  /* ---------- 事件 + 主渲染 ---------- */
  function renderChrome() {
    document.getElementById('ttl').textContent = t().title;
    document.getElementById('sub').textContent = t().sub;
    document.getElementById('h-hand').textContent = t().hHand;
    document.getElementById('foot').textContent = t().footer;
    document.getElementById('langBtn').textContent = state.lang === 'zh' ? 'EN' : '中文';
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
  }

  function render() { renderChrome(); renderPicker(); renderControls(); renderHandline(); renderExamples(); renderResult(); }

  function addTile(id) {
    var exp = 13 - 3 * state.melds;
    if (state.counts[id] >= COPIES) return;
    if (total() >= exp + 1) return;
    state.counts[id]++;
  }
  function removeTile(id) { if (state.counts[id] > 0) state.counts[id]--; }

  document.getElementById('picker').addEventListener('click', function (e) {
    var b = e.target.closest('.tb'); if (!b) return;
    if (e.shiftKey) removeTile(+b.dataset.id); else addTile(+b.dataset.id);
    render();
  });
  document.getElementById('picker').addEventListener('contextmenu', function (e) {
    var b = e.target.closest('.tb'); if (!b) return;
    e.preventDefault(); removeTile(+b.dataset.id); render();
  });
  document.getElementById('langBtn').addEventListener('click', function () {
    state.lang = state.lang === 'zh' ? 'en' : 'zh'; render();
  });

  render();
})();
