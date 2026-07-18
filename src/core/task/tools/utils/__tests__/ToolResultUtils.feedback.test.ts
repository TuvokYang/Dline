import { strict as assert } from "node:assert"
import type { ToolUse } from "@core/assistant-message"
import type { TaskConfig } from "@core/task/tools/types/TaskConfig"
import { describe, expect, it, vi } from "vitest"
import { ToolResultUtils } from "../ToolResultUtils"

/**
 * Create a minimal tool block for tool result tests.
 *
 * @returns Tool use block with canonical native identities.
 */
function createBlock(): ToolUse {
	return {
		type: "tool_use",
		name: "write_to_file",
		params: {},
		partial: false,
		function_id: "call-1",
		dline_tid: "dline_tid_1",
		isNativeToolCall: true,
		ts: 1,
	} as ToolUse
}

/**
 * Describe a tool block for tool result tests.
 *
 * @param block Tool use block.
 * @returns Human-readable tool description.
 */
function describeTool(block: ToolUse): string {
	return `[${block.name}]`
}

describe("ToolResultUtils approval feedback", () => {
	it("merges approval feedback into the following native tool_result", () => {
		const userMessageContent: any[] = []
		ToolResultUtils.pushAdditionalToolFeedback(userMessageContent, "请继续，但注意边界", undefined, undefined)

		ToolResultUtils.pushToolResult("File written.", createBlock(), userMessageContent, describeTool, undefined)

		assert.equal(userMessageContent.length, 1)
		const toolResult = userMessageContent[0]
		assert.equal(toolResult.type, "tool_result")
		assert.equal(toolResult.function_id, "call-1")
		assert.equal(toolResult.dline_tid, "dline_tid_1")
		assert.equal("tool_use_id" in toolResult, false)
		assert.equal("item_id" in toolResult, false)
		assert.match(toolResult.content[0].text, /\[write_to_file\] Result:\nFile written\./)
		assert.match(toolResult.content[1].text, /<feedback>\n请继续，但注意边界\n<\/feedback>/)
	})

	it("does not leak approval feedback as a standalone text block", () => {
		const userMessageContent: any[] = []
		ToolResultUtils.pushAdditionalToolFeedback(userMessageContent, "不要单独写入 text", undefined, undefined)

		assert.equal(userMessageContent.length, 1)
		assert.equal(userMessageContent[0].type, "tool_feedback")

		ToolResultUtils.pushToolResult("Rejected.", createBlock(), userMessageContent, describeTool, undefined)

		assert.equal(
			userMessageContent.some((block) => block.type === "tool_feedback"),
			false,
		)
		assert.equal(
			userMessageContent.some((block) => block.type === "text"),
			false,
		)
	})

	it("does not render duplicate user_feedback when approval response was already acked", async () => {
		const userMessageContent: any[] = []
		const say = vi.fn(async () => undefined)
		const config = {
			isSubagentExecution: false,
			callbacks: {
				ask: vi.fn(async () => ({ response: "yesButtonClicked", text: "审批补充", images: [], files: [] })),
				say,
			},
			taskState: {
				userMessageContent,
				ackedFeedback: {
					response: "yesButtonClicked",
					text: "审批补充",
					images: [],
					files: [],
				},
			},
			taskController: {
				rejectActiveBlock: vi.fn(),
			},
		} as unknown as TaskConfig

		const approved = await ToolResultUtils.askApprovalAndPushFeedback("tool" as never, "{}", config)

		assert.equal(approved, true)
		expect(say).not.toHaveBeenCalledWith("user_feedback", "审批补充", [], [])
		assert.equal(config.taskState.ackedFeedback, undefined)
		assert.equal(userMessageContent.length, 1)
		assert.equal(userMessageContent[0].type, "tool_feedback")
		ToolResultUtils.pushToolResult("Approved.", createBlock(), userMessageContent, describeTool, undefined)
		assert.match(userMessageContent[0].content[1].text, /<feedback>\n审批补充\n<\/feedback>/)
	})
})
