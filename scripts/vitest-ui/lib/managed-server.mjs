import { spawn as spawnChild } from "node:child_process"
import { DEFAULT_HOST, DEFAULT_PORT, normalizeBaseUrl } from "./client.mjs"
import { buildVitestUiArgs } from "./server-args.mjs"
import { createVitestSpawnCommand } from "./spawn-command.mjs"

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Return whether the configured Vitest UI endpoint is accepting requests. */
export async function isReachable(url, fetchImpl = globalThis.fetch) {
	try {
		const response = await fetchImpl(url)
		return response.ok
	} catch {
		return false
	}
}

/** Wait for Vitest UI while also surfacing child startup failures immediately. */
export async function waitForReachable(
	url,
	{ timeoutMs = 60_000, pollMs = 1_000, fetchImpl = globalThis.fetch, getStartupError } = {},
) {
	const started = Date.now()
	while (Date.now() - started < timeoutMs) {
		const startupError = getStartupError?.()
		if (startupError) throw startupError
		if (await isReachable(url, fetchImpl)) return
		await sleep(pollMs)
	}
	const startupError = getStartupError?.()
	if (startupError) throw startupError
	throw new Error(`Vitest UI did not become reachable at ${url} within ${timeoutMs}ms`)
}

function writeChunk(stream, chunk) {
	stream?.write(chunk)
}

/** Reuse a reachable Vitest UI or start the repository-local Vitest 4 UI process. */
export async function ensureVitestUiServer(options = {}) {
	const env = options.env || process.env
	const cwd = options.cwd || process.cwd()
	const host = env.VITEST_UI_HOST || DEFAULT_HOST
	const port = Number(env.VITEST_UI_PORT || DEFAULT_PORT)
	const url = normalizeBaseUrl(env.VITEST_UI_URL || `http://${host}:${port}/__vitest__/`)
	const fetchImpl = options.fetchImpl || globalThis.fetch

	if (await isReachable(url, fetchImpl)) {
		return { url, child: null, started: false }
	}
	if (env.VITEST_UI_MCP_START === "false") {
		throw new Error(
			`Vitest UI is not reachable at ${url}. Start it with "npm run vitest:ui:server" or allow automatic startup.`,
		)
	}

	const config = env.VITEST_UI_CONFIG || "vitest.config.ts"
	const vitestArgs = buildVitestUiArgs({ host, port, config })
	const spawnCommand = createVitestSpawnCommand({ cwd, execPath: options.execPath })
	const args = [...spawnCommand.args, ...vitestArgs]
	const stderr = options.stderr || process.stderr
	writeChunk(stderr, `[vitest-ui-mcp] starting: ${spawnCommand.file} ${args.join(" ")}\n`)

	let startupError
	const spawnImpl = options.spawnImpl || spawnChild
	const child = spawnImpl(spawnCommand.file, args, {
		cwd,
		env,
		stdio: ["ignore", "pipe", "pipe"],
		...spawnCommand.options,
	})
	child.stdout?.on("data", (chunk) => writeChunk(stderr, chunk))
	child.stderr?.on("data", (chunk) => writeChunk(stderr, chunk))
	child.once("error", (error) => {
		startupError = new Error(`Failed to start Vitest UI: ${error.message}`, { cause: error })
	})
	child.once("exit", (code, signal) => {
		options.onExit?.(code, signal)
		if (code !== null || signal) {
			startupError = new Error(`Vitest UI exited before becoming reachable (code=${code ?? ""}, signal=${signal ?? ""})`)
		}
	})

	try {
		await waitForReachable(url, {
			timeoutMs: Number(env.VITEST_UI_MCP_START_TIMEOUT || 60_000),
			pollMs: options.pollMs,
			fetchImpl,
			getStartupError: () => startupError,
		})
	} catch (error) {
		if (!child.killed && child.exitCode === null) child.kill("SIGTERM")
		throw error
	}
	return { url, child, started: true }
}
