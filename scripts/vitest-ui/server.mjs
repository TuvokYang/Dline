#!/usr/bin/env node
import { spawn } from "node:child_process"
import { DEFAULT_HOST, DEFAULT_PORT } from "./lib/client.mjs"

function parseArgs(argv) {
	const options = {
		host: process.env.VITEST_UI_HOST || DEFAULT_HOST,
		port: Number(process.env.VITEST_UI_PORT || DEFAULT_PORT),
		config: process.env.VITEST_UI_CONFIG || "vitest.config.ts",
	}
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === "--host") options.host = argv[++index]
		else if (arg === "--port") options.port = Number(argv[++index])
		else if (arg === "--config") options.config = argv[++index]
	}
	return options
}

function bin(name) {
	return process.platform === "win32" ? `${name}.cmd` : name
}

const options = parseArgs(process.argv.slice(2))
const args = ["vitest", "--ui", "--host", options.host, "--port", String(options.port)]
if (options.config) {
	args.push("--config", options.config)
}

console.error(`[vitest-ui] starting: npx ${args.join(" ")}`)
console.error(`[vitest-ui] url: http://${options.host}:${options.port}/__vitest__/`)

const child = spawn(bin("npx"), args, {
	cwd: process.cwd(),
	env: process.env,
	stdio: "inherit",
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
