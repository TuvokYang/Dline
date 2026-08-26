import type { ApiHandler } from "@core/api"
import { OutputLimitExceededError } from "@core/api/stream/OutputLimitExceededError"
import { estimateContextWindowCandidate } from "@core/context/context-management/context-window-projection"
import { computeSummarizeBudget, resolveCompactTriggerPolicy } from "@core/context/context-management/context-window-utils"
import type { TargetWindowFittingDecision } from "@core/context/context-management/TargetWindowFittingService"
import { buildCompactionPassHistory } from "@core/context/context-management/target-window-fitting"
import type { CompactionProviderInput } from "@core/task/compaction/CompactionRequestReplay"
import { ExplicitInstructionRegistry } from "@core/task/explicit-instructions/ExplicitInstructionRegistry"
import { ExplicitInstructionRequestScope } from "@core/task/explicit-instructions/ExplicitInstructionRequestScope"
import type { ClineStorageMessage } from "@shared/messages/content"
import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import { ContextCompactionSession, type ContextCompactionSessionPorts } from "../ContextCompactionSession"

const API = { createMessage: vi.fn() } as unknown as ApiHandler
const HISTORY: ClineStorageMessage[] = [
	{ role: "user", content: [{ type: "text", text: "turn one" }] },
	{ role: "assistant", content: [{ type: "text", text: "answer one" }] },
	{ role: "user", content: [{ type: "text", text: "turn two" }] },
	{ role: "assistant", content: [{ type: "text", text: "answer two" }] },
]

function decision(status: TargetWindowFittingDecision["status"]): TargetWindowFittingDecision {
	return {
		status,
		projectedUsageTokens: 100,
		targetContextWindow: 1_000,
		effectiveContextLimit: 1_000,
		fittingExitTarget: 800,
	}
}

function useSuccessfulCompactionStream(): void {
	API.createMessage = vi.fn(async function* () {
		yield {
			type: "tool_calls",
			function_id: "f",
			tool_index: 0,
			tool_call: { function: { name: "summarize_task", arguments: JSON.stringify({ context: "summary" }) } },
		}
		yield { type: "usage", inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 }
	}) as ApiHandler["createMessage"]
}

function createPorts(): ContextCompactionSessionPorts {
	return {
		getPassInputCeiling: () => 10_000,
		estimatePassInput: async (_input, history) => history.length * 10,
		buildPassRequest: vi.fn(async (_input, state) => {
			const explicitInstructions = new ExplicitInstructionRequestScope(new ExplicitInstructionRegistry(), {
				requestId: `request-${state.passIndex}`,
				attemptId: `attempt-${state.passIndex}`,
			})
			explicitInstructions.register({
				type: "summarize_task",
				source: "auto_compaction",
				targetTool: ClineDefaultTool.SUMMARIZE_TASK,
				operationId: state.operationId,
			})
			return {
				providerInput: {} as CompactionProviderInput,
				explicitInstructions,
				initialAttemptId: `attempt-${state.passIndex}`,
			}
		}),
		reprojectTarget: vi.fn(async () => decision("complete")),
		stageAcceptedPass: vi.fn(async () => undefined),
		commit: vi.fn(async () => undefined),
		publish: vi.fn(async () => undefined),
		waitForRetry: vi.fn(async () => undefined),
	}
}

/** Lock the shared orchestration boundary independently from Task recursion. */
describe("ContextCompactionSession", () => {
	it("exposes every approved trigger through one session type", () => {
		const source = ["auto_compaction", "task_header", "manual_compact_command", "profile_switch", "mode_switch"]
		expect(source).toHaveLength(5)
	})

	it("fails locally before Provider admission when no complete logical turn is available", async () => {
		const ports = createPorts()
		const api = { createMessage: vi.fn() } as unknown as ApiHandler
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		const sourceHistory: ClineStorageMessage[] = [
			{ role: "user", content: [{ type: "text", text: "<user_message>pending first turn</user_message>" }] },
		]

		const result = await session.run({
			operationId: "operation-no-complete-turn",
			trigger: "auto_compaction",
			compactionApi: api,
			targetApi: api,
			targetMode: "act",
			sourceHistory,
		})

		const reason = "No complete logical turn is available for context compaction."
		expect(result).toBe("failed")
		expect(api.createMessage).not.toHaveBeenCalled()
		expect(ports.reprojectTarget).not.toHaveBeenCalled()
		expect(ports.publish).toHaveBeenCalledWith(expect.objectContaining({ operationId: "operation-no-complete-turn" }), {
			kind: "failed",
			error: reason,
		})
	})

	it("admits a complete tool round whose paired result is the final canonical message", async () => {
		const ports = createPorts()
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()
		const sourceHistory: ClineStorageMessage[] = [
			{ role: "user", content: [{ type: "text", text: "Inspect the file" }] },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						function_id: "call-read-final",
						dline_tid: "tid-read-final",
						name: "read_file",
						input: { path: "src/example.ts" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						function_id: "call-read-final",
						dline_tid: "tid-read-final",
						content: [{ type: "text", text: "file contents" }],
					},
				],
			},
		]

		const result = await session.run({
			operationId: "operation-final-tool-result",
			trigger: "auto_compaction",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory,
		})

		expect(result).toBe("completed")
		expect(API.createMessage).toHaveBeenCalledOnce()
		expect(ports.reprojectTarget).toHaveBeenCalledOnce()
	})

	it("admits one complete 450K multi-tool logical turn when the full hidden request fits the 472K Provider window", async () => {
		const createSourceHistory = (payload: string): ClineStorageMessage[] => [
			{ role: "user", content: [{ type: "text", text: "Inspect both large files without splitting this logical turn." }] },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						function_id: "call-large-read-a",
						dline_tid: "tid-large-read-a",
						name: "read_file",
						input: { path: "dist/large-a.map" },
					},
					{
						type: "tool_use",
						function_id: "call-large-read-b",
						dline_tid: "tid-large-read-b",
						name: "read_file",
						input: { path: "dist/large-b.map" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						function_id: "call-large-read-a",
						dline_tid: "tid-large-read-a",
						content: [{ type: "text", text: payload }],
					},
					{
						type: "tool_result",
						function_id: "call-large-read-b",
						dline_tid: "tid-large-read-b",
						content: [{ type: "text", text: "SECOND_LARGE_TOOL_RESULT" }],
					},
				],
			},
		]
		const createProviderInput = (messages: readonly ClineStorageMessage[]): CompactionProviderInput => ({
			systemPrompt: "stable compaction system prompt",
			messages: [...messages, { role: "user", content: [{ type: "text", text: "Summarize this complete logical turn." }] }],
			tools: [],
			serverTools: [],
			providerOutputCap: 20_000,
		})
		const targetInputTokens = 450_000
		const emptyPayloadTokens = estimateContextWindowCandidate(createProviderInput(createSourceHistory("")))
		const sourceHistory = createSourceHistory("x".repeat((targetInputTokens - emptyPayloadTokens) * 4))
		const fullRequestTokens = estimateContextWindowCandidate(createProviderInput(sourceHistory))
		const passInputCeiling = resolveCompactTriggerPolicy(472_000, computeSummarizeBudget(), {
			triggerPercent: 95,
			minReserveTokens: 5_000,
			maxReserveTokens: 30_000,
			maxContextTokens: 0,
		}).passInputCeilingTokens
		const ports = createPorts()
		ports.getPassInputCeiling = () => passInputCeiling
		ports.estimatePassInput = async (_input, passHistory) => estimateContextWindowCandidate(createProviderInput(passHistory))
		ports.buildPassRequest = vi.fn(async (_input, state) => {
			const explicitInstructions = new ExplicitInstructionRequestScope(new ExplicitInstructionRegistry(), {
				requestId: `request-${state.passIndex}`,
				attemptId: `attempt-${state.passIndex}`,
			})
			explicitInstructions.register({
				type: "summarize_task",
				source: "auto_compaction",
				targetTool: ClineDefaultTool.SUMMARIZE_TASK,
				operationId: state.operationId,
			})
			return {
				providerInput: createProviderInput(buildCompactionPassHistory(state)),
				explicitInstructions,
				initialAttemptId: `attempt-${state.passIndex}`,
			}
		})
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		expect(fullRequestTokens).toBe(targetInputTokens)
		expect(fullRequestTokens).toBeGreaterThan(446_400)
		expect(fullRequestTokens).toBeLessThan(472_000)

		const result = await session.run({
			operationId: "operation-large-complete-turn",
			trigger: "auto_compaction",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory,
		})

		expect(result).toBe("completed")
		expect(API.createMessage).toHaveBeenCalledOnce()
		const sentMessages = JSON.stringify(vi.mocked(API.createMessage).mock.calls[0]?.[1])
		expect(sentMessages).toContain("call-large-read-a")
		expect(sentMessages).toContain("call-large-read-b")
		expect(sentMessages).toContain("SECOND_LARGE_TOOL_RESULT")
	})

	it.each([
		["ordinary failure", new Error("manual compaction failed")],
		["OpenAI max-output termination", new OutputLimitExceededError("openai_responses", "max_output_tokens")],
	] as const)("does not automatically replay a manual Pass after %s", async (_case, failure) => {
		const ports = createPorts()
		ports.buildPassRequest = vi.fn(async (_input, state) => {
			const explicitInstructions = new ExplicitInstructionRequestScope(new ExplicitInstructionRegistry(), {
				requestId: `manual-failure-request-${state.passIndex}`,
				attemptId: `manual-failure-attempt-${state.passIndex}`,
			})
			explicitInstructions.register({
				type: "summarize_task",
				source: "manual_compact_command",
				targetTool: ClineDefaultTool.SUMMARIZE_TASK,
				operationId: state.operationId,
			})
			return {
				providerInput: { providerOutputCap: 1_000 } as CompactionProviderInput,
				explicitInstructions,
				initialAttemptId: `manual-failure-attempt-${state.passIndex}`,
			}
		})
		const api = {
			createMessage: vi.fn(async function* () {
				yield {
					type: "tool_calls",
					function_id: "manual-failure",
					tool_index: 0,
					tool_call: {
						function: { name: "summarize_task", arguments: '{"context":"damaged partial"' },
					},
				}
				throw failure
			}),
		} as unknown as ApiHandler
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 3 })

		const result = await session.run({
			operationId: `operation-manual-failure-${_case}`,
			trigger: "task_header",
			compactionApi: api,
			targetApi: api,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(result).toBe("failed")
		expect(api.createMessage).toHaveBeenCalledOnce()
		const events = vi.mocked(ports.publish).mock.calls.map(([, event]) => event)
		expect(events.some((event) => event.kind === "pass_retry")).toBe(false)
		expect(events.at(-1)).toMatchObject({ kind: "failed" })
		expect(ports.reprojectTarget).not.toHaveBeenCalled()
	})

	it("owns planning through commit for one accepted Pass", async () => {
		const ports = createPorts()
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		const result = await session.run({
			operationId: "operation-1",
			trigger: "profile_switch",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(result).toBe("completed")
		const publish = vi.mocked(ports.publish)
		const events = publish.mock.calls.map(([, event]) => event)
		expect(vi.mocked(ports.buildPassRequest).mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[0])
		expect(events.map((event) => event.kind)).toEqual([
			"pass_started",
			"pass_receiving",
			"pass_partial",
			"pass_receiving",
			"pass_completed",
		])
		expect(events[0]).toMatchObject({
			kind: "pass_started",
			passIdentity: { operationId: "operation-1", passIndex: 0 },
			attempt: { attemptIndex: 0, authorizationAttemptId: "attempt-0" },
		})
		expect(events[1]).toMatchObject({
			kind: "pass_receiving",
			passIdentity: { operationId: "operation-1", passIndex: 0 },
			attempt: { attemptIndex: 0, authorizationAttemptId: "attempt-0" },
			chunk: { type: "tool_calls" },
		})
		expect(events[1]).not.toHaveProperty("state")
		expect(events[2]).toMatchObject({
			kind: "pass_partial",
			passIdentity: { operationId: "operation-1", passIndex: 0 },
			attempt: { attemptIndex: 0, authorizationAttemptId: "attempt-0" },
			content: "summary",
		})
		expect(events[2]).not.toHaveProperty("state")
		expect(events[3]).toMatchObject({ kind: "pass_receiving", chunk: { type: "usage", outputTokens: 5 } })
		expect(events[3]).not.toHaveProperty("state")
		expect(events[4]).toMatchObject({
			kind: "pass_completed",
			state: { passIndex: 1, coveredTurnCount: 2, cumulativeSummary: "summary" },
			passIdentity: { operationId: "operation-1", passIndex: 0 },
			attempt: { attemptIndex: 0, authorizationAttemptId: "attempt-0" },
			content: "summary",
		})
		expect(ports.reprojectTarget).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-1" }),
			expect.objectContaining({ passIndex: 1, coveredTurnCount: 2, cumulativeSummary: "summary" }),
		)
		expect(ports.stageAcceptedPass).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-1" }),
			expect.objectContaining({ passIndex: 1, coveredTurnCount: 2, cumulativeSummary: "summary" }),
			decision("complete"),
		)
		expect(vi.mocked(ports.reprojectTarget).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(ports.stageAcceptedPass).mock.invocationCallOrder[0],
		)
		expect(vi.mocked(ports.stageAcceptedPass).mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[4])
		expect(publish.mock.invocationCallOrder[4]).toBeLessThan(vi.mocked(ports.commit).mock.invocationCallOrder[0])
	})

	it("commits an accepted projection without waiting for tail settlement", async () => {
		const ports = createPorts()
		let releaseTail!: () => void
		const tailGate = new Promise<void>((resolve) => {
			releaseTail = resolve
		})
		const api = {
			createMessage: vi.fn(async function* () {
				yield {
					type: "tool_calls",
					function_id: "call-summary-checkpoint-boundary",
					phase: "completed",
					tool_index: 0,
					tool_call: {
						function: {
							name: ClineDefaultTool.SUMMARIZE_TASK,
							arguments: JSON.stringify({
								context:
									"The accepted summary records the stable architecture, the completed implementation work, the remaining verification boundary, and the precise next action.",
							}),
						},
					},
				}
				await tailGate
				throw new Error("provider connection closed after summary completion")
			}),
		} as unknown as ApiHandler
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 3 })

		const completion = session.run({
			operationId: "operation-completed-summary-tail-error",
			trigger: "auto_compaction",
			compactionApi: api,
			targetApi: api,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		await vi.waitFor(() => {
			expect(ports.stageAcceptedPass).toHaveBeenCalledOnce()
			const events = vi.mocked(ports.publish).mock.calls.map(([, event]) => event)
			expect(events.some((event) => event.kind === "pass_completed")).toBe(true)
		})

		try {
			await vi.waitFor(() => expect(ports.commit).toHaveBeenCalledOnce(), { timeout: 100 })
			await expect(completion).resolves.toBe("completed")
		} finally {
			releaseTail()
		}
		expect(api.createMessage).toHaveBeenCalledOnce()
		expect(ports.commit).toHaveBeenCalledOnce()
		const events = vi.mocked(ports.publish).mock.calls.map(([, event]) => event)
		expect(events.some((event) => event.kind === "pass_retry")).toBe(false)
		expect(events.at(-1)).toMatchObject({ kind: "pass_completed" })
	})

	it("keeps a manually accepted projection after the completed summary stream fails at the tail", async () => {
		const ports = createPorts()
		const api = {
			createMessage: vi.fn(async function* () {
				yield {
					type: "tool_calls",
					function_id: "call-manual-summary-tail-failure",
					phase: "completed",
					tool_index: 0,
					tool_call: {
						function: {
							name: ClineDefaultTool.SUMMARIZE_TASK,
							arguments: JSON.stringify({
								context:
									"The manually reviewed summary preserves the approved design, the accepted implementation state, and the remaining verification work.",
							}),
						},
					},
				}
				throw new Error("manual provider stream failed after summary completion")
			}),
		} as unknown as ApiHandler
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 3 })

		const result = await session.run({
			operationId: "operation-manual-completed-summary-tail-error",
			trigger: "task_header",
			compactionApi: api,
			targetApi: api,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(result).toBe("completed")
		expect(api.createMessage).toHaveBeenCalledOnce()
		expect(ports.stageAcceptedPass).toHaveBeenCalledOnce()
		expect(ports.commit).toHaveBeenCalledOnce()
		const events = vi.mocked(ports.publish).mock.calls.map(([, event]) => event)
		expect(events.some((event) => event.kind === "pass_retry")).toBe(false)
		expect(events.at(-1)).toMatchObject({ kind: "pass_completed" })
	})

	it("regenerates the same manual Pass before staging only the confirmed summary", async () => {
		const ports = createPorts()
		let buildCount = 0
		ports.buildPassRequest = vi.fn(async (_input, state, feedback) => {
			const explicitInstructions = new ExplicitInstructionRequestScope(new ExplicitInstructionRegistry(), {
				requestId: `manual-request-${buildCount}`,
				attemptId: `manual-attempt-${buildCount}`,
			})
			explicitInstructions.register({
				type: "summarize_task",
				source: "manual_compact_command",
				targetTool: ClineDefaultTool.SUMMARIZE_TASK,
				operationId: state.operationId,
			})
			buildCount += 1
			return {
				providerInput: {
					messages: feedback ? [{ role: "user", content: [...feedback] }] : [],
				} as CompactionProviderInput,
				explicitInstructions,
				initialAttemptId: `manual-attempt-${buildCount - 1}`,
			}
		})
		ports.reviewPass = vi
			.fn()
			.mockResolvedValueOnce({ action: "regenerate", feedback: [{ type: "text", text: "preserve constraints" }] })
			.mockResolvedValueOnce({ action: "accept" })
		let requestCount = 0
		const api = {
			createMessage: vi.fn(async function* () {
				const summary = requestCount++ === 0 ? "first unconfirmed summary" : "confirmed summary"
				yield {
					type: "tool_calls",
					function_id: `f-${requestCount}`,
					tool_index: 0,
					tool_call: { function: { name: "summarize_task", arguments: JSON.stringify({ context: summary }) } },
				}
				yield { type: "usage", inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 }
			}),
		} as unknown as ApiHandler
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })

		const result = await session.run({
			operationId: "operation-manual-review",
			trigger: "manual_compact_command",
			compactionApi: api,
			targetApi: api,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(result).toBe("completed")
		expect(ports.reviewPass).toHaveBeenCalledTimes(2)
		expect(ports.reprojectTarget).toHaveBeenCalledOnce()
		expect(ports.stageAcceptedPass).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-manual-review" }),
			expect.objectContaining({ cumulativeSummary: "confirmed summary", passIndex: 1 }),
			decision("complete"),
		)
		expect(ports.buildPassRequest).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ operationId: "operation-manual-review" }),
			expect.objectContaining({ passIndex: 0, coveredTurnCount: 0 }),
			[{ type: "text", text: "preserve constraints" }],
		)
		const events = vi.mocked(ports.publish).mock.calls.map(([, event]) => event)
		expect(events.filter((event) => event.kind === "pass_started")).toHaveLength(1)
		expect(events).toContainEqual(
			expect.objectContaining({
				kind: "pass_retry",
				event: expect.objectContaining({
					kind: "manual_regeneration",
					failedAttempt: { attemptIndex: 0, authorizationAttemptId: "manual-attempt-0" },
					nextAttempt: { attemptIndex: 1, authorizationAttemptId: "manual-attempt-1" },
				}),
			}),
		)
		expect(events.at(-1)).toMatchObject({
			kind: "pass_completed",
			attempt: { attemptIndex: 1, authorizationAttemptId: "manual-attempt-1" },
			content: "confirmed summary",
		})
	})

	it("releases a completed transition immediately because adoption is not Session-owned", async () => {
		const ports = createPorts()
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		const result = await session.run({
			operationId: "operation-transition",
			trigger: "profile_switch",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(result).toBe("completed")
		expect(session.getActiveOperationId()).toBeUndefined()
	})

	it("keeps a durable commit completed when cancellation arrives after the commit point", async () => {
		const abortController = new AbortController()
		const ports = createPorts()
		ports.commit = vi.fn(async () => {
			abortController.abort(new Error("late cancellation"))
		})
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		const result = await session.run({
			operationId: "operation-late-cancel",
			trigger: "auto_compaction",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory: HISTORY,
			signal: abortController.signal,
		})

		expect(result).toBe("completed")
		expect(ports.commit).toHaveBeenCalledOnce()
		const events = vi.mocked(ports.publish).mock.calls.map(([, event]) => event)
		expect(events.at(-1)).toMatchObject({ kind: "pass_completed" })
		expect(events.some((event) => event.kind === "failed")).toBe(false)
	})

	it("uses the target projection returned by the pure reprojection port", async () => {
		const ports = createPorts()
		const atomicProjection = {
			...decision("complete"),
			indicator: {
				durableContextTokens: 70,
				pendingSendTokens: 20,
				environmentTokens: 10,
				contextWindow: 1_000,
				profileName: "target",
				mode: "act" as const,
			},
		}
		ports.reprojectTarget = vi.fn(async () => atomicProjection)
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		const result = await session.run({
			operationId: "operation-atomic-projection",
			trigger: "profile_switch",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(result).toBe("completed")
		expect(ports.stageAcceptedPass).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-atomic-projection" }),
			expect.objectContaining({ passIndex: 1, cumulativeSummary: "summary" }),
			atomicProjection,
		)
		expect(ports.publish).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-atomic-projection" }),
			expect.objectContaining({ kind: "pass_completed", projection: atomicProjection }),
		)
	})

	it("does not advance or stage a Pass when target reprojection fails", async () => {
		const ports = createPorts()
		ports.reprojectTarget = vi.fn(async () => {
			throw new Error("target reprojection failed")
		})
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		const result = await session.run({
			operationId: "operation-reprojection-failure",
			trigger: "profile_switch",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(result).toBe("failed")
		expect(ports.stageAcceptedPass).not.toHaveBeenCalled()
		expect(ports.commit).not.toHaveBeenCalled()
		const events = vi.mocked(ports.publish).mock.calls.map(([, event]) => event)
		expect(events.map((event) => event.kind)).toEqual([
			"pass_started",
			"pass_receiving",
			"pass_partial",
			"pass_receiving",
			"failed",
		])
		expect(events.at(-1)).toMatchObject({
			kind: "failed",
			state: { passIndex: 0, coveredTurnCount: 0 },
			error: "target reprojection failed",
		})
	})

	it("does not advance or complete a Pass when staging fails", async () => {
		const ports = createPorts()
		ports.stageAcceptedPass = vi.fn(async () => {
			throw new Error("accepted Pass staging failed")
		})
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		const result = await session.run({
			operationId: "operation-stage-failure",
			trigger: "profile_switch",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(result).toBe("failed")
		expect(ports.reprojectTarget).toHaveBeenCalledOnce()
		expect(ports.commit).not.toHaveBeenCalled()
		const events = vi.mocked(ports.publish).mock.calls.map(([, event]) => event)
		expect(events.map((event) => event.kind)).toEqual([
			"pass_started",
			"pass_receiving",
			"pass_partial",
			"pass_receiving",
			"failed",
		])
		expect(events.at(-1)).toMatchObject({
			kind: "failed",
			state: { passIndex: 0, coveredTurnCount: 0 },
			error: "accepted Pass staging failed",
		})
	})

	it("reports failure without rollback when the staged target remains exhausted", async () => {
		const ports = createPorts()
		ports.reprojectTarget = vi.fn(async () => decision("exhausted"))
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		const result = await session.run({
			operationId: "operation-2",
			trigger: "mode_switch",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(result).toBe("failed")
		expect(ports.stageAcceptedPass).toHaveBeenCalledOnce()
		expect(ports.commit).not.toHaveBeenCalled()
		const events = vi.mocked(ports.publish).mock.calls.map(([, event]) => event)
		expect(events.at(-2)).toMatchObject({ kind: "pass_completed", state: { passIndex: 1, coveredTurnCount: 2 } })
		expect(events.at(-1)).toMatchObject({
			kind: "failed",
			state: { passIndex: 1, coveredTurnCount: 2 },
			error: "Context compaction could not fit the complete target request below the required 80% exit target of 800 tokens for the effective context limit 1000, because no complete logical turn remains.",
		})
	})
})
