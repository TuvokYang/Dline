import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import { isSuspectedCompactionOutputTruncation, runInternalCompactionPass } from "../internal-compaction-pass"

/**
 * P0 regression guard for compaction Passes that burned a Provider request and its
 * tokens while reporting no returned text.
 *
 * The stream completed and usage was recorded, but settlement rejected the response:
 * a second summarize_task block made the XML reader return nothing, and native
 * arguments cut off by the output cap never parsed as complete JSON. Both produced a
 * terminal failure card with empty content even though a usable summary had arrived.
 */

function usageChunk() {
	return { type: "usage" as const, inputTokens: 9_000, outputTokens: 1_200, cacheWriteTokens: 0, cacheReadTokens: 0 }
}

function createStream(chunks: unknown[]) {
	return (async function* () {
		for (const chunk of chunks) yield chunk
	})()
}

function createApi(chunks: unknown[]) {
	return { createMessage: vi.fn(() => createStream(chunks)) }
}

function createExplicitInstructions() {
	return {
		beginProviderAttempt: vi.fn(),
		createConsumePort: () => ({ consumeTool: () => ({ ok: true as const }) }),
	}
}

function runPass(chunks: unknown[], providerOutputCap?: number) {
	return runInternalCompactionPass({
		api: createApi(chunks) as never,
		providerInput: {
			systemPrompt: "system",
			messages: [],
			tools: [],
			...(providerOutputCap === undefined ? {} : { providerOutputCap }),
		} as never,
		explicitInstructions: createExplicitInstructions() as never,
	})
}

function nativeArgumentChunk(argumentText: string, phase?: "completed") {
	return {
		type: "tool_calls" as const,
		function_id: "call_compaction",
		tool_index: 0,
		...(phase === undefined ? {} : { phase }),
		tool_call: { function: { name: ClineDefaultTool.SUMMARIZE_TASK, arguments: argumentText } },
	}
}

describe("internal compaction Pass parsing tolerance", () => {
	it("still yields a summary when the model emits several summarize_task blocks", async () => {
		// The assistant parser closes `context` on the last `</context>`, so repeated
		// blocks arrive merged rather than as separate tool uses. The Pass must not be
		// rejected for it; the merged text is preserved verbatim for the reviewer.
		const text =
			"<summarize_task><context>draft summary</context></summarize_task>" +
			"<summarize_task><context>revised final summary</context></summarize_task>"

		const result = await runPass([{ type: "text", text }, usageChunk()])

		expect(result.summary).toContain("draft summary")
		expect(result.summary).toContain("revised final summary")
	})

	it("keeps accepting a single summarize_task block", async () => {
		const text = "<summarize_task><context>only summary</context></summarize_task>"

		const result = await runPass([{ type: "text", text }, usageChunk()])

		expect(result.summary).toBe("only summary")
	})

	it("salvages a summary from native arguments truncated by the output cap", async () => {
		// The closing brace never arrives, so JSON.parse cannot read the payload.
		const truncated = '{"context":"partial but usable summary'

		const result = await runPass([nativeArgumentChunk(truncated), usageChunk()])

		expect(result.summary).toBe("partial but usable summary")
	})

	it("prefers complete native arguments over the salvaged fragment", async () => {
		const complete = JSON.stringify({ context: "complete summary" })

		const result = await runPass([nativeArgumentChunk(complete, "completed"), usageChunk()])

		expect(result.summary).toBe("complete summary")
	})

	it("tags an unreadable argument payload as a suspected output truncation", async () => {
		// Argument text arrived, but it carries no readable context at all.
		const unreadable = '{"unexpected":'

		const error = await runPass([nativeArgumentChunk(unreadable), usageChunk()]).catch((caught: unknown) => caught)

		expect(error).toBeInstanceOf(Error)
		expect((error as Error).message).toMatch(/did not return a valid summarize_task context/)
		expect(isSuspectedCompactionOutputTruncation(error)).toBe(true)
	})

	it("does not tag an empty response as a suspected output truncation", async () => {
		const error = await runPass([usageChunk()]).catch((caught: unknown) => caught)

		expect(error).toBeInstanceOf(Error)
		expect(isSuspectedCompactionOutputTruncation(error)).toBe(false)
	})
})
