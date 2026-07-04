import { strict as assert } from "node:assert"
import { describe, it, vi } from "vitest"
import type { ResumeContext } from "../ResumeHandler"
import { ResumeHandler } from "../ResumeHandler"

/**
 * Tests for ResumeHandler — validates the new snapshot-aware resume path.
 */
describe("ResumeHandler", () => {
	function createMockContext(overrides: Partial<ResumeContext> = {}): ResumeContext {
		return {
			taskState: {
				abort: false,
			} as any,
			controller: {
				toolNameToAskType: () => "resume_task",
				rejectActiveBlock: vi.fn(),
			} as any,
			messageStateHandler: {
				clineMessages: [],
				apiConversationHistory: [],
			} as any,
			restoreHandler: {
				replayPendingTools: async () => {},
			} as any,
			ask: async () => ({ response: "yesButtonClicked", text: "" }),
			say: async () => 0,
			postStateToWebview: async () => {},
			...overrides,
		}
	}

	it("promptUser does NOT call rejectActiveBlock on rejection", async () => {
		const rejectSpy = vi.fn()
		const ctx = createMockContext({
			controller: {
				toolNameToAskType: () => "tool",
				rejectActiveBlock: rejectSpy,
			} as any,
			ask: async () => ({ response: "noButtonClicked", text: "" }),
		})

		const handler = new ResumeHandler(ctx)
		const result = await handler.promptUser(
			{
				assistantIndex: 0,
				toolUseBlocks: [{ type: "tool_use", id: "t1", name: "write_to_file", input: {} } as any],
				answeredToolResults: [],
				sanitizedHistory: [],
			},
			undefined,
		)

		assert.equal(result.response, "noButtonClicked")
		// rejectActiveBlock should NOT be called — the BlockPhaseMachine has no
		// active approval block during resume (all blocks are in STREAMING phase).
		assert.equal(rejectSpy.mock.calls.length, 0, "rejectActiveBlock should not be called during resume")
	})

	it("detectPendingTools returns undefined for empty history", () => {
		const ctx = createMockContext({
			messageStateHandler: {
				clineMessages: [],
				apiConversationHistory: [],
			} as any,
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools([])
		assert.equal(result, undefined)
	})

	it("detectPendingTools starts from snapshot apiIndex instead of the history tail", () => {
		const apiHistory = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_snapshot",
						call_id: "call_snapshot",
						name: "read_file",
						input: {},
					},
				],
			},
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "tool_tail",
						call_id: "call_tail",
						name: "write_to_file",
						input: {},
					},
				],
			},
		] as any[]
		const ctx = createMockContext({
			messageStateHandler: {
				clineMessages: [
					{
						ts: 300,
						type: "say",
						say: "state_snapshot",
						text: JSON.stringify({ phase: "streaming", apiIndex: 1, timestamp: 300 }),
					},
				],
				apiConversationHistory: apiHistory,
			} as any,
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory as any)

		assert.equal(result?.assistantIndex, 1)
		assert.equal(result?.toolUseBlocks[0].id, "tool_snapshot")
	})

	it("detectPendingTools falls back to history tail for invalid startup snapshot apiIndex", () => {
		const apiHistory = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool_old", call_id: "call_old", name: "read_file", input: {} }],
			},
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool_tail", call_id: "call_tail", name: "write_to_file", input: {} }],
			},
		] as any[]
		const ctx = createMockContext({
			messageStateHandler: {
				clineMessages: [
					{
						ts: 300,
						type: "say",
						say: "state_snapshot",
						text: JSON.stringify({ phase: "streaming", apiIndex: -1, timestamp: 300 }),
					},
				],
				apiConversationHistory: apiHistory,
			} as any,
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory as any)

		assert.equal(result?.assistantIndex, 2)
		assert.equal(result?.toolUseBlocks[0].id, "tool_tail")
	})

	it("detectPendingTools uses approval activeCallId instead of the first approval block", () => {
		const apiHistory = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool_first", call_id: "call_first", name: "read_file", input: {} }],
			},
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool_active", call_id: "call_active", name: "write_to_file", input: {} }],
			},
		] as any[]
		const ctx = createMockContext({
			messageStateHandler: {
				clineMessages: [
					{
						ts: 300,
						type: "say",
						say: "state_snapshot",
						text: JSON.stringify({
							phase: "awaiting_approval",
							apiIndex: 2,
							timestamp: 300,
							approval: {
								mode: "serial",
								activeCallId: "call_active",
								blocks: [
									{ callId: "call_first", name: "read_file", phase: "awaiting_approval", apiIndex: 1 },
									{ callId: "call_active", name: "write_to_file", phase: "awaiting_approval", apiIndex: 2 },
								],
							},
						}),
					},
				],
				apiConversationHistory: apiHistory,
			} as any,
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory as any)

		assert.equal(result?.assistantIndex, 2)
		assert.equal(result?.toolUseBlocks[0].id, "tool_active")
	})

	it("detectPendingTools filters pending blocks using snapshot resume context", () => {
		const apiHistory = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "tool_answered", call_id: "call_answered", name: "read_file", input: {} },
					{ type: "tool_use", id: "tool_pending", call_id: "call_pending", name: "write_to_file", input: {} },
				],
			},
		] as any[]
		const ctx = createMockContext({
			messageStateHandler: {
				clineMessages: [
					{
						ts: 300,
						type: "say",
						say: "state_snapshot",
						text: JSON.stringify({
							phase: "resuming",
							apiIndex: 1,
							timestamp: 300,
							resume: {
								assistantApiIndex: 1,
								pendingToolUseIds: ["tool_pending"],
								answeredToolUseIds: ["tool_answered"],
							},
						}),
					},
				],
				apiConversationHistory: apiHistory,
			} as any,
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory as any)

		assert.equal(result?.assistantIndex, 1)
		assert.deepEqual(
			result?.toolUseBlocks.map((block) => block.id),
			["tool_pending"],
		)
	})

	it("resumeFromHistory returns false when detectPendingTools finds nothing", async () => {
		const ctx = createMockContext({
			messageStateHandler: {
				clineMessages: [],
				apiConversationHistory: [],
			} as any,
		})

		const handler = new ResumeHandler(ctx)
		const result = await handler.resumeFromHistory()
		assert.equal(result, false)
	})
})
