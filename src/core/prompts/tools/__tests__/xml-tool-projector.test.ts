import { describe, expect, it } from "vitest"
import { toolParamNames } from "../../../assistant-message"
import { SystemPromptGenerator } from "../../generators/SystemPromptGenerator"
import { ToolPromptGenerator } from "../../generators/ToolPromptGenerator"
import { PromptProfile } from "../../profiles/types"
import type { SystemPromptContext } from "../../system-prompt/context"
import { STANDARD_TOOL_SPECS } from "../tool-specs"

const BASE_CONTEXT = {
	promptProfile: PromptProfile.Standard,
	cwd: "/workspace/project",
	ide: "Test IDE",
	providerInfo: {
		providerId: "openai",
		model: { id: "tool-matrix", info: { id: "tool-matrix", capabilities: {} } },
		mode: "act",
	},
	enableNativeToolCalls: false,
	supportsBrowserUse: true,
	browserSettings: { viewport: { width: 1440, height: 900 }, disableToolUse: false },
	isMultiRootEnabled: true,
	workspaceRoots: [
		{ name: "primary", path: "/workspace/project" },
		{ name: "opaque", path: "literal @CWD@" },
	],
	focusChainSettings: { enabled: false, remindClineInterval: 0 },
	terminalCommandTimeoutSeconds: 1800,
	isTesting: true,
} as SystemPromptContext

describe("XML tool projection", () => {
	it("keeps every canonical parameter recognizable by the XML parser", () => {
		const parserParams = new Set<string>(toolParamNames)
		const missingParams = [
			...new Set(STANDARD_TOOL_SPECS.flatMap((tool) => tool.parameters?.map((parameter) => parameter.name) ?? [])),
		].filter((name) => !parserParams.has(name))

		expect(missingParams).toEqual([])
	})

	it("documents the complete execute_command directory and lifecycle contract", () => {
		const xml = new ToolPromptGenerator().generateXml(PromptProfile.Standard, BASE_CONTEXT)

		expect(xml).toContain("<workdirectory>")
		expect(xml).toContain("<background>")
		expect(xml).toContain("<synchronous>")
		expect(xml).toContain("<timeout>")
		expect(xml).toContain("<mute_stdout>")
		expect(xml).toContain("outside every project root requires user approval")
		expect(xml).toContain("background process")
		expect(xml).toContain("absolute maximum runtime")
		expect(xml).toContain("zero or a negative integer")
		expect(xml).toContain("default is @TERMINAL_COMMAND_TIMEOUT_SECONDS@ seconds")
		expect(xml).toContain("10-second background handoff")
		expect(xml).toContain("certain the command's stdout is not needed")
		expect(xml).toContain("If you are unsure whether stdout is needed")
		expect(xml).toContain("On failure")
		expect(xml).not.toContain("foreground wait")
	})

	it("documents kill_command separately with its exact function identity", () => {
		const xml = new ToolPromptGenerator().generateXml(PromptProfile.Standard, BASE_CONTEXT)

		expect(xml).toContain("## kill_command")
		expect(xml).toContain("- function_id: (required)")
		expect(xml).toContain("does not cancel the task or other commands")
	})

	it("keeps canonical runtime tokens unresolved until the System facade final scan", async () => {
		const generator = new ToolPromptGenerator()
		const xml = generator.generateXml(PromptProfile.Standard, BASE_CONTEXT)

		expect(xml).toContain("@CWD@")
		expect(xml).toContain("@MULTI_ROOT_HINT@")
		expect(xml).toContain("@BROWSER_VIEWPORT_WIDTH@x@BROWSER_VIEWPORT_HEIGHT@")
		expect(xml).not.toContain("/workspace/project")
		expect(xml).not.toContain("1440x900")
		expect(xml).not.toContain("{{")

		const output = await new SystemPromptGenerator(generator).generate(BASE_CONTEXT)

		expect(output.systemPrompt).toContain("/workspace/project")
		expect(output.systemPrompt).toContain("1440x900")
		expect(output.systemPrompt).toContain("opaque: literal @CWD@")
		expect(output.systemPrompt).not.toContain("@MULTI_ROOT_HINT@")
		expect(output.systemPrompt).not.toContain("@BROWSER_VIEWPORT_WIDTH@")
		expect(output.systemPrompt).not.toContain("@BROWSER_VIEWPORT_HEIGHT@")
		expect(output.systemPrompt).toContain("default is 1800 seconds")
		expect(output.systemPrompt).not.toContain("@TERMINAL_COMMAND_TIMEOUT_SECONDS@")
		expect(output.systemPrompt).not.toContain("{{")
	})

	it("uses the same focus fragment gates as provider-native projection", () => {
		const generator = new ToolPromptGenerator()
		const enabled = generator.generateXml(PromptProfile.Standard, {
			...BASE_CONTEXT,
			focusChainSettings: { enabled: true, remindClineInterval: 6 },
		})
		const disabled = generator.generateXml(PromptProfile.Standard, BASE_CONTEXT)

		expect(enabled).toContain("task_progress checklist")
		expect(enabled).toContain("current task is fully complete")
		expect(enabled).toContain("- task_progress: (optional)")
		expect(enabled).not.toContain("After each tool use")
		expect(disabled).not.toContain("task_progress checklist")
		expect(disabled).toContain("current task is fully complete")
		expect(disabled).not.toContain("- task_progress: (optional)")
	})

	it("projects spawn_task into the Standard XML projection", () => {
		const xml = new ToolPromptGenerator().generateXml(PromptProfile.Standard, {
			...BASE_CONTEXT,
			promptProfile: PromptProfile.Standard,
			subagentsEnabled: true,
			isSubagentRun: false,
		})

		expect(xml).toContain("## spawn_task")
		expect(xml).toContain("<spawn_task>")
	})

	it("keeps spawn_task out of the Lite XML projection", () => {
		const xml = new ToolPromptGenerator().generateXml(PromptProfile.Lite, {
			...BASE_CONTEXT,
			promptProfile: PromptProfile.Lite,
			subagentsEnabled: true,
			isSubagentRun: false,
		})

		expect(xml).not.toContain("## spawn_task")
		expect(xml).not.toContain("<spawn_task>")
	})

	it("keeps Lite XML free of subagent, LSP, browser, and web tools", () => {
		const xml = new ToolPromptGenerator().generateXml(PromptProfile.Lite, {
			...BASE_CONTEXT,
			promptProfile: PromptProfile.Lite,
			subagentsEnabled: true,
			isSubagentRun: false,
			supportsBrowserUse: true,
			clineWebToolsEnabled: true,
		})
		const excludedHeadings = [
			"## use_subagent",
			"## use_subagents",
			"## find_references",
			"## rename",
			"## replace_text",
			"## browser_action",
			"## web_fetch",
			"## web_search",
		]

		for (const heading of excludedHeadings) expect(xml).not.toContain(heading)
	})

	it.each([
		PromptProfile.Standard,
		PromptProfile.Lite,
	])("does not document recursive task or subagent tools during a %s subagent run", (profile) => {
		const xml = new ToolPromptGenerator().generateXml(profile, {
			...BASE_CONTEXT,
			promptProfile: profile,
			subagentsEnabled: true,
			isSubagentRun: true,
		})

		expect(xml).not.toContain("## spawn_task")
		expect(xml).not.toContain("## use_subagent")
		expect(xml).not.toContain("## use_subagents")
	})
})
