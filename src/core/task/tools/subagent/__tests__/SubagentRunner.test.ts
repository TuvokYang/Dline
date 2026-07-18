import { strict as assert } from "node:assert"
import { afterEach, describe, it, vi } from "vitest"

vi.mock("@/config", () => ({
	ClineEndpoint: {
		isSelfHosted: () => false,
		init: () => {},
		config: {
			environment: "production",
			appBaseUrl: "https://app.dline.bot",
			apiBaseUrl: "https://api.dline.bot",
			mcpBaseUrl: "https://mcp.cline.bot",
		},
	},
	ClineEnv: {
		config: () => ({}) as any,
		setEnvironment: () => {},
		getEnvironment: () => "production",
	},
	ClineConfigurationError: class extends Error {
		constructor(m: string) {
			super(m)
			this.name = "ClineConfigurationError"
		}
	},
	Environment: { production: "production" },
}))

import * as coreApi from "@core/api"
import * as skills from "@core/context/instructions/user-instructions/skills"
import { PromptProfile } from "@core/prompts/profiles/types"
import * as systemPromptFacade from "@core/prompts/system-prompt"
import type { SystemPromptContext } from "@core/prompts/system-prompt/context"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import type { GlobalInstructionsFile } from "@shared/remote-config/schema"
import { HostProvider } from "@/hosts/host-provider"
import { ApiFormat } from "@/shared/proto/dline/models"
import { Logger } from "@/shared/services/Logger"
import { ClineDefaultTool } from "@/shared/tools"
import { TaskState } from "../../../TaskState"
import { SubagentBuilder } from "../SubagentBuilder"
import { SubagentRunner } from "../SubagentRunner"

function initializeHostProvider() {
	HostProvider.reset()
	HostProvider.initialize(
		() => ({}) as never,
		() => ({}) as never,
		() => ({}) as never,
		() => ({}) as never,
		{
			workspaceClient: {},
			envClient: { getHostVersion: async () => ({ platform: "test" }) },
			windowClient: {},
			diffClient: {},
		} as never,
		() => undefined,
		async () => "",
		async () => "",
		"",
		"",
	)
}

function createRemoteSkillEntry(
	name: string,
	description: string,
	options: { alwaysEnabled?: boolean } = {},
): GlobalInstructionsFile {
	return {
		name,
		alwaysEnabled: options.alwaysEnabled ?? false,
		contents: `---\nname: ${name}\ndescription: ${description}\n---\nInstructions for ${name}.`,
	}
}

function createTaskConfig(nativeToolCallEnabled: boolean, options: any = {}): TaskConfig {
	return {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/tmp",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		doubleCheckCompletionEnabled: false,
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: false,
		isSubagentExecution: false,
		context: {},
		taskState: new TaskState(),
		messageState: {},
		api: {
			getModel: () => ({
				id: "anthropic/claude-sonnet-4.5",
				info: {
					contextWindow: options.contextWindow ?? 200_000,
					apiFormat: ApiFormat.ANTHROPIC_CHAT,
					supportsPromptCache: true,
					capabilities: {
						contextWindow: options.contextWindow ?? 200_000,
						supportsImages: false,
						supportsPromptCache: true,
					},
				},
			}),
			createMessage: vi.fn().mockImplementation(async function* () {}),
		},
		services: {
			stateManager: {
				getGlobalSettingsKey: (key: string) =>
					key === "mode" ? "act" : key === "globalSkillsToggles" ? options.globalSkillsToggles : undefined,
				getGlobalStateKey: (key: string) =>
					key === "nativeToolCallEnabled"
						? nativeToolCallEnabled
						: key === "remoteSkillsToggles"
							? options.remoteSkillsToggles
							: undefined,
				getWorkspaceStateKey: (key: string) => (key === "localSkillsToggles" ? options.localSkillsToggles : undefined),
				getRemoteConfigSettings: () => ({
					remoteGlobalSkills: options.remoteGlobalSkills ?? [],
				}),
				getApiConfiguration: () => ({
					actModeProfile: "anthropic",
					planModeProfile: "anthropic",
				}),
			},
		},
		browserSettings: {},
		focusChainSettings: {},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: { executeSafeCommands: false, executeAllCommands: false },
		},
		autoApprover: {
			shouldAutoApproveTool: vi.fn().mockReturnValue([false, false]),
		},
		callbacks: {
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
			saveCheckpoint: vi.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing"),
			removeLastPartialMessageIfExistsWithType: vi.fn().mockResolvedValue(undefined),
			executeCommandTool: vi.fn().mockResolvedValue([false, "ok"]),
			cancelRunningCommandTool: vi.fn().mockResolvedValue(false),
			doesLatestTaskCompletionHaveNewChanges: vi.fn().mockResolvedValue(false),
			updateFCListFromToolResponse: vi.fn().mockResolvedValue(undefined),
			shouldAutoApproveTool: vi.fn().mockReturnValue([true, true]),
			shouldAutoApproveToolWithPath: vi.fn().mockResolvedValue(false),
			postStateToWebview: vi.fn().mockResolvedValue(undefined),
			reinitExistingTaskFromId: vi.fn().mockResolvedValue(undefined),
			cancelTask: vi.fn().mockResolvedValue(undefined),
			updateTaskHistory: vi.fn().mockResolvedValue([]),
			applyLatestBrowserSettings: vi.fn().mockResolvedValue(undefined),
			switchToActMode: vi.fn().mockResolvedValue(false),
			setActiveHookExecution: vi.fn().mockResolvedValue(undefined),
			clearActiveHookExecution: vi.fn().mockResolvedValue(undefined),
			getActiveHookExecution: vi.fn().mockResolvedValue(undefined),
			runUserPromptSubmitHook: vi.fn().mockResolvedValue({}),
		},
		coordinator: {
			getHandler: vi.fn().mockImplementation((toolName: any) => {
				if (toolName === ClineDefaultTool.LIST_FILES)
					return {
						execute: vi.fn().mockResolvedValue("ok"),
						getDescription: vi.fn().mockReturnValue("list_files"),
					}
				return undefined
			}),
		},
	} as unknown as TaskConfig
}

/** Stubs the stable profile facade used by subagent tests. */
function stubSystemPrompt(native: boolean, inspectContext?: (context: SystemPromptContext) => void): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(systemPromptFacade, "getSystemPrompt").mockImplementation(async (context) => {
		inspectContext?.(context)
		return {
			systemPrompt: "system prompt",
			tools: native
				? [
						{
							type: "function",
							function: { name: ClineDefaultTool.LIST_FILES, description: "List files" },
						},
					]
				: undefined,
			profile: PromptProfile.Native,
			warnings: [],
		}
	})
}

function stubApiHandler(createMessage: any, contextWindow = 200_000) {
	vi.spyOn(coreApi, "buildApiHandler").mockReturnValue({
		abort: vi.fn(),
		getModel: () => ({
			id: "anthropic/claude-sonnet-4.5",
			info: {
				contextWindow,
				apiFormat: ApiFormat.ANTHROPIC_CHAT,
				supportsPromptCache: true,
				capabilities: { contextWindow, supportsImages: false, supportsPromptCache: true },
			},
		}),
		createMessage,
	} as never)
}

describe("SubagentRunner", () => {
	afterEach(() => {
		HostProvider.reset()
		vi.restoreAllMocks()
	})

	it.each([
		[63_999, PromptProfile.Lite],
		[64_000, PromptProfile.Native],
	] as const)("resolves context window %s to %s before building the subagent prompt", async (contextWindow, expected) => {
		const createMessage = vi.fn().mockImplementation(async function* () {
			yield {
				type: "tool_calls",
				function_id: "profile-complete",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		stubSystemPrompt(false, (context) => {
			assert.equal(context.promptProfile, expected)
		})
		vi.spyOn(skills, "discoverSkills").mockResolvedValue([])
		vi.spyOn(skills, "getAvailableSkills").mockReturnValue([])
		stubApiHandler(createMessage, contextWindow)
		initializeHostProvider()

		const result = await new SubagentRunner(createTaskConfig(false, { contextWindow })).run("Use profile", () => {})

		assert.equal(result.status, "completed", result.error)
	})

	it("builds subagent prompts through the stable system prompt facade", async () => {
		const createMessage = vi.fn().mockImplementation(async function* (systemPrompt: string) {
			assert.match(systemPrompt, /^facade system prompt/)
			yield {
				type: "tool_calls",
				function_id: "facade-complete",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const facade = vi.spyOn(systemPromptFacade, "getSystemPrompt").mockImplementation(async (context) => {
			assert.equal(context.isSubagentRun, true)
			return {
				systemPrompt: "facade system prompt",
				tools: undefined,
				profile: PromptProfile.Native,
				warnings: [],
			}
		})
		vi.spyOn(skills, "discoverSkills").mockResolvedValue([])
		vi.spyOn(skills, "getAvailableSkills").mockReturnValue([])
		stubApiHandler(createMessage)
		initializeHostProvider()

		const result = await new SubagentRunner(createTaskConfig(false)).run("Use facade", () => {})

		assert.equal(facade.mock.calls.length, 1)
		assert.equal(result.status, "completed")
		assert.equal(result.result, "done")
	})

	it("emits native tool blocks with matching canonical identities across turns", async () => {
		const createMessage = vi.fn()
		createMessage.mockImplementationOnce(async function* () {
			yield {
				type: "tool_calls",
				function_id: "toolu_subagent_1",
				tool_index: 0,
				tool_call: {
					function: {
						name: ClineDefaultTool.LIST_FILES,
						arguments: JSON.stringify({ path: ".", recursive: false }),
					},
				},
			}
		})
		createMessage.mockImplementationOnce(async function* (_s: string, c: unknown[]) {
			const am = c[1] as any
			assert.equal(am.role, "assistant")
			const tu = am.content.find((b: any) => b.type === "tool_use")
			assert.ok(tu)
			assert.equal(tu.function_id, "toolu_subagent_1")
			assert.ok(tu.dline_tid)
			assert.equal("id" in tu, false)
			assert.equal("call_id" in tu, false)
			const um = c[2] as any
			assert.equal(um.role, "user")
			const tr = um.content.find((b: any) => b.type === "tool_result")
			assert.ok(tr)
			assert.equal(tr.function_id, tu.function_id)
			assert.equal(tr.dline_tid, tu.dline_tid)
			assert.equal("tool_use_id" in tr, false)
			assert.equal("call_id" in tr, false)
			yield {
				type: "tool_calls",
				function_id: "toolu_subagent_complete_1",
				tool_index: 0,
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		stubSystemPrompt(true)
		vi.spyOn(skills, "discoverSkills").mockResolvedValue([])
		vi.spyOn(skills, "getAvailableSkills").mockReturnValue([])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(createTaskConfig(true))
		const result = await runner.run("List files", () => {})
		assert.equal(result.status, "completed", result.error)
		assert.equal(result.result, "done")
		assert.equal(createMessage.mock.calls.length, 2)
	})

	it("passes prior request token totals into the next-turn compaction check", async () => {
		const createMessage = vi.fn()
		createMessage.mockImplementationOnce(async function* () {
			yield {
				type: "usage",
				inputTokens: 11,
				outputTokens: 7,
				cacheWriteTokens: 3,
				cacheReadTokens: 2,
			}
			yield {
				type: "tool_calls",
				function_id: "toolu_subagent_previous_tokens_1",
				tool_call: {
					function: {
						name: ClineDefaultTool.LIST_FILES,
						arguments: JSON.stringify({ path: ".", recursive: false }),
					},
				},
			}
		})
		createMessage.mockImplementationOnce(async function* () {
			yield {
				type: "tool_calls",
				function_id: "toolu_subagent_previous_tokens_complete_1",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		stubSystemPrompt(true)
		vi.spyOn(skills, "discoverSkills").mockResolvedValue([])
		vi.spyOn(skills, "getAvailableSkills").mockReturnValue([])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(createTaskConfig(true))
		const scs = vi.spyOn(runner as any, "shouldCompactBeforeNextRequest").mockImplementation((...args: unknown[]) => {
			assert.equal(args[0], 23)
			return false
		})
		const result = await runner.run("List files", () => {})
		assert.equal(result.status, "completed")
		assert.equal(result.result, "done")
		assert.equal(createMessage.mock.calls.length, 2)
		assert.equal(scs.mock.calls.length, 1)
	})

	it("falls back to non-native result blocks if structured tool calls appear while native mode is disabled", async () => {
		const createMessage = vi.fn()
		createMessage.mockImplementationOnce(async function* () {
			yield {
				type: "tool_calls",
				function_id: "toolu_subagent_2",
				tool_call: {
					function: {
						name: ClineDefaultTool.LIST_FILES,
						arguments: JSON.stringify({ path: ".", recursive: false }),
					},
				},
			}
		})
		createMessage.mockImplementationOnce(async function* (_s: string, c: unknown[]) {
			const lm = c[c.length - 1] as any
			assert.equal(lm.role, "user")
			assert.ok(lm.content.every((b: any) => b.type === "text"))
			yield {
				type: "tool_calls",
				function_id: "toolu_subagent_complete_2",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		stubSystemPrompt(false)
		vi.spyOn(skills, "discoverSkills").mockResolvedValue([])
		vi.spyOn(skills, "getAvailableSkills").mockReturnValue([])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(createTaskConfig(false))
		const result = await runner.run("List files", () => {})
		assert.equal(result.status, "completed")
		assert.equal(result.result, "done")
		assert.equal(createMessage.mock.calls.length, 2)
	})

	it("retries empty assistant turns with a no-tools-used nudge before failing", async () => {
		const createMessage = vi.fn()
		createMessage.mockImplementationOnce(async function* () {})
		createMessage.mockImplementationOnce(async function* (_s: string, c: unknown[]) {
			const la = c[1] as any
			assert.equal(la.role, "assistant")
			assert.equal(la.content[0]?.type, "text")
			assert.equal(la.content[0]?.text, "Failure: I did not provide a response.")
			const lu = c[2] as any
			assert.equal(lu.role, "user")
			assert.match(lu.content[0]?.text || "", /You did not use a tool/)
			yield {
				type: "tool_calls",
				function_id: "toolu_subagent_complete_3",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		stubSystemPrompt(false)
		vi.spyOn(skills, "discoverSkills").mockResolvedValue([])
		vi.spyOn(skills, "getAvailableSkills").mockReturnValue([])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(createTaskConfig(false))
		const result = await runner.run("List files", () => {})
		assert.equal(result.status, "completed")
		assert.equal(result.result, "done")
		assert.equal(createMessage.mock.calls.length, 2)
	})

	it("retries initial stream failures before failing", async () => {
		const createMessage = vi.fn()
		const errMsg = '{"code":"stream_initialization_failed","message":"Failed to create stream"}'
		createMessage.mockImplementationOnce(async function* () {
			yield* []
			throw new Error(errMsg)
		})
		createMessage.mockImplementationOnce(async function* () {
			yield* []
			throw new Error(errMsg)
		})
		createMessage.mockImplementationOnce(async function* () {
			yield* []
			throw new Error(errMsg)
		})
		stubSystemPrompt(false)
		vi.spyOn(skills, "discoverSkills").mockResolvedValue([])
		vi.spyOn(skills, "getAvailableSkills").mockReturnValue([])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(createTaskConfig(false))
		const result = await runner.run("List files", () => {})
		assert.equal(result.status, "failed")
		assert.equal(createMessage.mock.calls.length, 3)
		assert.match(result.error || "", /stream_initialization_failed/i)
	})

	it("fails context window errors", async () => {
		const createMessage = vi.fn()
		createMessage.mockImplementationOnce(async function* () {
			yield* []
			const e = new Error("context length exceeded")
			;(e as any).status = 400
			throw e
		})
		stubSystemPrompt(false)
		vi.spyOn(skills, "discoverSkills").mockResolvedValue([])
		vi.spyOn(skills, "getAvailableSkills").mockReturnValue([])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(createTaskConfig(false))
		const result = await runner.run("Huge prompt", () => {})
		assert.equal(result.status, "failed")
		assert.equal(createMessage.mock.calls.length, 1)
		assert.match(result.error || "", /context length exceeded/i)
	})

	it("uses the configured task api handler for subagent requests", async () => {
		const createMessage = vi.fn().mockImplementation(async function* () {
			yield {
				type: "tool_calls",
				function_id: "t1",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		stubSystemPrompt(true)
		vi.spyOn(skills, "discoverSkills").mockResolvedValue([])
		vi.spyOn(skills, "getAvailableSkills").mockReturnValue([])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(createTaskConfig(true))
		const result = await runner.run("List files", () => {})
		assert.equal(result.status, "completed")
		assert.equal(createMessage.mock.calls.length, 1)
	})

	it("filters available skills to configured skills when subagent skills are configured", async () => {
		const createMessage = vi.fn().mockImplementation(async function* () {
			yield {
				type: "tool_calls",
				function_id: "tsf1",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		stubSystemPrompt(false, (context) => {
			assert.deepEqual(
				context.skills?.map((skill) => skill.name),
				["allowed-skill"],
			)
		})
		vi.spyOn(SubagentBuilder.prototype, "getConfiguredSkills").mockReturnValue(["allowed-skill"])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(
			createTaskConfig(false, {
				remoteGlobalSkills: [createRemoteSkillEntry("allowed-skill", "A"), createRemoteSkillEntry("other-skill", "O")],
			}),
		)
		const result = await runner.run("Run task", () => {})
		assert.equal(result.status, "completed")
		assert.equal(createMessage.mock.calls.length, 1)
	})

	it("uses all available skills when subagent skills are not configured", async () => {
		const createMessage = vi.fn().mockImplementation(async function* () {
			yield {
				type: "tool_calls",
				function_id: "tsu1",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		stubSystemPrompt(false, (context) => {
			assert.deepEqual(
				context.skills?.map((skill) => skill.name),
				["alpha-skill", "beta-skill"],
			)
		})
		vi.spyOn(SubagentBuilder.prototype, "getConfiguredSkills").mockReturnValue(undefined)
		vi.spyOn(skills, "discoverAvailableSkills").mockResolvedValue([
			{ name: "alpha-skill", description: "A", path: "r:a", source: "global" },
			{ name: "beta-skill", description: "B", path: "r:b", source: "global" },
		])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(createTaskConfig(false))
		const result = await runner.run("Run task", () => {})
		assert.equal(result.status, "completed")
		assert.equal(createMessage.mock.calls.length, 1)
	})

	it("logs a warning when a configured skill is not available", async () => {
		const createMessage = vi.fn().mockImplementation(async function* () {
			yield {
				type: "tool_calls",
				function_id: "tsm1",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const warnStub = vi.spyOn(Logger, "warn").mockImplementation(() => undefined)
		stubSystemPrompt(false, (context) => {
			assert.deepEqual(
				context.skills?.map((skill) => skill.name),
				["present-skill"],
			)
		})
		vi.spyOn(SubagentBuilder.prototype, "getConfiguredSkills").mockReturnValue(["present-skill", "missing-skill"])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(
			createTaskConfig(false, {
				remoteGlobalSkills: [createRemoteSkillEntry("present-skill", "P")],
			}),
		)
		const result = await runner.run("Run task", () => {})
		assert.equal(result.status, "completed")
		assert.equal(createMessage.mock.calls.length, 1)
		assert.ok(
			warnStub.mock.calls.some((c) => c.some((a) => String(a).includes("missing-skill"))),
			"Expected warn about missing skill",
		)
	})

	it("includes enabled remote skills in subagent context and preserves configured remote names", async () => {
		const createMessage = vi.fn().mockImplementation(async function* () {
			yield {
				type: "tool_calls",
				function_id: "trs1",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const remoteGlobalSkills = [
			createRemoteSkillEntry("remote-enabled", "E"),
			createRemoteSkillEntry("remote-disabled", "D"),
			createRemoteSkillEntry("remote-locked", "L", { alwaysEnabled: true }),
		]
		stubSystemPrompt(false, (context) => {
			assert.deepEqual(
				context.skills?.map((skill) => skill.name),
				["remote-enabled", "remote-locked"],
			)
		})
		vi.spyOn(SubagentBuilder.prototype, "getConfiguredSkills").mockReturnValue([
			"remote-enabled",
			"remote-disabled",
			"remote-locked",
		])
		vi.spyOn(skills, "discoverSkills").mockImplementation(async (_c: any, re: any) => {
			assert.deepEqual(re, remoteGlobalSkills)
			return [
				{
					name: "remote-enabled",
					description: "E",
					path: "r:re",
					source: "global",
				},
				{
					name: "remote-disabled",
					description: "D",
					path: "r:rd",
					source: "global",
				},
				{
					name: "remote-locked",
					description: "L",
					path: "r:rl",
					source: "global",
				},
			]
		})
		vi.spyOn(skills, "getAvailableSkills").mockImplementation((as: any) => as)
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(
			createTaskConfig(false, {
				remoteGlobalSkills,
				remoteSkillsToggles: {
					"remote-disabled": false,
					"remote-locked": false,
				},
			}),
		)
		const result = await runner.run("Run task", () => {})
		assert.equal(result.status, "completed")
		assert.equal(createMessage.mock.calls.length, 1)
	})

	it("includes workspace metadata only in the initial user message", async () => {
		const createMessage = vi.fn()
		createMessage.mockImplementationOnce(async function* (_s: string, c: unknown[]) {
			const iu = c[0] as any
			assert.equal(iu.role, "user")
			assert.match(
				iu.content
					.filter((b: any) => b.type === "text")
					.map((b: any) => b.text || "")
					.join("\n"),
				/# Workspace Configuration/,
			)
			yield {
				type: "tool_calls",
				function_id: "tww1",
				tool_call: {
					function: {
						name: ClineDefaultTool.LIST_FILES,
						arguments: JSON.stringify({ path: ".", recursive: false }),
					},
				},
			}
		})
		createMessage.mockImplementationOnce(async function* (_s: string, c: unknown[]) {
			const fu = c[2] as any
			assert.equal(fu.role, "user")
			assert.equal(
				fu.content
					.filter((b: any) => b.type === "text")
					.map((b: any) => b.text || "")
					.join("\n")
					.includes("# Workspace Configuration"),
				false,
			)
			yield {
				type: "tool_calls",
				function_id: "twwc1",
				tool_call: {
					function: {
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		stubSystemPrompt(true)
		vi.spyOn(skills, "discoverSkills").mockResolvedValue([])
		vi.spyOn(skills, "getAvailableSkills").mockReturnValue([])
		stubApiHandler(createMessage)
		initializeHostProvider()
		const runner = new SubagentRunner(createTaskConfig(true))
		const result = await runner.run("List files", () => {})
		assert.equal(result.status, "completed")
		assert.equal(result.result, "done")
		assert.equal(createMessage.mock.calls.length, 2)
	})
})
