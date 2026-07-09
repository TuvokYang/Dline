#!/usr/bin/env node
import { spawn } from "node:child_process"
import { DEFAULT_HOST, DEFAULT_PORT } from "./lib/client.mjs"
import { buildVitestUiArgs, parseServerArgs } from "./lib/server-args.mjs"
import { createSpawnCommand } from "./lib/spawn-command.mjs"

const options = parseServerArgs(process.argv.slice(2), process.env, { host: DEFAULT_HOST, port: DEFAULT_PORT })
const args = buildVitestUiArgs(options)

console.error(`[vitest-ui] starting: npx ${args.join(" ")}`)
console.error(`[vitest-ui] url: http://${options.host}:${options.port}/__vitest__/`)

const spawnCommand = createSpawnCommand({ executable: "npx" })
const child = spawn(spawnCommand.file, args, {
	cwd: process.cwd(),
	env: process.env,
	stdio: "inherit",
	...spawnCommand.options,
})

function shutdown(signal) {
	if (!child.killed) {
		child.kill(signal)
	}
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))

child.on("exit", (code, signal) => {
	if (signal) {
		process.kill(process.pid, signal)
		return
	}
	process.exit(code ?? 0)
})
