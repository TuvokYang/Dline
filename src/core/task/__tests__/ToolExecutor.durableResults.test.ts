import { strict as assert } from "node:assert"
import type { ToolUse } from "@core/assistant-message"
import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import { ToolExecutor } from "../ToolExecutor"
import { ToolResultUtils } from "../tools/utils/ToolResultUtils"

function createBlock(
	name: string = ClineDefaultTool.FILE_READ,
	params: ToolUse["params"] = name === ClineDefaultTool.FILE_READ ? { path: "src/index.ts" } : { path: "src/new.ts" },
): ToolUse {
	return {
		type: "tool_use",
		name: name as ClineDefaultTool,
		params,
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
	coordinatorHas?: boolean
	allowedNativeToolNames?: string[]
	focusChainEnabled?: boolean
}

function createHarness(options: HarnessOptions = {}) {
	const userMessageContent: any[] = []
	const say = vi.fn(async () => 1)
	const updateFCListFromToolResponse = vi.fn(async () => undefined)
	const coordinator = {
		has: vi.fn(() => options.coordinatorHas ?? true),
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
				if (key === "focusChainSettings") return { enabled: options.focusChainEnabled === true }
				if (key === "hooksEnabled") return false
				return false
			}),
		},
		autoApprover: { shouldAutoApproveTool: vi.fn(() => false) },
		getMode: () => (options.strictPlan ? "plan" : "act"),
		browserSession: { closeBrowser: vi.fn(async () => undefined) },
		coordinator,
		say,
		updateFCListFromToolResponse,
		allowedNativeToolNames: new Set(options.allowedNativeToolNames ?? []),
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

	return { coordinator, executor, say, updateFCListFromToolResponse, userMessageContent }
}

function partialResultRows(say: ReturnType<typeof vi.fn>): string[] {
	return say.mock.calls
		.filter(([type]) => type === "partial_tool_result")
		.map(([, text]) => text)
		.filter((text): text is string => typeof text === "string")
}

describe("ToolExecutor durable tool results", () => {
	it("keeps an advertised read_file on its registered execution path", async () => {
		const { coordinator, executor, say } = createHarness({
			allowedNativeToolNames: [ClineDefaultTool.FILE_READ],
		})

		await executor.execute(createBlock(), {})

		expect(coordinator.execute).toHaveBeenCalledOnce()
		expect(JSON.parse(partialResultRows(say)[0])).toMatchObject({ is_error: null })
	})

	it("auto-executes task_progress as an internal tool without an approval gate", async () => {
		const { coordinator, executor, say, updateFCListFromToolResponse } = createHarness({
			allowedNativeToolNames: [],
			coordinatorHas: false,
			focusChainEnabled: true,
		})
		const block = createBlock("task_progress", { task_progress: "- [x] Inspect runtime state" })

		expect(executor.isBlockApproved(block)).toBe(true)
		await executor.execute(block, {})

		expect(coordinator.execute).not.toHaveBeenCalled()
		expect(updateFCListFromToolResponse).toHaveBeenCalledWith("- [x] Inspect runtime state")
		expect(JSON.parse(partialResultRows(say)[0])).toMatchObject({
			function_id: "fn-task_progress",
			dline_tid: "tid-task_progress",
			is_error: null,
		})
	})

	it("rejects an unadvertised native function non-fatally instead of invoking its registered handler", async () => {
		const { coordinator, executor, say } = createHarness({ allowedNativeToolNames: [] })
		const block = createBlock(ClineDefaultTool.FILE_READ)

		expect(executor.isBlockApproved(block)).toBe(true)
		const handled = await executor.execute(block, {})

		expect(handled).toBe(true)
		expect(coordinator.execute).not.toHaveBeenCalled()
		expect(JSON.parse(partialResultRows(say)[0])).toMatchObject({
			function_id: "fn-read_file",
			dline_tid: "tid-read_file",
			is_error: true,
		})
	})

	it("closes an unregistered native function with a durable error result", async () => {
		const { coordinator, executor, say } = createHarness({
			allowedNativeToolNames: [],
			coordinatorHas: false,
		})
		const block = createBlock("not_registered", {})

		expect(executor.isBlockApproved(block)).toBe(true)
		const handled = await executor.execute(block, {})

		expect(handled).toBe(true)
		expect(coordinator.execute).not.toHaveBeenCalled()
		expect(JSON.parse(partialResultRows(say)[0])).toMatchObject({ is_error: true })
	})

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
		const { executor, say, userMessageContent } = createHarness({
			...options,
			allowedNativeToolNames: [toolName],
		})

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
