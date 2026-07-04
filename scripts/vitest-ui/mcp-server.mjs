#!/usr/bin/env node
import { spawn } from "node:child_process"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod/v4"
import {
	DEFAULT_HOST,
	DEFAULT_PORT,
	collectFailures,
	connectVitestUi,
	filterFiles,
	normalizeBaseUrl,
	rerunWithScope,
	simplifyFile,
	summarizeFiles,
	waitForIdle,
} from "./lib/client.mjs"

function bin(name) {
	return process.platform === "win32" ? `${name}.cmd` : name
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

async function isReachable(url) {
	try {
		const response = await fetch(url)
		return response.ok
	} catch {
		return false
	}
}

async function waitForReachable(url, timeoutMs = 60_000) {
	const started = Date.now()
	while (Date.now() - started < timeoutMs) {
		if (await isReachable(url)) {
			return
		}
		await sleep(1_000)
	}
	throw new Error(`Vitest UI did not become reachable at ${url} within ${timeoutMs}ms`)
}

async function ensureVitestUiServer() {
	const host = process.env.VITEST_UI_HOST || DEFAULT_HOST
	const port = Number(process.env.VITEST_UI_PORT || DEFAULT_PORT)
	const url = normalizeBaseUrl(process.env.VITEST_UI_URL || `http://${host}:${port}/__vitest__/`)

	if (process.env.VITEST_UI_MCP_START === "false" || (await isReachable(url))) {
		return { url, child: null }
	}

	const config = process.env.VITEST_UI_CONFIG || "vitest.config.ts"
	const args = ["vitest", "--ui", "--host", host, "--port", String(port), "--config", config]
	console.error(`[vitest-ui-mcp] starting: npx ${args.join(" ")}`)

	const child = spawn(bin("npx"), args, {
		cwd: process.cwd(),
		env: process.env,
		stdio: ["ignore", "pipe", "pipe"],
	})
	child.stdout.on("data", (chunk) => process.stderr.write(chunk))
	child.stderr.on("data", (chunk) => process.stderr.write(chunk))
	child.on("exit", (code, signal) => {
		console.error(`[vitest-ui-mcp] vitest ui exited code=${code ?? ""} signal=${signal ?? ""}`)
	})

	await waitForReachable(url, Number(process.env.VITEST_UI_MCP_START_TIMEOUT || 60_000))
	return { url, child }
}

function textResult(structuredContent) {
	return {
		content: [
			{
				type: "text",
				text: JSON.stringify(structuredContent, null, 2),
			},
		],
		structuredContent,
	}
}

async function withClient(url, callback) {
	const client = await connectVitestUi({ url })
	try {
		return await callback(client)
	} finally {
		client.close()
	}
}

const { url, child } = await ensureVitestUiServer()

const server = new McpServer({
	name: "dline-vitest-ui",
	version: "1.0.0",
})

server.registerTool(
	"vitest_status",
	{
		title: "Vitest UI Status",
		description: "Read the current Vitest UI watch state without starting a new test run.",
		inputSchema: {
			filter: z.enum(["all", "fail", "failed", "pass", "success", "skip", "running"]).default("all"),
			includeTasks: z.boolean().default(false),
			includeFailures: z.boolean().default(true),
			includeContainers: z.boolean().default(false),
			waitForIdle: z.boolean().default(false),
			allowUnknown: z.boolean().default(false),
			timeoutMs: z.number().int().positive().default(180_000),
		},
	},
	async ({ filter, includeTasks, includeFailures, includeContainers, waitForIdle: shouldWait, allowUnknown, timeoutMs }) =>
		withClient(url, async (client) => {
			const files = shouldWait ? await waitForIdle(client, { timeoutMs, allowUnknown }) : await client.getFiles()
			const filtered = filterFiles(files, filter)
			return textResult({
				url: client.baseUrl,
				summary: summarizeFiles(files),
				filter,
				files: filtered.map((file) => simplifyFile(file, { includeTasks })),
				failures: includeFailures ? collectFailures(filtered, { includeContainers }) : undefined,
			})
		}),
)

server.registerTool(
	"vitest_rerun",
	{
		title: "Vitest UI Rerun",
		description: "Rerun all tests, failed files, one file, one task id, or one test name through the Vitest UI watch server.",
		inputSchema: {
			scope: z.enum(["all", "failed", "fail", "file", "test", "task"]).default("all"),
			file: z.string().optional(),
			testName: z.string().optional(),
			taskId: z.string().optional(),
			exact: z.boolean().default(false),
			allMatches: z.boolean().default(false),
			waitForIdle: z.boolean().default(true),
			allowUnknown: z.boolean().default(true),
			timeoutMs: z.number().int().positive().default(180_000),
		},
	},
	async ({ scope, file, testName, taskId, exact, allMatches, waitForIdle: shouldWait, allowUnknown, timeoutMs }) =>
		withClient(url, async (client) => {
			const rerun = await rerunWithScope(client, { scope, file, testName, taskId, exact, allMatches })
			const files = shouldWait ? await waitForIdle(client, { timeoutMs, since: rerun.startedAt, allowUnknown }) : undefined
			return textResult({
				url: client.baseUrl,
				rerun,
				summary: files ? summarizeFiles(files) : undefined,
				failures: files ? collectFailures(files) : undefined,
			})
		}),
)

server.registerTool(
	"vitest_failures",
	{
		title: "Vitest UI Failures",
		description: "Return only failed Vitest tests and their error messages.",
		inputSchema: {
			includeContainers: z.boolean().default(false),
			waitForIdle: z.boolean().default(false),
			allowUnknown: z.boolean().default(false),
			timeoutMs: z.number().int().positive().default(180_000),
		},
	},
	async ({ includeContainers, waitForIdle: shouldWait, allowUnknown, timeoutMs }) =>
		withClient(url, async (client) => {
			const files = shouldWait ? await waitForIdle(client, { timeoutMs, allowUnknown }) : await client.getFiles()
			const failedFiles = filterFiles(files, "fail")
			return textResult({
				url: client.baseUrl,
				summary: summarizeFiles(files),
				failures: collectFailures(failedFiles, { includeContainers }),
			})
		}),
)

const transport = new StdioServerTransport()
await server.connect(transport)
console.error(`[vitest-ui-mcp] ready: ${url}`)

function shutdown() {
	if (child && !child.killed) {
		child.kill("SIGTERM")
	}
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
process.on("exit", shutdown)
