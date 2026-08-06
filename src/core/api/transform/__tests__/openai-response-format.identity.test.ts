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

	it("projects Dline-owned function ids into Responses call_id fields", () => {
		const dlineFunctionId = `dline_function_${"0".repeat(26)}`
		const toolUse: ClineAssistantToolUseBlock = {
			type: "tool_use",
			function_id: dlineFunctionId,
			dline_tid: "dline_tid_test",
			name: "read_file",
			input: { path: "README.md" },
		}
		const toolResult: ClineUserToolResultContentBlock = {
			type: "tool_result",
			function_id: dlineFunctionId,
			dline_tid: "dline_tid_test",
			content: "file contents",
		}
		const messages: ClineStorageMessage[] = [
			{ role: "assistant", content: [toolUse] },
			{ role: "user", content: [toolResult] },
		]

		const { input } = convertToOpenAIResponsesInput(messages)

		const call = input.find((item) => item.type === "function_call")
		const output = input.find((item) => item.type === "function_call_output")
		expect(call?.type).toBe("function_call")
		expect(output?.type).toBe("function_call_output")
		expect(String(call?.call_id)).toMatch(/^call_/)
		expect(String(call?.call_id).length).toBeLessThanOrEqual(40)
		expect(String(output?.call_id)).toBe(String(call?.call_id))
		expect(JSON.stringify(input)).not.toContain("dline_function_")
		expect(JSON.stringify(input)).not.toContain("dline_tid")
	})
})
