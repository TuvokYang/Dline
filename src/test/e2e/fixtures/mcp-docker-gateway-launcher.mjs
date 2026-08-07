#!/usr/bin/env node

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"

/**
 * E2E stand-in for the `docker mcp gateway run --profile dline` command.
 *
 * Keeps the exact user-facing config shape (command docker, args [...]) while
 * letting the test control startup failures deterministically:
 * - Before the marker file exists: exits immediately (simulates a gateway that
 *   is still starting / a transient spawn failure).
 * - After the marker file exists: forwards to the real `docker mcp gateway
 *   run --profile dline` so the server connects like in production.
 */

const markerPath = process.env.DLINE_E2E_MCP_MARKER
if (!markerPath || !existsSync(markerPath)) {
	console.error("MCP gateway not ready yet")
	process.exit(1)
}

const child = spawn("docker", ["mcp", "gateway", "run", "--profile", "dline"], { stdio: "inherit" })
child.on("error", (error) => {
	console.error(`Failed to start docker mcp gateway: ${error.message}`)
	process.exit(1)
})
child.on("exit", (code, signal) => {
	if (signal) process.kill(process.pid, signal)
	process.exit(code ?? 0)
})
