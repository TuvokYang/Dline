import type { ApiHandler } from "@core/api"
import { OutputLimitExceededError } from "@core/api/stream/OutputLimitExceededError"
import type { CompactionCheckpointHead } from "@core/context/context-management/compaction-checkpoint-chain"
import type { TargetWindowFittingDecision } from "@core/context/context-management/TargetWindowFittingService"
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
	return { status, projectedUsageTokens: 100, targetContextWindow: 1_000, fittingExitTarget: 800 }
}

function checkpointHead(operationId: string, overrides: Partial<CompactionCheckpointHead> = {}): CompactionCheckpointHead {
	return {
		schemaVersion: 1,
		operationId,
		rootCheckpointId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		headCheckpointId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		branchId: "branch-0",
		chainRevision: 0,
		sequence: 0,
		depth: 0,
		...overrides,
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
		prepareRootCheckpoint: vi.fn(async (input) => checkpointHead(input.operationId)),
		checkpointAcceptedPass: vi.fn(async (input, checkpoint) => ({
			checkpointHead: checkpointHead(input.operationId, {
				headCheckpointId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				branchId: checkpoint.expectedHead.branchId,
				chainRevision: checkpoint.expectedHead.chainRevision + 1,
				sequence: checkpoint.expectedHead.sequence + 1,
				depth: checkpoint.expectedHead.depth + 1,
			}),
			projection: decision("complete"),
		})),
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
		stageAcceptedPass: vi.fn(async () => undefined),
		commit: vi.fn(async () => undefined),
		rollback: vi.fn(async () => undefined),
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
		expect(ports.prepareRootCheckpoint).not.toHaveBeenCalled()
		expect(ports.rollback).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-no-complete-turn" }),
			undefined,
			reason,
		)
		expect(ports.publish).toHaveBeenCalledWith(expect.objectContaining({ operationId: "operation-no-complete-turn" }), {
			kind: "failed",
			error: reason,
		})
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
		expect(ports.rollback).toHaveBeenCalledOnce()
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
		expect(vi.mocked(ports.prepareRootCheckpoint).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(ports.buildPassRequest).mock.invocationCallOrder[0],
		)
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
			checkpointHead: { chainRevision: 0, branchId: "branch-0" },
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
			passIdentity: { operationId: "operation-1", passIndex: 0 },
			attempt: { attemptIndex: 0, authorizationAttemptId: "attempt-0" },
			content: "summary",
		})
		expect(ports.checkpointAcceptedPass).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-1" }),
			expect.objectContaining({
				expectedHead: expect.objectContaining({ chainRevision: 0, sequence: 0, depth: 0 }),
				previousState: expect.objectContaining({ passIndex: 0, coveredTurnCount: 0 }),
				nextState: expect.objectContaining({ passIndex: 1, coveredTurnCount: 2, cumulativeSummary: "summary" }),
				passIdentity: expect.objectContaining({ operationId: "operation-1", passIndex: 0 }),
				attempt: { attemptIndex: 0, authorizationAttemptId: "attempt-0" },
				summary: "summary",
			}),
		)
		expect(vi.mocked(ports.checkpointAcceptedPass).mock.invocationCallOrder[0]).toBeLessThan(
			vi.mocked(ports.stageAcceptedPass).mock.invocationCallOrder[0],
		)
		expect(vi.mocked(ports.stageAcceptedPass).mock.invocationCallOrder[0]).toBeLessThan(publish.mock.invocationCallOrder[4])
		expect(ports.stageAcceptedPass).toHaveBeenCalledOnce()
		expect(ports.commit).toHaveBeenCalledOnce()
		expect(ports.rollback).not.toHaveBeenCalled()
	})

	it("regenerates the same manual Pass before checkpointing only the confirmed summary", async () => {
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
			.mockResolvedValueOnce({ action: "regenerate", feedback: [{ type: "text", text: "preserve checkpoint" }] })
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
		expect(ports.checkpointAcceptedPass).toHaveBeenCalledOnce()
		expect(ports.checkpointAcceptedPass).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-manual-review" }),
			expect.objectContaining({
				attempt: { attemptIndex: 1, authorizationAttemptId: "manual-attempt-1" },
				summary: "confirmed summary",
			}),
		)
		expect(ports.buildPassRequest).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ operationId: "operation-manual-review" }),
			expect.objectContaining({ passIndex: 0, coveredTurnCount: 0 }),
			[{ type: "text", text: "preserve checkpoint" }],
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

	it("holds a completed transition until adoption releases or fails its barrier", async () => {
		const ports = createPorts()
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		await session.run({
			operationId: "operation-barrier",
			trigger: "profile_switch",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(session.getActiveOperationId()).toBe("operation-barrier")
		await session.fail("operation-barrier", "Profile adoption failed.")
		expect(ports.rollback).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-barrier" }),
			expect.any(Object),
			"Profile adoption failed.",
		)
		expect(session.getActiveOperationId()).toBeUndefined()
	})

	it("releases a completed transition without rolling back after adoption succeeds", async () => {
		const ports = createPorts()
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		await session.run({
			operationId: "operation-release",
			trigger: "mode_switch",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory: HISTORY,
		})
		session.release("operation-release")

		expect(ports.rollback).not.toHaveBeenCalled()
		expect(session.getActiveOperationId()).toBeUndefined()
	})

	it("interrupts an in-flight Pass for restore and continues from the restored branch without rollback", async () => {
		const ports = createPorts()
		let initialState: Parameters<ContextCompactionSessionPorts["prepareRootCheckpoint"]>[1] | undefined
		ports.prepareRootCheckpoint = vi.fn(async (input, state) => {
			initialState = state
			return checkpointHead(input.operationId)
		})
		let rejectFirstStream: ((error: Error) => void) | undefined
		let requestCount = 0
		const api = {
			createMessage: vi.fn(async function* () {
				requestCount += 1
				if (requestCount === 1) {
					yield {
						type: "tool_calls",
						function_id: "f",
						tool_index: 0,
						tool_call: { function: { name: "summarize_task", arguments: '{"context":"partial"}' } },
					}
					await new Promise<never>((_resolve, reject) => {
						rejectFirstStream = reject
					})
					return
				}
				yield {
					type: "tool_calls",
					function_id: "f",
					tool_index: 0,
					tool_call: { function: { name: "summarize_task", arguments: '{"context":"restored summary"}' } },
				}
				yield { type: "usage", inputTokens: 10, outputTokens: 5, cacheWriteTokens: 0, cacheReadTokens: 0 }
			}),
			abort: vi.fn(() => rejectFirstStream?.(new Error("restore interrupt"))),
		} as unknown as ApiHandler
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		const run = session.run({
			operationId: "operation-restore",
			trigger: "profile_switch",
			compactionApi: api,
			targetApi: api,
			targetMode: "act",
			sourceHistory: HISTORY,
		})
		await vi.waitFor(() =>
			expect(ports.publish).toHaveBeenCalledWith(
				expect.objectContaining({ operationId: "operation-restore" }),
				expect.objectContaining({ kind: "pass_partial", content: "partial" }),
			),
		)
		const restoredHead = checkpointHead("operation-restore", {
			branchId: "branch:operation-restore:1",
			chainRevision: 1,
			sequence: 1,
		})
		if (!initialState) throw new Error("Expected the initial compaction state before restore")
		const restoredState = initialState

		await session.restore("operation-restore", {
			prepare: async () => undefined,
			apply: async () => ({
				state: restoredState,
				checkpointHead: restoredHead,
			}),
		})

		expect(await run).toBe("completed")
		expect(api.abort).toHaveBeenCalledOnce()
		expect(ports.rollback).not.toHaveBeenCalled()
		expect(ports.checkpointAcceptedPass).toHaveBeenCalledOnce()
		expect(ports.checkpointAcceptedPass).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-restore" }),
			expect.objectContaining({ expectedHead: restoredHead }),
		)
		expect(ports.commit).toHaveBeenCalledOnce()
	})

	it("uses the target projection atomically returned by the durable checkpoint", async () => {
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
		ports.checkpointAcceptedPass = vi.fn(async (input, checkpoint) => ({
			checkpointHead: checkpointHead(input.operationId, {
				headCheckpointId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				branchId: checkpoint.expectedHead.branchId,
				chainRevision: checkpoint.expectedHead.chainRevision + 1,
				sequence: checkpoint.expectedHead.sequence + 1,
				depth: checkpoint.expectedHead.depth + 1,
			}),
			projection: atomicProjection,
		})) as unknown as ContextCompactionSessionPorts["checkpointAcceptedPass"]
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
		expect(ports.publish).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-atomic-projection" }),
			expect.objectContaining({ kind: "pass_completed", projection: atomicProjection }),
		)
	})

	it("does not advance or complete a Pass when its durable checkpoint fails", async () => {
		const ports = createPorts()
		ports.checkpointAcceptedPass = vi.fn(async () => {
			throw new Error("checkpoint write failed")
		})
		const session = new ContextCompactionSession(ports, { maxRetryAttempts: 1 })
		useSuccessfulCompactionStream()

		const result = await session.run({
			operationId: "operation-checkpoint-failure",
			trigger: "profile_switch",
			compactionApi: API,
			targetApi: API,
			targetMode: "act",
			sourceHistory: HISTORY,
		})

		expect(result).toBe("failed")
		expect(ports.stageAcceptedPass).not.toHaveBeenCalled()
		expect(ports.commit).not.toHaveBeenCalled()
		expect(ports.rollback).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "operation-checkpoint-failure" }),
			expect.objectContaining({ passIndex: 0, coveredTurnCount: 0 }),
			"checkpoint write failed",
		)
		expect(vi.mocked(ports.publish).mock.calls.map(([, event]) => event.kind)).toEqual([
			"pass_started",
			"pass_receiving",
			"pass_partial",
			"pass_receiving",
			"failed",
		])
	})

	it("rolls back instead of committing when the target remains exhausted", async () => {
		const ports = createPorts()
		ports.checkpointAcceptedPass = vi.fn(async (input, checkpoint) => ({
			checkpointHead: checkpointHead(input.operationId, {
				headCheckpointId: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				branchId: checkpoint.expectedHead.branchId,
				chainRevision: checkpoint.expectedHead.chainRevision + 1,
				sequence: checkpoint.expectedHead.sequence + 1,
				depth: checkpoint.expectedHead.depth + 1,
			}),
			projection: decision("exhausted"),
		}))
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
		expect(ports.commit).not.toHaveBeenCalled()
		expect(ports.rollback).toHaveBeenCalledOnce()
	})
})
