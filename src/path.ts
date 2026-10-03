// 按最终墙体计算两格之间的路线（BFS 唯一通路），并可校验外部给定路线。

import { DIRS } from './maze.js';
import type { Maze } from './maze.js';

export function validateCell(
  maze: Pick<Maze, 'rows' | 'cols'>,
  r: unknown,
  c: unknown,
  label: string,
): [number, number] {
  if (typeof r !== 'number' || typeof c !== 'number' || !Number.isInteger(r) || !Number.isInteger(c)) {
    throw Object.assign(new Error(`${label} 坐标必须是整数 [row, col]`), { code: 'INVALID_CELL' });
  }
  if (r < 0 || c < 0 || r >= maze.rows || c >= maze.cols) {
    throw Object.assign(
      new Error(`${label} 坐标 (${r},${c}) 越界，尺寸为 ${maze.rows}x${maze.cols}`),
      { code: 'OUT_OF_BOUNDS' },
    );
  }
  return [r, c];
}

// 返回从 start 到 goal 的连续格子坐标；穿墙/不对称墙视为不可通行。
export function findPath(
  maze: Pick<Maze, 'rows' | 'cols' | 'walls'>,
  startInput: unknown,
  goalInput: unknown,
): Array<[number, number]> {
  const start = validateCell(maze, (startInput as [number, number])?.[0], (startInput as [number, number])?.[1], '起点');
  const goal = validateCell(maze, (goalInput as [number, number])?.[0], (goalInput as [number, number])?.[1], '终点');
  const { rows, cols, walls } = maze;
  const prev = new Map<number, number>();
  const startId = start[0] * cols + start[1];
  const goalId = goal[0] * cols + goal[1];
  prev.set(startId, -1);
  const queue: Array<[number, number]> = [start];
  while (queue.length > 0) {
    const [r, c] = queue.shift()!;
    if (r === goal[0] && c === goal[1]) break;
    for (const d of DIRS) {
      const nr = r + d.dr;
      const nc = c + d.dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nid = nr * cols + nc;
      if (prev.has(nid)) continue;
      if (!walls[r][c][d.name] && !walls[nr][nc][d.opposite]) {
        prev.set(nid, r * cols + c);
        queue.push([nr, nc]);
      }
    }
  }
  if (!prev.has(goalId)) {
    throw Object.assign(
      new Error(`(${start[0]},${start[1]}) 与 (${goal[0]},${goal[1]}) 之间不存在沿开通边的通路`),
      { code: 'UNREACHABLE' },
    );
  }
  const path: Array<[number, number]> = [];
  let cur = goalId;
  while (cur !== -1) {
    path.push([Math.floor(cur / cols), cur % cols]);
    const p = prev.get(cur)!;
    cur = p;
  }
  path.reverse();
  return path;
}

// 校验外部给定路线：每一步必须相邻、在界内、且不穿墙。不做任何自动修正。
export function validatePath(
  maze: Pick<Maze, 'rows' | 'cols' | 'walls'>,
  rawPath: unknown,
): { valid: boolean; reason?: string; badStep?: number } {
  if (!Array.isArray(rawPath) || rawPath.length < 1) {
    return { valid: false, reason: '路线必须是非空数组 [[row,col], ...]' };
  }
  const cells: Array<[number, number]> = [];
  for (let i = 0; i < rawPath.length; i++) {
    const item = rawPath[i];
    if (!Array.isArray(item) || item.length !== 2 ||
        typeof item[0] !== 'number' || typeof item[1] !== 'number' ||
        !Number.isInteger(item[0]) || !Number.isInteger(item[1])) {
      return { valid: false, reason: `第 ${i} 个坐标不是整数 [row,col]`, badStep: i };
    }
    const [r, c] = item;
    if (r < 0 || c < 0 || r >= maze.rows || c >= maze.cols) {
      return { valid: false, reason: `第 ${i} 步 (${r},${c}) 越界`, badStep: i };
    }
    cells.push([r, c]);
  }
  for (let i = 1; i < cells.length; i++) {
    const [ar, ac] = cells[i - 1];
    const [br, bc] = cells[i];
    const dr = br - ar;
    const dc = bc - ac;
    if (Math.abs(dr) + Math.abs(dc) !== 1) {
      return { valid: false, reason: `第 ${i} 步与上一格不相邻（不能斜走或跳跃）`, badStep: i };
    }
    const dir = DIRS.find((d) => d.dr === dr && d.dc === dc)!;
    if (maze.walls[ar][ac][dir.name] || maze.walls[br][bc][dir.opposite]) {
      return { valid: false, reason: `第 ${i} 步 (${ar},${ac})->(${br},${bc}) 穿墙`, badStep: i };
    }
  }
  return { valid: true };
}
