// HTTP API 服务（Node 内置 http，无外部依赖）。

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateMaze, MazeError, openEdges, RNG_ALGORITHM, RNG_VERSION, Walls } from "./maze";
import { validateMaze } from "./validate";
import { findRoute, validateRoute, CellCoord } from "./route";
import { renderAscii, routeMarks } from "./ascii";
import { MazeStore, defaultDbPath } from "./db";

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function sendError(res: http.ServerResponse, status: number, code: string, message: string): void {
  sendJson(res, status, { error: { code, message } });
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    throw new MazeError("INVALID_JSON", "请求体不是合法 JSON");
  }
}

function parseCoordParam(raw: string | null): CellCoord {
  if (!raw) throw new MazeError("INVALID_COORD", "缺少坐标参数，格式 r,c");
  const m = /^(-?\d+),(-?\d+)$/.exec(raw.trim());
  if (!m) throw new MazeError("INVALID_COORD", `坐标格式应为 r,c，收到 "${raw}"`);
  return { row: Number(m[1]), col: Number(m[2]) };
}

export function createServer(store: MazeStore, exportDir: string): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);

      // POST /api/mazes  {rows, cols, seed}
      if (req.method === "POST" && url.pathname === "/api/mazes") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const rows = Number(body.rows);
        const cols = Number(body.cols);
        const seed = Number(body.seed);
        const maze = generateMaze(rows, cols, seed);
        const report = validateMaze(maze.rows, maze.cols, maze.walls);
        const { record, reused } = store.save(maze, report);
        sendJson(res, reused ? 200 : 201, { ...record, reused });
        return;
      }

      // GET /api/mazes  历史列表
      if (req.method === "GET" && url.pathname === "/api/mazes") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 500);
        const offset = Number(url.searchParams.get("offset") ?? 0) || 0;
        sendJson(res, 200, store.list(limit, offset));
        return;
      }

      // POST /api/validate  {rows, cols, walls}
      if (req.method === "POST" && url.pathname === "/api/validate") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const rows = Number(body.rows);
        const cols = Number(body.cols);
        const report = validateMaze(rows, cols, body.walls as Walls);
        sendJson(res, report.ok ? 200 : 422, report);
        return;
      }

      // POST /api/route/validate  {rows, cols, walls, path}
      if (req.method === "POST" && url.pathname === "/api/route/validate") {
        const body = (await readBody(req)) as Record<string, unknown>;
        const rows = Number(body.rows);
        const cols = Number(body.cols);
        const result = validateRoute(rows, cols, body.walls as Walls, body.path as CellCoord[]);
        sendJson(res, result.ok ? 200 : 422, result);
        return;
      }

      // /api/mazes/:id/...
      if (parts[0] === "api" && parts[1] === "mazes" && parts.length >= 3) {
        const id = Number(parts[2]);
        if (!Number.isInteger(id)) {
          sendError(res, 400, "INVALID_ID", "id 必须是整数");
          return;
        }
        const record = store.get(id);
        if (!record) {
          sendError(res, 404, "NOT_FOUND", `迷宫 #${id} 不存在`);
          return;
        }

        if (req.method === "GET" && parts.length === 3) {
          const format = url.searchParams.get("format") ?? "json";
          if (format === "ascii") {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(renderAscii(record.rows, record.cols, record.walls) + "\n");
          } else if (format === "edges") {
            sendJson(res, 200, { id, openEdges: openEdges(record) });
          } else if (format === "walls") {
            sendJson(res, 200, { id, rows: record.rows, cols: record.cols, walls: record.walls });
          } else {
            sendJson(res, 200, record);
          }
          return;
        }

        // GET /api/mazes/:id/route?from=r,c&to=r,c[&ascii=1]
        if (req.method === "GET" && parts[3] === "route") {
          const from = parseCoordParam(url.searchParams.get("from"));
          const to = parseCoordParam(url.searchParams.get("to"));
          const pathCells = findRoute(record.rows, record.cols, record.walls, from, to);
          if (url.searchParams.get("ascii") === "1") {
            res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(renderAscii(record.rows, record.cols, record.walls, routeMarks(pathCells, from, to)) + "\n");
          } else {
            sendJson(res, 200, { id, from, to, length: pathCells.length, path: pathCells });
          }
          return;
        }

        // GET /api/mazes/:id/validate  重新核验存储的墙体
        if (req.method === "GET" && parts[3] === "validate") {
          const report = validateMaze(record.rows, record.cols, record.walls);
          sendJson(res, report.ok ? 200 : 422, report);
          return;
        }

        // GET /api/mazes/:id/export  导出 JSON 到项目 exports/ 目录
        if (req.method === "GET" && parts[3] === "export") {
          fs.mkdirSync(exportDir, { recursive: true });
          const file = path.join(exportDir, `maze-${record.id}.json`);
          fs.writeFileSync(file, JSON.stringify(record, null, 2), "utf8");
          sendJson(res, 200, { id, file: path.resolve(file) });
          return;
        }
      }

      sendError(res, 404, "NOT_FOUND", `未匹配的路由: ${req.method} ${url.pathname}`);
    } catch (err) {
      if (err instanceof MazeError) {
        const status =
          err.code === "NOT_FOUND" || err.code === "NO_ROUTE" ? 404 : err.code === "OUT_OF_BOUNDS" ? 422 : 400;
        sendError(res, status, err.code, err.message);
      } else {
        sendError(res, 500, "INTERNAL", err instanceof Error ? err.message : String(err));
      }
    }
  });
}

export function startServer(port?: number, dbPath?: string): Promise<{ port: number; close: () => void }> {
  const store = new MazeStore(dbPath ?? defaultDbPath());
  const exportDir = path.join(process.cwd(), "exports");
  const server = createServer(store, exportDir);
  // 默认端口 0：由操作系统分配空闲端口
  const requested = port ?? Number(process.env.PORT ?? 0);
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(requested, "127.0.0.1", () => {
      const addr = server.address();
      const actual = typeof addr === "object" && addr ? addr.port : requested;
      resolve({ port: actual, close: () => server.close() });
    });
  });
}

export { RNG_ALGORITHM, RNG_VERSION };
