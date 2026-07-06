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
import { PromptRegistry } from "@core/prompts/system-prompt"
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
					contextWindow: 200_000,
					apiFormat: ApiFormat.ANTHROPIC_CHAT,
					supportsPromptCache: true,
					capabilities: { supportsImages: false, supportsPromptCache: true },
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

function stubApiHandler(createMessage: any) {
	vi.spyOn(coreApi, "buildApiHandler").mockReturnValue({
		abort: vi.fn(),
		getModel: () => ({
			id: "anthropic/claude-sonnet-4.5",
			info: {
				contextWindow: 200_000,
				apiFormat: ApiFormat.ANTHROPIC_CHAT,
				supportsPromptCache: true,
				capabilities: { supportsImages: false, supportsPromptCache: true },
			},
		}),
		createMessage,
	} as never)
}

describe("SubagentRunner", () => {
	afterEach(() => {
		try {
			const pr = PromptRegistry.getInstance()
			if (pr) (pr as any).nativeTools = undefined
		} catch {}
		HostProvider.reset()
		vi.restoreAllMocks()
	})

	it("emits native tool_use blocks with matching tool_result tool_use_id across turns", async () => {
		const createMessage = vi.fn()
		createMessage.mockImplementationOnce(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_1",
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
			assert.equal(tu.id, "toolu_subagent_1")
			const um = c[2] as any
			assert.equal(um.role, "user")
			const tr = um.content.find((b: any) => b.type === "tool_result")
			assert.ok(tr)
			assert.equal(tr.tool_use_id, "toolu_subagent_1")
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_complete_1",
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async () => {
			;(pr as any).nativeTools = [{ name: "list_files" }]
			return "system prompt"
		})
		vi.spyOn(SubagentBuilder.prototype, "buildNativeTools").mockReturnValue([{ name: "list_files" }] as any)
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
				tool_call: {
					function: {
						id: "toolu_subagent_previous_tokens_1",
						name: ClineDefaultTool.LIST_FILES,
						arguments: JSON.stringify({ path: ".", recursive: false }),
					},
				},
			}
		})
		createMessage.mockImplementationOnce(async function* () {
			yield {
				type: "tool_calls",
				tool_call: {
					function: {
						id: "toolu_subagent_previous_tokens_complete_1",
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async () => {
			;(pr as any).nativeTools = [{ name: "list_files" }]
			return "system prompt"
		})
		vi.spyOn(SubagentBuilder.prototype, "buildNativeTools").mockReturnValue([{ name: "list_files" }] as any)
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
				tool_call: {
					function: {
						id: "toolu_subagent_2",
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
				tool_call: {
					function: {
						id: "toolu_subagent_complete_2",
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async () => {
			;(pr as any).nativeTools = undefined
			return "system prompt"
		})
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
				tool_call: {
					function: {
						id: "toolu_subagent_complete_3",
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async () => {
			;(pr as any).nativeTools = undefined
			return "system prompt"
		})
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
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async () => {
			;(pr as any).nativeTools = undefined
			return "system prompt"
		})
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
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async () => {
			;(pr as any).nativeTools = undefined
			return "system prompt"
		})
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
				tool_call: {
					function: {
						id: "t1",
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async () => {
			;(pr as any).nativeTools = [{ name: "list_files" }]
			return "system prompt"
		})
		vi.spyOn(SubagentBuilder.prototype, "buildNativeTools").mockReturnValue([{ name: "list_files" }] as any)
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
				tool_call: {
					function: {
						id: "tsf1",
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async (ctx: any) => {
			assert.deepEqual(
				ctx.skills.map((s: any) => s.name),
				["allowed-skill"],
			)
			;(pr as any).nativeTools = undefined
			return "sp"
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
				tool_call: {
					function: {
						id: "tsu1",
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async (ctx: any) => {
			assert.deepEqual(
				ctx.skills.map((s: any) => s.name),
				["alpha-skill", "beta-skill"],
			)
			;(pr as any).nativeTools = undefined
			return "sp"
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
				tool_call: {
					function: {
						id: "tsm1",
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const warnStub = vi.spyOn(Logger, "warn").mockImplementation(() => undefined)
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async (ctx: any) => {
			assert.deepEqual(
				ctx.skills.map((s: any) => s.name),
				["present-skill"],
			)
			;(pr as any).nativeTools = undefined
			return "sp"
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
				tool_call: {
					function: {
						id: "trs1",
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
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async (ctx: any) => {
			assert.deepEqual(
				ctx.skills.map((s: any) => s.name),
				["remote-enabled", "remote-locked"],
			)
			;(pr as any).nativeTools = undefined
			return "sp"
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
				tool_call: {
					function: {
						id: "tww1",
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
				tool_call: {
					function: {
						id: "twwc1",
						name: ClineDefaultTool.ATTEMPT,
						arguments: JSON.stringify({ result: "done" }),
					},
				},
			}
		})
		const pr = PromptRegistry.getInstance()
		vi.spyOn(pr, "get").mockImplementation(async () => {
			;(pr as any).nativeTools = [{ name: "list_files" }]
			return "system prompt"
		})
		vi.spyOn(SubagentBuilder.prototype, "buildNativeTools").mockReturnValue([{ name: "list_files" }] as any)
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
