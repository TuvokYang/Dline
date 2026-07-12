import { strict as assert } from "node:assert"
import { describe, it, vi } from "vitest"
import { Controller } from "../index"

/**
 * Build a minimal Controller-like object for cancelTask behavior tests.
 *
 * @returns Fake controller and spies used by the test.
 */
function createCancelController(): {
	controller: Pick<Controller, "cancelTask">
	requestCancellation: ReturnType<typeof vi.fn>
	updateBackgroundCommandState: ReturnType<typeof vi.fn>
} {
	const requestCancellation = vi.fn(async () => ({ accepted: true }))
	const updateBackgroundCommandState = vi.fn()
	const controller = {
		task: { taskId: "task-1", requestCancellation },
		cancelInProgress: false,
		updateBackgroundCommandState,
		cancelTask: Controller.prototype.cancelTask,
	}

	return {
		controller: controller as unknown as Pick<Controller, "cancelTask">,
		requestCancellation,
		updateBackgroundCommandState,
	}
}

describe("Controller.cancelTask", () => {
	it("dispatches one cancellation transaction without reading task flags or messages", async () => {
		const { controller, requestCancellation, updateBackgroundCommandState } = createCancelController()

		await controller.cancelTask()

		assert.equal(requestCancellation.mock.calls.length, 1)
		assert.deepEqual(updateBackgroundCommandState.mock.calls, [[false]])
	})
})
