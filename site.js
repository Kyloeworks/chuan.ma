/**
 * chuan.ma 全站共享脚本：顶栏 + 设置面板 + 语言切换
 *
 * 只做三件事：
 *   ① 把每页原来的 <nav> 换成统一的「品牌 + 设置」顶栏（顶栏不放别的按钮）；
 *   ② 设置面板里放「页面导航 + 语言 + 关闭」；
 *   ③ 语言用 localStorage['chuanma.lang'] 跨页保持 —— 牌桌 / 算牌器 / 牌面页用的是同一个 key，
 *      所以在任一处切成英文，翻到别的页面也还是英文。
 *
 * 页面侧只需要：
 *   ① <nav></nav>（内容会被本脚本填掉）；
 *   ② 给要翻译的元素加 data-i18n="key"（英文原文照常写在 HTML 里，未提供译文的保持英文）；
 *   ③ 底部定义 window.CM_I18N = { zh: { key: '中文…' } }（也可以写在某段 <script> 里）。
 * 之所以「英文留在 DOM、中文放字典」，是为了让 SEO 与「禁用 JS 也能读」都不受影响。
 */
(function () {
  'use strict';

  var LANG_KEY = 'chuanma.lang';
  var GEAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>';

  var NAV = [
    { href: 'index.html', en: 'Home', zh: '首页' },
    { href: 'learn-rules.html', en: 'Rules', zh: '规则' },
    { href: 'learn-tiles.html', en: 'Tiles', zh: '牌面' },
    { href: 'learn-scoring.html', en: 'Scoring', zh: '番数' },
    { href: 'learn-culture.html', en: 'Culture', zh: '文化' },
    { href: 'glossary.html', en: 'Glossary', zh: '术语' },
    { href: 'play.html', en: 'Play the table', zh: '牌桌' },
    { href: 'calculator.html', en: 'Hand calculator', zh: '算牌器' }
  ];

  // 面板自身的文案（不依赖各页的词典，任何页面都能用）
  var UI = {
    en: { settings: 'Settings', pages: 'Pages', lang: 'Language', close: 'Close', on: 'On this page' },
    zh: { settings: '设置', pages: '页面', lang: '语言', close: '关闭', on: '当前页' }
  };

  function readLang() {
    try { var v = localStorage.getItem(LANG_KEY); if (v === 'zh' || v === 'en') return v; } catch (e) { /* 隐私模式 */ }
    return 'zh';
  }
  function writeLang(v) { try { localStorage.setItem(LANG_KEY, v); } catch (e) { /* ignore */ } }

  var lang = readLang();

  function here() {
    var p = location.pathname.split('/').pop();
    return p && p.length ? p : 'index.html';
  }

  /** 按当前语言改写所有 data-i18n 元素；没有译文的一律回到 HTML 原文 */
  function applyText() {
    var dict = (window.CM_I18N && window.CM_I18N.zh) || {};
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.hasAttribute('data-orig')) el.setAttribute('data-orig', el.innerHTML);
      var zh = dict[el.getAttribute('data-i18n')];
      el.innerHTML = (lang === 'zh' && zh) ? zh : el.getAttribute('data-orig');
    }
    var ph = document.querySelectorAll('[data-i18n-ph]');
    for (var j = 0; j < ph.length; j++) {
      var e2 = ph[j];
      if (!e2.hasAttribute('data-orig-ph')) e2.setAttribute('data-orig-ph', e2.getAttribute('placeholder') || '');
      var z2 = dict[e2.getAttribute('data-i18n-ph')];
      e2.setAttribute('placeholder', (lang === 'zh' && z2) ? z2 : e2.getAttribute('data-orig-ph'));
    }
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    var lb = document.getElementById('cmLangBtn');
    if (lb) lb.textContent = lang === 'zh' ? 'EN' : '中文';
  }

  /** 顶栏：左侧品牌、右侧设置。页面里原来的 <nav> 直接换成它。 */
  function buildBar() {
    var nav = document.querySelector('nav');
    if (!nav) return;
    nav.className = 'cmbar';
    nav.innerHTML =
      '<a class="brand" href="index.html" title="chuan.ma"><b>Chuan<span>.</span>Ma</b><i>川麻</i></a>' +
      '<span class="spacer"></span>' +
      '<button class="iconbtn" id="cmSetBtn" aria-label="Settings" title="Settings / 设置">' + GEAR + '</button>';
  }

  /** 设置面板：页面导航 + 语言 + 关闭 */
  function buildSheet() {
    var d = document.createElement('div');
    d.className = 'cmsheet';
    d.id = 'cmsheet';
    var cur = here();
    var links = '';
    for (var i = 0; i < NAV.length; i++) {
      var n = NAV[i];
      links += '<a class="cmpill' + (n.href === cur ? ' on' : '') + '" href="' + n.href + '">' +
        (lang === 'zh' ? n.zh : n.en) + '</a>';
    }
    d.innerHTML = '<div class="cmsheet-in" role="dialog" aria-modal="true">' +
      '<div class="cmgroup"><div class="cmlbl" data-ui="pages"></div><div class="cmpills">' + links + '</div></div>' +
      '<div class="cmgroup"><div class="cmlbl" data-ui="lang"></div><div class="cmpills">' +
        '<button class="cmpill lang' + (lang === 'zh' ? ' on' : '') + '" data-lang="zh">中文</button>' +
        '<button class="cmpill lang' + (lang === 'en' ? ' on' : '') + '" data-lang="en">English</button>' +
      '</div></div>' +
      '<div class="cmactions"><button class="cmbtn" id="cmCloseBtn" data-ui="close"></button></div>' +
      '</div>';
    document.body.appendChild(d);

    d.querySelectorAll('.cmpill.lang').forEach(function (el) {
      el.onclick = function () { lang = el.dataset.lang; writeLang(lang); applyText(); paintSheet(); };
    });
    d.onclick = function (e) { if (e.target === d) close(); };
    d.querySelector('#cmCloseBtn').onclick = close;
  }

  /** 面板内的动态文案（语言切换后要重刷：导航名与按钮都是按语言生成的） */
  function paintSheet() {
    var d = document.getElementById('cmsheet');
    if (!d) return;
    var u = UI[lang] || UI.en;
    d.querySelectorAll('[data-ui]').forEach(function (el) { el.textContent = u[el.dataset.ui] || ''; });
    var cur = here();
    d.querySelectorAll('a.cmpill').forEach(function (el) {
      var href = el.getAttribute('href');
      el.classList.toggle('on', href === cur);
      var found = null;
      for (var i = 0; i < NAV.length; i++) if (NAV[i].href === href) found = NAV[i];
      if (found) el.textContent = lang === 'zh' ? found.zh : found.en;
    });
    d.querySelectorAll('.cmpill.lang').forEach(function (el) {
      el.classList.toggle('on', el.dataset.lang === lang);
    });
  }

  function open() { var d = document.getElementById('cmsheet'); if (d) d.classList.add('show'); }
  function close() { var d = document.getElementById('cmsheet'); if (d) d.classList.remove('show'); }

  function init() {
    buildBar();
    buildSheet();
    paintSheet();
    applyText();
    var b = document.getElementById('cmSetBtn');
    if (b) b.onclick = function () {
      var d = document.getElementById('cmsheet');
      if (d && d.classList.contains('show')) close(); else open();
    };
    // 暴露给测试/调试
    window.__CMI18N__ = {
      get: function () { return lang; },
      set: function (v) { lang = (v === 'en' ? 'en' : 'zh'); writeLang(lang); applyText(); paintSheet(); return lang; }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
