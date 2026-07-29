import { describe, expect, it, vi } from "vitest"

import { PromptProfile } from "../../profiles/types"
import { PromptScanner } from "../../template/PromptScanner"
import { assemblePromptFragments } from "../assembly/prompt-fragment-assembler"
import type { SystemPromptContext } from "../context"
import { assembleSystemPrompt, createSystemPromptConfig, prepareSystemRuntimeEnv, prepareToolUseSection } from "../pipeline"
import { SYSTEM_SECTION_IDS } from "../templates/system-template-registry"
import { createStandardSystemSections } from "../variants/section-content"

const BASE_CONTEXT: SystemPromptContext = {
	promptProfile: PromptProfile.Standard,
	cwd: "/workspace/project",
	ide: "Test IDE",
	providerInfo: {
		providerId: "cline",
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
	capabilitiesSection: "  @CWD@ capability  ",
	focusChainSettings: { enabled: true, remindClineInterval: 6 },
	globalClineRulesFileInstructions: "Global project rules.",
	preferredLanguageInstructions: "Preferred language: zh-CN.",
	skills: [{ name: "review", description: "Review code changes.", path: "/skills/review.md", source: "project" }],
	subagentsEnabled: true,
	clineWebToolsEnabled: true,
	enableNativeToolCalls: false,
	enableParallelToolCalling: true,
	yoloModeToggled: false,
	isCliEnvironment: true,
	terminalExecutionMode: "backgroundExec",
	isTesting: true,
}

describe("canonical system prompt pipeline", () => {
	it("projects the complete immutable SystemPromptConfig from typed PromptProfile input", () => {
		const context = {
			...BASE_CONTEXT,
			promptProfile: PromptProfile.Lite,
		}
		const config = createSystemPromptConfig(context)

		expect(config).toEqual({
			templateId: "integrated",
			variant: PromptProfile.Lite,
			transport: "xml",
			parallelTools: true,
			mcpEnabled: false,
			browserEnabled: true,
			focusChainEnabled: false,
			subagentsEnabled: true,
			subagentRun: false,
			yoloModeEnabled: false,
			cliEnvironment: true,
			webToolsEnabled: true,
			skillsEnabled: false,
			userInstructionsEnabled: true,
		})
		expect(Object.isFrozen(config)).toBe(true)
	})

	it("prepares one frozen complete runtime env before unresolved content preparation", () => {
		const config = createSystemPromptConfig(BASE_CONTEXT)
		const env = prepareSystemRuntimeEnv(BASE_CONTEXT, config)

		expect(Object.isFrozen(env)).toBe(true)
		expect(env).toMatchObject({
			CWD: "/workspace/project",
			PARALLEL_TOOLS_RULE: expect.stringContaining("multiple tools"),
			MCP_RULE: "",
			CLARIFY_PERMISSION: expect.stringContaining("ask the user clarifying questions"),
			PARALLEL_TOOL_POLICY: expect.stringContaining("multiple independent tools"),
			CUSTOM_INSTRUCTIONS: "Preferred language: zh-CN.\n\nGlobal project rules.",
			SKILLS_LIST: '  - "review": Review code changes.',
			OS: "macOS",
			IDE: "TestIde",
		})
		expect(Reflect.set(env, "CWD", "/mutated")).toBe(false)
		expect(env).not.toHaveProperty("XML_TOOLS_SECTION")
		expect(env).not.toHaveProperty("SUBAGENTS_GUIDANCE")
		expect(env).not.toHaveProperty("FOCUS_CHAIN_EXAMPLE_BASH")

		const sections = createStandardSystemSections(config)
		expect(sections.get("rules")).toContain("@CWD@")
		expect(sections.get("objective")).toContain("@PARALLEL_TOOL_POLICY@")
		expect(env.CWD).toBe("/workspace/project")
	})

	it("assembles the stable unresolved template with exact-empty omission and no trimming", () => {
		const sections = new Map<string, string>(SYSTEM_SECTION_IDS.map((sectionId) => [sectionId, ""] as const))
		sections.set("agent-role", "  role @CWD@  ")
		sections.set("tool-use", "@XML_TOOLS_SECTION@")
		sections.set("todo", "\n")

		expect(assembleSystemPrompt(SYSTEM_SECTION_IDS, sections, "|")).toBe("  role @CWD@  |# @XML_TOOLS_SECTION@|\n")
	})

	it("assembles tool content after env preparation without leaving structural slots", () => {
		const config = createSystemPromptConfig(BASE_CONTEXT)
		const section = prepareToolUseSection(config, "unused native section", "XML @CWD@ TOOLS")

		expect(section).toContain("XML @CWD@ TOOLS")
		expect(section).toContain("<task_progress>")
		expect(section).not.toMatch(/@(TOOL_USE_[A-Z_]+|TOOLS_SECTION|FOCUS_[A-Z_]+|XML_TOOLS_SECTION|SUBAGENTS_GUIDANCE)@/)
	})

	it("expands only declared structural slots and preserves nested runtime tokens unresolved", () => {
		expect(
			assemblePromptFragments("before @STRUCTURE@ @RUNTIME@ after", {
				STRUCTURE: "fragment @RUNTIME@ @NESTED_STRUCTURE@",
				NESTED_STRUCTURE: "must-not-expand",
			}),
		).toBe("before fragment @RUNTIME@ @NESTED_STRUCTURE@ @RUNTIME@ after")
	})

	it("rejects env keys outside the static complete-template contract", () => {
		expect(() =>
			assembleSystemPrompt(["agent-role"], new Map([["agent-role", "@CWD@"]]), "|", {
				CWD: "/workspace/project",
				RUNTIME_ONLY_SURPRISE: "not contracted",
			}),
		).toThrowError(/undeclared-key/)
	})

	it("performs one global non-recursive replacement after complete assembly", () => {
		const renderSpy = vi.spyOn(PromptScanner.prototype, "render")
		const output = assembleSystemPrompt(
			["agent-role", "tool-use"],
			new Map([
				["agent-role", "@CWD@"],
				["tool-use", "@CUSTOM_INSTRUCTIONS@"],
			]),
			"|",
			{
				CWD: "/workspace/project",
				CUSTOM_INSTRUCTIONS: "literal @CWD@",
			},
		)

		expect(output.text).toBe("/workspace/project|# literal @CWD@")
		expect(output.warnings).toEqual([])
		expect(renderSpy).toHaveBeenCalledTimes(1)
	})
})
