import { test } from 'node:test';
import assert from 'node:assert/strict';
import { H, H14 } from './helpers.ts';
import { canWin, canWinStandard, canWinSevenPairs } from '../src/win.ts';

test('标准和牌：四面子一对将', () => {
  assert.equal(canWinStandard(H14('123m 456m 789m 123s 11s')), true);
});

test('标准和牌：四刻子（对对和形）', () => {
  assert.equal(canWinStandard(H14('111m 222m 333m 444m 55m')), true);
});

test('标准和牌：含顺子跨门不影响判定', () => {
  assert.equal(canWinStandard(H14('123m 456s 789p 111m 22s')), true);
});

test('非和牌：13 张不成立', () => {
  assert.equal(canWin(H('123m 456m 789m 123s 1s')), null);
});

test('非和牌：14 张但结构不对', () => {
  assert.equal(canWin(H14('123m 456m 789m 123s 45s')), null);
});

test('暗七对：7 个对子', () => {
  assert.equal(canWinSevenPairs(H14('11m 22m 33s 44s 55p 66p 77p')), true);
});

test('龙七对：4 张算 2 对', () => {
  assert.equal(canWinSevenPairs(H14('11m 22m 33s 44s 55p 6666p')), true);
});

test('七对：6 对 + 2 单张不算', () => {
  assert.equal(canWinSevenPairs(H14('11m 22m 33s 44s 55p 66p 7p 8p')), false);
});

test('七对要求门清：副露后不成立', () => {
  const c = H('11m 22m 33s 44s 55p 6666p'); // 11 张 + 1 副露
  assert.equal(canWinSevenPairs(c, 1), false);
});

test('副露后标准和牌：手牌 11 张 = 3 面子 + 1 将', () => {
  // 副露 1 副（碰），手牌 11 张
  assert.equal(canWinStandard(H('234m 567s 123p 88p'), 1), true);
});

test('副露 2 副：手牌 8 张 = 2 面子 + 1 将', () => {
  assert.equal(canWinStandard(H('234m 567s 88p'), 2), true);
});

test('canWin 返回牌型', () => {
  assert.equal(canWin(H14('11m 22m 33s 44s 55p 66p 77p')), 'sevenPairs');
  assert.equal(canWin(H14('123m 456m 789m 123s 11s')), 'standard');
});

test('清一色和牌', () => {
  assert.equal(canWin(H14('111m 222m 333m 444m 55m')), 'standard');
});
