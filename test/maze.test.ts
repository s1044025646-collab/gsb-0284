import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateMaze, openEdges, toAscii, CellWalls } from '../src/maze.js';
import { findPath, validatePath } from '../src/path.js';
import { verifyMaze } from '../src/verify.js';
import { MazeService } from '../src/service.js';
import { MazeStore } from '../src/store.js';

function emptyGrid(rows: number, cols: number): CellWalls[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ N: true, E: true, S: true, W: true })),
  );
}

test('同尺寸同种子生成完全相同的墙体（可复现）', () => {
  const a = generateMaze(5, 7, 42);
  const b = generateMaze(5, 7, 42);
  assert.deepEqual(a.walls, b.walls);
  assert.equal(a.algorithm, 'mulberry32-v1');
});

test('固定小迷宫 3x3 seed=1 的精确墙体快照', () => {
  const m = generateMaze(3, 3, 1);
  assert.deepEqual(m.walls, [
    [
      { N: true, E: true, S: false, W: true },
      { N: true, E: false, S: true, W: true },
      { N: true, E: true, S: false, W: false },
    ],
    [
      { N: false, E: false, S: true, W: true },
      { N: true, E: false, S: true, W: false },
      { N: false, E: true, S: false, W: false },
    ],
    [
      { N: true, E: false, S: true, W: true },
      { N: true, E: false, S: true, W: false },
      { N: false, E: true, S: true, W: false },
    ],
  ]);
});

test('单格迷宫是合法树', () => {
  const m = generateMaze(1, 1, 0);
  assert.deepEqual(m.walls, [[{ N: true, E: true, S: true, W: true }]]);
  const report = verifyMaze(m);
  assert.equal(report.ok, true);
  assert.equal(report.openEdgeCount, 0);
  assert.equal(report.expectedEdgeCount, 0);
});

test('单行与单列：唯一通路、边数为格数-1', () => {
  for (const [r, c] of [[1, 5], [5, 1], [1, 1]]) {
    const m = generateMaze(r, c, 7);
    const report = verifyMaze(m);
    assert.equal(report.ok, true, `尺寸 ${r}x${c} 应合法: ${report.errors.join('; ')}`);
    assert.equal(openEdges(m).length, r * c - 1);
  }
});

test('多个固定种子与多种尺寸均为完美迷宫（连通、对称、边数 n-1）', () => {
  for (const seed of [0, 1, 2, 99, 123456, 4294967295]) {
    for (const [r, c] of [[2, 2], [4, 6], [10, 3], [13, 13]]) {
      const m = generateMaze(r, c, seed);
      const report = verifyMaze(m);
      assert.equal(report.ok, true, `seed=${seed} ${r}x${c}: ${report.errors.join('; ')}`);
      assert.equal(report.unreachableCells.length, 0);
    }
  }
});

test('手工墙体：闭环（extraEdges>0）能被发现', () => {
  const m = generateMaze(2, 2, 1);
  // 额外打通 0,0 与 1,0 之间已存在的边不行，改为构造一个已知含环结构：
  const walls = emptyGrid(2, 2);
  // 四条边全开 => 4 条边，格数 4，树只需 3 条 => 有环
  walls[0][0].E = false; walls[0][1].W = false;
  walls[0][0].S = false; walls[1][0].N = false;
  walls[0][1].S = false; walls[1][1].N = false;
  walls[1][0].E = false; walls[1][1].W = false;
  const report = verifyMaze({ rows: 2, cols: 2, walls });
  assert.equal(report.ok, false);
  assert.equal(report.openEdgeCount, 4);
  assert.ok(report.errors.some((e) => e.includes('不等于')));
  void m;
});

test('手工墙体：断裂（不可达格）能被定位', () => {
  const walls = emptyGrid(2, 2);
  // 只打通 (0,0)-(0,1)，其余格孤立
  walls[0][0].E = false; walls[0][1].W = false;
  const report = verifyMaze({ rows: 2, cols: 2, walls });
  assert.equal(report.ok, false);
  assert.deepEqual(report.unreachableCells.sort(), [[1, 0], [1, 1]]);
});

test('手工墙体：共享墙不对称能被具体定位', () => {
  const walls = emptyGrid(3, 3);
  walls[0][0].S = false; // 只改一侧，邻居 (1,0) 的 N 仍是 true => 不对称
  const report = verifyMaze({ rows: 3, cols: 3, walls });
  assert.equal(report.ok, false);
  assert.equal(report.asymmetricWalls.length, 1);
  assert.deepEqual(report.asymmetricWalls[0].a, [0, 0]);
});

test('手工墙体：外边界缺口能被定位', () => {
  const m = generateMaze(3, 3, 1);
  m.walls[2][2].E = false;
  const report = verifyMaze(m);
  assert.equal(report.ok, false);
  assert.deepEqual(report.boundaryGaps, [{ cell: [2, 2], dir: 'E', reason: 'boundary_open' }]);
});

test('损坏结构与非法尺寸抛出明确错误码', () => {
  assert.throws(() => verifyMaze(null), (e: Error & { code?: string }) => e.code === 'INVALID_STRUCTURE');
  assert.throws(
    () => verifyMaze({ rows: 2, cols: 2, walls: [] }),
    (e: Error & { code?: string }) => e.code === 'INVALID_STRUCTURE',
  );
  assert.throws(() => generateMaze(0, 2, 1), (e: Error & { code?: string }) => e.code === 'INVALID_DIMENSIONS');
  assert.throws(() => generateMaze(2, 2, -1), (e: Error & { code?: string }) => e.code === 'INVALID_SEED');
});

test('路线：起终点、相邻性、每一步不穿墙，且唯一', () => {
  const m = generateMaze(6, 8, 20261003);
  const path = findPath(m, [0, 0], [5, 7]);
  assert.deepEqual(path[0], [0, 0]);
  assert.deepEqual(path[path.length - 1], [5, 7]);
  for (let i = 1; i < path.length; i++) {
    const [ar, ac] = path[i - 1];
    const [br, bc] = path[i];
    assert.equal(Math.abs(br - ar) + Math.abs(bc - ac), 1, '每一步必须上下左右相邻');
    const result = validatePath(m, path.slice(0, i + 1));
    assert.equal(result.valid, true, result.reason);
  }
  // 合法路线通过校验；穿墙路线被拒绝
  assert.equal(validatePath(m, [[0, 0], [0, 1]]).valid, !m.walls[0][0].E);
  const diagonal = validatePath(m, [[0, 0], [1, 1]]);
  assert.equal(diagonal.valid, false);
  const oob = validatePath(m, [[0, 0], [0, 8]]);
  assert.equal(oob.valid, false);
  assert.match(oob.reason!, /越界/);
});

test('ASCII 图与墙体结构一致', () => {
  const m = generateMaze(3, 4, 5);
  const ascii = toAscii(m).split('\n');
  // 顶行与底行应全部为墙
  assert.match(ascii[0], /^#+$/);
  assert.match(ascii[ascii.length - 1], /^#+$/);
  // 每行格心字符存在
  assert.equal(ascii[1].includes('o'), true);
  // 边界左右两侧：格心行首尾为墙
  for (let r = 0; r < m.rows; r++) {
    assert.equal(ascii[1 + 2 * r][0], '#');
    assert.equal(ascii[1 + 2 * r].at(-1), '#');
  }
});

test('SQLite 持久化：重复同参数命中旧记录，重启后仍可查询', () => {
  const dir = mkdtempSync(join(tmpdir(), 'maze-'));
  const dbPath = join(dir, 'mazes.sqlite');
  let store = new MazeStore(dbPath);
  let svc = new MazeService(store);
  const first = svc.generate(4, 5, 99);
  assert.equal(first.regenerated, false);
  const again = svc.generate(4, 5, 99);
  assert.equal(again.regenerated, true);
  assert.equal(again.id, first.id);
  store.close();

  // 模拟服务重启：重新打开同一数据库文件
  store = new MazeStore(dbPath);
  svc = new MazeService(store);
  const reloaded = svc.getOrThrow(first.id);
  assert.deepEqual(reloaded.walls, first.walls);
  assert.equal(reloaded.algorithm, 'mulberry32-v1');
  const route = svc.path(first.id, [0, 0], [3, 4]);
  assert.deepEqual(route.path.at(-1), [3, 4]);
  store.close();
});
