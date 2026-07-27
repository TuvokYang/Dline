---
name: use-vitest
description: Run, rerun, inspect, and diagnose Vitest tests in the Dline repository without blocking the agent on Vitest UI or watch processes. Use whenever an agent needs to execute focused or full backend, task, prompt, hook, or Webview tests; investigate Vitest failures or 60-second timeouts; query an already-running Vitest UI server; or report Vitest results.
---

# Use Vitest

Run Dline tests as bounded, one-shot processes by default. Select the smallest useful test scope, collect the command through completion, and report the actual failing assertion or stack.

## Hard Safety Boundary

Never start Vitest UI, a Vitest watch process, or the Vitest UI MCP server unless the user explicitly requests that startup in the current turn.

Do not run these commands by default:

```text
npm run vitest:ui:server
npm run vitest:ui:mcp
npx vitest --ui
vitest --ui
npm run test:watch
npm run watch-tests
vitest
```

The last command starts watch mode when `run` is omitted. Do not open the Vitest UI URL in a browser.

`npm run vitest:ui:mcp` is especially unsafe for routine agent use: when the configured UI URL is unreachable, `scripts/vitest-ui/mcp-server.mjs` automatically starts Vitest UI unless `VITEST_UI_MCP_START=false`; the MCP process is also long-lived. Never launch it from an agent terminal merely to inspect tests.

If the user explicitly asks to start Vitest UI, start it as a detached/background process with a clear PID and URL. Never leave the foreground command attached to the conversation's execution session.

## Confirm The Contract

Treat these files as the source of truth if commands appear stale:

- `package.json`: npm script names and lifecycle hooks.
- `vitest.config.ts`: root projects, aliases, workers, and the 60-second test timeout.
- `webview-ui/vitest.config.ts`: Webview test root and jsdom setup.
- `scripts/vitest-ui/cli.mjs`: supported status and rerun arguments.
- `scripts/vitest-ui/server.mjs`: foreground UI server behavior.
- `scripts/vitest-ui/mcp-server.mjs`: automatic server startup behavior.

Do not infer a command from memory when one of these files has changed.

## Run One-Shot Tests

Prefer `test:run`. It expands to `vitest run` and does not invoke the `pretest` lifecycle hook.

Run focused root tests:

```powershell
npm run test:run -- src/core/task/tools/handlers/__tests__/SpawnTaskHandler.test.ts
```

Run several related files:

```powershell
npm run test:run -- src/core/api/providers/__tests__/openai.test.ts src/core/api/providers/__tests__/deepseek.test.ts
```

Run one test by name:

```powershell
npm run test:run -- src/core/task/tools/handlers/__tests__/SpawnTaskHandler.test.ts -t "should return toolError"
```

Select a root project when running a broad pattern or resolving ambiguous ownership:

```powershell
npm run test:run -- --project backend-task src/core/task
```

Run Webview tests from the Webview package so paths are relative to `webview-ui`:

```powershell
npm --prefix webview-ui test -- src/components/settings/OpenAIServiceTierSelector.test.tsx
```

Run all configured root projects only when the change warrants the cost:

```powershell
npm run test:run
```

Do not use `npm test` for routine focused validation. Its `pretest` hook runs `npm run protos`, which can regenerate and format files before the tests. Use it only when that lifecycle behavior is intentionally required.

## Select The Project

The root config assigns tests by path:

| Project | Owned tests |
| --- | --- |
| `backend-task` | `src/core/task/**/*.test.ts` |
| `backend-prompts` | `src/core/prompts/**/*.test.ts` |
| `backend-hooks` | `src/core/hooks/**/*.test.ts` |
| `backend-core` | Other `src/core/**/*.test.ts` files |
| `backend` | Tests under `src/` outside `src/core/` |
| `webview` | Tests/specs under `webview-ui/src/` |

Start with the changed module's focused test. Then run adjacent tests for shared contracts, and broaden only in proportion to the change's blast radius.

## Use An Existing Vitest UI Server

The CLI in `scripts/vitest-ui/cli.mjs` only connects to an existing server; it does not start one. Use it only when the user says a Vitest UI server is already running or explicitly asks to inspect that server.

Before connecting, perform a bounded reachability probe. A failed probe must never trigger server startup:

```powershell
node -e "const u=process.env.VITEST_UI_URL||'http://localhost:51205/__vitest__/';fetch(u,{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

If the probe fails:

- Use a one-shot `test:run` command when the goal is to execute tests.
- Report that the existing UI server is unavailable when the goal is to inspect its retained state.
- Never fall back to `vitest:ui:server` or `vitest:ui:mcp` automatically.

Read current failures:

```powershell
npm run vitest:ui -- errors --json --timeout 10000 --rpc-timeout 15000
```

Read status without waiting:

```powershell
npm run vitest:ui -- status --filter fail --details --timeout 10000 --rpc-timeout 15000
```

Wait for an existing run to become idle only when waiting is part of the request:

```powershell
npm run vitest:ui -- status --wait-idle --allow-unknown --timeout 180000 --rpc-timeout 180000
```

Rerun failures on the existing server:

```powershell
npm run vitest:ui -- rerun failed --wait --timeout 180000 --rpc-timeout 180000
```

Rerun one file or test:

```powershell
npm run vitest:ui -- rerun file --file src/core/foo.test.ts --wait --timeout 180000 --rpc-timeout 180000
npm run vitest:ui -- rerun test --file src/core/foo.test.ts --test "does the thing" --wait --timeout 180000 --rpc-timeout 180000
```

Use `--all-matches` only after confirming that rerunning every match is intended. Use `--allow-unknown` only to tolerate uncollected placeholder files; never report unknown files as passing.

## Handle Running Commands

When a command yields a continuation or process handle, keep collecting it until exit. Wait in intervals of at most 30 seconds, send concise progress updates, and do not start duplicate test runs because output is temporarily quiet.

If a one-shot test exceeds its expected duration, inspect the active process and the test's awaited boundary. Do not switch to watch/UI mode to obtain output.

The root config sets `testTimeout: 60_000`. A failure at approximately 60 seconds usually indicates an unresolved promise, import, timer, interaction, or worker boundary. Diagnose that boundary; do not raise the timeout merely to make the test pass.

## Report Results

Always report:

- The exact command scope or test files.
- Test files passed/failed and tests passed/failed.
- The first meaningful assertion, stack, or timeout boundary.
- Whether a failure came from test behavior or command/environment startup.
- Any validation that could not be run.

After a fix, rerun the original RED test first. Then run adjacent tests and static checks appropriate to the changed production boundary.
