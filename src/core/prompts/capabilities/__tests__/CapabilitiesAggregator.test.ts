import fs from "fs/promises"
import os from "os"
import path from "path"
import { describe, expect, it, vi } from "vitest"
import { collectCapabilities } from "../CapabilitiesAggregator"

vi.mock("@core/context/instructions/user-instructions/skills", () => ({
	discoverAvailableSkills: vi.fn(async () => [{ name: "writer", description: "Write text", path: "skill", source: "project" }]),
}))

describe("collectCapabilities", () => {
	it("collects MCP and skill capabilities with only name and description", async () => {
		const snapshot = await collectCapabilities({
			cwd: process.cwd(),
			mcpHub: {
				getServers: () => [
					{
						name: "server",
						config: "{}",
						status: "connected" as const,
						tools: [{ name: "tool", description: "Run tool", inputSchema: { type: "object" } }],
					},
				],
			},
		})

		expect(snapshot.mcp).toEqual([{ name: "server.tool", description: "Run tool" }])
		expect(snapshot.skills).toEqual([{ name: "writer", description: "Write text" }])
		expect(JSON.stringify(snapshot)).not.toContain("inputSchema")
	})

	it("collects workflow and subagent capabilities from project files", async () => {
		const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "dline-capabilities-"))
		try {
			const workflowDir = path.join(cwd, ".agents", "workflows")
			const subagentDir = path.join(cwd, ".agents", "subagents")
			await fs.mkdir(workflowDir, { recursive: true })
			await fs.mkdir(subagentDir, { recursive: true })
			await fs.writeFile(
				path.join(workflowDir, "release.md"),
				"---\nname: release\ndescription: Release flow\n---\nbody",
				"utf8",
			)
			await fs.writeFile(
				path.join(subagentDir, "reviewer.yaml"),
				"---\nname: reviewer\ndescription: Review code\ntools: []\n---\nReview system prompt",
				"utf8",
			)

			const snapshot = await collectCapabilities({ cwd })

			expect(snapshot.workflows).toEqual([{ name: "release", description: "Release flow" }])
			expect(snapshot.subagents).toEqual([{ name: "reviewer", description: "Review code" }])
			expect(JSON.stringify(snapshot)).not.toContain("systemPrompt")
		} finally {
			await fs.rm(cwd, { recursive: true, force: true })
		}
	})
})
