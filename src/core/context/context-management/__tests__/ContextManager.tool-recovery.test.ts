import { convertToOpenAIResponsesInput } from "@core/api/transform/openai-response-format"
import type { ClineStorageMessage, ClineUserToolResultContentBlock } from "@shared/messages/content"
import { normalizeLegacyConversation } from "@shared/messages/legacy-identity-migration"
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
					function_id: "call_status_update",
					dline_tid: "dline_status_update",
					provider_metadata: { item_id: "fc_status_item" },
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
			function_id: "call_status_update",
			dline_tid: "dline_status_update",
		})
		expect(result).not.toHaveProperty("tool_use_id")
		expect(result).not.toHaveProperty("call_id")
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
			} as any,
		])

		const result = repairedResult(normalizeLegacyConversation(history))

		expect(result.function_id).toBe("call_status_update")
		expect(result.dline_tid).toBe("dline_status_update")
		expect(result).not.toHaveProperty("tool_use_id")
		expect(result).not.toHaveProperty("call_id")
	})
})
