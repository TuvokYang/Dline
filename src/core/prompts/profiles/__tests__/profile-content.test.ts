import { describe, expect, it } from "vitest"
import { SystemPromptGenerator } from "../../generators/SystemPromptGenerator"
import { PromptProfile } from "../../profiles/types"
import type { SystemPromptContext } from "../../system-prompt/context"

const TEST_CONTEXT: SystemPromptContext = {
	promptProfile: PromptProfile.Standard,
	cwd: "/workspace/project",
	ide: "Test IDE",
	providerInfo: {
		providerId: "test-provider",
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
	skills: [{ name: "review", description: "Review code changes.", path: "/skills/review.md", source: "project" }],
	subagentsEnabled: true,
	enableNativeToolCalls: true,
	enableParallelToolCalling: true,
	yoloModeToggled: false,
	terminalExecutionMode: "backgroundExec",
	isMultiRootEnabled: true,
	workspaceRoots: [
		{ name: "frontend", path: "/workspace/frontend", vcs: "git" },
		{ name: "backend", path: "/workspace/backend", vcs: "git" },
	],
	isTesting: true,
}

/** Generates one profile candidate through the stable production facade implementation. */
async function generateProfile(profile: PromptProfile, overrides: Partial<SystemPromptContext> = {}): Promise<string> {
	const result = await new SystemPromptGenerator().generate({
		...TEST_CONTEXT,
		promptProfile: profile,
		...overrides,
	})

	expect(result.profile).toBe(profile)
	expect(result.warnings).toEqual([])
	return result.systemPrompt
}

describe("standard and lite profile content", () => {
	it("generates the full Native candidate without legacy profile identity", async () => {
		const text = await generateProfile(PromptProfile.Standard)

		expect(text).toContain("## Deliverables and Success Criteria")
		expect(text).toContain("## Tool-Calling Convention and Preambles")
		expect(text).toContain("Use qna_respond when the user asks a direct question")
		expect(text).toContain("Use ask_followup_question for user interaction")
		expect(text).toContain("Use generate_report only when the user requests a formal report")
		expect(text).toContain("and must be followed to the best of your ability")
		expect(text).not.toContain("and should be followed to the best of your ability")
		expect(text).toContain("The current working directory is `/workspace/project`")
		expect(text).toContain("Preferred language: zh-CN.")
		expect(text).not.toMatch(/\b(?:XS|compact|native-next-gen)\b/i)
	})

	it("keeps Skill guidance inside the capability catalog without a duplicate top-level section", async () => {
		const text = await generateProfile(PromptProfile.Standard, {
			capabilities: {
				mcp: [],
				skills: [{ name: "review", description: "Review code changes." }],
				workflows: [{ name: "release", description: "Run the release workflow." }],
				subagents: [],
			},
		})

		expect(text.match(/^## Skills$/gm)).toHaveLength(1)
		expect(text).not.toMatch(/^# SKILLS$/gm)
		expect(text).toContain("Use `load_skill` once")
		expect(text.indexOf("Use `load_skill` once")).toBeLessThan(text.indexOf("`review`: Review code changes."))
	})

	it("generates the compact Lite candidate without legacy profile identity", async () => {
		const text = await generateProfile(PromptProfile.Lite)

		expect(text).toContain("You are Dline, a senior software engineer")
		expect(text).toContain("FILE EDITING RULES")
		expect(text).toContain("CWD fixed: /workspace/project")
		expect(text).toContain("execute_command.workdirectory")
		expect(text).not.toContain("cd /path && cmd")
		expect(text).not.toContain("load_skill")
		expect(text).not.toContain("Review code changes.")
		expect(text).not.toContain("use_subagent")
		expect(text).not.toContain("use_subagents")
		expect(text).not.toContain("## Subagents")
		expect(text.length).toBeLessThan((await generateProfile(PromptProfile.Standard)).length)
		expect(text).not.toMatch(/\b(?:XS|compact|native-next-gen)\b/i)
	})

	it("includes Native focus-chain contracts only when enabled", async () => {
		const enabled = await generateProfile(PromptProfile.Standard)
		const disabled = await generateProfile(PromptProfile.Standard, {
			focusChainSettings: { enabled: false, remindClineInterval: 6 },
		})

		expect(enabled).toContain("task_progress")
		expect(enabled).toContain("change_todo_list")
		expect(disabled).not.toContain("task_progress")
		expect(disabled).not.toContain("change_todo_list")
	})

	it("keeps Lite free of focus-chain contracts", async () => {
		const text = await generateProfile(PromptProfile.Lite)

		expect(text).not.toContain("task_progress")
		expect(text).not.toContain("change_todo_list")
	})

	it("does not name ask_followup_question in Lite YOLO mode", async () => {
		const text = await generateProfile(PromptProfile.Lite, { yoloModeToggled: true })

		expect(text).not.toContain("ask_followup_question")
	})
})
