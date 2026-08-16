import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import type { TaskConfig } from "../../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../../types/UIHelpers"
import { SummarizeTaskHandler } from "../SummarizeTaskHandler"

function createHelpers(
	isInternalContextCompactionRequest: boolean,
	contextCompactionMessageTs?: number,
	manualSource?: "manual_compact_command" | "task_header",
) {
	const say = vi.fn().mockResolvedValue(undefined)
	const ask = vi.fn().mockRejectedValue(new Error("Current ask promise was ignored"))
	const config = {
		taskState: { isInternalContextCompactionRequest, contextCompactionMessageTs },
		explicitInstructions: {
			getPendingToolAuthorization: vi.fn(() => (manualSource ? { source: manualSource } : undefined)),
		},
	} as unknown as TaskConfig
	const helpers = {
		say,
		ask,
		removeClosingTag: vi.fn((_block, _tag, text) => text ?? ""),
		getConfig: () => config,
	} as unknown as StronglyTypedUIHelpers
	return { helpers, say, ask, config }
}

const partialBlock = {
	type: "tool_use",
	name: ClineDefaultTool.SUMMARIZE_TASK,
	partial: true,
	ts: 12345,
	params: { context: "Streaming summary" },
} as const

describe("SummarizeTaskHandler partial rendering", () => {
	it("streams the stable running row for internal context compaction", async () => {
		const handler = new SummarizeTaskHandler({} as never)
		const { helpers, say, ask, config } = createHelpers(true, 777)

		await handler.handlePartialBlock(partialBlock as never, helpers)

		const payload = JSON.parse(say.mock.calls[0][1] as string)
		expect(payload).toMatchObject({
			tool: "summarizeTask",
			content: "Streaming summary",
			compactionStatus: "running",
		})
		expect(say).toHaveBeenCalledWith("tool", expect.any(String), undefined, undefined, true, 777)
		expect(ask).not.toHaveBeenCalled()
		expect(config.taskState.contextCompactionMessageTs).toBe(777)
	})

	it("does not create a compaction row before non-empty summary content arrives", async () => {
		const handler = new SummarizeTaskHandler({} as never)
		const { helpers, say, ask } = createHelpers(true)

		await handler.handlePartialBlock({ ...partialBlock, params: { context: "   " } } as never, helpers)

		expect(say).not.toHaveBeenCalled()
		expect(ask).not.toHaveBeenCalled()
	})

	it("does not render an unauthorized summarize_task outside the auto compaction owner", async () => {
		const handler = new SummarizeTaskHandler({} as never)
		const { helpers, say } = createHelpers(false)

		await handler.handlePartialBlock(partialBlock as never, helpers)

		expect(say).not.toHaveBeenCalled()
	})

	it("leaves manual Pass partial rendering to ContextCompactionSession", async () => {
		const handler = new SummarizeTaskHandler({} as never)
		const { helpers, say, ask, config } = createHelpers(false, undefined, "manual_compact_command")

		await expect(handler.handlePartialBlock(partialBlock as never, helpers)).resolves.toBeUndefined()

		expect(ask).not.toHaveBeenCalled()
		expect(config.taskState.contextCompactionMessageTs).toBeUndefined()
		expect(say).not.toHaveBeenCalled()
	})
})
