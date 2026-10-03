// 迷宫核心类型与完美迷宫生成器（随机 DFS 回溯 + mulberry32 种子化伪随机）

export const RNG_ALGORITHM = "mulberry32-v1";
export const RNG_VERSION = 1;

export interface CellWalls {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

export type Walls = CellWalls[][]; // walls[row][col]

export interface Maze {
  rows: number;
  cols: number;
  seed: number;
  rngAlgorithm: string;
  rngVersion: number;
  walls: Walls;
}

export interface OpenEdge {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

// mulberry32：公开、固定的 32 位种子化伪随机数生成器。
// 每次调用返回 [0,1) 的浮点数，内部状态随之推进。
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 邻居候选的固定基础次序：上、右、下、左（N, E, S, W）。
// 每次选择前对候选数组做 Fisher-Yates 洗牌（使用种子化 PRNG），
// 然后按洗牌后的次序挑选第一个尚未访问的邻居。
export const DIRS: ReadonlyArray<{ dr: number; dc: number; wall: keyof CellWalls; opp: keyof CellWalls }> = [
  { dr: -1, dc: 0, wall: "n", opp: "s" },
  { dr: 0, dc: 1, wall: "e", opp: "w" },
  { dr: 1, dc: 0, wall: "s", opp: "n" },
  { dr: 0, dc: -1, wall: "w", opp: "e" },
];

export class MazeError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function validateDimensions(rows: number, cols: number): void {
  if (!Number.isInteger(rows) || !Number.isInteger(cols)) {
    throw new MazeError("INVALID_DIMENSIONS", "行数和列数必须是整数");
  }
  if (rows < 1 || cols < 1) {
    throw new MazeError("INVALID_DIMENSIONS", "行数和列数必须 >= 1");
  }
  if (rows > 1000 || cols > 1000 || rows * cols > 1_000_000) {
    throw new MazeError("INVALID_DIMENSIONS", "网格过大（上限 1000x1000 且总格数 <= 1,000,000）");
  }
}

// 带栈的随机深度优先回溯生成网格图生成树。
// 同一 (rows, cols, seed) 永远产生相同墙体。
export function generateMaze(rows: number, cols: number, seed: number): Maze {
  validateDimensions(rows, cols);
  if (!Number.isInteger(seed)) {
    throw new MazeError("INVALID_SEED", "种子必须是整数");
  }

  const walls: Walls = [];
  for (let r = 0; r < rows; r++) {
    const row: CellWalls[] = [];
    for (let c = 0; c < cols; c++) row.push({ n: true, e: true, s: true, w: true });
    walls.push(row);
  }

  const visited: boolean[][] = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  const rand = mulberry32(seed);
  const stack: Array<[number, number]> = [[0, 0]];
  visited[0][0] = true;

  while (stack.length > 0) {
    const [r, c] = stack[stack.length - 1];
    // 收集未访问邻居，基础次序 N,E,S,W，再 Fisher-Yates 洗牌
    const candidates = DIRS.filter((d) => {
      const nr = r + d.dr;
      const nc = c + d.dc;
      return nr >= 0 && nr < rows && nc >= 0 && nc < cols && !visited[nr][nc];
    });
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }
    const d = candidates[0];
    const nr = r + d.dr;
    const nc = c + d.dc;
    walls[r][c][d.wall] = false;
    walls[nr][nc][d.opp] = false;
    visited[nr][nc] = true;
    stack.push([nr, nc]);
  }

  return { rows, cols, seed, rngAlgorithm: RNG_ALGORITHM, rngVersion: RNG_VERSION, walls };
}

// 从最终墙体重新构图，列出所有开通边（每对相邻格只列一次）。
export function openEdges(maze: { rows: number; cols: number; walls: Walls }): OpenEdge[] {
  const edges: OpenEdge[] = [];
  for (let r = 0; r < maze.rows; r++) {
    for (let c = 0; c < maze.cols; c++) {
      const w = maze.walls[r][c];
      if (!w.e && c + 1 < maze.cols) edges.push({ r1: r, c1: c, r2: r, c2: c + 1 });
      if (!w.s && r + 1 < maze.rows) edges.push({ r1: r, c1: c, r2: r + 1, c2: c });
    }
  }
  return edges;
}
