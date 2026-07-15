import { describe, expect, it } from "vitest"
import { SystemPromptGenerator } from "../../generators/SystemPromptGenerator"
import { ToolPromptGenerator } from "../../generators/ToolPromptGenerator"
import type { SystemPromptContext } from "../context"

const CONNECTED_MCP_HUB = {
	getServers: () => [
		{
			uid: "matrix",
			name: "Matrix Server",
			config: "{}",
			status: "connected" as const,
			tools: [],
		},
	],
}

const BASE_CONTEXT = {
	cwd: "/workspace/project",
	ide: "Test IDE",
	providerInfo: {
		providerId: "cline",
		model: { id: "matrix-model", info: { id: "matrix-model", capabilities: {} } },
		mode: "act",
	},
	supportsBrowserUse: true,
	browserSettings: { viewport: { width: 1280, height: 800 }, disableToolUse: false },
	mcpHub: CONNECTED_MCP_HUB,
	focusChainSettings: { enabled: true, remindClineInterval: 6 },
	skills: [{ name: "review", description: "Review code changes.", path: "/skills/review.md", source: "project" }],
	subagentsEnabled: true,
	clineWebToolsEnabled: true,
	enableParallelToolCalling: true,
	yoloModeToggled: false,
	isCliEnvironment: false,
	isTesting: true,
} as unknown as SystemPromptContext

/** Extracts stable names from provider-native tool shapes. */
function toolNames(tools: ReturnType<ToolPromptGenerator["generate"]>): readonly string[] {
	return (tools ?? [])
		.map((tool) => {
			if ("function" in tool) return tool.function.name
			return "name" in tool ? tool.name : "[UNEXPECTED_TOOL_SHAPE]"
		})
		.filter((name): name is string => typeof name === "string")
}

/** Generates one explicit profile/transport matrix candidate. */
async function generate(profile: "native" | "lite", transport: "native" | "xml", overrides: Partial<SystemPromptContext> = {}) {
	const context = {
		...BASE_CONTEXT,
		...overrides,
		providerInfo: {
			...BASE_CONTEXT.providerInfo,
			...overrides.providerInfo,
			customPrompt: profile === "lite" ? "lite" : undefined,
		},
		enableNativeToolCalls: transport === "native",
	} as SystemPromptContext
	return new SystemPromptGenerator().generate(context)
}

/** Reports whether one tool is exposed through the selected transport. */
function exposes(result: Awaited<ReturnType<typeof generate>>, transport: "native" | "xml", name: string): boolean {
	return transport === "native" ? toolNames(result.tools).includes(name) : result.systemPrompt.includes(`## ${name}`)
}

describe("Native/Lite transport and capability behavior matrix", () => {
	it.each([
		["native", "native"],
		["native", "xml"],
		["lite", "native"],
		["lite", "xml"],
	] as const)("preserves exact profile restrictions for %s/%s", async (profile, transport) => {
		const result = await generate(profile, transport)

		expect(result.profile).toBe(profile)
		expect(result.warnings).toEqual([])
		expect(exposes(result, transport, "read_file")).toBe(true)
		expect(exposes(result, transport, "browser_action")).toBe(profile === "native")
		expect(exposes(result, transport, "use_mcp_tool")).toBe(profile === "native")
		expect(exposes(result, transport, "web_search")).toBe(profile === "native")
	})

	it.each(["native", "xml"] as const)("applies browser support and disable gates for Native/%s", async (transport) => {
		const unsupported = await generate("native", transport, { supportsBrowserUse: false })
		const disabled = await generate("native", transport, {
			browserSettings: { viewport: { width: 1280, height: 800 }, disableToolUse: true },
		})

		expect(exposes(unsupported, transport, "browser_action")).toBe(false)
		expect(exposes(disabled, transport, "browser_action")).toBe(false)
	})

	it.each(["native", "xml"] as const)("requires a connected enabled MCP server for Native/%s", async (transport) => {
		const disconnected = await generate("native", transport, {
			mcpHub: {
				getServers: () => [
					{
						uid: "offline",
						name: "Offline Server",
						config: "{}",
						status: "disconnected" as const,
						tools: [],
					},
				],
			} as unknown as SystemPromptContext["mcpHub"],
		})
		const disabled = await generate("native", transport, {
			mcpHub: {
				getServers: () => [
					{
						uid: "disabled",
						name: "Disabled Server",
						config: "{}",
						status: "connected" as const,
						disabled: true,
						tools: [],
					},
				],
			} as unknown as SystemPromptContext["mcpHub"],
		})

		expect(exposes(disconnected, transport, "use_mcp_tool")).toBe(false)
		expect(exposes(disabled, transport, "use_mcp_tool")).toBe(false)
	})

	it.each([
		"native",
		"xml",
	] as const)("preserves focus, subagent, web, CLI, yolo, and parallel gates for Native/%s", async (transport) => {
		const result = await generate("native", transport, {
			focusChainSettings: { enabled: false, remindClineInterval: 0 },
			subagentsEnabled: false,
			clineWebToolsEnabled: false,
			isCliEnvironment: true,
			yoloModeToggled: true,
			enableParallelToolCalling: false,
		})

		expect(exposes(result, transport, "focus_chain_change")).toBe(false)
		expect(exposes(result, transport, "use_subagents")).toBe(false)
		expect(exposes(result, transport, "web_search")).toBe(false)
		expect(exposes(result, transport, "generate_explanation")).toBe(false)
		expect(exposes(result, transport, "ask_followup_question")).toBe(false)
		expect(result.systemPrompt).not.toContain("You may use multiple tools in a single response")
	})
})
