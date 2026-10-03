// 演示脚本：生成 -> 查询路径 -> 手动改坏一面墙 -> 核验器定位问题。

import * as fs from "node:fs";
import * as path from "node:path";
import { generateMaze } from "./maze";
import { validateMaze } from "./validate";
import { findRoute } from "./route";
import { renderAscii, routeMarks } from "./ascii";
import { MazeStore, defaultDbPath } from "./db";

async function main(): Promise<void> {
  const store = new MazeStore(defaultDbPath());

  console.log("=== 1. 生成 8x12 迷宫（种子 42） ===");
  const maze = generateMaze(8, 12, 42);
  const report = validateMaze(maze.rows, maze.cols, maze.walls);
  const { record, reused } = store.save(maze, report);
  console.log(`迷宫 #${record.id} ${reused ? "（重复参数，复用已有记录）" : "（新建）"}，核验: ${report.ok ? "通过" : "失败"}`);
  console.log(renderAscii(maze.rows, maze.cols, maze.walls));

  console.log("\n=== 2. 查询 (0,0) -> (7,11) 路线 ===");
  const route = findRoute(maze.rows, maze.cols, maze.walls, { row: 0, col: 0 }, { row: 7, col: 11 });
  console.log(`路线长度 ${route.length}`);
  console.log(renderAscii(maze.rows, maze.cols, maze.walls, routeMarks(route, { row: 0, col: 0 }, { row: 7, col: 11 })));

  console.log("\n=== 3. 手动改坏一面墙并核验 ===");
  const broken = JSON.parse(JSON.stringify(maze.walls));
  // 在 (3,5) 与 (3,6) 之间制造不对称：只改一侧
  broken[3][5].e = !broken[3][5].e;
  const sampleDir = path.join(process.cwd(), "samples");
  fs.mkdirSync(sampleDir, { recursive: true });
  const brokenFile = path.join(sampleDir, "broken-maze.json");
  fs.writeFileSync(brokenFile, JSON.stringify({ rows: 8, cols: 12, walls: broken }, null, 2), "utf8");
  console.log(`已写入损坏样例: ${brokenFile}`);
  const bad = validateMaze(8, 12, broken);
  console.log(`核验结果: ${bad.ok ? "通过（不应发生）" : "失败（符合预期）"}`);
  for (const issue of bad.issues.slice(0, 10)) {
    console.log(`  [${issue.code}] ${issue.message}`);
  }

  store.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
