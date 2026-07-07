import { expect } from "chai"
import { describe, it } from "vitest"
import { shouldDeferCurrentTurn } from "../current-turn-compaction"

const CONTEXT_WINDOW = 272_000

/**
 * Create a tool result block with controllable payload size.
 *
 * @param toolUseId Tool use identifier for the result block.
 * @param text Payload text to embed in the tool result.
 * @returns Tool result content block matching Dline's tool result format.
 */
function createToolResult(toolUseId: string, text: string) {
	return {
		type: "tool_result" as const,
		tool_use_id: toolUseId,
		content: [
			{
				type: "text" as const,
				text,
			},
		],
	}
}

/**
 * Create a regular text block with controllable payload size.
 *
 * @param text Payload text to embed in the block.
 * @returns Text content block.
 */
function createText(text: string) {
	return {
		type: "text" as const,
		text,
	}
}

describe("current-turn compaction boundary", () => {
	it("defers any tool result when the previous request is below trigger but the current result crosses it", () => {
		const previousTokens = 230_000
		const toolPayload = "x".repeat(140_000)

		const shouldDefer = shouldDeferCurrentTurn({
			contextWindow: CONTEXT_WINDOW,
			previousTokens,
			userContent: [createToolResult("toolu_execute", `[execute_command] Result:\n${toolPayload}`)],
		})

		expect(shouldDefer).to.equal(true)
	})

	it("does not defer plain user text even when estimated size crosses the trigger", () => {
		const previousTokens = 230_000
		const textPayload = "x".repeat(140_000)

		const shouldDefer = shouldDeferCurrentTurn({
			contextWindow: CONTEXT_WINDOW,
			previousTokens,
			userContent: [createText(textPayload)],
		})

		expect(shouldDefer).to.equal(false)
	})

	it("does not defer tool results while the estimated request remains below the trigger", () => {
		const previousTokens = 230_000
		const toolPayload = "x".repeat(20_000)

		const shouldDefer = shouldDeferCurrentTurn({
			contextWindow: CONTEXT_WINDOW,
			previousTokens,
			userContent: [createToolResult("toolu_search", `[search_files] Result:\n${toolPayload}`)],
		})

		expect(shouldDefer).to.equal(false)
	})
})
