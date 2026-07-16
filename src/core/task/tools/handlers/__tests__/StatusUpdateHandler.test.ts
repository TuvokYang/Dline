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
	const open = vi.fn(async () => ({
		actionId: askResult.response === "noButtonClicked" ? ("stop" as const) : ("acknowledge" as const),
		draft: {
			text: askResult.text ?? "",
			images: askResult.images ?? [],
			files: askResult.files ?? [],
		},
	}))
	return {
		taskState: {
			consecutiveMistakeCount: 0,
			lastToolName: "read_file",
		},
		interactions: {
			open,
			complete: open,
			say: vi.fn(async () => undefined),
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
			dline_tid: "tid-status-stop",
			params: { response: "请确认", requires_acknowledgment: "true" },
		} as any)

		expect(result).toContain("User chose to stop")
		expect(result).toContain("<feedback>\n先停止，我要调整方向\n</feedback>")
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
			dline_tid: "tid-status-acknowledge",
			params: { response: "请确认", requires_acknowledgment: "true" },
		} as any)

		expect(result).toContain("User acknowledged")
		expect(result).toContain("<feedback>\n我知道了，下一步先检查配置\n</feedback>")
		expect(result).toContain("Images: ack-image")
		expect(result).toContain("Files: ack-file")
	})
})
