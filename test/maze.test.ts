import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { generateMaze, openEdges, Walls } from "../src/maze";
import { validateMaze } from "../src/validate";
import { findRoute, validateRoute } from "../src/route";
import { renderAscii } from "../src/ascii";
import { MazeStore } from "../src/db";

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

test("固定种子生成确定性的 3x3 迷宫（快照）", () => {
  const m = generateMaze(3, 3, 42);
  assert.deepEqual(m.walls, EXPECTED_3X3_SEED42);
  // 同参数重复生成完全一致
  assert.deepEqual(generateMaze(3, 3, 42).walls, m.walls);
  // 不同尺寸互不相同（合理性检查）
  assert.notDeepEqual(generateMaze(3, 4, 42).walls, m.walls);
});

test("单格迷宫是合法树", () => {
  const m = generateMaze(1, 1, 7);
  assert.deepEqual(m.walls, [[{ n: true, e: true, s: true, w: true }]]);
  const report = validateMaze(1, 1, m.walls);
  assert.equal(report.ok, true);
  assert.equal(report.openEdgeCount, 0);
});

test("单行/单列长条有唯一通路", () => {
  for (const [r, c] of [
    [1, 10],
    [10, 1],
  ]) {
    const m = generateMaze(r, c, 99);
    const report = validateMaze(r, c, m.walls);
    assert.equal(report.ok, true, JSON.stringify(report.issues));
    assert.equal(report.openEdgeCount, r * c - 1);
    const route = findRoute(r, c, m.walls, { row: 0, col: 0 }, { row: r - 1, col: c - 1 });
    assert.equal(route.length, r * c); // 长条通路经过所有格
  }
});

test("多个固定种子均连通且边数 = 格数 - 1", () => {
  for (const seed of [0, 1, 42, 12345, -7, 2147483647]) {
    const m = generateMaze(12, 15, seed);
    const report = validateMaze(12, 15, m.walls);
    assert.equal(report.ok, true, `seed=${seed}: ${JSON.stringify(report.issues)}`);
    assert.equal(report.openEdgeCount, 12 * 15 - 1);
    assert.equal(report.reachableCount, 12 * 15);
  }
});

test("非法尺寸与非法种子被拒绝", () => {
  assert.throws(() => generateMaze(0, 5, 1), /行数和列数/);
  assert.throws(() => generateMaze(5, -1, 1), /行数和列数/);
  assert.throws(() => generateMaze(3.5, 5, 1), /整数/);
  assert.throws(() => generateMaze(5, 5, 1.5), /种子/);
});

test("核验器发现闭环（边数过多）", () => {
  const m = generateMaze(4, 4, 5);
  const walls = clone(m.walls);
  // 打通一面内部墙（两侧都改，保持对称）制造闭环
  walls[0][0].s = false;
  walls[1][0].n = false;
  const report = validateMaze(4, 4, walls);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === "EDGE_COUNT_MISMATCH"));
});

test("核验器发现断开的格子（不可达）", () => {
  const m = generateMaze(3, 3, 5);
  const walls = clone(m.walls);
  // 把 (2,2) 完全封死
  walls[2][2] = { n: true, e: true, s: true, w: true };
  walls[1][2].s = true;
  walls[2][1].e = true;
  const report = validateMaze(3, 3, walls);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === "UNREACHABLE_CELL" && i.row === 2 && i.col === 2));
});

test("核验器发现共享墙不对称", () => {
  const m = generateMaze(3, 3, 5);
  const walls = clone(m.walls);
  walls[1][1].e = !walls[1][1].e; // 只改一侧
  const report = validateMaze(3, 3, walls);
  assert.equal(report.ok, false);
  const issue = report.issues.find((i) => i.code === "ASYMMETRIC_WALL");
  assert.ok(issue);
  assert.equal(issue!.row, 1);
  assert.equal(issue!.col, 1);
});

test("核验器发现外边界缺失", () => {
  const m = generateMaze(3, 3, 5);
  const walls = clone(m.walls);
  walls[0][2].n = false; // 打开上边界
  const report = validateMaze(3, 3, walls);
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((i) => i.code === "OPEN_BOUNDARY" && i.row === 0 && i.col === 2));
});

test("核验器拒绝损坏结构，不做静默修正", () => {
  const bad1 = validateMaze(2, 2, [[{ n: 1 }]] as unknown as Walls);
  assert.equal(bad1.ok, false);
  assert.ok(bad1.issues.every((i) => i.code === "MALFORMED_STRUCTURE"));
  const bad2 = validateMaze(2, 2, [] as unknown as Walls);
  assert.equal(bad2.ok, false);
  assert.equal(bad2.issues[0].code, "MALFORMED_STRUCTURE");
});

test("路线：起终点、相邻性、不穿墙、越界拒绝", () => {
  const m = generateMaze(6, 6, 2024);
  const from = { row: 0, col: 0 };
  const to = { row: 5, col: 5 };
  const route = findRoute(6, 6, m.walls, from, to);
  assert.deepEqual(route[0], from);
  assert.deepEqual(route[route.length - 1], to);
  for (let i = 1; i < route.length; i++) {
    const d = Math.abs(route[i].row - route[i - 1].row) + Math.abs(route[i].col - route[i - 1].col);
    assert.equal(d, 1);
  }
  assert.equal(validateRoute(6, 6, m.walls, route).ok, true);

  // 穿墙路线被拒绝：找一对有墙的相邻格
  outer: for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 5; c++) {
      if (m.walls[r][c].e) {
        const bad = validateRoute(6, 6, m.walls, [
          { row: r, col: c },
          { row: r, col: c + 1 },
        ]);
        assert.equal(bad.ok, false);
        assert.ok(bad.issues[0].includes("穿墙"));
        break outer;
      }
    }
  }
  // 越界与不连续
  assert.equal(validateRoute(6, 6, m.walls, [{ row: 9, col: 0 }]).ok, false);
  assert.equal(
    validateRoute(6, 6, m.walls, [
      { row: 0, col: 0 },
      { row: 2, col: 2 },
    ]).ok,
    false
  );
  // 越界起终点抛错
  assert.throws(() => findRoute(6, 6, m.walls, { row: -1, col: 0 }, to), /越界/);
});

test("ASCII 输出与墙体结构一致", () => {
  const m = generateMaze(2, 2, 3);
  const ascii = renderAscii(2, 2, m.walls);
  const lines = ascii.split("\n");
  assert.equal(lines.length, 2 * 2 + 1);
  assert.equal(lines[0], "+---+---+"); // 上边界封闭
  assert.equal(lines[4], "+---+---+"); // 下边界封闭
  assert.ok(lines[1].startsWith("|") && lines[1].endsWith("|"));
  // 内部竖墙字符与 walls[0][0].e 一致
  assert.equal(lines[1][4], m.walls[0][0].e ? "|" : " ");
  // 内部横墙与 walls[0][0].s 一致
  assert.equal(lines[2].slice(1, 4), m.walls[0][0].s ? "---" : "   ");
});

test("SQLite 持久化：重复参数复用记录，重开后数据仍在", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "maze-test-"));
  const dbPath = path.join(dir, "t.db");
  const m = generateMaze(5, 5, 77);
  const report = validateMaze(5, 5, m.walls);

  let store = new MazeStore(dbPath);
  const first = store.save(m, report);
  assert.equal(first.reused, false);
  const second = store.save(m, report);
  assert.equal(second.reused, true);
  assert.equal(second.record.id, first.record.id);
  store.close();

  // 模拟重启
  store = new MazeStore(dbPath);
  const loaded = store.get(first.record.id);
  assert.ok(loaded);
  assert.deepEqual(loaded!.walls, m.walls);
  assert.equal(loaded!.seed, 77);
  assert.equal(store.list().length, 1);
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("openEdges 与墙体一致", () => {
  const m = generateMaze(4, 4, 11);
  const edges = openEdges(m);
  assert.equal(edges.length, 15);
  for (const e of edges) {
    if (e.r1 === e.r2) assert.equal(m.walls[e.r1][e.c1].e, false);
    else assert.equal(m.walls[e.r1][e.c1].s, false);
  }
});

// 固定种子 42 的 3x3 迷宫预期墙体（由算法首次实现后固化，防止回归）
const EXPECTED_3X3_SEED42: Walls = [
  [
    { n: true, e: false, s: true, w: true },
    { n: true, e: true, s: false, w: false },
    { n: true, e: true, s: false, w: true },
  ],
  [
    { n: true, e: true, s: false, w: true },
    { n: false, e: false, s: true, w: true },
    { n: false, e: true, s: false, w: false },
  ],
  [
    { n: false, e: false, s: true, w: true },
    { n: true, e: false, s: true, w: false },
    { n: false, e: true, s: true, w: false },
  ],
];
