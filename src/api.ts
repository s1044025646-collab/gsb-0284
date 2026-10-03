// 纯 HTTP JSON API（无第三方框架）。端口可配置，默认自动选择空闲端口。

import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { MazeService } from './service.js';
import { MazeStore } from './store.js';

interface ApiError extends Error {
  code?: string;
  statusCode?: number;
  details?: unknown;
}

const STATUS_BY_CODE: Record<string, number> = {
  INVALID_DIMENSIONS: 400,
  INVALID_SEED: 400,
  INVALID_CELL: 400,
  INVALID_STRUCTURE: 400,
  OUT_OF_BOUNDS: 400,
  UNREACHABLE: 422,
  NOT_FOUND: 404,
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { code: 'INVALID_JSON', statusCode: 400 });
  }
}

export function createApiServer(service: MazeService): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      const method = req.method ?? 'GET';

      if (method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'POST' && pathname === '/mazes') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const stored = service.generate(body.rows, body.cols, body.seed as unknown);
        sendJson(res, stored.regenerated ? 200 : 201, {
          id: stored.id,
          rows: stored.rows,
          cols: stored.cols,
          seed: stored.seed,
          algorithm: stored.algorithm,
          reused: stored.regenerated,
          verify: { ok: stored.report.ok, openEdgeCount: stored.report.openEdgeCount },
          createdAt: stored.createdAt,
        });
        return;
      }

      const detail = pathname.match(/^\/mazes\/(\d+)$/);
      if (method === 'GET' && detail) {
        sendJson(res, 200, service.exportJson(Number(detail[1])));
        return;
      }

      const wallsMatch = pathname.match(/^\/mazes\/(\d+)\/walls$/);
      if (method === 'GET' && wallsMatch) {
        sendJson(res, 200, service.walls(Number(wallsMatch[1])));
        return;
      }

      const edgesMatch = pathname.match(/^\/mazes\/(\d+)\/edges$/);
      if (method === 'GET' && edgesMatch) {
        sendJson(res, 200, service.edges(Number(edgesMatch[1])));
        return;
      }

      const asciiMatch = pathname.match(/^\/mazes\/(\d+)\/ascii$/);
      if (method === 'GET' && asciiMatch) {
        const text = service.ascii(Number(asciiMatch[1]));
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(text);
        return;
      }

      const pathMatch = pathname.match(/^\/mazes\/(\d+)\/path$/);
      if (method === 'POST' && pathMatch) {
        const body = (await readJson(req)) as Record<string, unknown>;
        sendJson(res, 200, service.path(Number(pathMatch[1]), body.start, body.goal));
        return;
      }

      const validateMatch = pathname.match(/^\/mazes\/(\d+)\/validate-route$/);
      if (method === 'POST' && validateMatch) {
        const body = (await readJson(req)) as Record<string, unknown>;
        sendJson(res, 200, service.validateRoute(Number(validateMatch[1]), body.path));
        return;
      }

      if (method === 'POST' && pathname === '/verify') {
        const body = (await readJson(req)) as Record<string, unknown>;
        sendJson(res, 200, service.verify(body));
        return;
      }

      if (method === 'GET' && pathname === '/history') {
        const limit = Number(url.searchParams.get('limit') ?? '50');
        sendJson(res, 200, service.history(Number.isFinite(limit) ? limit : 50));
        return;
      }

      sendJson(res, 404, { error: 'NOT_FOUND', message: `无此路由: ${method} ${pathname}` });
    } catch (err) {
      const e = err as ApiError;
      const code = e.code ?? 'INTERNAL';
      const status = e.statusCode ?? STATUS_BY_CODE[code ?? ''] ?? 500;
      sendJson(res, status, {
        error: code,
        message: e.message,
        ...(e.details ? { details: e.details } : {}),
        ...((err as { report?: unknown }).report ? { report: (err as { report: unknown }).report } : {}),
      });
    }
  });
}

// 默认端口 0 = 由操作系统分配空闲端口；也可用 PORT 环境变量固定。
export function startServer(): void {
  const dbPath = process.env.MAZE_DB ?? join(process.cwd(), 'data', 'mazes.sqlite');
  const store = new MazeStore(dbPath);
  const service = new MazeService(store);
  const server = createApiServer(service);
  const port = Number(process.env.PORT ?? '0');
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const actual = typeof address === 'object' && address ? address.port : port;
    console.log(JSON.stringify({
      msg: '迷宫服务已启动',
      baseUrl: `http://127.0.0.1:${actual}`,
      db: dbPath,
    }));
  });

  const shutdown = () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
