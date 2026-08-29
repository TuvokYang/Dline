---
name: use-vitest
description: Run, rerun, inspect, and diagnose Vitest tests in the Dline repository without blocking the agent on watch processes. Use bounded one-shot commands for focused tests, and automatically start or reuse a background Vitest UI server for full-suite runs before reading results through scripts/vitest-ui/cli.mjs.
---

# Use Vitest

Use bounded one-shot processes for focused tests. When the user requests all Vitest tests or all configured projects, use the background Vitest UI workflow so the long-lived server is detached from the execution turn and all results are read through the repository wrapper.

## Execution Safety Boundary

Never start Vitest UI or a Vitest watch process for a focused test unless the user explicitly requests UI/watch startup. A request to run all Vitest tests, the full suite, or all configured projects is explicit authorization to automatically start or reuse the background Vitest UI server.

Do not run these commands by default:

```text
npx vitest --ui
vitest --ui
npm run test:watch
npm run watch-tests
vitest
```

The last command starts watch mode when `run` is omitted. Background Vitest UI startup must include the shared `--no-open` argument and must never open the UI URL in a system browser. Use `npm run vitest:ui:server` for an authorized full-suite run and use `scripts/vitest-ui/cli.mjs` for status and reruns.

Always start the authorized UI server with `execute_command` using both `background=true` and `timeout=0`. `background=true` detaches the server from the tool turn and marks it as explicit background work; `timeout=0` means no finite command deadline, so the server remains resident until it exits or is explicitly cancelled. Record the returned `function_id` and URL, and never attach the foreground server command to the conversation execution session. Keep a healthy UI server running after the test task completes unless the user asks to stop it or it must be replaced because it is unhealthy.

### Background Server Cancellation

Dline exposes different Cancel controls with intentionally different ownership semantics:

- The running command card's **Cancel** button in the Work view cancels the exact command activity by `activityId`; it will terminate the Vitest UI server.
- The matching **Cancel** button in the Activities view uses the same exact activity cancellation and will also terminate the server.
- The task footer's **Cancel** button pauses the foreground Task and cancels only Task-owned work. It does not terminate a server started with `background=true`, because that command has explicit cancellation ownership.
- `kill_command` with the server's exact `function_id` explicitly terminates that one server without cancelling the Task or other commands.
- Closing or destroying the Task performs full cleanup and can terminate all commands associated with that Task, including explicit background work.

When reporting the resident server, identify its `function_id`, URL, and the distinction above. Do not claim that every Work-view Cancel preserves the server: the command card's own Cancel is an explicit process cancellation, while the task footer Cancel is not.

## Confirm The Contract

Treat these files as the source of truth if commands appear stale:

- `package.json`: npm script names and lifecycle hooks.
- `vitest.config.ts`: root projects, aliases, workers, and the 60-second test timeout.
- `webview-ui/vitest.config.ts`: Webview test root and jsdom setup.
- `scripts/vitest-ui/cli.mjs`: supported status and rerun arguments.
- `scripts/vitest-ui/server.mjs`: UI server startup behavior.

Do not infer a command from memory when one of these files has changed.

## Run One-Shot Tests

Prefer `test:run`. It expands to `vitest run` and does not invoke the `pretest` lifecycle hook.

Escalate test scope deliberately:

1. Reproduce and diagnose with one named test or one test file whenever possible.
2. After the fix, rerun the original focused scope first.
3. Then run the owning Vitest project when the changed boundary warrants broader confidence.
4. When the user requests all projects, switch to the background Vitest UI workflow instead of launching a foreground one-shot full run.

A full Dline rerun normally takes about 7-8 minutes. Give Vitest UI CLI wait/rerun operations a timeout of at least 10 minutes, keep querying the same server, and do not start another server or full run because output is temporarily quiet. Prefer separate one-shot project runs for local changes; reserve the UI workflow for explicit full-suite validation.

Run focused root tests:

```
npm run test:run -- src/core/task/tools/handlers/__tests__/SpawnTaskHandler.test.ts
```

Run several related files:

```
npm run test:run -- src/core/api/providers/__tests__/openai.test.ts src/core/api/providers/__tests__/deepseek.test.ts
```

Run one test by name:

```
npm run test:run -- src/core/task/tools/handlers/__tests__/SpawnTaskHandler.test.ts -t "should return toolError"
```

Select a root project when running a broad pattern or resolving ambiguous ownership:

```
npm run test:run -- --project backend-task src/core/task
```

Run Webview tests from the Webview package so paths are relative to `webview-ui`:

```
npm --prefix webview-ui test -- src/components/settings/OpenAIServiceTierSelector.test.tsx
```

For all configured root projects, do not run a foreground `npm run test:run`. Follow the background Vitest UI workflow below so the server survives command handoffs and the repository CLI provides the durable result channel.

Do not use `npm test` for routine focused validation. Its `pretest` hook runs `npm run protos`, which can regenerate and format files before the tests. Use it only when that lifecycle behavior is intentionally required.

## Regenerate Prompt Snapshots

Any intentional change to prompt prose, prompt templates, prompt assembly, profile projection, or other generated system-prompt output MUST regenerate the repository-owned prompt snapshots before prompt validation is considered complete.

Use the dedicated package script from the repository root:

```
npm run test:snapshot
```

Treat `package.json` as the source of truth for the exact generation scope. The script sets the required snapshot-update environment variables and runs the repository's prompt and focus-chain snapshot generators. Do not replace it with an ad hoc Vitest command, and NEVER hand-edit generated `.snap` files.

After generation succeeds, review the resulting snapshot changes and run the owning prompt project without update flags:

```
npm run test:run -- --project backend-prompts
```

Snapshot generation passing proves that the generator completed; the subsequent project run verifies that the committed baselines and the rest of the prompt tests are consistent. Report separately any unrelated pre-existing failures rather than modifying their assertions or inventories to make the suite pass.

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

## Run Or Reuse The Background Vitest UI

The CLI in `scripts/vitest-ui/cli.mjs` only connects to an existing server; it does not start one. For an explicit full-suite request, first reuse a healthy server or automatically start one in the background.

Probe at most five consecutive ports. Start at the default port `51205`, then increment by one through `51209`; the default port counts as the first attempt. Stop at the first reachable Vitest UI and use that exact URL for all subsequent CLI commands:

Each candidate URL has the form `http://localhost:<port>/__vitest__/`. Probe it with whatever HTTP client the current shell provides, treat any 2xx/3xx response as reachable, and use a short per-probe timeout of a few seconds so an unused port fails fast.

Pass the discovered URL through `--url`; do not keep assuming port `51205` after a later port succeeds.

If all five probes fail during a full-suite request, start the server automatically on the first candidate port with `execute_command`:

```text
command: npm run vitest:ui:server -- --host localhost --port 51205 --config vitest.config.ts
workdirectory: <repository-root>
background: true
timeout: 0
requires_approval: false
```

The server wrapper supplies `--watch --no-open` to Vitest, so it remains resident without launching a system browser. Record the returned `function_id` and candidate URL. Because the server was started with `background=true` and `timeout=0`, do not wait for that command to exit. Probe that exact URL for up to 30 seconds before using the CLI. If the background command exits or the port is occupied by a non-Vitest service, inspect the command result and try the next candidate port, stopping after `51209`. Do not start duplicate servers on ports that already expose a healthy Vitest UI.

If no candidate can start, report the environment/startup failure and do not claim that the full suite ran. Do not silently replace the requested UI workflow with a foreground full run.

A newly started UI automatically begins its initial full run. Avoid the empty-collection race: query `status --json` until `summary.total` is greater than zero, retrying for up to 30 seconds. Then wait for the same run to become idle without `--allow-unknown`:

```
npm run vitest:ui -- status --url <vitest-ui-url> --wait-idle --timeout 900000 --rpc-timeout 900000
```

For a reused UI server, first wait for any active run to become idle, then explicitly rerun all collected files so the result reflects the current workspace:

```
npm run vitest:ui -- rerun all --url <vitest-ui-url> --wait --timeout 900000 --rpc-timeout 900000
```

Persistent `unknown` files are not passing files. Diagnose collection failures or report them as unresolved; use `--allow-unknown` only when the user explicitly accepts placeholder files.

Read current failures:

```
npm run vitest:ui -- errors --json --timeout 10000 --rpc-timeout 15000
```

Add `--url <discovered-url>` to each Vitest UI CLI command when the reachable server is not at the default URL.

Read status without waiting:

```
npm run vitest:ui -- status --filter fail --details --timeout 10000 --rpc-timeout 15000
```

Wait for an existing focused rerun to become idle when waiting is part of the request:

```
npm run vitest:ui -- status --wait-idle --timeout 180000 --rpc-timeout 180000
```

Rerun failures on the existing server:

```
npm run vitest:ui -- rerun failed --wait --timeout 180000 --rpc-timeout 180000
```

Rerun one file or test:

```
npm run vitest:ui -- rerun file --file src/core/foo.test.ts --wait --timeout 180000 --rpc-timeout 180000
npm run vitest:ui -- rerun test --file src/core/foo.test.ts --test "does the thing" --wait --timeout 180000 --rpc-timeout 180000
```

Use `--all-matches` only after confirming that rerunning every match is intended. Use `--allow-unknown` only to tolerate uncollected placeholder files; never report unknown files as passing.

## Waiting For The Full Suite

A full run takes roughly 7-10 minutes on the background server. Collect the result with a single bounded wait rather than repeated short status probes:

```
npm run vitest:ui -- status --url <vitest-ui-url> --wait-idle --timeout 900000 --rpc-timeout 900000
```

If the remaining plan already contains work that does not touch the files being executed, that work may proceed during the wait; documentation, memory-bank updates, and separate E2E or fixture work are typical examples. This is an option, not an obligation: when nothing else is planned, simply wait for the run. Never invent extra work to fill the interval.

Do not edit production source while the suite is executing it. A mid-run edit makes the reported result describe a tree that no longer exists, so the run has to be repeated.

## Handle Running Commands

When a bounded one-shot or CLI command yields a continuation/process handle, keep collecting it until exit. Wait in intervals of at most 30 seconds, send concise progress updates, and do not start duplicate test runs because output is temporarily quiet. The background Vitest UI server is the exception: verify it through its URL and retained `function_id`, but leave the healthy long-lived process running rather than waiting for it to exit.

If a one-shot test exceeds its expected duration, inspect the active process and the test's awaited boundary. Do not switch to watch/UI mode to obtain output.

The root config sets `testTimeout: 60_000`. A failure at approximately 60 seconds usually indicates an unresolved promise, import, timer, interaction, or worker boundary. Diagnose that boundary; do not raise the timeout merely to make the test pass.

## Report Results

Always report:

- The exact command scope or test files.
- For a full run, the Vitest UI URL, whether it was started or reused, and the CLI command used to obtain the result.
- Test files passed/failed and tests passed/failed; never count `unknown` files as passing.
- The first meaningful assertion, stack, or timeout boundary.
- Whether a failure came from test behavior, collection, or command/environment startup.
- Any validation that could not be run.

After a fix, rerun the original RED test first. Then run adjacent tests and static checks appropriate to the changed production boundary.
