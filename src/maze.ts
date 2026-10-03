// 矩形网格迷宫的数据结构、生成（带栈的随机深度优先回溯）与 ASCII 渲染。

import { ALGO_VERSION, SeededRng } from './rng.js';

// 方向顺序是公开且固定的：上、右、下、左。
// 候选邻居先按该几何顺序收集，再用种子化 RNG 在候选中选择。
export const DIRS = [
  { name: 'N', dr: -1, dc: 0, opposite: 'S' },
  { name: 'E', dr: 0, dc: 1, opposite: 'W' },
  { name: 'S', dr: 1, dc: 0, opposite: 'N' },
  { name: 'W', dr: 0, dc: -1, opposite: 'E' },
] as const;

export type DirName = 'N' | 'E' | 'S' | 'W';

export interface CellWalls {
  N: boolean;
  E: boolean;
  S: boolean;
  W: boolean;
}

export interface Maze {
  rows: number;
  cols: number;
  seed: number;
  algorithm: string;
  // walls[r][c] 中 true 表示该面有墙（封闭），false 表示开通。
  walls: CellWalls[][];
  createdAt: string;
}

export const MAX_DIM = 200;

export function validateDimensions(rows: unknown, cols: unknown): { rows: number; cols: number } {
  if (typeof rows !== 'number' || typeof cols !== 'number' ||
      !Number.isInteger(rows) || !Number.isInteger(cols)) {
    throw Object.assign(new Error('rows 与 cols 必须是整数'), { code: 'INVALID_DIMENSIONS' });
  }
  if (rows < 1 || cols < 1 || rows > MAX_DIM || cols > MAX_DIM) {
    throw Object.assign(
      new Error(`rows 与 cols 必须在 1..${MAX_DIM} 之间`),
      { code: 'INVALID_DIMENSIONS' },
    );
  }
  return { rows, cols };
}

export function validateSeed(seed: unknown): number {
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw Object.assign(
      new Error('seed 必须是 0..4294967295 之间的非负整数'),
      { code: 'INVALID_SEED' },
    );
  }
  return seed;
}

export function cellId(r: number, c: number, cols: number): number {
  return r * cols + c;
}

function makeWalls(rows: number, cols: number): CellWalls[][] {
  const walls: CellWalls[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: CellWalls[] = [];
    for (let c = 0; c < cols; c++) {
      row.push({ N: true, E: true, S: true, W: true });
    }
    walls.push(row);
  }
  return walls;
}

// 带栈的随机深度优先回溯：每个格只在首次访问时打通一面墙建立一条新边，
// 没有未访问邻居时弹栈回退。最终得到一棵生成树（任意两格恰有一条通路）。
export function generateMaze(rowsInput: unknown, colsInput: unknown, seedInput: unknown): Maze {
  const { rows, cols } = validateDimensions(rowsInput, colsInput);
  const seed = validateSeed(seedInput);
  const rng = new SeededRng(seed);
  const walls = makeWalls(rows, cols);
  const visited = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));

  const stack: Array<[number, number]> = [[0, 0]];
  visited[0][0] = true;

  while (stack.length > 0) {
    const [r, c] = stack[stack.length - 1];
    const candidates: Array<{ dr: number; dc: number; name: DirName; opposite: DirName }> = [];
    for (const d of DIRS) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc]) {
        candidates.push({ dr: d.dr, dc: d.dc, name: d.name, opposite: d.opposite });
      }
    }
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const choice = candidates[rng.pickIndex(candidates.length)];
    const nr = r + choice.dr;
    const nc = c + choice.dc;
    walls[r][c][choice.name] = false;
    walls[nr][nc][choice.opposite] = false;
    visited[nr][nc] = true;
    stack.push([nr, nc]);
  }

  return {
    rows,
    cols,
    seed,
    algorithm: ALGO_VERSION,
    walls,
    createdAt: new Date().toISOString(),
  };
}

// 开通边列表（无向），按格子与固定方向顺序输出，每条只出现一次（取 N、W 侧）。
export function openEdges(maze: Pick<Maze, 'rows' | 'cols' | 'walls'>): Array<{
  a: [number, number];
  b: [number, number];
  dir: DirName;
}> {
  const edges = [];
  for (let r = 0; r < maze.rows; r++) {
    for (let c = 0; c < maze.cols; c++) {
      if (!maze.walls[r][c].S && r + 1 < maze.rows) {
        edges.push({ a: [r, c] as [number, number], b: [r + 1, c] as [number, number], dir: 'S' as DirName });
      }
      if (!maze.walls[r][c].E && c + 1 < maze.cols) {
        edges.push({ a: [r, c] as [number, number], b: [r, c + 1] as [number, number], dir: 'E' as DirName });
      }
    }
  }
  return edges;
}

// 终端可读 ASCII：
// 一行格子用上下两条字符行表示；'#' 为墙，'.' 为开通，格心用 'o'。
export function toAscii(maze: Pick<Maze, 'rows' | 'cols' | 'walls'>, path?: Array<[number, number]>): string {
  const onPath = new Set<number>();
  if (path) for (const [r, c] of path) onPath.add(cellId(r, c, maze.cols));
  const lines: string[] = [];
  for (let r = 0; r < maze.rows; r++) {
    let mid = '';
    for (let c = 0; c < maze.cols; c++) {
      const w = maze.walls[r][c];
      mid += (c === 0 ? (w.W ? '#' : '.') : '');
      mid += (onPath.has(cellId(r, c, maze.cols)) ? '*' : 'o');
      mid += w.E ? '#' : '.';
    }
    // 顶部墙行
    let wallLine = '#';
    for (let c = 0; c < maze.cols; c++) {
      wallLine += maze.walls[r][c].N ? '##' : '.#';
    }
    lines.push(wallLine);
    lines.push(mid);
  }
  let bottom = '#';
  for (let c = 0; c < maze.cols; c++) bottom += '##';
  lines.push(bottom);
  return lines.join('\n');
}
