import { describe, expect, it, vi } from "vitest"
import { ClineDefaultTool } from "@/shared/tools"
import { StatusUpdateHandler } from "../StatusUpdateHandler"

/**
 * Create a minimal task config for status update handler tests.
 * @param askResult Result returned by the mocked ask callback.
 * @returns TaskConfig-compatible test double.
 */
function createConfig(askResult: {
	response: "yesButtonClicked" | "noButtonClicked"
	text?: string
	images?: string[]
	files?: string[]
}) {
	return {
		taskState: {
			consecutiveMistakeCount: 0,
			lastToolName: "read_file",
		},
		callbacks: {
			ask: vi.fn(async () => askResult),
			say: vi.fn(async () => undefined),
			sayAndCreateMissingParamError: vi.fn(async () => "missing response"),
		},
	} as any
}

describe("StatusUpdateHandler", () => {
	const handler = new StatusUpdateHandler()

	it("uses noButtonClicked as stop response for acknowledged status update", async () => {
		const config = createConfig({ response: "noButtonClicked", text: "先停止，我要调整方向" })

		const result = await handler.execute(config, {
			name: ClineDefaultTool.STATUS_UPDATE,
			params: { response: "请确认", requires_acknowledgment: "true" },
		} as any)

		expect(result).toContain("User chose to stop")
		expect(result).toContain("先停止，我要调整方向")
	})

	it("includes acknowledge input in tool result", async () => {
		const config = createConfig({
			response: "yesButtonClicked",
			text: "我知道了，下一步先检查配置",
			images: ["ack-image"],
			files: ["ack-file"],
		})

		const result = await handler.execute(config, {
			name: ClineDefaultTool.STATUS_UPDATE,
			params: { response: "请确认", requires_acknowledgment: "true" },
		} as any)

		expect(result).toContain("User acknowledged")
		expect(result).toContain("我知道了，下一步先检查配置")
		expect(result).toContain("ack-image")
		expect(result).toContain("ack-file")
	})
})
