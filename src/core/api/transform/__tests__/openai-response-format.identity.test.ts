import { describe, expect, it } from "vitest"
import type { ClineAssistantToolUseBlock, ClineStorageMessage, ClineUserToolResultContentBlock } from "@/shared/messages/content"
import { convertToOpenAIResponsesInput } from "../openai-response-format"

interface CanonicalToolUse extends ClineAssistantToolUseBlock {
	item_id: string
	function_id: string
	dline_tid: string
}

interface CanonicalToolResult extends ClineUserToolResultContentBlock {
	item_id: string
	function_id: string
	dline_tid: string
}

describe("OpenAI Responses identity projection", () => {
	it("projects item and function identities without leaking Dline trace identity", () => {
		const toolUse: CanonicalToolUse = {
			type: "tool_use",
			id: "legacy_tool_id",
			call_id: "legacy_call_id",
			item_id: "fc_item_123",
			function_id: "call_123",
			dline_tid: "dline_tid_test",
			name: "read_file",
			input: { path: "README.md" },
		}
		const toolResult: CanonicalToolResult = {
			type: "tool_result",
			tool_use_id: "legacy_tool_id",
			call_id: "legacy_call_id",
			item_id: "fc_result_456",
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
				id: "fc_item_123",
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
	})
})
