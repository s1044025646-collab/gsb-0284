// 业务编排：生成、查询、路线、核验。

import { generateMaze, openEdges, toAscii, Maze } from './maze.js';
import { findPath, validatePath } from './path.js';
import { MazeStore, StoredMaze } from './store.js';
import { verifyMaze } from './verify.js';

export class MazeService {
  constructor(private store: MazeStore) {}

  generate(rows: unknown, cols: unknown, seed: unknown): StoredMaze {
    const maze = generateMaze(rows, cols, seed);
    const report = verifyMaze(maze);
    if (!report.ok) {
      throw Object.assign(new Error('内部错误：生成的迷宫未通过核验'), {
        code: 'GENERATION_VERIFY_FAILED',
        report,
      });
    }
    return this.store.upsert(maze, report);
  }

  getOrThrow(id: number): StoredMaze {
    const stored = this.store.get(id);
    if (!stored) {
      throw Object.assign(new Error(`迷宫 id=${id} 不存在`), { code: 'NOT_FOUND' });
    }
    return stored;
  }

  asMaze(stored: StoredMaze): Maze {
    return {
      rows: stored.rows,
      cols: stored.cols,
      seed: stored.seed,
      algorithm: stored.algorithm,
      walls: stored.walls,
      createdAt: stored.createdAt,
    };
  }

  walls(id: number) {
    const stored = this.getOrThrow(id);
    return { id, rows: stored.rows, cols: stored.cols, walls: stored.walls };
  }

  edges(id: number) {
    const stored = this.getOrThrow(id);
    return {
      id,
      rows: stored.rows,
      cols: stored.cols,
      openEdges: openEdges(this.asMaze(stored)),
    };
  }

  ascii(id: number, path?: Array<[number, number]>) {
    const stored = this.getOrThrow(id);
    return toAscii(this.asMaze(stored), path);
  }

  path(id: number, start: unknown, goal: unknown) {
    const stored = this.getOrThrow(id);
    const maze = this.asMaze(stored);
    const route = findPath(maze, start, goal);
    return { id, path: route, ascii: toAscii(maze, route) };
  }

  validateRoute(id: number, route: unknown) {
    const stored = this.getOrThrow(id);
    return { id, ...validatePath(this.asMaze(stored), route) };
  }

  // 对数据库内迷宫，或调用方提交（可能被手工改过）的墙体做独立核验。
  verify(payload: { id?: number; rows?: number; cols?: number; walls?: unknown }) {
    if (payload.walls !== undefined) {
      return { report: verifyMaze({ rows: payload.rows, cols: payload.cols, walls: payload.walls }) };
    }
    if (payload.id !== undefined) {
      const stored = this.getOrThrow(payload.id);
      return { id: stored.id, report: verifyMaze(this.asMaze(stored)) };
    }
    throw Object.assign(new Error('核验需要 id 或 {rows, cols, walls}'), { code: 'MISSING_PARAM' });
  }

  history(limit?: number) {
    return this.store.list(limit);
  }

  exportJson(id: number) {
    const stored = this.getOrThrow(id);
    return {
      id: stored.id,
      rows: stored.rows,
      cols: stored.cols,
      seed: stored.seed,
      algorithm: stored.algorithm,
      walls: stored.walls,
      openEdges: openEdges(this.asMaze(stored)),
      ascii: toAscii(this.asMaze(stored)),
      verifyReport: stored.report,
      createdAt: stored.createdAt,
    };
  }
}
