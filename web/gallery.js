/* 资产总览页逻辑 */
(function () {
  var MJ = window.MJTiles;
  var SUIT = ['万', '条', '筒'];
  function fill(el, ids, cls) {
    el.innerHTML = ids.map(function (id, i) {
      var cap = SUIT[Math.floor(id / 9)] + ((id % 9) + 1);
      return '<div class="cell"><div class="tile ' + (cls || '') + '">' + MJ.face(id) + '</div>' +
        '<div class="cap">' + cap + ' · id ' + id + '</div></div>';
    }).join('');
  }
  fill(document.getElementById('gWan'), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  fill(document.getElementById('gTiao'), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  fill(document.getElementById('gTong'), [18, 19, 20, 21, 22, 23, 24, 25, 26]);

  document.getElementById('gBack').innerHTML =
    '<div class="cell"><div class="tile">' + MJ.back() + '</div><div class="cap">牌背</div></div>' +
    '<div class="cell"><div class="tile sm">' + MJ.back() + '</div><div class="cap">小号牌背</div></div>';

  var hand = [0, 1, 2, 9, 10, 11, 18, 19, 20, 25, 7, 16, 22, 4];
  document.getElementById('fHand').innerHTML = hand.map(function (id) {
    return '<div class="tile" style="width:48px;height:68px">' + MJ.face(id) + '</div>';
  }).join('');

  var small = [3, 12, 21, 26, 5, 14, 23, 8];
  document.getElementById('fSmall').innerHTML = small.map(function (id) {
    return '<div class="tile sm" style="width:28px;height:39px">' + MJ.face(id) + '</div>';
  }).join('');

  var backs = '';
  for (var i = 0; i < 13; i++) backs += '<div class="tile sm" style="width:28px;height:39px">' + MJ.back() + '</div>';
  document.getElementById('fBack').innerHTML = backs;
})();
