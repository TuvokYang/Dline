import { expect } from "chai"
import { describe, it } from "vitest"
import { shouldDeferCurrentTurn, shouldRestoreDeferredTurn } from "../current-turn-compaction"

const DEFAULT_TRIGGER_TOKENS = 261_340

/**
 * Create a tool result block with controllable payload size.
 *
 * @param functionId Function identifier for the result block.
 * @param text Payload text to embed in the tool result.
 * @returns Tool result content block matching Dline's tool result format.
 */
function createToolResult(functionId: string, text: string) {
	return {
		type: "tool_result" as const,
		function_id: functionId,
		dline_tid: `tid_${functionId}`,
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
			triggerTokens: DEFAULT_TRIGGER_TOKENS,
			previousTokens,
			userContent: [createToolResult("toolu_execute", `[execute_command] Result:\n${toolPayload}`)],
		})

		expect(shouldDefer).to.equal(true)
	})

	it("does not defer plain user text even when estimated size crosses the trigger", () => {
		const previousTokens = 230_000
		const textPayload = "x".repeat(140_000)

		const shouldDefer = shouldDeferCurrentTurn({
			triggerTokens: DEFAULT_TRIGGER_TOKENS,
			previousTokens,
			userContent: [createText(textPayload)],
		})

		expect(shouldDefer).to.equal(false)
	})

	it("does not defer tool results while the estimated request remains below the trigger", () => {
		const previousTokens = 230_000
		const toolPayload = "x".repeat(20_000)

		const shouldDefer = shouldDeferCurrentTurn({
			triggerTokens: DEFAULT_TRIGGER_TOKENS,
			previousTokens,
			userContent: [createToolResult("toolu_search", `[search_files] Result:\n${toolPayload}`)],
		})

		expect(shouldDefer).to.equal(false)
	})

	it("defers tool results when the previous request already exceeds the trigger", () => {
		const previousTokens = 263_000

		const shouldDefer = shouldDeferCurrentTurn({
			triggerTokens: DEFAULT_TRIGGER_TOKENS,
			previousTokens,
			userContent: [createToolResult("toolu_execute", "[execute_command] Result:\nsmall current result")],
		})

		expect(shouldDefer).to.equal(true)
	})

	it("uses the caller-resolved custom trigger", () => {
		const shouldDefer = shouldDeferCurrentTurn({
			triggerTokens: 160_000,
			previousTokens: 150_000,
			userContent: [createToolResult("toolu_execute", "x".repeat(40_000))],
		})

		expect(shouldDefer).to.equal(true)
	})

	it("restores deferred turns only after summarize_task has completed", () => {
		expect(shouldRestoreDeferredTurn({ hasDeferredTurn: true, didCompleteSummarization: false })).to.equal(false)
		expect(shouldRestoreDeferredTurn({ hasDeferredTurn: false, didCompleteSummarization: true })).to.equal(false)
		expect(shouldRestoreDeferredTurn({ hasDeferredTurn: true, didCompleteSummarization: true })).to.equal(true)
	})
})
