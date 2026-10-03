// 命令行界面。所有数据落在项目内 data/ 目录，离线运行。

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MazeService } from './service.js';
import { MazeStore } from './store.js';

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags.set(key, 'true');
      } else {
        flags.set(key, next);
        i++;
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function num(flags: Map<string, string>, key: string): number {
  const raw = flags.get(key);
  if (raw === undefined) {
    throw Object.assign(new Error(`缺少必填参数 --${key}`), { code: 'MISSING_PARAM' });
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw Object.assign(new Error(`--${key} 必须是数字，收到: ${raw}`), { code: 'INVALID_PARAM' });
  }
  return value;
}

function parseCell(raw: string | undefined, label: string): [number, number] {
  if (!raw || !/^-?\d+,-?\d+$/.test(raw)) {
    throw Object.assign(new Error(`${label} 格式应为 row,col，收到: ${raw}`), {
      code: 'INVALID_CELL',
    });
  }
  const [r, c] = raw.split(',').map(Number);
  return [r, c];
}

const HELP = `
完美迷宫 CLI（离线，SQLite 持久化）

用法:
  maze generate --rows R --cols C --seed S [--json]
  maze walls <id>
  maze edges <id>
  maze ascii <id>
  maze path <id> --from r,c --to r,c
  maze validate-route <id> --path "[[0,0],[0,1]]"
  maze verify --id <id>
  maze verify --file walls.json     # 文件形如 {"rows":R,"cols":C,"walls":[[...]]}
  maze history [--limit N]
  maze export <id> [--out path.json]
  maze demo
  maze help

数据库: 环境变量 MAZE_DB 可覆盖，默认 ./data/mazes.sqlite
`;

export function runCli(argv: string[]): void {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0] ?? 'help';
  const dbPath = process.env.MAZE_DB ?? join(process.cwd(), 'data', 'mazes.sqlite');
  const store = new MazeStore(dbPath);
  const service = new MazeService(store);

  try {
    switch (command) {
      case 'generate': {
        const stored = service.generate(
          num(flags, 'rows'),
          num(flags, 'cols'),
          num(flags, 'seed'),
        );
        if (flags.has('json')) {
          console.log(JSON.stringify(service.exportJson(stored.id), null, 2));
        } else {
          console.log(
            `迷宫${stored.regenerated ? '（命中已有记录，未重复入库）' : ''} id=${stored.id} ` +
              `${stored.rows}x${stored.cols} seed=${stored.seed} algo=${stored.algorithm}`,
          );
          console.log(service.ascii(stored.id));
        }
        break;
      }
      case 'walls': {
        console.log(JSON.stringify(service.walls(Number(positional[1])), null, 2));
        break;
      }
      case 'edges': {
        console.log(JSON.stringify(service.edges(Number(positional[1])), null, 2));
        break;
      }
      case 'ascii': {
        console.log(service.ascii(Number(positional[1])));
        break;
      }
      case 'path': {
        const result = service.path(
          Number(positional[1]),
          parseCell(flags.get('from'), '--from'),
          parseCell(flags.get('to'), '--to'),
        );
        console.log(result.path.map(([r, c]) => `(${r},${c})`).join(' -> '));
        if (!flags.has('quiet')) console.log('\n' + result.ascii);
        break;
      }
      case 'validate-route': {
        let parsed: unknown;
        try {
          parsed = JSON.parse(flags.get('path') ?? '');
        } catch {
          throw Object.assign(new Error('--path 必须是合法 JSON 数组'), { code: 'INVALID_PARAM' });
        }
        const result = service.validateRoute(Number(positional[1]), parsed);
        console.log(JSON.stringify(result, null, 2));
        if (!result.valid) process.exitCode = 1;
        break;
      }
      case 'verify': {
        const result = flags.has('file')
          ? service.verify(JSON.parse(readFileSync(flags.get('file')!, 'utf-8')))
          : service.verify({ id: Number(flags.get('id') ?? positional[1]) });
        console.log(JSON.stringify(result.report, null, 2));
        if (!result.report.ok) process.exitCode = 1;
        break;
      }
      case 'history': {
        console.log(JSON.stringify(service.history(Number(flags.get('limit') ?? '50')), null, 2));
        break;
      }
      case 'export': {
        const data = service.exportJson(Number(positional[1]));
        const json = JSON.stringify(data, null, 2);
        const out = flags.get('out');
        if (out) {
          writeFileSync(out, json, 'utf-8');
          console.log(`已导出到 ${out}`);
        } else {
          console.log(json);
        }
        break;
      }
      case 'demo': {
        runDemo(service);
        break;
      }
      case 'help':
      case '--help':
      case '-h':
      default:
        console.log(HELP);
    }
  } catch (err) {
    const e = err as Error & { code?: string };
    console.error(`错误 [${e.code ?? 'INTERNAL'}]: ${e.message}`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

// 演示：生成 -> 查路径 -> 手工改坏一面墙 -> 核验定位问题。
function runDemo(service: MazeService): void {
  const stored = service.generate(6, 8, 20261003);
  console.log(`== 1) 生成 6x8 seed=20261003，id=${stored.id} ==`);
  console.log(service.ascii(stored.id));

  console.log('\n== 2) 查询 (0,0) 到 (5,7) 的唯一通路 ==');
  const route = service.path(stored.id, [0, 0], [5, 7]);
  console.log(route.path.map(([r, c]) => `(${r},${c})`).join(' -> '));

  console.log('\n== 3) 手工改坏一面墙：把 (0,0) 的北墙（外边界）打通 ==');
  const exported = service.exportJson(stored.id);
  const broken = structuredClone(exported);
  broken.walls[0][0].N = false;
  const report = service.verify(broken);
  console.log('核验 ok =', report.report.ok);
  console.log('问题明细:', JSON.stringify(report.report.boundaryGaps, null, 2));

  const examplePath = join(process.cwd(), 'examples', 'demo-broken-walls.json');
  writeFileSync(examplePath, JSON.stringify(broken, null, 2), 'utf-8');
  console.log(`坏墙样例已保存: ${examplePath}（可用 verify --file 复核）`);
}
