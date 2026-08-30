import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const taskSourcePath = path.resolve("src/core/task/index.ts")

function extractReasoningChunkCase(source: string): string {
	const requestStart = source.indexOf("async recursivelyMakeClineRequests(")
	const reasoningStart = source.indexOf('case "reasoning": {', requestStart)
	const toolCallStart = source.indexOf('case "tool_calls": {', reasoningStart)
	if (requestStart < 0 || reasoningStart < 0 || toolCallStart < 0) {
		throw new Error("Unable to locate the Task reasoning stream boundary")
	}
	return source.slice(reasoningStart, toolCallStart)
}

describe("Task reasoning and completion presentation order", () => {
	it("reserves the stable reasoning timestamp before a later tool chunk can allocate its timestamp", async () => {
		const source = await readFile(taskSourcePath, "utf8")
		const reasoningCase = extractReasoningChunkCase(source)
		const visibleReasoningGuard = reasoningCase.indexOf("thinkingBlock?.thinking")
		const reserveTimestamp = reasoningCase.indexOf("this.taskState.reasoningTs = this.genMessageTs()")
		// The published value depends on whether the chunk carries renderable text
		// or only encrypted reasoning, so match the assignment rather than one operand.
		const publishPendingText = reasoningCase.indexOf("this.pendingReasoningText =")

		expect(visibleReasoningGuard).toBeGreaterThanOrEqual(0)
		expect(reserveTimestamp).toBeGreaterThan(visibleReasoningGuard)
		expect(reserveTimestamp).toBeLessThan(publishPendingText)
		expect(reasoningCase.slice(visibleReasoningGuard, publishPendingText)).not.toContain(
			"await this.flushPendingReasoningMessage",
		)
	})
})
