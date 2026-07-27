import type { ClineMessage } from "@shared/ExtensionMessage"
import type { ClineContent, ClineStorageMessage, ClineUserToolResultContentBlock } from "@shared/messages"
import { describe, expect, it } from "vitest"
import { type BlockLifecycle, BlockPhase } from "../../BlockPhaseMachine"
import { collectResumeTurnContent } from "../ResumeToolResult"

const blocks: BlockLifecycle[] = [
	{
		dlineTid: "tid-api",
		functionId: "fn-api",
		toolName: "read_file",
		phase: BlockPhase.COMPLETED,
		ts: 10,
		requiresApproval: false,
		conversationHistoryIndex: 1,
	},
	{
		dlineTid: "tid-ui",
		functionId: "fn-ui",
		toolName: "execute_command",
		phase: BlockPhase.COMPLETED,
		ts: 11,
		requiresApproval: false,
		conversationHistoryIndex: 1,
	},
	{
		dlineTid: "tid-missing",
		functionId: "fn-missing",
		toolName: "write_to_file",
		phase: BlockPhase.CANCELLED,
		ts: 12,
		requiresApproval: true,
		conversationHistoryIndex: 1,
	},
]

function result(dlineTid: string, functionId: string, text: string): ClineUserToolResultContentBlock {
	return {
		type: "tool_result",
		dline_tid: dlineTid,
		function_id: functionId,
		content: [{ type: "text", text }],
	}
}

describe("collectResumeTurnContent", () => {
	it("does not duplicate API results, restores durable UI results, and closes missing pairs", () => {
		const apiHistory: ClineStorageMessage[] = [
			{ role: "assistant", content: [], ts: 1 },
			{ role: "user", content: [result("tid-api", "fn-api", "already persisted")], ts: 2 },
		]
		const uiHistory: ClineMessage[] = [
			{
				ts: 3,
				type: "say",
				say: "partial_tool_result",
				text: JSON.stringify({
					version: 1,
					function_id: "fn-ui",
					dline_tid: "tid-ui",
					content: [{ type: "text", text: "durable partial" }],
					is_error: null,
				}),
			},
		]
		const pendingContent: ClineContent[] = [{ type: "text", text: "preserved feedback" }]

		const content = collectResumeTurnContent({
			blocks,
			assistantApiIndex: 0,
			apiHistory,
			uiHistory,
			pendingContent,
			synthesizeMissing: "all",
		})
		const results = content.filter((item): item is ClineUserToolResultContentBlock => item.type === "tool_result")

		expect(results.map((item) => item.dline_tid)).toEqual(["tid-ui", "tid-missing"])
		expect(results[0]?.content).toEqual([{ type: "text", text: "durable partial" }])
		expect(results[1]).toMatchObject({
			function_id: "fn-missing",
			dline_tid: "tid-missing",
			is_error: true,
		})
		expect(content.at(-1)).toEqual({ type: "text", text: "preserved feedback" })
	})

	it("treats ambiguous unversioned results as text instead of guessing structured content", () => {
		const content = collectResumeTurnContent({
			blocks: [blocks[1]],
			assistantApiIndex: 0,
			apiHistory: [{ role: "assistant", content: [], ts: 1 }],
			uiHistory: [
				{
					ts: 3,
					type: "say",
					say: "partial_tool_result",
					text: JSON.stringify({ function_id: "fn-ui", dline_tid: "tid-ui", result: "[]" }),
				},
			],
			pendingContent: [],
			synthesizeMissing: "all",
		})
		const restored = content.find(
			(item): item is ClineUserToolResultContentBlock => item.type === "tool_result" && item.dline_tid === "tid-ui",
		)

		expect(restored?.content).toEqual([{ type: "text", text: "[]" }])
	})

	it("keeps an awaiting interaction unpaired while restoring earlier durable results", () => {
		const awaiting = blocks.map((block, index) => (index === 2 ? { ...block, phase: BlockPhase.AWAITING_APPROVAL } : block))
		const pending = result("tid-ui", "fn-ui", "already pending")

		const content = collectResumeTurnContent({
			blocks: awaiting,
			assistantApiIndex: 0,
			apiHistory: [{ role: "assistant", content: [], ts: 1 }],
			uiHistory: [],
			pendingContent: [pending],
			synthesizeMissing: "terminal_only",
		})
		const results = content.filter((item): item is ClineUserToolResultContentBlock => item.type === "tool_result")

		expect(results.map((item) => item.dline_tid)).toEqual(["tid-api", "tid-ui"])
		expect(results.some((item) => item.dline_tid === "tid-missing")).toBe(false)
	})
})
