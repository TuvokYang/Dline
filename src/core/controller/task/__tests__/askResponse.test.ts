import { AskResponseRequest } from "@shared/proto/dline/task"
import { describe, expect, it, vi } from "vitest"
import { askResponse } from "../askResponse"

/** Create a controller with one injectable runtime interaction state. */
function controller(interaction: object | undefined) {
	return {
		task: {
			getRuntimeState: vi.fn(() => ({ interaction })),
			handleWebviewAskResponse: vi.fn(async () => undefined),
		},
	}
}

describe("askResponse legacy boundary", () => {
	it("ignores legacy responses while a causal interaction is active", async () => {
		const value = controller({ interactionId: "interaction-1" })

		await askResponse(value as never, AskResponseRequest.create({ responseType: "yesButtonClicked", text: "legacy" }))

		expect(value.task.handleWebviewAskResponse).not.toHaveBeenCalled()
	})

	it("keeps legacy non-interaction feedback compatible", async () => {
		const value = controller(undefined)

		await askResponse(value as never, AskResponseRequest.create({ responseType: "messageResponse", text: "interrupt" }))

		expect(value.task.handleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "interrupt", [], [])
	})
})
