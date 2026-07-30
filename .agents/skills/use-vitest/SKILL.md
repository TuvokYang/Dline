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

Escalate test scope deliberately:

1. Reproduce and diagnose with one named test or one test file whenever possible.
2. After the fix, rerun the original focused scope first.
3. Then run the owning Vitest project when the changed boundary warrants broader confidence.
4. Run all projects only when the change has repository-wide impact or the user explicitly requests a full rerun.

A full Dline rerun normally takes about 7-8 minutes. Give it a command timeout of at least 10 minutes, keep collecting the same process until it exits, and do not start another full run because output is temporarily quiet. Prefer separate project runs over a full run so failures are available sooner and unrelated projects do not extend the feedback loop.

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

When broader validation is appropriate, run the owning project before considering all projects. Do not use a full rerun merely to validate a local test or fixture change.

## Use An Existing Vitest UI Server

The CLI in `scripts/vitest-ui/cli.mjs` only connects to an existing server; it does not start one. Use it only when the user says a Vitest UI server is already running or explicitly asks to inspect that server.

Before connecting, probe at most five consecutive ports. Start at the default port `51205`, then increment by one through `51209`; the default port counts as the first attempt. Stop at the first reachable Vitest UI and use that exact URL for subsequent CLI commands:

```powershell
$vitestUiUrl = $null
for ($vitestUiOffset = 0; $vitestUiOffset -lt 5; $vitestUiOffset++) {
	$vitestUiCandidate = "http://localhost:$((51205 + $vitestUiOffset))/__vitest__/"
	try {
		$vitestUiResponse = Invoke-WebRequest -Uri $vitestUiCandidate -UseBasicParsing -TimeoutSec 3
		if ($vitestUiResponse.StatusCode -ge 200 -and $vitestUiResponse.StatusCode -lt 400) {
			$vitestUiUrl = $vitestUiCandidate
			break
		}
	} catch {}
}
if ($null -eq $vitestUiUrl) { exit 1 }
$vitestUiUrl
```

Pass the discovered URL through `--url`; do not keep assuming port `51205` after a later port succeeds.

Only after all five probes fail may you conclude that the Vitest UI server is not running. If no server is reachable:

- Use a one-shot `test:run` command instead of starting a server.
- Prefer one named test or one file; use the owning `--project` only when the focused scope is insufficient.
- Report that the existing UI server is unavailable when the goal is to inspect its retained state.
- Never fall back to `vitest:ui:server` or `vitest:ui:mcp` automatically.

Read current failures:

```powershell
npm run vitest:ui -- errors --json --timeout 10000 --rpc-timeout 15000
```

Add `--url <discovered-url>` to each Vitest UI CLI command when the reachable server is not at the default URL.

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
