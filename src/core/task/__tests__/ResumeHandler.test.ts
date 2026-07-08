import { strict as assert } from "node:assert"
import { describe, it, vi } from "vitest"
import type { ClineAssistantToolUseBlock, ClineStorageMessage } from "@/shared/messages"
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
			} as unknown as ResumeContext["taskState"],
			controller: {
				toolNameToAskType: () => "resume_task",
				rejectActiveBlock: vi.fn(),
			} as unknown as ResumeContext["controller"],
			messageStateHandler: {
				clineMessages: [],
				apiConversationHistory: [],
			} as unknown as ResumeContext["messageStateHandler"],
			restoreHandler: {
				replayPendingTools: async () => {},
			} as unknown as ResumeContext["restoreHandler"],
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
			} as unknown as ResumeContext["controller"],
			ask: async () => ({ response: "noButtonClicked", text: "" }),
		})

		const handler = new ResumeHandler(ctx)
		const result = await handler.promptUser(
			{
				assistantIndex: 0,
				toolUseBlocks: [{ type: "tool_use", id: "t1", name: "write_to_file", input: {} } as ClineAssistantToolUseBlock],
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
			} as unknown as ResumeContext["messageStateHandler"],
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
		] satisfies ClineStorageMessage[]
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
			} as unknown as ResumeContext["messageStateHandler"],
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory)

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
		] satisfies ClineStorageMessage[]
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
			} as unknown as ResumeContext["messageStateHandler"],
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory)

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
		] satisfies ClineStorageMessage[]
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
			} as unknown as ResumeContext["messageStateHandler"],
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory)

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
		] satisfies ClineStorageMessage[]
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
			} as unknown as ResumeContext["messageStateHandler"],
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory)

		assert.equal(result?.assistantIndex, 1)
		assert.deepEqual(
			result?.toolUseBlocks.map((block) => block.id),
			["tool_pending"],
		)
	})

	it("detectPendingTools restores only pending tools from mixed multi-tool snapshot", () => {
		const apiHistory = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "tool_done", call_id: "call_done", name: "read_file", input: {} },
					{ type: "tool_use", id: "tool_pending", call_id: "call_pending", name: "write_to_file", input: {} },
					{ type: "tool_use", id: "tool_report", call_id: "call_report", name: "qna_respond", input: {} },
					{ type: "tool_use", id: "tool_rejected", call_id: "call_rejected", name: "execute_command", input: {} },
					{ type: "tool_use", id: "tool_skipped", call_id: "call_skipped", name: "replace_in_file", input: {} },
				],
			},
		] satisfies ClineStorageMessage[]
		const ctx = createMockContext({
			messageStateHandler: {
				clineMessages: [
					{
						ts: 250,
						type: "say",
						say: "partial_tool_result",
						conversationHistoryIndex: 1,
						text: JSON.stringify({ tool_use_id: "tool_done", result: "already done" }),
					},
					{
						ts: 300,
						type: "say",
						say: "state_snapshot",
						text: JSON.stringify({
							phase: "awaiting_approval",
							apiIndex: 1,
							timestamp: 300,
							approval: {
								mode: "serial",
								activeCallId: "call_pending",
								blocks: [
									{ callId: "call_done", name: "read_file", phase: "completed", apiIndex: 1 },
									{ callId: "call_pending", name: "write_to_file", phase: "awaiting_approval", apiIndex: 1 },
									{ callId: "call_rejected", name: "execute_command", phase: "rejected", apiIndex: 1 },
									{ callId: "call_skipped", name: "replace_in_file", phase: "skipped", apiIndex: 1 },
								],
							},
						}),
					},
				],
				apiConversationHistory: apiHistory,
			} as unknown as ResumeContext["messageStateHandler"],
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory)

		assert.equal(result?.assistantIndex, 1)
		assert.deepEqual(
			result?.toolUseBlocks.map((block) => block.id),
			["tool_pending"],
		)
		assert.deepEqual(result?.answeredToolResults, [
			{
				type: "tool_result",
				tool_use_id: "tool_done",
				content: [{ type: "text", text: "already done" }],
			},
		])
	})

	it("detectPendingTools ignores turns that only contain turn-ending tools", () => {
		const apiHistory = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "tool_attempt", call_id: "call_attempt", name: "attempt_completion", input: {} },
					{ type: "tool_use", id: "tool_ask", call_id: "call_ask", name: "ask_followup_question", input: {} },
					{ type: "tool_use", id: "tool_plan", call_id: "call_plan", name: "plan_mode_respond", input: {} },
					{ type: "tool_use", id: "tool_qna", call_id: "call_qna", name: "qna_respond", input: {} },
					{ type: "tool_use", id: "tool_report", call_id: "call_report", name: "generate_report", input: {} },
				],
			},
		] satisfies ClineStorageMessage[]
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
			} as unknown as ResumeContext["messageStateHandler"],
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory)

		assert.equal(result, undefined)
	})

	it("detectPendingTools restores regular tool calls after reasoning-only history close", () => {
		const apiHistory = [
			{ role: "user", content: [{ type: "text", text: "start" }] },
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "tool_pending", call_id: "call_pending", name: "read_file", input: {} }],
			},
		] satisfies ClineStorageMessage[]
		const ctx = createMockContext({
			messageStateHandler: {
				clineMessages: [
					{ ts: 250, type: "say", say: "reasoning", text: "thinking" },
					{
						ts: 300,
						type: "say",
						say: "state_snapshot",
						text: JSON.stringify({ phase: "streaming", apiIndex: 1, timestamp: 300 }),
					},
				],
				apiConversationHistory: apiHistory,
			} as unknown as ResumeContext["messageStateHandler"],
		})

		const handler = new ResumeHandler(ctx)
		const result = handler.detectPendingTools(apiHistory)

		assert.equal(result?.assistantIndex, 1)
		assert.deepEqual(
			result?.toolUseBlocks.map((block) => block.id),
			["tool_pending"],
		)
	})

	it("promptUser reuses the original tool approval ask timestamp", async () => {
		const askSpy = vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "" })
		const ctx = createMockContext({
			controller: {
				toolNameToAskType: () => "tool",
				rejectActiveBlock: vi.fn(),
			} as unknown as ResumeContext["controller"],
			messageStateHandler: {
				clineMessages: [
					{
						ts: 1234,
						type: "ask",
						ask: "tool",
						text: JSON.stringify({ tool: "readFile", path: "README.md" }),
					},
				],
				apiConversationHistory: [],
			} as unknown as ResumeContext["messageStateHandler"],
			ask: askSpy,
		})

		const handler = new ResumeHandler(ctx)
		await handler.promptUser(
			{
				assistantIndex: 0,
				toolUseBlocks: [{ type: "tool_use", id: "t1", name: "read_file", input: {} } as ClineAssistantToolUseBlock],
				answeredToolResults: [],
				sanitizedHistory: [],
			},
			undefined,
		)

		assert.equal(askSpy.mock.calls[0]?.[0], "tool")
		assert.equal(askSpy.mock.calls[0]?.[1], JSON.stringify({ tool: "readFile", path: "README.md" }))
		assert.equal(askSpy.mock.calls[0]?.[3]?.existingTs, 1234)
	})

	it("resumeFromHistory returns false when detectPendingTools finds nothing", async () => {
		const ctx = createMockContext({
			messageStateHandler: {
				clineMessages: [],
				apiConversationHistory: [],
			} as unknown as ResumeContext["messageStateHandler"],
		})

		const handler = new ResumeHandler(ctx)
		const result = await handler.resumeFromHistory()
		assert.equal(result, false)
	})
})
