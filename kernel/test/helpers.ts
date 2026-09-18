/** 测试辅助：用紧凑字符串构造手牌 counts
 *  例：H('123m 456s 789p 11m')  m=万 s=条 p=筒
 */
import { countsFrom, tileId, WAN, TIAO, TONG, type Counts } from '../src/tiles.ts';

const SUIT_OF: Record<string, number> = { m: WAN, s: TIAO, p: TONG };

export function H(spec: string): Counts {
  const ids: number[] = [];
  const re = /(\d+)([msp])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(spec)) !== null) {
    const suit = SUIT_OF[m[2]];
    for (const ch of m[1]) ids.push(tileId(suit, Number(ch)));
  }
  if (ids.length === 0) throw new Error(`无法解析手牌: ${spec}`);
  return countsFrom(ids);
}

export function H13(spec: string): Counts {
  const c = H(spec);
  let t = 0;
  for (const n of c) t += n;
  if (t !== 13) throw new Error(`期望 13 张，实际 ${t} 张: ${spec}`);
  return c;
}

export function H14(spec: string): Counts {
  const c = H(spec);
  let t = 0;
  for (const n of c) t += n;
  if (t !== 14) throw new Error(`期望 14 张，实际 ${t} 张: ${spec}`);
  return c;
}
