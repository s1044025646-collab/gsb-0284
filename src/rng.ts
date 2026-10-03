// 固定、公开的种子化伪随机数算法。
// 算法版本：mulberry32-v1
// 说明：这是 32 位 mulberry32（参考实现公开且固定）。
// 同一 (尺寸, 种子, 算法版本) 永远产生同一迷宫；
// 旧迷宫在数据库中记录算法版本，不会因将来更换默认算法而改变。

export const ALGO_VERSION = 'mulberry32-v1';

export class SeededRng {
  private state: number;
  readonly algorithm = ALGO_VERSION;

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError('seed 必须是 0..4294967295 之间的非负整数');
    }
    this.state = seed >>> 0;
  }

  // 返回 [0, 1) 的浮点伪随机数；实现固定，不可替换为 Math.random。
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // 在长度为 length 的候选中返回一个下标 [0, length)。
  pickIndex(length: number): number {
    if (length <= 0) throw new RangeError('pickIndex 需要正长度');
    return Math.floor(this.next() * length);
  }
}
