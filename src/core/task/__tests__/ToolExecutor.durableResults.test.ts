import { strict as assert } from "node:assert"
import type { ToolUse } from "@core/assistant-message"
import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import { ToolExecutor } from "../ToolExecutor"
import { ToolResultUtils } from "../tools/utils/ToolResultUtils"

function createBlock(name: ClineDefaultTool = ClineDefaultTool.FILE_READ): ToolUse {
	return {
		type: "tool_use",
		name,
		params: name === ClineDefaultTool.FILE_READ ? { path: "src/index.ts" } : { path: "src/new.ts" },
		partial: false,
		function_id: `fn-${name}`,
		dline_tid: `tid-${name}`,
		isNativeToolCall: true,
		ts: 1,
	} as ToolUse
}

interface HarnessOptions {
	rejected?: boolean
	strictPlan?: boolean
	throwFromTool?: boolean
}

function createHarness(options: HarnessOptions = {}) {
	const userMessageContent: any[] = []
	const say = vi.fn(async () => 1)
	const coordinator = {
		has: vi.fn(() => true),
		getHandler: vi.fn(() => ({ getDescription: (block: ToolUse) => `[${block.name}]` })),
		execute: vi.fn(async () => {
			if (options.throwFromTool) throw new Error("handler exploded")
			return "tool completed"
		}),
	}
	const executor = Object.create(ToolExecutor.prototype) as any
	Object.assign(executor, {
		taskState: {
			abort: false,
			consecutiveMistakeCount: 0,
			didAlreadyUseTool: false,
			userMessageContent,
		},
		taskController: {
			wasRejected: vi.fn(() => options.rejected === true),
		},
		stateManager: {
			getGlobalSettingsKey: vi.fn((key: string) => {
				if (key === "strictPlanModeEnabled") return options.strictPlan === true
				if (key === "focusChainSettings") return { enabled: false }
				if (key === "hooksEnabled") return false
				return false
			}),
		},
		getMode: () => (options.strictPlan ? "plan" : "act"),
		browserSession: { closeBrowser: vi.fn(async () => undefined) },
		coordinator,
		say,
		isParallelToolCallingEnabled: () => true,
	})

	// The production method is an instance field. Install the same implementation
	// without constructing the executor's unrelated VS Code services.
	executor.pushToolResult = (content: any, block: ToolUse, isError?: boolean) =>
		ToolResultUtils.pushToolResult(
			content,
			block,
			userMessageContent,
			(toolBlock) => `[${toolBlock.name}]`,
			coordinator as never,
			isError,
		)

	return { executor, say, userMessageContent }
}

function partialResultRows(say: ReturnType<typeof vi.fn>): string[] {
	return say.mock.calls
		.filter(([type]) => type === "partial_tool_result")
		.map(([, text]) => text)
		.filter((text): text is string => typeof text === "string")
}

describe("ToolExecutor durable tool results", () => {
	it("persists the exact canonical block pushed to the model, including description and approval feedback", async () => {
		const { executor, say, userMessageContent } = createHarness()
		const block = createBlock(ClineDefaultTool.FILE_NEW)
		ToolResultUtils.pushAdditionalToolFeedback(userMessageContent, "keep the public API stable")

		await executor.commitRestoredToolResult("File written.", block)

		assert.equal(userMessageContent.length, 1)
		const canonical = userMessageContent[0]
		const rows = partialResultRows(say)
		assert.equal(rows.length, 1)
		expect(JSON.parse(rows[0])).toEqual({
			version: 1,
			function_id: canonical.function_id,
			dline_tid: canonical.dline_tid,
			content: canonical.content,
			is_error: null,
		})
		expect(canonical.content[0].text).toContain("[write_to_file] Result:\nFile written.")
		expect(canonical.content[1].text).toContain("keep the public API stable")
	})

	it.each([
		["a rejected native tool", { rejected: true }, ClineDefaultTool.FILE_READ],
		["a strict-plan rejection", { strictPlan: true }, ClineDefaultTool.FILE_NEW],
		["a handler error", { throwFromTool: true }, ClineDefaultTool.FILE_READ],
	] as const)("records a durable error result for %s", async (_label, options, toolName) => {
		const { executor, say, userMessageContent } = createHarness(options)

		await executor.execute(createBlock(toolName), {})

		const rows = partialResultRows(say)
		assert.equal(rows.length, 1)
		const persisted = JSON.parse(rows[0])
		const canonical = userMessageContent.find((item) => item.type === "tool_result")
		expect(persisted).toEqual({
			version: 1,
			function_id: canonical.function_id,
			dline_tid: canonical.dline_tid,
			content: canonical.content,
			is_error: true,
		})
	})
})
