import { convertToOpenAIResponsesInput } from "@core/api/transform/openai-response-format"
import type { ClineStorageMessage, ClineUserToolResultContentBlock } from "@shared/messages/content"
import { describe, expect, it } from "vitest"
import { ContextManager } from "../ContextManager"

function toolUseHistory(userContent: ClineStorageMessage["content"]): ClineStorageMessage[] {
	return [
		{ role: "user", content: "Initial task" },
		{ role: "assistant", content: "Starting work" },
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "fc_status_item",
					item_id: "fc_status_item",
					function_id: "call_status_update",
					dline_tid: "dline_status_update",
					name: "status_update",
					input: { response: "Working" },
				},
			],
		},
		{ role: "user", content: userContent },
	]
}

function repairedResult(history: ClineStorageMessage[]): ClineUserToolResultContentBlock {
	const repaired = new ContextManager().getTruncatedMessages(history, undefined) as ClineStorageMessage[]
	const content = repaired[3].content
	if (!Array.isArray(content) || content[0]?.type !== "tool_result") {
		throw new Error("Expected a repaired canonical tool result")
	}
	return content[0]
}

describe("ContextManager canonical tool-result recovery", () => {
	it("synthesizes a provider-projectable result when execution history lost the result", () => {
		const history = toolUseHistory([{ type: "text", text: "<environment_details />" }])

		const result = repairedResult(history)

		expect(result).toMatchObject({
			tool_use_id: "call_status_update",
			function_id: "call_status_update",
			call_id: "call_status_update",
			dline_tid: "dline_status_update",
		})
		expect(() =>
			convertToOpenAIResponsesInput(new ContextManager().getTruncatedMessages(history, undefined) as ClineStorageMessage[]),
		).not.toThrow()
	})

	it("normalizes a legacy result before strict provider projection", () => {
		const history = toolUseHistory([
			{
				type: "tool_result",
				tool_use_id: "call_status_update",
				content: [{ type: "text", text: "Legacy result" }],
			},
		])

		const result = repairedResult(history)

		expect(result.function_id).toBe("call_status_update")
		expect(result.call_id).toBe("call_status_update")
		expect(result.dline_tid).toBe("dline_status_update")
	})
})
