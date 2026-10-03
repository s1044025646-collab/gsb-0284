// 路线查询与校验：按最终墙体计算，完整合法迷宫中路线唯一。

import { MazeError, Walls } from "./maze";

export interface CellCoord {
  row: number;
  col: number;
}

export function parseCoord(v: unknown): CellCoord {
  if (
    typeof v !== "object" ||
    v === null ||
    !Number.isInteger((v as Record<string, unknown>).row) ||
    !Number.isInteger((v as Record<string, unknown>).col)
  ) {
    throw new MazeError("INVALID_COORD", "坐标必须是 {row: 整数, col: 整数}");
  }
  return v as CellCoord;
}

export function checkInBounds(rows: number, cols: number, p: CellCoord): void {
  if (p.row < 0 || p.row >= rows || p.col < 0 || p.col >= cols) {
    throw new MazeError("OUT_OF_BOUNDS", `坐标 (${p.row},${p.col}) 越界（网格 ${rows}x${cols}）`);
  }
}

// BFS 求两格间通路；合法完美迷宫中该通路唯一。
export function findRoute(
  rows: number,
  cols: number,
  walls: Walls,
  from: CellCoord,
  to: CellCoord
): CellCoord[] {
  checkInBounds(rows, cols, from);
  checkInBounds(rows, cols, to);
  const prev: (CellCoord | null)[][] = Array.from({ length: rows }, () => new Array<CellCoord | null>(cols).fill(null));
  const seen: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const queue: CellCoord[] = [from];
  seen[from.row][from.col] = true;
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.row === to.row && cur.col === to.col) break;
    const cell = walls[cur.row][cur.col];
    const moves: Array<[boolean, number, number]> = [
      [!cell.n, cur.row - 1, cur.col],
      [!cell.e, cur.row, cur.col + 1],
      [!cell.s, cur.row + 1, cur.col],
      [!cell.w, cur.row, cur.col - 1],
    ];
    for (const [open, nr, nc] of moves) {
      if (open && nr >= 0 && nr < rows && nc >= 0 && nc < cols && !seen[nr][nc]) {
        seen[nr][nc] = true;
        prev[nr][nc] = cur;
        queue.push({ row: nr, col: nc });
      }
    }
  }
  if (!seen[to.row][to.col]) {
    throw new MazeError("NO_ROUTE", `从 (${from.row},${from.col}) 到 (${to.row},${to.col}) 不存在通路`);
  }
  const path: CellCoord[] = [];
  let cur: CellCoord | null = to;
  while (cur) {
    path.push(cur);
    cur = prev[cur.row][cur.col];
  }
  return path.reverse();
}

// 校验用户给定的路线：坐标合法、相邻连续、每一步不穿墙。
export function validateRoute(
  rows: number,
  cols: number,
  walls: Walls,
  path: CellCoord[]
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!Array.isArray(path) || path.length === 0) {
    return { ok: false, issues: ["路线必须是非空坐标数组"] };
  }
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!Number.isInteger(p?.row) || !Number.isInteger(p?.col)) {
      issues.push(`第 ${i} 步坐标非法`);
      continue;
    }
    if (p.row < 0 || p.row >= rows || p.col < 0 || p.col >= cols) {
      issues.push(`第 ${i} 步 (${p.row},${p.col}) 越界`);
      continue;
    }
    if (i === 0) continue;
    const q = path[i - 1];
    const dr = p.row - q.row;
    const dc = p.col - q.col;
    if (Math.abs(dr) + Math.abs(dc) !== 1) {
      issues.push(`第 ${i} 步 (${q.row},${q.col}) -> (${p.row},${p.col}) 不相邻`);
      continue;
    }
    const cell = walls[q.row][q.col];
    const blocked =
      (dr === -1 && cell.n) || (dr === 1 && cell.s) || (dc === -1 && cell.w) || (dc === 1 && cell.e);
    if (blocked) {
      issues.push(`第 ${i} 步 (${q.row},${q.col}) -> (${p.row},${p.col}) 穿墙`);
    }
  }
  return { ok: issues.length === 0, issues };
}
