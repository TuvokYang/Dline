# Vitest UI Wrapper

This wrapper talks to an existing Vitest `--ui` watch server through the same WebSocket RPC API used by the web UI.

## Start the Watch Server

```sh
npm run vitest:ui:server
```

Defaults:

- URL: `http://localhost:51205/__vitest__/`
- Config: `vitest.config.ts`

Override with flags or env:

```sh
npm run vitest:ui:server -- --host 127.0.0.1 --port 51205 --config vitest.config.ts
```

## CLI

```sh
npm run vitest:ui -- status --filter fail --details
npm run vitest:ui -- status --wait-idle --allow-unknown
npm run vitest:ui -- errors --json
npm run vitest:ui -- files --filter running
npm run vitest:ui -- rerun all --wait
npm run vitest:ui -- rerun failed --wait
npm run vitest:ui -- rerun file --file src/core/foo.test.ts --wait
npm run vitest:ui -- rerun test --file src/core/foo.test.ts --test "does the thing" --wait
```

Filters: `all`, `fail`, `pass`, `success`, `skip`, `running`.

Set a non-default UI URL with:

```sh
npm run vitest:ui -- status --url http://localhost:51205/__vitest__/
```

## MCP 服务

```sh
npm run vitest:ui:mcp
```

服务优先连接 `VITEST_UI_URL` 指向的现有 Vitest UI。目标不可达时，默认使用当前 Node 运行项目本地的 Vitest 4 CLI，并通过 `--ui --watch --no-open --api.host --api.port` 自动启动常驻 UI；后台启动不会打开系统浏览器，即使首轮测试失败也会继续等待查询与复跑。Windows 不依赖 `shell: true` 或全局 `npx`。

可用工具：

- `vitest_status`：读取当前文件、任务和失败状态。
- `vitest_failures`：只返回失败测试及错误信息。
- `vitest_rerun`：按全部、失败文件、单文件或单测试范围复跑。

环境变量：

- `VITEST_UI_URL`：完整 UI URL；设置后优先使用其 host、port 和路径。
- `VITEST_UI_HOST`：自动启动时的 API host，默认 `localhost`。
- `VITEST_UI_PORT`：自动启动时的 API port，默认 `51205`。
- `VITEST_UI_CONFIG`：Vitest 配置文件，默认 `vitest.config.ts`。
- `VITEST_UI_MCP_START=false`：禁止自动启动；若目标不可达，服务会立即报错并提示先运行 `npm run vitest:ui:server`。
- `VITEST_UI_MCP_START_TIMEOUT`：等待自动启动 UI 就绪的毫秒数，默认 `60000`。

仅连接已经运行的 UI：

```powershell
$env:VITEST_UI_MCP_START = "false"
npm run vitest:ui:mcp
```

使用非默认端口并允许自动启动：

```powershell
$env:VITEST_UI_PORT = "51206"
npm run vitest:ui:mcp
```

MCP 进程退出时，只会终止由自身自动启动的 Vitest UI 子进程；复用的外部 UI 服务不会被关闭。
