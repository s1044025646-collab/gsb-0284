// SQLite 持久层（Node 内置 node:sqlite，无需原生编译）。
// 同参数（rows, cols, seed, algorithm）重复生成：返回已有记录，不新增行。

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Maze } from './maze.js';
import { VerifyReport } from './verify.js';

export interface StoredMaze {
  id: number;
  rows: number;
  cols: number;
  seed: number;
  algorithm: string;
  walls: Maze['walls'];
  report: VerifyReport;
  createdAt: string;
  regenerated: boolean;
}

export class MazeStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mazes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rows INTEGER NOT NULL,
        cols INTEGER NOT NULL,
        seed INTEGER NOT NULL,
        algorithm TEXT NOT NULL,
        walls_json TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(rows, cols, seed, algorithm)
      );
    `);
  }

  // 插入或按同参数取回已有迷宫。
  upsert(maze: Maze, report: VerifyReport): StoredMaze {
    const wallsJson = JSON.stringify(maze.walls);
    const reportJson = JSON.stringify(report);
    const existing = this.db.prepare(
      'SELECT id FROM mazes WHERE rows=? AND cols=? AND seed=? AND algorithm=?',
    ).get(maze.rows, maze.cols, maze.seed, maze.algorithm) as Record<string, unknown> | undefined;
    this.db.prepare(`
      INSERT INTO mazes (rows, cols, seed, algorithm, walls_json, report_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rows, cols, seed, algorithm) DO NOTHING
    `).run(maze.rows, maze.cols, maze.seed, maze.algorithm, wallsJson, reportJson, maze.createdAt);
    const row = this.db.prepare(
      'SELECT * FROM mazes WHERE rows=? AND cols=? AND seed=? AND algorithm=?',
    ).get(maze.rows, maze.cols, maze.seed, maze.algorithm) as Record<string, unknown>;
    return this.hydrate(row, existing !== undefined);
  }

  get(id: number): StoredMaze | null {
    const row = this.db.prepare('SELECT * FROM mazes WHERE id=?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.hydrate(row, false) : null;
  }

  list(limit = 50): StoredMaze[] {
    const rows = this.db.prepare('SELECT * FROM mazes ORDER BY id DESC LIMIT ?').all(limit) as
      Record<string, unknown>[];
    return rows.map((r) => this.hydrate(r, false));
  }

  close(): void {
    this.db.close();
  }

  private hydrate(row: Record<string, unknown>, regenerated: boolean): StoredMaze {
    return {
      id: row.id as number,
      rows: row.rows as number,
      cols: row.cols as number,
      seed: row.seed as number,
      algorithm: row.algorithm as string,
      walls: JSON.parse(row.walls_json as string) as Maze['walls'],
      report: JSON.parse(row.report_json as string) as VerifyReport,
      createdAt: row.created_at as string,
      regenerated,
    };
  }
}
