import { estimateContextWindowCandidate } from "@core/context/context-management/context-window-projection"
import type { ClineStorageMessage } from "@shared/messages/content"
import { describe, expect, it } from "vitest"
import { estimateContextWindowIndicatorSegments, estimateContextWindowReceivingDelta } from "../ContextWindowIndicatorProjection"
import type { CompactionProviderInput } from "../compaction/CompactionRequestReplay"

function providerInput(messages: ClineStorageMessage[]): CompactionProviderInput {
	return {
		systemPrompt: "system prompt",
		messages,
		tools: [],
		serverTools: [],
	}
}

describe("ContextWindowIndicatorProjection", () => {
	it("decomposes one ordinary frozen input without overlapping the latest turn and environment", () => {
		const input = providerInput([
			{ role: "user", content: [{ type: "text", text: "durable user turn" }] },
			{ role: "assistant", content: [{ type: "text", text: "durable assistant turn" }] },
			{
				role: "user",
				content: [
					{ type: "text", text: "pending user turn" },
					{ type: "text", text: "<environment_details>dynamic environment snapshot</environment_details>" },
				],
			},
		])

		const segments = estimateContextWindowIndicatorSegments({ providerInput: input, durableMessageCount: 2 })

		expect(segments.durableContextTokens).toBeGreaterThan(0)
		expect(segments.pendingSendTokens).toBeGreaterThan(0)
		expect(segments.environmentTokens).toBeGreaterThan(0)
		expect(segments.durableContextTokens + segments.pendingSendTokens + segments.environmentTokens).toBe(segments.totalTokens)
		expect(segments.totalTokens).toBe(estimateContextWindowCandidate(input))
	})

	it("treats a cumulative summary as durable and the selected Pass batch as pending", () => {
		const input = providerInput([
			{ role: "user", content: [{ type: "text", text: "cumulative summary" }] },
			{ role: "user", content: [{ type: "text", text: "selected logical turn A" }] },
			{ role: "assistant", content: [{ type: "text", text: "selected logical turn A response" }] },
			{ role: "user", content: [{ type: "text", text: "summarize_task instruction" }] },
		])

		const segments = estimateContextWindowIndicatorSegments({ providerInput: input, durableMessageCount: 1 })

		expect(segments.durableContextTokens).toBeGreaterThan(0)
		expect(segments.pendingSendTokens).toBeGreaterThan(segments.durableContextTokens)
		expect(segments.environmentTokens).toBe(0)
		expect(segments.durableContextTokens + segments.pendingSendTokens).toBe(segments.totalTokens)
	})

	it("keeps receiving estimates monotonic-compatible without counting usage input or cache tokens", () => {
		expect(estimateContextWindowReceivingDelta({ type: "text", text: "response delta" })).toBeGreaterThan(0)
		expect(estimateContextWindowReceivingDelta({ type: "reasoning", reasoning: "reasoning delta" })).toBeGreaterThan(0)
		expect(
			estimateContextWindowReceivingDelta({
				type: "usage",
				inputTokens: 1_000,
				outputTokens: 25,
				cacheReadTokens: 500,
			}),
		).toBe(25)
	})

	it("counts only model-generated tool arguments and excludes hosted tool lifecycle results", () => {
		const argumentsText = JSON.stringify({ path: "README.md" })
		expect(
			estimateContextWindowReceivingDelta({
				type: "tool_calls",
				function_id: "call_read",
				tool_index: 0,
				tool_call: { function: { name: "read_file", arguments: argumentsText } },
			}),
		).toBe(Math.ceil(Buffer.byteLength(argumentsText, "utf8") / 4))

		expect(
			estimateContextWindowReceivingDelta({
				type: "server_tool",
				function_id: "ws_large_result",
				tool: "WEB_SEARCH",
				phase: "completed",
				result: { results: [{ snippet: "provider result".repeat(4_000) }] },
			}),
		).toBe(0)
	})
})
