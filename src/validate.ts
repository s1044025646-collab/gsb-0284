// 独立核验器：只从最终墙体重新构图，不信任任何生成期标记。

import { Walls, openEdges } from "./maze";

export interface ValidationIssue {
  code:
    | "MALFORMED_STRUCTURE"
    | "ASYMMETRIC_WALL"
    | "OPEN_BOUNDARY"
    | "UNREACHABLE_CELL"
    | "EDGE_COUNT_MISMATCH";
  message: string;
  row?: number;
  col?: number;
  row2?: number;
  col2?: number;
  side?: string;
}

export interface ValidationReport {
  ok: boolean;
  rows: number;
  cols: number;
  cellCount: number;
  openEdgeCount: number;
  expectedOpenEdges: number;
  reachableCount: number;
  issues: ValidationIssue[];
}

function isBool(v: unknown): v is boolean {
  return typeof v === "boolean";
}

// 严格校验墙体结构；结构损坏时报告，不做任何静默修正。
export function checkStructure(rows: number, cols: number, walls: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    issues.push({ code: "MALFORMED_STRUCTURE", message: `非法尺寸 rows=${rows} cols=${cols}` });
    return issues;
  }
  if (!Array.isArray(walls) || walls.length !== rows) {
    issues.push({ code: "MALFORMED_STRUCTURE", message: "walls 必须是长度等于行数的数组" });
    return issues;
  }
  for (let r = 0; r < rows; r++) {
    const row = walls[r];
    if (!Array.isArray(row) || row.length !== cols) {
      issues.push({ code: "MALFORMED_STRUCTURE", message: `第 ${r} 行不是长度 ${cols} 的数组`, row: r });
      continue;
    }
    for (let c = 0; c < cols; c++) {
      const cell = row[c];
      if (
        typeof cell !== "object" ||
        cell === null ||
        !isBool((cell as Record<string, unknown>).n) ||
        !isBool((cell as Record<string, unknown>).e) ||
        !isBool((cell as Record<string, unknown>).s) ||
        !isBool((cell as Record<string, unknown>).w)
      ) {
        issues.push({
          code: "MALFORMED_STRUCTURE",
          message: `格子 (${r},${c}) 的墙体必须是 {n,e,s,w} 布尔值`,
          row: r,
          col: c,
        });
      }
    }
  }
  return issues;
}

export function validateMaze(rows: number, cols: number, walls: Walls): ValidationReport {
  const issues: ValidationIssue[] = [];

  const structural = checkStructure(rows, cols, walls);
  if (structural.length > 0) {
    return {
      ok: false,
      rows,
      cols,
      cellCount: 0,
      openEdgeCount: 0,
      expectedOpenEdges: 0,
      reachableCount: 0,
      issues: structural,
    };
  }

  // 1. 相邻格共享墙对称
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = walls[r][c];
      if (c + 1 < cols && cell.e !== walls[r][c + 1].w) {
        issues.push({
          code: "ASYMMETRIC_WALL",
          message: `格子 (${r},${c}).e=${cell.e} 与 (${r},${c + 1}).w=${walls[r][c + 1].w} 不对称`,
          row: r,
          col: c,
          row2: r,
          col2: c + 1,
          side: "e/w",
        });
      }
      if (r + 1 < rows && cell.s !== walls[r + 1][c].n) {
        issues.push({
          code: "ASYMMETRIC_WALL",
          message: `格子 (${r},${c}).s=${cell.s} 与 (${r + 1},${c}).n=${walls[r + 1][c].n} 不对称`,
          row: r,
          col: c,
          row2: r + 1,
          col2: c,
          side: "s/n",
        });
      }
    }
  }

  // 2. 外边界封闭
  for (let c = 0; c < cols; c++) {
    if (!walls[0][c].n) issues.push({ code: "OPEN_BOUNDARY", message: `上边界 (${0},${c}).n 未封闭`, row: 0, col: c, side: "n" });
    if (!walls[rows - 1][c].s)
      issues.push({ code: "OPEN_BOUNDARY", message: `下边界 (${rows - 1},${c}).s 未封闭`, row: rows - 1, col: c, side: "s" });
  }
  for (let r = 0; r < rows; r++) {
    if (!walls[r][0].w) issues.push({ code: "OPEN_BOUNDARY", message: `左边界 (${r},${0}).w 未封闭`, row: r, col: 0, side: "w" });
    if (!walls[r][cols - 1].e)
      issues.push({ code: "OPEN_BOUNDARY", message: `右边界 (${r},${cols - 1}).e 未封闭`, row: r, col: cols - 1, side: "e" });
  }

  // 3. 从最终墙体重新构图，BFS 统计可达格
  const seen: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const queue: Array<[number, number]> = [[0, 0]];
  seen[0][0] = true;
  let reachable = 0;
  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    reachable++;
    const cell = walls[r][c];
    const moves: Array<[boolean, number, number]> = [
      [!cell.n, r - 1, c],
      [!cell.e, r, c + 1],
      [!cell.s, r + 1, c],
      [!cell.w, r, c - 1],
    ];
    for (const [open, nr, nc] of moves) {
      if (open && nr >= 0 && nr < rows && nc >= 0 && nc < cols && !seen[nr][nc]) {
        seen[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!seen[r][c]) {
        issues.push({ code: "UNREACHABLE_CELL", message: `格子 (${r},${c}) 不可达`, row: r, col: c });
      }
    }
  }

  // 4. 无向开通边数必须等于格数减一（树）
  const edgeCount = openEdges({ rows, cols, walls }).length;
  const expected = rows * cols - 1;
  if (edgeCount !== expected) {
    issues.push({
      code: "EDGE_COUNT_MISMATCH",
      message: `开通边数 ${edgeCount} != 格数-1 ${expected}（存在闭环或断裂）`,
    });
  }

  return {
    ok: issues.length === 0,
    rows,
    cols,
    cellCount: rows * cols,
    openEdgeCount: edgeCount,
    expectedOpenEdges: expected,
    reachableCount: reachable,
    issues,
  };
}
