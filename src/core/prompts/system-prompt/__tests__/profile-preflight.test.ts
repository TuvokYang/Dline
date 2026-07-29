import { describe, expect, it, vi } from "vitest"

import { SystemPromptGenerator } from "../../generators/SystemPromptGenerator"
import { ToolPromptGenerator } from "../../generators/ToolPromptGenerator"
import { PromptProfile } from "../../profiles/types"
import { PromptScanner } from "../../template/PromptScanner"
import type { SystemPromptContext } from "../context"

const BASE_CONTEXT: SystemPromptContext = {
	promptProfile: PromptProfile.Native,
	cwd: "/workspace/project",
	ide: "Test IDE",
	providerInfo: {
		providerId: "openai",
		model: {
			id: "test-model",
			info: { id: "test-model", capabilities: { supportsImages: false, supportsPromptCache: false } },
		},
		mode: "act",
	},
	supportsBrowserUse: true,
	browserSettings: {
		viewport: { width: 1280, height: 800 },
		disableToolUse: false,
	},
	capabilitiesSection: "# Capabilities\n- load_skill: Load one skill.",
	focusChainSettings: { enabled: true, remindClineInterval: 6 },
	globalClineRulesFileInstructions: "Global project rules.",
	preferredLanguageInstructions: "Preferred language: zh-CN.",
	subagentsEnabled: true,
	enableNativeToolCalls: true,
	enableParallelToolCalling: true,
	yoloModeToggled: false,
	terminalExecutionMode: "backgroundExec",
	isTesting: true,
}

/** Extracts stable names from provider-native function tool shapes. */
function toolNames(tools: Awaited<ReturnType<ToolPromptGenerator["generate"]>>): string[] {
	return (tools ?? []).map((tool) => {
		if ("function" in tool) {
			return tool.function.name
		}
		return "[UNEXPECTED_TOOL_SHAPE]"
	})
}

describe("profile facade preflight", () => {
	it("generates explicit Native with the complete established section content and ordered tools", async () => {
		const result = await new SystemPromptGenerator().generate(BASE_CONTEXT)

		expect(result.profile).toBe(PromptProfile.Native)
		expect(result.warnings).toEqual([])
		expect(result.systemPrompt).toContain("You prioritize modular, decoupled solutions over monolithic code")
		expect(result.systemPrompt).toContain("## TURN-END Tools")
		expect(result.systemPrompt).toContain("UPDATING TASK PROGRESS")
		expect(result.systemPrompt).toContain("## Task Closure Contract")
		expect(result.systemPrompt).toContain("The current working directory is `/workspace/project`")
		expect(result.systemPrompt).not.toContain("[MISSING:")
		expect(toolNames(result.tools)).toHaveLength(25)
		expect(toolNames(result.tools).slice(0, 3)).toEqual(["write_to_file", "replace_in_file", "read_file"])
		expect(toolNames(result.tools)).not.toContain("generate_explanation")
	})

	it("preserves the established Native section order", async () => {
		const prompt = (await new SystemPromptGenerator().generate(BASE_CONTEXT)).systemPrompt
		const sectionMarkers = [
			"\n\n# TOOL USE\n",
			"\n\n# UPDATING TASK PROGRESS\n",
			"\n\n# ACT MODE V.S. PLAN MODE\n",
			"\n\n# CAPABILITIES\n",
			"\n\n# FEEDBACK\n",
			"\n\n# RULES\n",
			"\n\n# SYSTEM INFORMATION\n",
			"\n\n# OBJECTIVE\n",
			"\n\n# USER'S CUSTOM INSTRUCTIONS\n",
		]

		let previousIndex = -1
		for (const marker of sectionMarkers) {
			const currentIndex = prompt.indexOf(marker)
			expect(currentIndex, `missing Native section marker: ${marker.trim()}`).toBeGreaterThan(previousIndex)
			previousIndex = currentIndex
		}
	})

	it("selects Lite only for the exact explicit value and enforces restricted tools", async () => {
		const context: SystemPromptContext = {
			...BASE_CONTEXT,
			providerInfo: BASE_CONTEXT.providerInfo,
			promptProfile: PromptProfile.Lite,
		}
		const result = await new SystemPromptGenerator().generate(context)
		const names = toolNames(result.tools)

		expect(result.profile).toBe(PromptProfile.Lite)
		expect(result.warnings).toEqual([])
		expect(result.systemPrompt).toContain("You are Dline, a senior software engineer + precise task runner")
		expect(result.systemPrompt).toContain("MODES (STRICT)")
		expect(result.systemPrompt).toContain("CURIOSITY & FIRST CONTACT")
		expect(result.systemPrompt).toContain("FILE EDITING RULES")
		expect(names).toHaveLength(20)
		expect(names).toContain("use_subagent")
		expect(names).toContain("use_subagents")
		expect(names).not.toContain("load_subagent")
		expect(names).not.toContain("browser_action")
		expect(names).not.toContain("use_mcp_tool")
		expect(names).not.toContain("apply_patch")
	})

	it("does not select a profile from model or provider identity", async () => {
		const context: SystemPromptContext = {
			...BASE_CONTEXT,
			providerInfo: {
				...BASE_CONTEXT.providerInfo,
				providerId: "ollama",
				customPrompt: "compact",
				model: { ...BASE_CONTEXT.providerInfo.model, id: "xs-model" },
			},
		}

		expect((await new SystemPromptGenerator().generate(context)).profile).toBe(PromptProfile.Native)
	})

	it("projects the complete XML tool documentation into the system prompt", async () => {
		const result = await new SystemPromptGenerator().generate({ ...BASE_CONTEXT, enableNativeToolCalls: false })

		expect(result.tools).toBeUndefined()
		expect(result.systemPrompt).toContain("# Tool Use Formatting")
		expect(result.systemPrompt).toContain("## write_to_file")
		expect(result.systemPrompt).toContain("Description:")
		expect(result.systemPrompt).toContain("Parameters:")
		expect(result.systemPrompt).toContain("- absolutePath: (required)")
		expect(result.systemPrompt).toContain("Usage:\n<write_to_file>")
		expect(result.systemPrompt).toContain("<absolutePath></absolutePath>")
		expect(result.systemPrompt).toContain("## replace_in_file")
	})

	it("prepares the complete runtime env before generating XML tool content", async () => {
		let envPrepared = false
		const context = {
			...BASE_CONTEXT,
			enableNativeToolCalls: false,
			get workspaceRoots() {
				envPrepared = true
				return undefined
			},
		} satisfies SystemPromptContext
		class OrderedToolGenerator extends ToolPromptGenerator {
			public override generateXml(profile: PromptProfile, toolContext: SystemPromptContext): string {
				expect(envPrepared).toBe(true)
				return super.generateXml(profile, toolContext)
			}
		}

		await new SystemPromptGenerator(new OrderedToolGenerator()).generate(context)
	})

	it("returns the System trace from its single non-recursive complete-template scan", async () => {
		const renderSpy = vi.spyOn(PromptScanner.prototype, "render")
		const context: SystemPromptContext = {
			...BASE_CONTEXT,
			enableNativeToolCalls: false,
			preferredLanguageInstructions: "literal @CWD@",
		}

		try {
			const result = await new SystemPromptGenerator().generate(context)

			expect(renderSpy).toHaveBeenCalledTimes(1)
			expect(result.systemPrompt).toContain("literal @CWD@")
			const trace = result.trace ?? []
			expect(trace).toContainEqual({ key: "CWD", stage: "runtime", source: "system-runtime-env" })
			expect(trace).toContainEqual({
				key: "CUSTOM_INSTRUCTIONS",
				stage: "runtime",
				source: "system-runtime-env",
			})
			expect(trace.every((entry) => entry.source === "system-runtime-env")).toBe(true)
			expect(trace.filter((entry) => entry.key === "CWD")).toHaveLength(1)
		} finally {
			renderSpy.mockRestore()
		}
	})

	it("keeps one System scan plus one independent Tool scan only for native transport", async () => {
		const renderSpy = vi.spyOn(PromptScanner.prototype, "render")
		const contexts: readonly SystemPromptContext[] = [
			BASE_CONTEXT,
			{ ...BASE_CONTEXT, enableNativeToolCalls: false },
			{
				...BASE_CONTEXT,
				providerInfo: BASE_CONTEXT.providerInfo,
				promptProfile: PromptProfile.Lite,
			},
			{
				...BASE_CONTEXT,
				enableNativeToolCalls: false,
				providerInfo: BASE_CONTEXT.providerInfo,
				promptProfile: PromptProfile.Lite,
			},
		]

		try {
			for (const context of contexts) {
				renderSpy.mockClear()
				await new SystemPromptGenerator().generate(context)
				expect(renderSpy).toHaveBeenCalledTimes(context.enableNativeToolCalls ? 2 : 1)
			}
		} finally {
			renderSpy.mockRestore()
		}
	})

	it("removes browser, MCP, and focus-chain content at their established gates", async () => {
		const generator = new SystemPromptGenerator()
		const noBrowser = await generator.generate({ ...BASE_CONTEXT, enableNativeToolCalls: false, supportsBrowserUse: false })
		const noMcp = await generator.generate({ ...BASE_CONTEXT, enableNativeToolCalls: false, mcpHub: undefined })
		const noFocus = await generator.generate({
			...BASE_CONTEXT,
			enableNativeToolCalls: false,
			focusChainSettings: { enabled: false, remindClineInterval: 0 },
		})

		expect(noBrowser.systemPrompt).not.toContain("## browser_action")
		expect(noMcp.systemPrompt).not.toContain("## use_mcp_tool")
		expect(noMcp.systemPrompt).not.toContain("MCP SERVERS")
		expect(noFocus.systemPrompt).not.toContain("UPDATING TASK PROGRESS")
		expect(noFocus.systemPrompt).not.toContain("FEEDBACK")
	})
})
