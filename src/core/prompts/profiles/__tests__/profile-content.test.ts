import { describe, expect, it } from "vitest"
import { SystemPromptGenerator } from "../../generators/SystemPromptGenerator"
import { PromptProfile } from "../../profiles/types"
import type { SystemPromptContext } from "../../system-prompt/context"
import { buildRuntimeEnv } from "../../system-prompt/env/runtime-env"
import { buildSystemEnv } from "../../system-prompt/env/system-env"

const TEST_CONTEXT: SystemPromptContext = {
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
async function generateProfile(profile: PromptProfile): Promise<string> {
	const result = await new SystemPromptGenerator().generate({
		...TEST_CONTEXT,
		promptProfile: profile,
	})

	expect(result.profile).toBe(profile)
	expect(result.warnings).toEqual([])
	return result.systemPrompt
}

describe("native and lite profile content", () => {
	it("projects stable system and dynamic runtime environment values", () => {
		expect(buildSystemEnv(TEST_CONTEXT)).toMatchObject({
			CWD: "/workspace/project",
			IDE_NAME: "Test IDE",
			COMMAND_ENV: "backgroundExec",
			MULTI_ROOT_HINT: " Use @workspace:path syntax (e.g., @frontend:src/index.ts) to specify a workspace.",
		})
		expect(buildSystemEnv(TEST_CONTEXT).WORKSPACE_ROOTS).toContain("frontend: /workspace/frontend (git)")
		expect(buildRuntimeEnv(TEST_CONTEXT)).toMatchObject({
			TOOL_TRANSPORT: "native",
			NATIVE_TOOLS_ENABLED: true,
			PARALLEL_TOOLS_ENABLED: true,
			BROWSER_ENABLED: true,
			BROWSER_VIEWPORT_WIDTH: 1280,
			BROWSER_VIEWPORT_HEIGHT: 800,
			SUBAGENTS_ENABLED: true,
			FOCUS_CHAIN_ENABLED: true,
			YOLO_MODE_ENABLED: false,
		})
		expect(buildRuntimeEnv(TEST_CONTEXT).USER_INSTRUCTIONS_SECTION).toBe(
			"Preferred language: zh-CN.\n\nGlobal project rules.",
		)
		expect(buildRuntimeEnv(TEST_CONTEXT).SKILLS_SECTION).toContain('"review": Review code changes.')
	})

	it("generates the full Native candidate without legacy profile identity", async () => {
		const text = await generateProfile(PromptProfile.Native)

		expect(text).toContain("## Deliverables and Success Criteria")
		expect(text).toContain("## Tool-Calling Convention and Preambles")
		expect(text).toContain("The current working directory is `/workspace/project`")
		expect(text).toContain("Preferred language: zh-CN.")
		expect(text).not.toMatch(/\b(?:XS|compact|native-next-gen)\b/i)
	})

	it("generates the compact Lite candidate without legacy profile identity", async () => {
		const text = await generateProfile(PromptProfile.Lite)

		expect(text).toContain("You are Dline, a senior software engineer")
		expect(text).toContain("FILE EDITING RULES")
		expect(text).toContain("CWD fixed: /workspace/project")
		expect(text.length).toBeLessThan((await generateProfile(PromptProfile.Native)).length)
		expect(text).not.toMatch(/\b(?:XS|compact|native-next-gen)\b/i)
	})
})
