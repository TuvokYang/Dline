import { strict as assert } from "node:assert"
import * as api from "@core/api"
import * as profileStore from "@core/controller/file/getApiProfiles"
import { PromptRegistry } from "@core/prompts/system-prompt"
import { ClineToolSet } from "@core/prompts/system-prompt/registry/ClineToolSet"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import { afterEach, describe, it, vi } from "vitest"
// sinon import removed: using vitest globals
import { ClineDefaultTool } from "@/shared/tools"
import { AgentConfigLoader } from "../AgentConfigLoader"
import { SUBAGENT_DEFAULT_ALLOWED_TOOLS, SUBAGENT_SYSTEM_SUFFIX, SubagentBuilder } from "../SubagentBuilder"

/**
 * Create the minimal task config needed by SubagentBuilder tests.
 *
 * @param mode Current global mode returned by state manager.
 * @param provider Current act and plan profile name.
 * @returns TaskConfig test double.
 */
function createTaskConfig(mode: "act" | "plan", provider: string): TaskConfig {
	return {
		ulid: "ulid-123",
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) => (key === "mode" ? mode : undefined),
				getApiConfiguration: () =>
					({
						actModeProfile: provider,
						planModeProfile: provider,
						actModeApiModelId: "act-default",
						planModeApiModelId: "plan-default",
						actModeOpenAiModelId: "openai-act-default",
						planModeOpenRouterModelId: "openrouter-plan-default",
					}) as any,
			},
		},
	} as unknown as TaskConfig
}

describe("SubagentBuilder", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("uses cached config profile when it supports subagents", () => {
		vi.spyOn(AgentConfigLoader, "getInstance").mockReturnValue({
			getCachedConfig: (subagentName?: string) =>
				subagentName === "cached-agent"
					? {
							name: "cached-agent",
							description: "cached description",
							tools: [ClineDefaultTool.LIST_FILES],
							profile: "subagent-profile",
							systemPrompt: "cached system prompt",
						}
					: undefined,
		} as unknown as AgentConfigLoader)
		vi.spyOn(profileStore, "readApiProfiles").mockReturnValue([
			{ name: "subagent-profile", enabled: true, usedFor: ["subagents"] },
		] as ReturnType<typeof profileStore.readApiProfiles>)

		const fakeHandler = { getModel: vi.fn(), createMessage: vi.fn() }
		const buildApiHandlerStub = vi.spyOn(api, "buildApiHandler").mockReturnValue(fakeHandler as never)

		const builder = new SubagentBuilder(createTaskConfig("act", "act-default-profile"), "cached-agent")

		assert.equal(buildApiHandlerStub.mock.calls.length, 1)
		const [effectiveApiConfig, selectedMode] = buildApiHandlerStub.mock.calls[0]
		assert.equal(selectedMode, "act")
		assert.equal((effectiveApiConfig as Record<string, unknown>).ulid, "ulid-123")
		assert.equal((effectiveApiConfig as Record<string, unknown>).actModeProfile, "subagent-profile")
		assert.equal((effectiveApiConfig as Record<string, unknown>).planModeProfile, "act-default-profile")

		assert.deepEqual(builder.getAllowedTools(), [ClineDefaultTool.LIST_FILES, ClineDefaultTool.ATTEMPT])
		const prompt = builder.buildSystemPrompt("generated system prompt")
		assert.match(prompt, /# Agent Profile/)
		assert.match(prompt, /Name: cached-agent/)
		assert.match(prompt, /Description: cached description/)
		assert.match(prompt, /cached system prompt/)
		assert.match(prompt, new RegExp(SUBAGENT_SYSTEM_SUFFIX.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
	})

	it("uses defaults when no cached config is provided", () => {
		vi.spyOn(AgentConfigLoader, "getInstance").mockReturnValue({
			getCachedConfig: () => undefined,
		} as unknown as AgentConfigLoader)

		vi.spyOn(api, "buildApiHandler").mockReturnValue({ getModel: vi.fn(), createMessage: vi.fn() } as never)
		const builder = new SubagentBuilder(createTaskConfig("act", "anthropic"))

		assert.deepEqual(builder.getAllowedTools(), SUBAGENT_DEFAULT_ALLOWED_TOOLS)
		const prompt = builder.buildSystemPrompt("generated prompt")
		assert.equal(prompt, `generated prompt${SUBAGENT_SYSTEM_SUFFIX}`)
	})

	it("falls back to default act profile when configured profile is missing", () => {
		vi.spyOn(AgentConfigLoader, "getInstance").mockReturnValue({
			getCachedConfig: (subagentName?: string) =>
				subagentName === "missing-profile-agent"
					? {
							name: "missing-profile-agent",
							description: "missing profile agent",
							tools: [ClineDefaultTool.FILE_READ],
							profile: "deleted-profile",
							systemPrompt: "fallback system",
						}
					: undefined,
		} as unknown as AgentConfigLoader)
		vi.spyOn(profileStore, "readApiProfiles").mockReturnValue([
			{ name: "another-profile", enabled: true, usedFor: ["subagents"] },
		] as ReturnType<typeof profileStore.readApiProfiles>)

		const buildApiHandlerStub = vi.spyOn(api, "buildApiHandler").mockReturnValue({
			getModel: vi.fn(),
			createMessage: vi.fn(),
		} as never)

		new SubagentBuilder(createTaskConfig("plan", "act-default-profile"), "missing-profile-agent")

		const [effectiveApiConfig, selectedMode] = buildApiHandlerStub.mock.calls[0]
		assert.equal(selectedMode, "act")
		assert.equal((effectiveApiConfig as Record<string, unknown>).actModeProfile, "act-default-profile")
		assert.equal((effectiveApiConfig as Record<string, unknown>).planModeProfile, "act-default-profile")
	})

	it("falls back to default act profile when configured profile is disabled or not for subagents", () => {
		vi.spyOn(AgentConfigLoader, "getInstance").mockReturnValue({
			getCachedConfig: (subagentName?: string) =>
				subagentName === "disabled-agent"
					? {
							name: "disabled-agent",
							description: "disabled profile agent",
							tools: [ClineDefaultTool.FILE_READ],
							profile: "disabled-profile",
							systemPrompt: "fallback system",
						}
					: undefined,
		} as unknown as AgentConfigLoader)
		vi.spyOn(profileStore, "readApiProfiles").mockReturnValue([
			{ name: "disabled-profile", enabled: false, usedFor: ["subagents"] },
			{ name: "plan-only-profile", enabled: true, usedFor: ["plan"] },
		] as ReturnType<typeof profileStore.readApiProfiles>)

		const buildApiHandlerStub = vi.spyOn(api, "buildApiHandler").mockReturnValue({
			getModel: vi.fn(),
			createMessage: vi.fn(),
		} as never)

		new SubagentBuilder(createTaskConfig("act", "act-default-profile"), "disabled-agent")

		const [effectiveApiConfig, selectedMode] = buildApiHandlerStub.mock.calls[0]
		assert.equal(selectedMode, "act")
		assert.equal((effectiveApiConfig as Record<string, unknown>).actModeProfile, "act-default-profile")
	})

	it("builds native tools by filtering allowed ids and context requirements then converting", () => {
		vi.spyOn(AgentConfigLoader, "getInstance").mockReturnValue({
			getCachedConfig: (subagentName?: string) =>
				subagentName === "tools-agent"
					? {
							name: "tools-agent",
							description: "tool-limited",
							tools: [ClineDefaultTool.LIST_FILES],
							profile: "tool-profile",
							systemPrompt: "tool prompt",
						}
					: undefined,
		} as unknown as AgentConfigLoader)
		vi.spyOn(api, "buildApiHandler").mockReturnValue({ getModel: vi.fn(), createMessage: vi.fn() } as never)

		const getModelFamilyStub = vi
			.spyOn(PromptRegistry.getInstance(), "getModelFamily")
			.mockReturnValue("test-family" as never)
		const getToolsStub = vi.spyOn(ClineToolSet, "getToolsForVariantWithFallback").mockReturnValue([
			{
				config: {
					id: ClineDefaultTool.LIST_FILES,
					contextRequirements: () => true,
				},
			},
			{
				config: {
					id: ClineDefaultTool.SEARCH,
					contextRequirements: () => true,
				},
			},
			{
				config: {
					id: ClineDefaultTool.ATTEMPT,
					contextRequirements: () => false,
				},
			},
		] as never)
		const converter = vi.fn().mockImplementation((tool: { id: string }) => ({ converted: tool.id }))
		const getConverterStub = vi.spyOn(ClineToolSet, "getNativeConverter").mockReturnValue(converter as never)

		const builder = new SubagentBuilder(createTaskConfig("act", "anthropic"), "tools-agent")

		const context = {
			providerInfo: {
				providerId: "anthropic",
				model: { id: "m1" },
			},
		} as never

		const result = builder.buildNativeTools(context)
		assert.equal(getModelFamilyStub.mock.calls.length, 1)
		assert.equal(getToolsStub.mock.calls.length, 1)
		assert.equal(getConverterStub.mock.calls.length, 1)
		assert.deepEqual(result, [{ converted: ClineDefaultTool.LIST_FILES }])
	})
})
