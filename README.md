# 完美迷宫生成与墙体连通核验后端

离线矩形网格迷宫服务：给定行列数与随机种子，生成**任意两格之间恰有一条通路**的完美迷宫
  （即网格图的一棵生成树），并提供从最终墙体重新构图的独立核验器、路线查询、历史与 JSON 导出。

只提供 HTTP API 与 CLI，不包含网页、游戏界面、求解玩法或排行榜。仅支持上下左右相邻，行列从 0 开始，
  外边界墙始终封闭；入口/出口以起终点格子坐标表示，不靠破坏外墙表达。

## 技术栈与假设

- TypeScript + Node.js（需 Node >= 22.5，实测 Node v25.5），ESM。
- SQLite 使用 Node **内置** `node:sqlite`（`DatabaseSync`），无需 npm 原生模块、Docker、WSL 或网络。
- 数据默认保存在项目内 `data/mazes.sqlite`，可用环境变量 `MAZE_DB` 覆盖；服务重启后历史迷宫仍可查询。
- 尺寸范围：`rows`、`cols` 均为 1..200 的整数；种子 `seed` 为 0..4294967295 的整数。

## 随机算法（公开且固定）

- 算法版本字符串：`mulberry32-v1`（32 位 mulberry32），实现见 `src/rng.ts`，全程不使用 `Math.random`。
- 邻居候选**收集顺序固定**为上(N)、右(E)、下(S)、左(W)（见 `src/maze.ts` 的 `DIRS`），
  只收集界内且未访问的邻居，再用种子化 RNG 在候选数组中等下标抽取。
- 生成采用带栈的随机深度优先回溯：每格仅首次访问时打通一面墙建立一条新边，无候选时弹栈回退。

### 可复现性 ≠ 随机均匀性

- **可复现**：相同 `(rows, cols, seed, algorithm)` 必然得到逐位相同的墙体；数据库记录算法版本，
  将来即使更换默认算法，旧迷宫仍按原版本复现，不会被改写。
- **不保证均匀**：本服务**不宣称**在所有生成树上均匀抽取。带栈随机 DFS 是经典算法，但不同算法
  （如 Wilson、并查集随机边）的生成树分布不同。若需要均匀生成树应另行实现指定算法。

## 重复生成策略

表 `mazes` 对 `(rows, cols, seed, algorithm)` 建唯一约束：

- 参数已存在 → 直接返回已有记录（HTTP `200`，响应 `reused: true`；CLI 提示“命中已有记录”），**不新增行、不覆盖墙体与核验报告**。
- 参数不存在 → 生成、核验入库（HTTP `201`，`reused: false`）。

## 构建、测试、启动、演示

```powershell
npm install
npm run build      # tsc 编译到 build/
npm test           # 编译并运行 node:test（13 个用例）
npm start          # 启动 HTTP 服务（默认 0 号端口 = 自动选择空闲端口，启动时打印实际 URL）
$env:PORT=8080; npm start      # 固定端口
npm run demo       # CLI 演示：生成 → 查路线 → 改坏一面墙 → 核验定位
```

## CLI

```powershell
node build/src/cli-main.js generate --rows 6 --cols 8 --seed 20261003
node build/src/cli-main.js generate --rows 3 --cols 3 --seed 1 --json
node build/src/cli-main.js walls 1
node build/src/cli-main.js edges 1
node build/src/cli-main.js ascii 1
node build/src/cli-main.js path 1 --from 0,0 --to 5,7
node build/src/cli-main.js validate-route 1 --path "[[0,0],[0,1]]"
node build/src/cli-main.js verify --id 1
node build/src/cli-main.js verify --file examples/demo-broken-walls.json
node build/src/cli-main.js history --limit 20
node build/src/cli-main.js export 1 --out examples/maze-1.json
node build/src/cli-main.js help
```

## HTTP API

仅监听 `127.0.0.1`。启动日志给出实际 `baseUrl`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/mazes` | 生成/取回，body `{rows, cols, seed}` |
| GET | `/mazes/:id` | 导出完整 JSON（墙体、开通边、ASCII、核验报告） |
| GET | `/mazes/:id/walls` | 每格四面墙 |
| GET | `/mazes/:id/edges` | 无向开通边列表 |
| GET | `/mazes/:id/ascii` | 终端可读 ASCII（`#` 墙、`.` 开口、`o` 格心） |
| POST | `/mazes/:id/path` | body `{start:[r,c], goal:[r,c]}`，返回连续坐标与带 `*` 路径的 ASCII |
| POST | `/mazes/:id/validate-route` | body `{path:[[r,c],...]}`，拒绝越界、非相邻、穿墙 |
| POST | `/verify` | 核验 `{id}` 或用户提交的 `{rows, cols, walls}` |
| GET | `/history?limit=50` | 历史记录 |

### 错误码

`400 INVALID_DIMENSIONS` / `400 INVALID_SEED` / `400 INVALID_CELL` / `400 INVALID_STRUCTURE` /
`400 OUT_OF_BOUNDS` / `400 INVALID_JSON` / `422 UNREACHABLE` / `404 NOT_FOUND` / `500 INTERNAL`。
错误响应形如 `{"error":"INVALID_DIMENSIONS","message":"..."}`，核验失败时附完整 `report`。

示例：

```powershell
Invoke-RestMethod http://127.0.0.1:8080/mazes -Method Post -ContentType 'application/json' `
  -Body '{"rows":4,"cols":5,"seed":777}'
```

## 核验器（独立于生成过程）

`src/verify.ts` **只读取最终墙体**，不信任任何生成时的访问标记，对手工修改过的墙体同样适用。
检查四项并报告具体位置，发现问题不会“自动修正后当作通过”：

1. **共享墙对称**：相邻两格对应面必须一致（A.S === B.N、A.E === B.W），不一致列入 `asymmetricWalls`。
2. **外边界封闭**：贴边格朝界外的一面必须为墙，缺口列入 `boundaryGaps`（含格子坐标与方向）。
3. **全部可达**：按双方都无墙的开通边从 (0,0) BFS 重新构图，不可达格列入 `unreachableCells`。
4. **边数 = 格数 - 1**：无向开通边计数 `openEdgeCount`，与 `rows*cols-1` 不符时报告（多边意味着环）。

合法树（含单格、单行、单列）`ok: true`。`examples/demo-broken-walls.json` 是故意改坏外墙的样例，
可用于演示定位。

## 目录

```
src/      rng、maze(生成/ASCII)、verify、path、store(SQLite)、service、api、cli
test/     node:test 固定种子与坏墙用例
data/     SQLite 数据目录（运行时生成）
examples/ 演示导出与坏墙样例
```

## 限制

- 仅矩形网格、四邻接；无六边形/极坐标网格、无加权墙、无房间。
- 路线为 BFS 结果；在合法完美迷宫中树内路线本就唯一。
- `node:sqlite` 当前在 Node 中带 Experimental 警告，API 若未来变更需随 Node 版本适配。
- 大尺寸上限 200x200（4 万格），主要约束是 JSON 体积与终端渲染宽度。
