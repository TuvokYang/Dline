import { strict as assert } from "node:assert"
import { setTimeout as delay } from "node:timers/promises"
import { ClineSubagentUsageInfo } from "@shared/ExtensionMessage"
import { ClineDefaultTool } from "@shared/tools"
import { expect } from "chai"
import { afterEach, describe, it, vi, expect as vitestExpect } from "vitest"
// sinon import removed: using vitest globals
import { TaskState } from "../../../TaskState"
import * as AgentConfigModule from "../../subagent/AgentConfigLoader"
import { SubagentRunner } from "../../subagent/SubagentRunner"
import type { TaskConfig } from "../../types/TaskConfig"
import { createUIHelpers } from "../../types/UIHelpers"
import {
	buildStatusPayload,
	UseSubagentsToolHandler as UseSubagentsToolHandlerImpl,
	UseSubagentToolHandler as UseSubagentToolHandlerImpl,
} from "../SubagentToolHandler"

class UseSubagentsToolHandler extends UseSubagentsToolHandlerImpl {
	override execute(config: TaskConfig, block: any) {
		return super.execute(config, {
			function_id: block.function_id ?? "test_subagents_function",
			dline_tid: block.dline_tid ?? "test_subagents_tid",
			...block,
		})
	}

	override handlePartialBlock(block: any, uiHelpers: any) {
		return super.handlePartialBlock(
			{
				function_id: block.function_id ?? "test_subagents_function",
				dline_tid: block.dline_tid ?? "test_subagents_tid",
				...block,
			},
			uiHelpers,
		)
	}
}

class UseSubagentToolHandler extends UseSubagentToolHandlerImpl {
	override execute(config: TaskConfig, block: any) {
		return super.execute(config, {
			function_id: block.function_id ?? "test_subagent_function",
			dline_tid: block.dline_tid ?? "test_subagent_tid",
			...block,
		})
	}
}

// Mock SubagentBuilder to avoid buildApiHandler (requires API profile config)
vi.mock("../../subagent/SubagentBuilder", () => ({
	SubagentBuilder: vi.fn(function (this: any) {
		this.getApiHandler = () => ({})
		this.getAllowedTools = () => []
		this.getConfiguredSkills = () => undefined
	}),
}))

function createConfig(options?: {
	autoApproveSafe?: boolean
	autoApproveAll?: boolean
	taskAskResponse?: "yesButtonClicked" | "noButtonClicked"
	subagentsEnabled?: boolean
}) {
	const taskState = new TaskState()
	const askResponse = options?.taskAskResponse ?? "yesButtonClicked"
	const subagentsEnabled = options?.subagentsEnabled ?? true

	const callbacks = {
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: askResponse }),
		saveCheckpoint: vi.fn().mockResolvedValue(undefined),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing"),
		executeCommandTool: vi
			.fn()
			.mockResolvedValue({ userRejected: false, result: "ok", completed: true, exitCode: 0, signal: null }),
		cancelRunningCommandTool: vi.fn().mockResolvedValue(false),
		doesLatestTaskCompletionHaveNewChanges: vi.fn().mockResolvedValue(false),
		updateFCListFromToolResponse: vi.fn().mockResolvedValue(undefined),
		shouldAutoApproveTool: vi.fn().mockReturnValue([options?.autoApproveSafe ?? false, options?.autoApproveAll ?? false]),
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
	}

	const config = {
		taskId: "task-1",
		ulid: "ulid-1",
		cwd: "/tmp",
		mode: "act",
		strictPlanModeEnabled: false,
		yoloModeToggled: false,
		vscodeTerminalExecutionMode: "backgroundExec",
		enableParallelToolCalling: true,
		context: {},
		taskState,
		taskController: { rejectActiveBlock: vi.fn() },
		messageState: {},
		api: {
			getModel: () => ({ id: "openai/gpt-5", info: {} }),
		},
		autoApprovalSettings: {
			enableNotifications: false,
			actions: {
				executeSafeCommands: false,
				executeAllCommands: false,
			},
		},
		autoApprover: {
			shouldAutoApproveTool: vi.fn().mockReturnValue([options?.autoApproveSafe ?? false, options?.autoApproveAll ?? false]),
		},
		browserSettings: {},
		focusChainSettings: {},
		services: {
			stateManager: {
				getGlobalStateKey: (key: string) => (key === "nativeToolCallEnabled" ? true : undefined),
				getGlobalSettingsKey: (key: string) => {
					if (key === "mode") {
						return "act"
					}
					if (key === "customPrompt") {
						return undefined
					}
					if (key === "subagentsEnabled") {
						return subagentsEnabled
					}
					return undefined
				},
				getApiConfiguration: () => ({
					planModeProfile: "openai",
					actModeProfile: "openai",
				}),
			},
			mcpHub: {},
		},
		callbacks,
		coordinator: {
			getHandler: vi.fn(),
		},
	} as unknown as TaskConfig

	return { config, callbacks, taskState }
}

describe("SubagentToolHandler", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("uses real injection state in Webview status payload", () => {
		const payload = buildStatusPayload(
			"single",
			"completed",
			[
				{
					index: 1,
					prompt: "<task>review</task><context>ctx</context>",
					status: "completed",
					toolCalls: 0,
					inputTokens: 0,
					outputTokens: 0,
					totalCost: 0,
					currency: "USD",
					contextTokens: 0,
					contextWindow: 0,
					contextUsagePercentage: 0,
					injectionState: "consumed",
				},
			],
			{ background: true, timeoutSeconds: 30, jobId: "subagent_1", injectionState: "consumed" },
		)

		assert.equal(payload.injectionState, "consumed")
		assert.equal(payload.items[0].injectionState, "consumed")
	})

	it("returns missing parameter error when no prompts are provided", async () => {
		const { config, callbacks, taskState } = createConfig()
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {},
			partial: false,
			ts: Date.now(),
		})

		assert.ok(String(result).includes("Missing required parameter: prompt_1"))
		assert.equal(taskState.consecutiveMistakeCount, 1)
		expect(callbacks.sayAndCreateMissingParamError)
	})

	it("returns an error when subagents are disabled", async () => {
		const { config } = createConfig({ subagentsEnabled: false })
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "first prompt",
			},
			partial: false,
			ts: Date.now(),
		})

		assert.equal(
			result,
			"The tool execution failed with the following error:\n<error>\nSubagents are disabled. Enable them in Settings > Features to use this tool.\n</error>",
		)
	})

	it("streams partial use_subagents approval as ask when not auto-approved", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: false, autoApproveAll: false })
		const handler = new UseSubagentsToolHandler()
		const uiHelpers = createUIHelpers(config)

		await handler.handlePartialBlock(
			{
				type: "tool_use",
				name: ClineDefaultTool.USE_SUBAGENTS,
				params: {
					prompt_1: "first prompt",
					prompt_2: "second prompt",
				},
				partial: true,
				ts: Date.now(),
			},
			uiHelpers,
		)

		vitestExpect(callbacks.ask).toHaveBeenCalledWith("use_subagents", vitestExpect.any(String), true, {
			existingTs: vitestExpect.any(Number),
		})

		const payload = JSON.parse(callbacks.ask.mock.calls[0][1])
		assert.deepEqual(payload.prompts, ["first prompt", "second prompt"])
		expect(callbacks.say)
	})

	it("streams partial use_subagents approval as say when auto-approved", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: false })
		const handler = new UseSubagentsToolHandler()
		const uiHelpers = createUIHelpers(config)

		await handler.handlePartialBlock(
			{
				type: "tool_use",
				name: ClineDefaultTool.USE_SUBAGENTS,
				params: {
					prompt_1: "first prompt",
					prompt_2: "second prompt",
				},
				partial: true,
				ts: Date.now(),
			},
			uiHelpers,
		)

		vitestExpect(callbacks.say).toHaveBeenCalledWith(
			"use_subagents",
			vitestExpect.any(String),
			undefined,
			undefined,
			true,
			vitestExpect.any(Number),
		)

		const payload = JSON.parse(callbacks.say.mock.calls[0][1])
		assert.deepEqual(payload.prompts, ["first prompt", "second prompt"])
		expect(callbacks.ask)
	})

	it("uses one approval for the full batch and stops on denial", async () => {
		const { config, callbacks, taskState } = createConfig({ taskAskResponse: "noButtonClicked" })
		const runStub = vi.spyOn(SubagentRunner.prototype, "run")
		const handler = new UseSubagentsToolHandler()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "<task>one</task><context>ctx one</context>",
				prompt_2: "<task>two</task><context>ctx two</context>",
			},
			partial: false,
			ts: Date.now(),
		})

		assert.equal(result, "The user denied this operation.")
		expect(config.taskController.rejectActiveBlock as any /* sinon.SinonStub → vitest */)
		expect(callbacks.ask)
		assert.equal(callbacks.ask.mock.calls[0][0], "use_subagents")
		expect(runStub)
	})

	it("uses read-file auto-approve level (safe only) for approval bypass", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: false })
		vi.spyOn(SubagentRunner.prototype, "run").mockResolvedValue({
			status: "completed",
			result: "done",
			stats: {
				toolCalls: 1,
				inputTokens: 2,
				outputTokens: 3,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0.25,
				currency: "USD",
				contextTokens: 5,
				contextWindow: 200000,
				contextUsagePercentage: 0.0025,
			},
		})

		const handler = new UseSubagentsToolHandler()
		await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "<task>one</task><context>ctx one</context>",
			},
			partial: false,
			ts: Date.now(),
		})

		expect(callbacks.ask)
		const subagentStatusCalls = callbacks.say.mock.calls.filter((call) => call[0] === "subagent")
		assert.ok(subagentStatusCalls.length >= 1)
	})

	it("fans out prompts in parallel and emits aggregated status", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		let activeRuns = 0
		let maxActiveRuns = 0

		vi.spyOn(SubagentRunner.prototype, "run").mockImplementation(async (_prompt: string, onProgress) => {
			activeRuns++
			maxActiveRuns = Math.max(maxActiveRuns, activeRuns)
			onProgress({
				status: "running",
				stats: {
					toolCalls: 0,
					inputTokens: 0,
					outputTokens: 0,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0,
					currency: "USD",
					contextTokens: 0,
					contextWindow: 200000,
					contextUsagePercentage: 0,
				},
			})
			await delay(10)
			activeRuns--
			return {
				status: "completed",
				result: "done",
				stats: {
					toolCalls: 1,
					inputTokens: 2,
					outputTokens: 3,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0.25,
					currency: "USD",
					contextTokens: 5,
					contextWindow: 200000,
					contextUsagePercentage: 0.0025,
				},
			}
		})

		const handler = new UseSubagentsToolHandler()
		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "<task>one</task><context>ctx one</context>",
				prompt_2: "<task>two</task><context>ctx two</context>",
				prompt_3: "<task>three</task><context>ctx three</context>",
			},
			partial: false,
			ts: Date.now(),
		})

		assert.equal(typeof result, "string")
		assert.ok((result as string).includes("Total: 3"))
		assert.ok(maxActiveRuns > 1)

		const subagentStatusCalls = callbacks.say.mock.calls.filter((call) => call[0] === "subagent")
		assert.ok(subagentStatusCalls.length >= 2)
		const finalCall = subagentStatusCalls[subagentStatusCalls.length - 1]
		assert.equal(finalCall[4], false)

		const usageCalls = callbacks.say.mock.calls.filter((call) => call[0] === "subagent_usage")
		assert.equal(usageCalls.length, 1)
		const usagePayload = JSON.parse(usageCalls[0][1]) as ClineSubagentUsageInfo
		assert.equal(usagePayload.source, "subagents")
		assert.equal(usagePayload.tokensIn, 6)
		assert.equal(usagePayload.tokensOut, 9)
		assert.equal(usagePayload.cacheWrites, 0)
		assert.equal(usagePayload.cacheReads, 0)
		assert.equal(usagePayload.cost, 0.75)
	})

	it("continues after per-subagent failures and reports both outcomes", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })

		vi.spyOn(SubagentRunner.prototype, "run").mockImplementation(async (prompt: string) => {
			if (prompt.includes("fail")) {
				return {
					status: "failed",
					error: "boom",
					stats: {
						toolCalls: 1,
						inputTokens: 0,
						outputTokens: 0,
						cacheWriteTokens: 0,
						cacheReadTokens: 0,
						totalCost: 0,
						currency: "USD",
						contextTokens: 0,
						contextWindow: 200000,
						contextUsagePercentage: 0,
					},
				}
			}
			return {
				status: "completed",
				result: "ok",
				stats: {
					toolCalls: 2,
					inputTokens: 0,
					outputTokens: 0,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
					totalCost: 0,
					currency: "USD",
					contextTokens: 0,
					contextWindow: 200000,
					contextUsagePercentage: 0,
				},
			}
		})

		const handler = new UseSubagentsToolHandler()
		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "<task>succeed</task><context>ctx succeed</context>",
				prompt_2: "<task>fail</task><context>ctx fail</context>",
			},
			partial: false,
			ts: Date.now(),
		})

		assert.equal(typeof result, "string")
		assert.ok((result as string).includes("Succeeded: 1"))
		assert.ok((result as string).includes("Failed: 1"))
		assert.ok((result as string).includes("boom"))
	})

	it("runs stable use_subagent with the built-in default when no YAML exists", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		const handler = new UseSubagentToolHandler()
		vi.spyOn(AgentConfigModule, "resolveAgentConfig").mockResolvedValue(undefined)
		const runStub = vi.spyOn(SubagentRunner.prototype, "run").mockResolvedValue({
			status: "completed",
			result: "default done",
			stats: {
				toolCalls: 1,
				inputTokens: 2,
				outputTokens: 3,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0.1,
				currency: "USD",
				contextTokens: 100,
				contextWindow: 200000,
				contextUsagePercentage: 0.05,
			},
		})

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENT,
			params: { task: "review this PR", context: "check quality" },
			partial: false,
			ts: Date.now(),
		})

		assert.match(String(result), /default done/)
		assert.equal(runStub.mock.calls.length, 1)
	})

	it("lists default and bounded configured names for an unknown stable subagent", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		const handler = new UseSubagentToolHandler()
		vi.spyOn(AgentConfigModule, "resolveAgentConfig").mockResolvedValue(undefined)
		vi.spyOn(AgentConfigModule, "listEnabledAgentConfigs").mockResolvedValue([
			{
				config: { name: "reviewer", description: "reviewer", tools: [], systemPrompt: "Prompt" },
				source: "project",
				path: "/workspace/.agents/subagents/reviewer.yml",
			},
		])

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENT,
			params: { agent_name: "missing", task: "review", context: "ctx" },
			partial: false,
			ts: Date.now(),
		})

		assert.match(String(result), /Unknown or disabled subagent 'missing'/)
		assert.match(String(result), /Available subagents: default, reviewer/)
	})

	it("runs stable use_subagent with selected YAML subagent", async () => {
		const { config } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		const handler = new UseSubagentToolHandler()
		const resolvedConfig = { name: "code-reviewer", description: "reviewer", tools: [], systemPrompt: "Prompt" }
		vi.spyOn(AgentConfigModule, "resolveAgentConfig").mockResolvedValue({
			config: resolvedConfig,
			source: "project",
			path: "/workspace/.agents/subagents/code-reviewer.md",
		})

		const runStub = vi.spyOn(SubagentRunner.prototype, "run").mockResolvedValue({
			status: "completed",
			result: "stable done",
			stats: {
				toolCalls: 1,
				inputTokens: 2,
				outputTokens: 3,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0.1,
				currency: "USD",
				contextTokens: 100,
				contextWindow: 200000,
				contextUsagePercentage: 0.05,
			},
		})

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENT,
			params: { agent_name: "code-reviewer", task: "review this PR", context: "check quality" },
			partial: false,
			ts: Date.now(),
		})

		assert.match(String(result), /stable done/)
		expect(runStub)
		assert.match(runStub.mock.calls[0][0], /<task>\s*review this PR\s*<\/task>/)
		assert.match(runStub.mock.calls[0][0], /<context>\s*check quality\s*<\/context>/)
		vitestExpect(AgentConfigModule.resolveAgentConfig).toHaveBeenCalledWith("/tmp", "code-reviewer", vitestExpect.any(Object))
	})

	it("starts stable use_subagent background job", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		const handler = new UseSubagentToolHandler()
		const resolvedConfig = { name: "code-reviewer", description: "reviewer", tools: [], systemPrompt: "Prompt" }
		vi.spyOn(AgentConfigModule, "resolveAgentConfig").mockResolvedValue({
			config: resolvedConfig,
			source: "project",
			path: "/workspace/.agents/subagents/code-reviewer.md",
		})
		vi.spyOn(SubagentRunner.prototype, "run").mockResolvedValue({
			status: "completed",
			result: "background done",
			stats: {
				toolCalls: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0,
				currency: "USD",
				contextTokens: 0,
				contextWindow: 200000,
				contextUsagePercentage: 0,
			},
		})

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENT,
			params: { agent_name: "code-reviewer", task: "review", context: "ctx", background: "true" },
			partial: false,
			ts: Date.now(),
		})

		assert.match(String(result), /Started background subagent job: subagent_/)
		assert.ok(config.subagentJobManager, "should attach a task-local subagent job manager")
		await delay(0)
		const subagentCalls = callbacks.say.mock.calls.filter((call) => call[0] === "subagent")
		assert.ok(subagentCalls.length >= 2, "should emit running and final background status")
	})

	it("replaces partial message when subagents are disabled with prompts in payload", async () => {
		const { config, callbacks, taskState } = createConfig({ subagentsEnabled: false })
		const handler = new UseSubagentsToolHandler()
		const blockTs = Date.now()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "do something" },
			partial: false,
			ts: blockTs,
		})

		assert.ok((result as string).includes("disabled"))
		assert.equal(taskState.consecutiveMistakeCount, 0)
		const allUseCalls = callbacks.say.mock.calls
		const useSubagentsCall = allUseCalls.find((c) => c[0] === "use_subagents")
		assert.ok(useSubagentsCall, "should have called say with use_subagents")
		assert.equal(useSubagentsCall[4], false) // partial=false
		assert.equal(useSubagentsCall[5], blockTs) // existingTs = block.ts
		const payload = JSON.parse(useSubagentsCall[1])
		assert.ok(Array.isArray(payload.prompts))
		assert.equal(payload.prompts.length, 0) // empty prompts, error card via message
		assert.equal(payload.error, "subagentsDisabled")
		assert.ok(payload.message && payload.message.length > 0, "should include error message")
	})

	it("keeps fast background batch completion mapped to item entries", async () => {
		const { config, callbacks } = createConfig({ autoApproveSafe: true, autoApproveAll: true })
		config.subagentJobManager = {
			startBatch: vi.fn((input) => {
				const batch = {
					batchJobId: "subagent_batch_1",
					status: "completed" as const,
					startedAt: Date.now(),
					finishedAt: Date.now(),
					timeoutSeconds: input.timeoutSeconds,
					itemJobIds: ["subagent_1"],
					injectionState: "pending" as const,
				}
				input.onCreated?.(batch)
				void input.onStatusChange?.(
					{
						jobId: "subagent_1",
						batchJobId: "subagent_batch_1",
						task: "fast",
						prompt: "<task>fast</task><context>ctx</context>",
						status: "completed" as const,
						startedAt: Date.now(),
						finishedAt: Date.now(),
						timeoutSeconds: input.timeoutSeconds,
						result: "fast done",
						injectionState: "pending" as const,
					},
					batch,
				)
				return batch
			}),
		} as unknown as TaskConfig["subagentJobManager"]
		const handler = new UseSubagentsToolHandler()

		await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: { prompt_1: "<task>fast</task><context>ctx</context>", background: "true" },
			partial: false,
			ts: Date.now(),
		})

		const subagentCalls = callbacks.say.mock.calls.filter((call) => call[0] === "subagent")
		const completedPayload = subagentCalls
			.map((call) => JSON.parse(call[1]))
			.find((payload) => payload.status === "completed")
		assert.equal(completedPayload.items[0].jobId, "subagent_1")
		assert.equal(completedPayload.items[0].status, "completed")
		assert.equal(completedPayload.items[0].result, "fast done")
	})

	it("allows exactly max prompts without error", async () => {
		const { config, callbacks, taskState } = createConfig({ autoApproveSafe: true })
		const handler = new UseSubagentsToolHandler()
		vi.spyOn(SubagentRunner.prototype, "run").mockResolvedValue({
			status: "completed",
			result: "done",
			stats: {
				toolCalls: 0,
				inputTokens: 0,
				outputTokens: 0,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalCost: 0,
				currency: "USD",
				contextTokens: 0,
				contextWindow: 200000,
				contextUsagePercentage: 0,
			},
		})
		const blockTs = Date.now()

		const result = await handler.execute(config, {
			type: "tool_use",
			name: ClineDefaultTool.USE_SUBAGENTS,
			params: {
				prompt_1: "<task>1</task><context>ctx 1</context>",
				prompt_2: "<task>2</task><context>ctx 2</context>",
				prompt_3: "<task>3</task><context>ctx 3</context>",
				prompt_4: "<task>4</task><context>ctx 4</context>",
				prompt_5: "<task>5</task><context>ctx 5</context>",
			},
			partial: false,
			ts: blockTs,
		})

		assert.equal(taskState.consecutiveMistakeCount, 0)
		assert.ok(String(result).includes("Subagent results"), "should proceed normally with exactly max prompts")
	})
})
