import { strict as assert } from "node:assert"
import { describe, it } from "vitest"
import type { PendingToolUseState, RestoreContext } from "../RestoreHandler"
import { RestoreHandler } from "../RestoreHandler"

/**
 * Tests for RestoreHandler — validates all restore modes and replayPendingTools.
 */
describe("RestoreHandler", () => {
	function createMockContext(overrides: Partial<RestoreContext> = {}): RestoreContext {
		return {
			taskState: {
				toolUseIdMap: new Map(),
			} as any,
			controller: {
				transition: () => ({}),
				reset: () => {},
				buildTurn: () => {},
				restoreFrom: () => {},
				phase: "idle",
			} as any,
			messageStateHandler: {
				apiConversationHistory: [],
				overwriteApiConversationHistory: async () => {},
				clineMessages: [],
			} as any,
			presentAssistantMessage: async () => {},
			recursivelyMakeClineRequests: async () => false,
			postStateToWebview: async () => {},
			shouldAutoApproveTool: () => false,
			...overrides,
		}
	}

	// ── restoreFromCheckpoint ──

	it("restoreFromCheckpoint throws when checkpointManager is missing", async () => {
		const handler = new RestoreHandler(createMockContext())
		await assert.rejects(() => handler.restoreFromCheckpoint("abc123"), {
			message: "Checkpoint manager is not available. Enable checkpoints in settings.",
		})
	})

	it("restoreFromCheckpoint delegates to checkpointManager.restoreCheckpoint", async () => {
		let restoreCalled = false
		let restoreMessageTs: number | undefined

		const checkpointManager = {
			restoreCheckpoint: async (messageTs: number) => {
				restoreCalled = true
				restoreMessageTs = messageTs
			},
		}

		const handler = new RestoreHandler(createMockContext({ checkpointManager } as any))

		// Integer string → parse as messageTs
		await handler.restoreFromCheckpoint("42")
		assert.ok(restoreCalled, "restoreCheckpoint should be called")
		assert.equal(restoreMessageTs, 42)
	})

	// ── restoreAfterHistoryEdit ──

	it("restoreAfterHistoryEdit throws for out-of-range index", async () => {
		const handler = new RestoreHandler(
			createMockContext({
				messageStateHandler: { apiConversationHistory: [], clineMessages: [] } as any,
			}),
		)
		await assert.rejects(() => handler.restoreAfterHistoryEdit(5), {
			message: "Invalid modifiedApiIndex: 5, history length: 0",
		})
	})

	// ── restoreFilesOnly ──

	it("restoreFilesOnly throws when checkpointManager is missing", async () => {
		const handler = new RestoreHandler(createMockContext())
		await assert.rejects(() => handler.restoreFilesOnly(["file.ts"]), {
			message: "Checkpoint manager is not available. Enable checkpoints in settings.",
		})
	})

	it("restoreFilesOnly delegates to restoreCheckpoint for fallback", async () => {
		let restoreCalled = false
		const checkpointManager = {
			restoreCheckpoint: async () => {
				restoreCalled = true
			},
		}

		const handler = new RestoreHandler(createMockContext({ checkpointManager } as any))

		await handler.restoreFilesOnly(["file.ts"])
		assert.ok(restoreCalled, "restoreCheckpoint should be called as fallback")
	})

	// ── restoreChatOnly ──

	it("restoreChatOnly restores phase from snapshot and calls postStateToWebview", async () => {
		let restoreFromCalled = false
		let postStateCalled = false

		const handler = new RestoreHandler(
			createMockContext({
				controller: {
					restoreFrom: () => {
						restoreFromCalled = true
					},
					buildTurn: () => {},
					phase: "idle",
				} as any,
				postStateToWebview: async () => {
					postStateCalled = true
				},
			}),
		)

		await handler.restoreChatOnly({
			phase: "executing" as any,
			apiIndex: 3,
			timestamp: Date.now(),
		})

		assert.ok(restoreFromCalled, "restoreFrom should be called with snapshot")
		assert.ok(postStateCalled, "postStateToWebview should be called")
	})

	it("restoreChatOnly restores approval turn state from snapshot", async () => {
		let restoredBlocks: any[] | undefined
		let restoredActiveCallId: string | undefined

		const handler = new RestoreHandler(
			createMockContext({
				controller: {
					restoreFrom: () => {},
					restoreTurnFromSnapshot: (blocks: any[], activeCallId?: string) => {
						restoredBlocks = blocks
						restoredActiveCallId = activeCallId
					},
					buildTurn: () => {},
					phase: "idle",
				} as any,
			}),
		)

		await handler.restoreChatOnly({
			phase: "awaiting_approval" as any,
			apiIndex: 4,
			timestamp: Date.now(),
			approval: {
				mode: "serial",
				activeCallId: "call_active",
				blocks: [
					{ callId: "call_active", name: "write_to_file", phase: "awaiting_approval" as any, apiIndex: 4 },
					{ callId: "call_next", name: "execute_command", phase: "streaming" as any, apiIndex: 4 },
				],
			},
		})

		assert.equal(restoredActiveCallId, "call_active")
		assert.deepEqual(restoredBlocks, [
			{
				callId: "call_active",
				toolName: "write_to_file",
				phase: "awaiting_approval",
				conversationHistoryIndex: 4,
				requiresApproval: true,
			},
			{
				callId: "call_next",
				toolName: "execute_command",
				phase: "streaming",
				conversationHistoryIndex: 4,
				requiresApproval: true,
			},
		])
	})

	// ── replayPendingTools ──

	it("replayPendingTools calls transition and overwriteApiConversationHistory", async () => {
		const transitionCalls: any[] = []
		let overwriteCalled = false
		const ctx = createMockContext({
			controller: {
				transition: (...args: any[]) => {
					transitionCalls.push(args)
					return {}
				},
				reset: () => {},
				buildTurn: () => {},
				phase: "idle",
			} as any,
			messageStateHandler: {
				apiConversationHistory: [{}, {}, {}, {}, {}],
				overwriteApiConversationHistory: async () => {
					overwriteCalled = true
				},
				clineMessages: [],
			} as any,
		})

		const handler = new RestoreHandler(ctx)
		const pending: PendingToolUseState = {
			assistantIndex: 2,
			toolUseBlocks: [
				{
					type: "tool_use",
					id: "tool_1",
					call_id: "call_1",
					name: "read_file",
					input: { filePath: "/test.ts" },
				} as any,
			],
			answeredToolResults: [],
			sanitizedHistory: [],
		}

		await handler.replayPendingTools(pending, { baseTs: 1000 })
		assert.ok(transitionCalls.length >= 2, `Expected >= 2 transition calls, got ${transitionCalls.length}`)
		assert.equal(transitionCalls[0][1].apiIndex, 2)
		assert.ok(overwriteCalled, "Expected overwriteApiConversationHistory to be called")
	})

	it("replayPendingTools builds turn with the current auto-approval predicate", async () => {
		let autoApproveResult: boolean | undefined
		const ctx = createMockContext({
			controller: {
				transition: () => ({}),
				reset: () => {},
				buildTurn: (_blocks: any[], autoApprove: (toolName: string, callId: string) => boolean) => {
					autoApproveResult = autoApprove("read_file", "call_1")
				},
				phase: "idle",
			} as any,
			messageStateHandler: {
				apiConversationHistory: [{}, {}],
				overwriteApiConversationHistory: async () => {},
				clineMessages: [],
			} as any,
			shouldAutoApproveTool: (toolName, callId) => toolName === "read_file" && callId === "call_1",
		})

		const handler = new RestoreHandler(ctx)
		await handler.replayPendingTools({
			assistantIndex: 1,
			toolUseBlocks: [
				{
					type: "tool_use",
					id: "tool_1",
					call_id: "call_1",
					name: "read_file",
					input: { filePath: "/test.ts" },
				} as any,
			],
			answeredToolResults: [],
			sanitizedHistory: [{}, {}] as any,
		})

		assert.equal(autoApproveResult, true)
	})
})
