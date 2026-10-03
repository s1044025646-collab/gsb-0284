// CLI 入口：generate / show / route / validate / list / export / serve / demo

import * as fs from "node:fs";
import * as path from "node:path";
import { generateMaze, MazeError, openEdges, Walls } from "./maze";
import { validateMaze } from "./validate";
import { findRoute, validateRoute, CellCoord } from "./route";
import { renderAscii, routeMarks } from "./ascii";
import { MazeStore, defaultDbPath } from "./db";
import { startServer } from "./server";

function parseCoordArg(s: string): CellCoord {
  const m = /^(-?\d+),(-?\d+)$/.exec(s.trim());
  if (!m) throw new MazeError("INVALID_COORD", `坐标格式应为 r,c，收到 "${s}"`);
  return { row: Number(m[1]), col: Number(m[2]) };
}

function printJson(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

function loadWallsFile(file: string): { rows: number; cols: number; walls: Walls } {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  return { rows: Number(data.rows), cols: Number(data.cols), walls: data.walls as Walls };
}

export async function runCli(argv: string[]): Promise<void> {
  const [cmd, ...args] = argv;
  const store = new MazeStore(defaultDbPath());
  try {
    switch (cmd) {
      case "generate": {
        // maze generate <rows> <cols> <seed> [--ascii]
        const [rows, cols, seed] = args.slice(0, 3).map(Number);
        const maze = generateMaze(rows, cols, seed);
        const report = validateMaze(maze.rows, maze.cols, maze.walls);
        const { record, reused } = store.save(maze, report);
        console.log(`迷宫 #${record.id}（${record.rows}x${record.cols}，种子 ${record.seed}）${reused ? "（参数重复，返回已有记录）" : "（新建）"}`);
        console.log(`核验: ${report.ok ? "通过" : "失败"}，开通边 ${report.openEdgeCount}/${report.expectedOpenEdges}`);
        if (args.includes("--ascii")) {
          console.log(renderAscii(record.rows, record.cols, record.walls));
        }
        break;
      }
      case "show": {
        // maze show <id> [--format ascii|walls|edges|json]
        const id = Number(args[0]);
        const rec = store.get(id);
        if (!rec) throw new MazeError("NOT_FOUND", `迷宫 #${id} 不存在`);
        const fi = args.indexOf("--format");
        const format = fi >= 0 ? args[fi + 1] : "ascii";
        if (format === "ascii") console.log(renderAscii(rec.rows, rec.cols, rec.walls));
        else if (format === "walls") printJson({ id, rows: rec.rows, cols: rec.cols, walls: rec.walls });
        else if (format === "edges") printJson({ id, openEdges: openEdges(rec) });
        else printJson(rec);
        break;
      }
      case "route": {
        // maze route <id> <from r,c> <to r,c> [--ascii]
        const id = Number(args[0]);
        const rec = store.get(id);
        if (!rec) throw new MazeError("NOT_FOUND", `迷宫 #${id} 不存在`);
        const from = parseCoordArg(args[1]);
        const to = parseCoordArg(args[2]);
        const pathCells = findRoute(rec.rows, rec.cols, rec.walls, from, to);
        console.log(`路线长度 ${pathCells.length}：`);
        printJson(pathCells);
        if (args.includes("--ascii")) {
          console.log(renderAscii(rec.rows, rec.cols, rec.walls, routeMarks(pathCells, from, to)));
        }
        break;
      }
      case "validate": {
        // maze validate <id>            重新核验库中迷宫
        // maze validate --file <json>   核验外部墙体文件
        // maze validate --file <json> --route '<json路径数组>'  校验给定路线
        let rows: number, cols: number, walls: Walls;
        const fi = args.indexOf("--file");
        if (fi >= 0) {
          ({ rows, cols, walls } = loadWallsFile(args[fi + 1]));
        } else {
          const rec = store.get(Number(args[0]));
          if (!rec) throw new MazeError("NOT_FOUND", `迷宫 #${args[0]} 不存在`);
          ({ rows, cols, walls } = rec);
        }
        const report = validateMaze(rows, cols, walls);
        printJson(report);
        const ri = args.indexOf("--route");
        if (ri >= 0) {
          const route = JSON.parse(args[ri + 1]) as CellCoord[];
          printJson(validateRoute(rows, cols, walls, route));
        }
        if (!report.ok) process.exitCode = 2;
        break;
      }
      case "list": {
        printJson(store.list());
        break;
      }
      case "export": {
        const id = Number(args[0]);
        const rec = store.get(id);
        if (!rec) throw new MazeError("NOT_FOUND", `迷宫 #${id} 不存在`);
        const dir = path.join(process.cwd(), "exports");
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `maze-${id}.json`);
        fs.writeFileSync(file, JSON.stringify(rec, null, 2), "utf8");
        console.log(`已导出: ${path.resolve(file)}`);
        break;
      }
      case "serve": {
        const pi = args.indexOf("--port");
        const port = pi >= 0 ? Number(args[pi + 1]) : undefined;
        const { port: actual } = await startServer(port);
        console.log(`API 服务已启动: http://127.0.0.1:${actual}`);
        return; // 保持进程运行
      }
      default:
        console.log(`用法:
  maze generate <rows> <cols> <seed> [--ascii]   生成并保存迷宫
  maze show <id> [--format ascii|walls|edges|json]
  maze route <id> <from r,c> <to r,c> [--ascii]  查询两格间路线
  maze validate <id> | --file <json> [--route '<json>']
  maze list                                       历史记录
  maze export <id>                                导出 JSON 到 exports/
  maze serve [--port N]                           启动 API（默认空闲端口）`);
    }
  } finally {
    if (cmd !== "serve") store.close();
  }
}

if (require.main === module) {
  runCli(process.argv.slice(2)).catch((err) => {
    if (err instanceof MazeError) {
      console.error(`错误 [${err.code}]: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  });
}
