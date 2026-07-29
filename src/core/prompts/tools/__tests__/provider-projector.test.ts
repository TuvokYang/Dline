import { describe, expect, it } from "vitest"
import { ClineDefaultTool } from "../../../../shared/tools"
import { ToolPromptGenerator } from "../../generators/ToolPromptGenerator"
import { getPrompt } from "../../i18n"
import { PromptProfile } from "../../profiles/types"
import type { SystemPromptContext } from "../../system-prompt/context"

const BASE_CONTEXT = {
	promptProfile: PromptProfile.Native,
	providerInfo: { providerId: "openai", model: { id: "model", info: {} } },
	enableNativeToolCalls: true,
} as SystemPromptContext

/** Finds one projected tool by stable provider name. */
function findTool(tools: ReturnType<ToolPromptGenerator["generate"]>, name: string) {
	return (tools ?? []).find((tool) => {
		if ("function" in tool) return tool.function.name === name
		return "name" in tool && tool.name === name
	})
}

/** Reads the provider-neutral description from any projected tool shape. */
function toolDescription(tool: ReturnType<typeof findTool>): string | undefined {
	if (!tool) return undefined
	if ("function" in tool) return tool.function.description
	return "description" in tool ? tool.description : undefined
}

describe("provider tool projector", () => {
	it("projects canonical parameters to OpenAI schemas", () => {
		const tools = new ToolPromptGenerator().generate(PromptProfile.Native, BASE_CONTEXT)
		const tool = findTool(tools, ClineDefaultTool.FILE_READ)

		expect(tool).toMatchObject({
			type: "function",
			function: {
				name: ClineDefaultTool.FILE_READ,
				parameters: { required: ["path"] },
			},
		})
	})

	it("resolves canonical runtime tokens at the native transport boundary without recursive insertion", () => {
		const context = {
			...BASE_CONTEXT,
			cwd: "/workspace/project",
			browserSettings: { viewport: { width: 1440, height: 900 }, disableToolUse: false },
			supportsBrowserUse: true,
			isMultiRootEnabled: true,
			workspaceRoots: [
				{ name: "primary", path: "/workspace/project" },
				{ name: "opaque", path: "literal @CWD@" },
			],
		} as SystemPromptContext

		const tools = new ToolPromptGenerator().generate(PromptProfile.Native, context)
		const fileTool = findTool(tools, ClineDefaultTool.FILE_READ)
		const browserTool = findTool(tools, ClineDefaultTool.BROWSER)
		const serialized = JSON.stringify([fileTool, browserTool])

		expect(serialized).toContain("/workspace/project")
		expect(serialized).toContain("opaque: literal @CWD@")
		expect(serialized).toContain("1440x900")
		expect(serialized).not.toContain("@MULTI_ROOT_HINT@")
		expect(serialized).not.toContain("@BROWSER_VIEWPORT_WIDTH@")
		expect(serialized).not.toContain("@BROWSER_VIEWPORT_HEIGHT@")
	})

	it.each([
		["openai", "function", "boolean", "integer"],
		["anthropic", "anthropic", "boolean", "integer"],
		["gemini", "gemini", "BOOLEAN", "NUMBER"],
	] as const)("projects optional execute_command workdirectory, background, and timeout for %s", (providerId, shape, boolType, intType) => {
		const context = { ...BASE_CONTEXT, providerInfo: { ...BASE_CONTEXT.providerInfo, providerId } }
		const tool = findTool(new ToolPromptGenerator().generate(PromptProfile.Native, context), ClineDefaultTool.BASH)
		const projected = tool as unknown as {
			function?: { parameters?: unknown }
			input_schema?: unknown
			parameters?: unknown
		}
		const schema =
			shape === "function"
				? projected.function?.parameters
				: shape === "anthropic"
					? projected.input_schema
					: projected.parameters

		expect(schema).toMatchObject({
			required: ["command", "requires_approval"],
			properties: {
				workdirectory: { type: shape === "gemini" ? "STRING" : "string" },
				background: { type: boolType },
				timeout: { type: intType },
			},
		})
	})

	it.each([
		PromptProfile.Native,
		PromptProfile.Lite,
	])("exposes singular and parallel subagent tools without load_subagent in %s", (profile) => {
		const context = { ...BASE_CONTEXT, subagentsEnabled: true, isSubagentRun: false }
		const tools = new ToolPromptGenerator().generate(profile, context)

		expect(findTool(tools, ClineDefaultTool.USE_SUBAGENT)).toBeDefined()
		expect(findTool(tools, ClineDefaultTool.USE_SUBAGENTS)).toBeDefined()
		expect(findTool(tools, "load_subagent")).toBeUndefined()
	})

	it("projects use_subagent with agent_name, task, and context", () => {
		const context = { ...BASE_CONTEXT, subagentsEnabled: true, isSubagentRun: false }
		const tool = findTool(new ToolPromptGenerator().generate(PromptProfile.Native, context), ClineDefaultTool.USE_SUBAGENT)

		expect(tool).toMatchObject({
			function: {
				parameters: {
					required: ["task", "context"],
					properties: {
						agent_name: { type: "string" },
						task: { type: "string" },
						context: { type: "string" },
					},
				},
			},
		})
	})

	it.each([
		PromptProfile.Native,
		PromptProfile.Lite,
	])("does not expose recursive task or subagent tools during a %s subagent run", (profile) => {
		const context = { ...BASE_CONTEXT, subagentsEnabled: true, isSubagentRun: true }
		const tools = new ToolPromptGenerator().generate(profile, context)

		expect(findTool(tools, ClineDefaultTool.SPAWN_TASK)).toBeUndefined()
		expect(findTool(tools, ClineDefaultTool.USE_SUBAGENT)).toBeUndefined()
		expect(findTool(tools, ClineDefaultTool.USE_SUBAGENTS)).toBeUndefined()
	})

	it("projects canonical parameters to Anthropic schemas", () => {
		const context = { ...BASE_CONTEXT, providerInfo: { ...BASE_CONTEXT.providerInfo, providerId: "anthropic" } }
		const tool = findTool(new ToolPromptGenerator().generate(PromptProfile.Native, context), ClineDefaultTool.FILE_READ)

		expect(tool).toMatchObject({ name: ClineDefaultTool.FILE_READ, input_schema: { required: ["path"] } })
	})

	it("includes dependency-gated parameters only when their tool dependency is enabled", () => {
		const enabledContext = { ...BASE_CONTEXT, focusChainSettings: { enabled: true, remindClineInterval: 6 } }
		const disabledContext = { ...BASE_CONTEXT, focusChainSettings: { enabled: false, remindClineInterval: 6 } }

		const enabledTool = findTool(
			new ToolPromptGenerator().generate(PromptProfile.Native, enabledContext),
			ClineDefaultTool.FILE_READ,
		)
		const disabledTool = findTool(
			new ToolPromptGenerator().generate(PromptProfile.Native, disabledContext),
			ClineDefaultTool.FILE_READ,
		)

		expect(enabledTool).toMatchObject({ function: { parameters: { properties: { task_progress: {} } } } })
		expect(disabledTool).not.toMatchObject({ function: { parameters: { properties: { task_progress: {} } } } })
	})

	it("projects the original Native focus guidance and task_progress only when enabled", () => {
		const profile = PromptProfile.Native
		const enabledContext = {
			...BASE_CONTEXT,
			promptProfile: profile,
			focusChainSettings: { enabled: true, remindClineInterval: 6 },
		}
		const disabledContext = {
			...enabledContext,
			focusChainSettings: { enabled: false, remindClineInterval: 6 },
		}
		const generator = new ToolPromptGenerator()
		const enabledAttempt = findTool(generator.generate(profile, enabledContext), ClineDefaultTool.ATTEMPT)
		const disabledAttempt = findTool(generator.generate(profile, disabledContext), ClineDefaultTool.ATTEMPT)

		expect(toolDescription(enabledAttempt)).toBe(getPrompt("attemptCompletion", "nativeDescription"))
		expect(toolDescription(enabledAttempt)).toContain("[TURN-END]")
		expect(toolDescription(enabledAttempt)).toContain("current task is fully complete")
		expect(toolDescription(enabledAttempt)).toContain("every checklist item must already be marked [x]")
		expect(toolDescription(enabledAttempt)).not.toContain("After each tool use")
		expect(toolDescription(enabledAttempt)).not.toContain("only for completing implementation or development tasks")
		expect(toolDescription(disabledAttempt)).toContain("[TURN-END]")
		expect(toolDescription(disabledAttempt)).toContain("current task is fully complete")
		expect(toolDescription(disabledAttempt)).not.toContain("task_progress")
		expect(enabledAttempt).not.toMatchObject({ function: { parameters: { properties: { task_progress: {} } } } })
		expect(disabledAttempt).not.toMatchObject({ function: { parameters: { properties: { task_progress: {} } } } })

		const expectedDescriptions = [
			[ClineDefaultTool.MAKE_PLAN, getPrompt("makePlan", "description")],
			[ClineDefaultTool.STATUS_UPDATE, getPrompt("statusUpdate", "nativeDescription")],
		] as const

		for (const [toolId, expectedDescription] of expectedDescriptions) {
			const enabled = findTool(generator.generate(profile, enabledContext), toolId)
			const disabled = findTool(generator.generate(profile, disabledContext), toolId)

			expect(toolDescription(enabled)).toBe(expectedDescription)
			expect(enabled).toMatchObject({ function: { parameters: { properties: { task_progress: {} } } } })
			expect(JSON.stringify(enabled)).toContain("task_progress")
			expect(JSON.stringify(disabled)).not.toContain("task_progress")
			expect(disabled).not.toMatchObject({ function: { parameters: { properties: { task_progress: {} } } } })
		}

		const enabledPlan = findTool(generator.generate(profile, enabledContext), ClineDefaultTool.MAKE_PLAN)
		expect(enabledPlan).toMatchObject({
			function: {
				name: "make_plan",
				parameters: {
					properties: { needs_more_exploration: { type: "boolean" } },
				},
			},
		})
	})

	it("keeps Lite free of focus guidance and task_progress even when the caller enables focus", () => {
		const context = {
			...BASE_CONTEXT,
			promptProfile: PromptProfile.Lite,
			focusChainSettings: { enabled: true, remindClineInterval: 6 },
		}
		const tools = new ToolPromptGenerator().generate(PromptProfile.Lite, context)

		expect(JSON.stringify(tools)).not.toContain("task_progress")
		expect(JSON.stringify(tools)).not.toContain("focus_chain_change")
	})

	it("keeps the active Native web descriptions and prompt parameter text", () => {
		const context = {
			...BASE_CONTEXT,
			providerInfo: { ...BASE_CONTEXT.providerInfo, providerId: "cline" },
			clineWebToolsEnabled: true,
		}
		const tools = new ToolPromptGenerator().generate(PromptProfile.Native, context)
		const fetchTool = findTool(tools, ClineDefaultTool.WEB_FETCH)
		const searchTool = findTool(tools, ClineDefaultTool.WEB_SEARCH)

		expect(toolDescription(fetchTool)).toBe(getPrompt("webFetch", "nativeDescription"))
		expect(toolDescription(searchTool)).toBe(getPrompt("webSearch", "nativeDescription"))
		expect(fetchTool).toMatchObject({
			function: {
				parameters: {
					properties: {
						prompt: { description: getPrompt("webFetch", "nativePromptInstruction") },
					},
				},
			},
		})
	})

	it("appends enabled MCP schemas only to Native", () => {
		const context = {
			...BASE_CONTEXT,
			mcpHub: {
				getServers: () => [
					{
						uid: "srv",
						name: "server",
						config: "{}",
						status: "connected" as const,
						tools: [
							{
								name: "weather",
								description: "Weather",
								inputSchema: {
									type: "object",
									properties: {
										city: { type: "string", description: "City", enum: ["Paris", "Tokyo"] },
										options: {
											type: "object",
											properties: { units: { type: "string", enum: ["metric", "imperial"] } },
										},
									},
									required: ["city"],
								},
							},
						],
					},
				],
			},
		} as SystemPromptContext

		const nativeTools = new ToolPromptGenerator().generate(PromptProfile.Native, context)
		const liteTools = new ToolPromptGenerator().generate(PromptProfile.Lite, context)

		expect(findTool(nativeTools, "srv0mcp0weather")).toMatchObject({
			function: {
				parameters: {
					required: ["city"],
					properties: {
						city: { enum: ["Paris", "Tokyo"] },
						options: { properties: { units: { enum: ["metric", "imperial"] } } },
					},
				},
			},
		})
		expect(findTool(liteTools, "srv0mcp0weather")).toBeUndefined()
	})

	it("projects canonical parameters to Gemini declarations", () => {
		const context = { ...BASE_CONTEXT, providerInfo: { ...BASE_CONTEXT.providerInfo, providerId: "gemini" } }
		const tool = findTool(new ToolPromptGenerator().generate(PromptProfile.Native, context), ClineDefaultTool.FILE_READ)

		expect(tool).toMatchObject({
			name: ClineDefaultTool.FILE_READ,
			parameters: { required: ["path"] },
		})
	})
})
