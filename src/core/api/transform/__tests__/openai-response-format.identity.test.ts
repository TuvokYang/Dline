import { describe, expect, it } from "vitest"
import type { ClineAssistantToolUseBlock, ClineStorageMessage, ClineUserToolResultContentBlock } from "@/shared/messages/content"
import { convertToOpenAIResponsesInput } from "../openai-response-format"

describe("OpenAI Responses identity projection", () => {
	it("projects only the canonical function identity without requiring persisted provider item metadata", () => {
		const toolUse: ClineAssistantToolUseBlock = {
			type: "tool_use",
			function_id: "call_123",
			dline_tid: "dline_tid_test",
			name: "read_file",
			input: { path: "README.md" },
		}
		const toolResult: ClineUserToolResultContentBlock = {
			type: "tool_result",
			function_id: "call_123",
			dline_tid: "dline_tid_test",
			content: "file contents",
		}
		const messages: ClineStorageMessage[] = [
			{ role: "assistant", content: [toolUse] },
			{ role: "user", content: [toolResult] },
		]

		const { input } = convertToOpenAIResponsesInput(messages)

		expect(input).toEqual([
			{
				type: "function_call",
				call_id: "call_123",
				name: "read_file",
				arguments: '{"path":"README.md"}',
			},
			{
				type: "function_call_output",
				call_id: "call_123",
				output: "file contents",
			},
		])
		expect(JSON.stringify(input)).not.toContain("dline_tid")
		expect(JSON.stringify(input)).not.toContain("item_id")
	})
})
