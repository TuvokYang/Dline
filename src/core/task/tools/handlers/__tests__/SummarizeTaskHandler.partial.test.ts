import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import type { TaskConfig } from "../../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../../types/UIHelpers"
import { SummarizeTaskHandler } from "../SummarizeTaskHandler"

function createHelpers(isInternalContextCompactionRequest: boolean) {
	const say = vi.fn().mockResolvedValue(undefined)
	const config = {
		taskState: { isInternalContextCompactionRequest },
	} as unknown as TaskConfig
	const helpers = {
		say,
		removeClosingTag: vi.fn((_block, _tag, text) => text ?? ""),
		getConfig: () => config,
	} as unknown as StronglyTypedUIHelpers
	return { helpers, say }
}

const partialBlock = {
	type: "tool_use",
	name: ClineDefaultTool.SUMMARIZE_TASK,
	partial: true,
	ts: 12345,
	params: { context: "Streaming summary" },
} as const

describe("SummarizeTaskHandler partial rendering", () => {
	it("does not render an internal context compaction summary", async () => {
		const handler = new SummarizeTaskHandler({} as never)
		const { helpers, say } = createHelpers(true)

		await handler.handlePartialBlock(partialBlock as never, helpers)

		expect(say).not.toHaveBeenCalled()
	})

	it("continues to render a user-visible summary", async () => {
		const handler = new SummarizeTaskHandler({} as never)
		const { helpers, say } = createHelpers(false)

		await handler.handlePartialBlock(partialBlock as never, helpers)

		expect(say).toHaveBeenCalledWith("tool", expect.stringContaining("Streaming summary"), undefined, undefined, true, 12345)
	})
})
