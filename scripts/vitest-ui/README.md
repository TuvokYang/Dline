# Vitest UI Wrapper

This wrapper talks to an existing Vitest `--ui` watch server through the same WebSocket RPC API used by the web UI.

## Start the Watch Server

```sh
npm run vitest:ui:server
```

Defaults:

- URL: `http://localhost:51204/__vitest__/`
- Config: `vitest.config.ts`

Override with flags or env:

```sh
npm run vitest:ui:server -- --host 127.0.0.1 --port 51204 --config vitest.config.ts
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
npm run vitest:ui -- status --url http://localhost:51204/__vitest__/
```

## MCP

```sh
npm run vitest:ui:mcp
```

The MCP server starts the Vitest UI watch server if the configured URL is not reachable. It exposes:

- `vitest_status`
- `vitest_failures`
- `vitest_rerun`

Useful env:

- `VITEST_UI_URL`
- `VITEST_UI_HOST`
- `VITEST_UI_PORT`
- `VITEST_UI_CONFIG`
- `VITEST_UI_MCP_START=false` to require an already-running server.
