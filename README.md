# 完美迷宫生成与墙体连通核验后端

离线矩形网格完美迷宫服务：TypeScript + Node.js + SQLite（Node 内置 `node:sqlite`，无原生依赖、无外部在线服务）。只提供 HTTP API 与 CLI，不含网页、游戏界面、推箱子或排行榜。

## 环境要求

- Windows 本地运行，Node.js >= 22.5（`node:sqlite` 内置模块；开发环境为 Node 25）
- 不依赖 Docker / WSL / 付费服务 / 外部 API

## 快速开始

```powershell
npm install
npm run build     # 编译 TypeScript 到 dist/
npm test          # 编译并运行全部测试
npm start         # 启动 API 服务（默认自动选择空闲端口）
npm run demo      # 演示：生成 -> 查询路径 -> 改坏一面墙 -> 核验定位
```

## 核心算法（公开且固定）

- **生成**：带栈的随机深度优先回溯（randomized DFS backtracker），从 `(0,0)` 出发，每次仅从当前格的**未访问**邻居中选择一个，打通双方对应墙并前进；无可选邻格时回退。每格只在首次访问时建立一条新边，结果必为网格图的生成树（任意两格恰有一条通路）。
- **邻居候选次序**：固定基础次序 上、右、下、左（N, E, S, W），选择前用 Fisher-Yates 洗牌。
- **伪随机源**：`mulberry32`（32 位种子，算法标识 `mulberry32-v1`，版本 `1`）。不使用 `Math.random`。同一 `(rows, cols, seed)` 永远产生相同墙体。
- **入口/出口**：以起终点格子坐标表示，外边界始终保持封闭。

### 可重现性 ≠ 随机均匀性

本服务保证**可重现性**（同尺寸同种子结果相同），但随机 DFS 回溯**不会均匀抽取所有生成树**（它偏向长通道、少分岔的迷宫）。请勿将其输出当作均匀随机生成树用于统计目的。

## 数据与重复生成策略

- SQLite 数据库位于项目内 `data/mazes.db`，导出文件在 `exports/`，演示样例在 `samples/`。服务重启后历史迷宫仍可查询。
- 每条记录保存：尺寸、种子、随机算法名与版本、墙体 JSON、核验报告、创建时间。
- **重复生成策略**：相同 `(rows, cols, seed, rngAlgorithm, rngVersion)` 直接返回已有记录（`reused: true`），不插入新行；旧记录永不修改，因此将来默认随机算法升级也不会改变已保存的迷宫。

## CLI

```powershell
node dist/cli.js generate 8 12 42 --ascii        # 生成并保存（重复参数复用旧记录）
node dist/cli.js show 1 --format ascii           # 查看（ascii|walls|edges|json）
node dist/cli.js route 1 0,0 7,11 --ascii        # 查询两格间路线（按最终墙体计算）
node dist/cli.js validate 1                      # 重新核验库中迷宫
node dist/cli.js validate --file samples/broken-maze.json   # 核验外部墙体文件
node dist/cli.js validate 1 --route "[{""row"":0,""col"":0}]" # 校验给定路线
node dist/cli.js list                            # 历史记录
node dist/cli.js export 1                        # 导出 JSON 到 exports/
node dist/cli.js serve --port 8080               # 指定端口（缺省为空闲端口）
```

## HTTP API

默认监听 `127.0.0.1` 的空闲端口（可用 `--port` 或环境变量 `PORT` 指定）。错误统一返回 `{"error":{"code","message"}}`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/mazes` | 生成 `{rows, cols, seed}`；重复参数返回旧记录（`reused: true`） |
| GET | `/api/mazes` | 历史列表（`limit`/`offset`） |
| GET | `/api/mazes/:id` | 详情；`?format=walls\|edges\|ascii\|json` |
| GET | `/api/mazes/:id/route?from=r,c&to=r,c` | 两格间路线（`&ascii=1` 返回标注图） |
| GET | `/api/mazes/:id/validate` | 重新核验存储的墙体 |
| GET | `/api/mazes/:id/export` | 导出 JSON 到 `exports/` |
| POST | `/api/validate` | 核验外部墙体 `{rows, cols, walls}` |
| POST | `/api/route/validate` | 校验给定路线 `{rows, cols, walls, path}` |

**错误码**：`INVALID_DIMENSIONS`、`INVALID_SEED`、`INVALID_COORD`、`INVALID_JSON`、`OUT_OF_BOUNDS`、`NO_ROUTE`、`NOT_FOUND`、`INTERNAL`。核验问题码：`MALFORMED_STRUCTURE`、`ASYMMETRIC_WALL`、`OPEN_BOUNDARY`、`UNREACHABLE_CELL`、`EDGE_COUNT_MISMATCH`。

## 核验器

核验器只从**最终墙体**重新构图（BFS），不信任任何生成期标记，可核验用户修改过的墙体。检查项：

1. 墙体结构完整（`rows x cols` 的 `{n,e,s,w}` 布尔网格），损坏结构直接报告，不做静默修正；
2. 相邻两格共享墙对称（`e/w`、`s/n`）；
3. 外边界全部封闭；
4. 所有格从 `(0,0)` 可达（报告具体不可达格）；
5. 无向开通边数 = 格数 - 1（完美迷宫的树的判据）。

路线校验拒绝穿墙、越界、不连续的给定路线；合法完美迷宫中两格间路线唯一。

## 测试

`npm test` 覆盖：固定种子 3x3 快照、单格、单行/单列长条、多固定种子连通性与边数、非法参数、手工构造的闭环/断开/共享墙不对称/外墙缺失、路线起终点与逐步墙体检查、ASCII 与结构一致性、SQLite 重启复现与重复参数策略。

## 已知限制

- `node:sqlite` 在 Node 25 仍为实验特性（启动时有 ExperimentalWarning，不影响功能）。
- 网格上限 1000x1000 且总格数 <= 1,000,000。
- 种子为 32 位整数（传入值按 `>>> 0` 截断）。
