// SQLite 持久化（Node 内置 node:sqlite，无原生依赖）。
// 保存尺寸、种子、随机算法版本、墙体与核验报告。
// 重复生成策略：相同 (rows, cols, seed, rngAlgorithm, rngVersion) 直接返回已有记录，
// 不重复插入；旧迷宫记录永不修改，因此默认随机算法将来变化也不影响历史数据。

import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { Maze, Walls } from "./maze";
import { ValidationReport } from "./validate";

export interface MazeRecord {
  id: number;
  rows: number;
  cols: number;
  seed: number;
  rngAlgorithm: string;
  rngVersion: number;
  walls: Walls;
  validation: ValidationReport;
  createdAt: string;
}

export class MazeStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mazes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rows INTEGER NOT NULL,
        cols INTEGER NOT NULL,
        seed INTEGER NOT NULL,
        rng_algorithm TEXT NOT NULL,
        rng_version INTEGER NOT NULL,
        walls TEXT NOT NULL,
        validation TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (rows, cols, seed, rng_algorithm, rng_version)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  // 返回 { record, reused }；reused=true 表示命中重复参数策略，返回旧记录。
  save(maze: Maze, validation: ValidationReport): { record: MazeRecord; reused: boolean } {
    const existing = this.findByParams(maze.rows, maze.cols, maze.seed, maze.rngAlgorithm, maze.rngVersion);
    if (existing) return { record: existing, reused: true };
    const stmt = this.db.prepare(
      `INSERT INTO mazes (rows, cols, seed, rng_algorithm, rng_version, walls, validation)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const result = stmt.run(
      maze.rows,
      maze.cols,
      maze.seed,
      maze.rngAlgorithm,
      maze.rngVersion,
      JSON.stringify(maze.walls),
      JSON.stringify(validation)
    );
    return { record: this.get(Number(result.lastInsertRowid))!, reused: false };
  }

  get(id: number): MazeRecord | null {
    const row = this.db.prepare(`SELECT * FROM mazes WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    return row ? this.toRecord(row) : null;
  }

  findByParams(rows: number, cols: number, seed: number, rngAlgorithm: string, rngVersion: number): MazeRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM mazes WHERE rows = ? AND cols = ? AND seed = ? AND rng_algorithm = ? AND rng_version = ?`
      )
      .get(rows, cols, seed, rngAlgorithm, rngVersion) as Record<string, unknown> | undefined;
    return row ? this.toRecord(row) : null;
  }

  list(limit = 50, offset = 0): MazeRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM mazes ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(limit, offset) as Array<Record<string, unknown>>;
    return rows.map((r) => this.toRecord(r));
  }

  private toRecord(row: Record<string, unknown>): MazeRecord {
    return {
      id: Number(row.id),
      rows: Number(row.rows),
      cols: Number(row.cols),
      seed: Number(row.seed),
      rngAlgorithm: String(row.rng_algorithm),
      rngVersion: Number(row.rng_version),
      walls: JSON.parse(String(row.walls)) as Walls,
      validation: JSON.parse(String(row.validation)) as ValidationReport,
      createdAt: String(row.created_at),
    };
  }
}

export function defaultDbPath(): string {
  return path.join(process.cwd(), "data", "mazes.db");
}
