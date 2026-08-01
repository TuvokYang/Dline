import { createTaskCapabilityToggles } from "@shared/TaskCapabilityToggles"
import { describe, expect, it, vi } from "vitest"
import type { TaskConfig } from "../types/TaskConfig"
import { LoadCapabilityService } from "./LoadCapabilityService"

function createConfig(remoteWorkflowEnabled: boolean): TaskConfig {
	return {
		cwd: "E:/workspace/project",
		capabilityToggles: createTaskCapabilityToggles({
			remoteWorkflowToggles: { "review-release": remoteWorkflowEnabled },
		}),
		services: {
			mcpHub: {
				getServers: vi.fn().mockReturnValue([]),
			},
			stateManager: {
				getRemoteConfigSettings: vi.fn().mockReturnValue({
					remoteGlobalWorkflows: [
						{
							name: "review-release",
							contents: "---\ndescription: Review a release\n---\nCheck the release.",
							alwaysEnabled: false,
						},
					],
				}),
				getGlobalStateKey: vi.fn().mockReturnValue({ "review-release": true }),
				getGlobalSettingsKey: vi.fn().mockReturnValue({}),
				getWorkspaceStateKey: vi.fn().mockReturnValue({}),
			},
		},
	} as unknown as TaskConfig
}

describe("LoadCapabilityService task capability scope", () => {
	it("does not load a remote workflow disabled in the current task", async () => {
		const payload = await new LoadCapabilityService().load("workflow", "review-release", createConfig(false))

		expect(payload.status).toBe("failed")
		expect(payload.error).toContain("Unknown or disabled workflow")
	})

	it("loads a remote workflow enabled in the current task", async () => {
		const payload = await new LoadCapabilityService().load("workflow", "review-release", createConfig(true))

		expect(payload.status).toBe("completed")
		expect(payload.body).toBe("Check the release.")
	})

	it("does not load an MCP tool disabled in the current task", async () => {
		const config = createConfig(true)
		config.capabilityToggles.mcpServers["shared-server"] = false
		vi.mocked(config.services.mcpHub.getServers).mockReturnValue([
			{
				name: "shared-server",
				status: "connected",
				disabled: false,
				config: "{}",
				tools: [{ name: "lookup", description: "Lookup" }],
				resources: [],
				resourceTemplates: [],
				prompts: [],
			},
		])

		const payload = await new LoadCapabilityService().load("mcp", "shared-server.lookup", config)

		expect(payload.status).toBe("failed")
		expect(payload.error).toContain("Unknown or unavailable MCP tool")
	})
})
