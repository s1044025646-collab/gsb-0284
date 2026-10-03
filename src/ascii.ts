// ASCII 渲染：每格 3 字符宽，墙用 +--- 与 | 表示，通路留空。
// 可选地在通路格内标注起终点 S/E 或路线字符 *。

import { Walls } from "./maze";
import { CellCoord } from "./route";

export function renderAscii(
  rows: number,
  cols: number,
  walls: Walls,
  marks?: Map<string, string>
): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let top = "";
    let mid = "";
    for (let c = 0; c < cols; c++) {
      const cell = walls[r][c];
      top += "+";
      top += cell.n ? "---" : "   ";
      mid += cell.w ? "|" : " ";
      const mark = marks?.get(`${r},${c}`);
      mid += mark ? ` ${mark} ` : "   ";
    }
    top += "+";
    mid += walls[r][cols - 1].e ? "|" : " ";
    lines.push(top, mid);
  }
  let bottom = "";
  for (let c = 0; c < cols; c++) {
    bottom += "+";
    bottom += walls[rows - 1][c].s ? "---" : "   ";
  }
  bottom += "+";
  lines.push(bottom);
  return lines.join("\n");
}

export function routeMarks(path: CellCoord[], start?: CellCoord, end?: CellCoord): Map<string, string> {
  const marks = new Map<string, string>();
  for (const p of path) marks.set(`${p.row},${p.col}`, "*");
  if (start) marks.set(`${start.row},${start.col}`, "S");
  if (end) marks.set(`${end.row},${end.col}`, "E");
  return marks;
}
