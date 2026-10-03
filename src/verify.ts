// 独立核验器：只相信最终墙体，不读取生成时的访问标记。
// 检查：共享墙对称、外边界封闭、全部可达、无向开通边数 = 格数 - 1。

import { CellWalls, DIRS, DirName, Maze } from './maze.js';

export interface BadWall {
  a: [number, number];
  b: [number, number];
  dirA: DirName;
  wallA: boolean;
  wallB: boolean;
  reason: 'asymmetric';
}

export interface BoundaryGap {
  cell: [number, number];
  dir: DirName;
  reason: 'boundary_open';
}

export interface VerifyReport {
  ok: boolean;
  rows: number;
  cols: number;
  cellCount: number;
  openEdgeCount: number;
  expectedEdgeCount: number;
  asymmetricWalls: BadWall[];
  boundaryGaps: BoundaryGap[];
  unreachableCells: Array<[number, number]>;
  extraEdges: number;
  errors: string[];
  checkedAt: string;
}

export function isMazeShape(input: unknown): input is Pick<Maze, 'rows' | 'cols' | 'walls'> {
  if (typeof input !== 'object' || input === null) return false;
  const m = input as Record<string, unknown>;
  if (typeof m.rows !== 'number' || typeof m.cols !== 'number') return false;
  if (!Array.isArray(m.walls) || m.walls.length !== m.rows) return false;
  for (const row of m.walls as unknown[]) {
    if (!Array.isArray(row) || row.length !== m.cols) return false;
    for (const cell of row as unknown[]) {
      if (typeof cell !== 'object' || cell === null) return false;
      for (const d of ['N', 'E', 'S', 'W'] as const) {
        if (typeof (cell as CellWalls)[d] !== 'boolean') return false;
      }
    }
  }
  return true;
}

export function verifyMaze(input: unknown): VerifyReport {
  if (!isMazeShape(input)) {
    throw Object.assign(new Error('墙体结构损坏：需要 {rows, cols, walls: CellWalls[][]}'), {
      code: 'INVALID_STRUCTURE',
    });
  }
  const { rows, cols, walls } = input;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw Object.assign(new Error('非法尺寸：rows 与 cols 必须为正整数'), {
      code: 'INVALID_DIMENSIONS',
    });
  }

  const asymmetricWalls: BadWall[] = [];
  const boundaryGaps: BoundaryGap[] = [];
  let openEdgeCount = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const w = walls[r][c];
      for (const d of DIRS) {
        const nr = r + d.dr;
        const nc = c + d.dc;
        const outside = nr < 0 || nr >= rows || nc < 0 || nc >= cols;
        if (outside) {
          if (!w[d.name]) {
            boundaryGaps.push({ cell: [r, c], dir: d.name, reason: 'boundary_open' });
          }
          continue;
        }
        const other = walls[nr][nc][d.opposite as DirName];
        // 每条内部无向边只从一侧计数（N 与 W 侧），避免重复。
        if ((d.name === 'S' || d.name === 'E') && !w[d.name]) openEdgeCount++;
        if (w[d.name] !== other) {
          // 去重：只记录一侧（S、E 侧），避免同一坏墙报两次。
          if (d.name === 'S' || d.name === 'E') {
            asymmetricWalls.push({
              a: [r, c],
              b: [nr, nc],
              dirA: d.name,
              wallA: w[d.name],
              wallB: other,
              reason: 'asymmetric',
            });
          }
        }
      }
    }
  }

  // 从 (0,0) 按“双方都无墙”的对称开通边重新构图并 BFS。
  const reachable = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const queue: Array<[number, number]> = [[0, 0]];
  reachable[0][0] = true;
  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    for (const d of DIRS) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (reachable[nr][nc]) continue;
      if (!walls[r][c][d.name] && !walls[nr][nc][d.opposite as DirName]) {
        reachable[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }

  const unreachableCells: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!reachable[r][c]) unreachableCells.push([r, c]);
    }
  }

  const cellCount = rows * cols;
  const expectedEdgeCount = cellCount - 1;
  const errors: string[] = [];
  if (asymmetricWalls.length > 0) {
    errors.push(`存在 ${asymmetricWalls.length} 处不对称共享墙`);
  }
  if (boundaryGaps.length > 0) {
    errors.push(`存在 ${boundaryGaps.length} 处外边界缺口`);
  }
  if (unreachableCells.length > 0) {
    errors.push(`存在 ${unreachableCells.length} 个不可达格`);
  }
  if (openEdgeCount !== expectedEdgeCount) {
    errors.push(`开通边数 ${openEdgeCount} 不等于 格数-1 (${expectedEdgeCount})，可能存在环或断裂`);
  }

  return {
    ok: errors.length === 0,
    rows,
    cols,
    cellCount,
    openEdgeCount,
    expectedEdgeCount,
    asymmetricWalls,
    boundaryGaps,
    unreachableCells,
    extraEdges: openEdgeCount - expectedEdgeCount,
    errors,
    checkedAt: new Date().toISOString(),
  };
}
