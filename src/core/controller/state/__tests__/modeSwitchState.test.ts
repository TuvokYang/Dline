import { Controller } from "@core/controller"
import type { ExtensionState } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/dline/common"
import {
	ModeSwitchOperationRequest,
	ModeSwitchStatus,
	PlanActMode,
	State,
	TogglePlanActModeRequest,
} from "@shared/proto/dline/state"
import { describe, expect, it, vi } from "vitest"
import type { StreamingResponseHandler } from "@/core/controller/grpc-handler"
import { cancelModeSwitch } from "../cancelModeSwitch"
import { confirmModeSwitch } from "../confirmModeSwitch"
import { subscribeToState } from "../subscribeToState"
import { togglePlanActModeProto } from "../togglePlanActModeProto"

/** Create the minimum serializable state needed by revision-order tests. */
function createState(revision: number): ExtensionState {
	const state = Object.create(null) as ExtensionState
	state.stateRevision = revision
	return state
}

/** Create an externally controlled promise for asynchronous ordering tests. */
function createDeferred<T>(): {
	promise: Promise<T>
	resolve: (value: T) => void
} {
	let resolvePromise!: (value: T) => void
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve
	})
	return { promise, resolve: resolvePromise }
}

/** Verify explicit mode-switch RPC results and stale-state suppression. */
describe("mode switch state integration", () => {
	/** Return confirmation metadata instead of collapsing it into a Boolean. */
	it("returns confirmation_required with operation id", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		const requestModeSwitch = vi
			.spyOn(controller, "requestModeSwitch")
			.mockResolvedValue({ status: "confirmation_required", operationId: "operation-1" })

		const result = await togglePlanActModeProto(controller, TogglePlanActModeRequest.create({ mode: PlanActMode.ACT }))

		expect(result.status).toBe(ModeSwitchStatus.MODE_SWITCH_STATUS_CONFIRMATION_REQUIRED)
		expect(result.operationId).toBe("operation-1")
		expect(requestModeSwitch).toHaveBeenCalledWith("act", undefined)
	})

	/** Preserve a stale confirm rejection as an explicit typed response. */
	it("rejects stale confirm operation id", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		vi.spyOn(controller, "confirmModeSwitch").mockResolvedValue({
			status: "rejected",
			operationId: "stale-operation",
			error: "Mode switch confirmation is stale.",
		})

		const result = await confirmModeSwitch(controller, ModeSwitchOperationRequest.create({ operationId: "stale-operation" }))

		expect(result.status).toBe(ModeSwitchStatus.MODE_SWITCH_STATUS_REJECTED)
		expect(result.operationId).toBe("stale-operation")
		expect(result.error).toBe("Mode switch confirmation is stale.")
	})

	/** Delegate cancellation only with the operation identity supplied by the caller. */
	it("cancels only the active operation", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		const cancel = vi.spyOn(controller, "cancelModeSwitch").mockResolvedValue({
			status: "rejected",
			operationId: "operation-2",
			error: "Mode switch cancelled.",
		})

		const result = await cancelModeSwitch(controller, ModeSwitchOperationRequest.create({ operationId: "operation-2" }))

		expect(cancel).toHaveBeenCalledWith("operation-2")
		expect(result.status).toBe(ModeSwitchStatus.MODE_SWITCH_STATUS_REJECTED)
		expect(result.operationId).toBe("operation-2")
	})

	/** Allocate monotonic revisions and retain the latest completed build. */
	it("allocates monotonic controller state revisions", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		Object.assign(controller, {
			nextStateRevision: 0,
			latestStateRevision: 0,
		})
		const buildState = vi
			.spyOn(controller as Controller & { buildState(revision: number): Promise<ExtensionState> }, "buildState")
			.mockImplementation(async (revision) => createState(revision))

		const first = await controller.getStateToPostToWebview()
		const second = await controller.getStateToPostToWebview()

		expect(first.stateRevision).toBe(1)
		expect(second.stateRevision).toBe(2)
		expect(controller.isStateCurrent(1)).toBe(false)
		expect(controller.isStateCurrent(2)).toBe(true)
		expect(buildState).toHaveBeenCalledTimes(2)
	})

	/** Drop an older asynchronous state result after a newer revision has been sent. */
	it("does not send an older state revision after a newer revision", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		const firstState = createDeferred<ExtensionState>()
		let latestRevision = 0
		const getState = vi
			.spyOn(controller, "getStateToPostToWebview")
			.mockResolvedValueOnce(createState(0))
			.mockImplementationOnce(() => firstState.promise)
			.mockImplementationOnce(async () => {
				latestRevision = 2
				return createState(2)
			})
		vi.spyOn(controller, "isStateCurrent").mockImplementation((revision) => revision >= latestRevision)
		vi.spyOn(controller, "getAccountUsage").mockReturnValue(undefined)
		const responseStream: StreamingResponseHandler<State> = vi.fn(async () => undefined)

		await subscribeToState(controller, EmptyRequest.create(), responseStream)
		vi.mocked(responseStream).mockClear()

		const olderPost = controller.postStateToWebview({ immediate: true })
		const newerPost = controller.postStateToWebview({ immediate: true })
		await newerPost
		firstState.resolve(createState(1))
		await olderPost

		expect(responseStream).toHaveBeenCalledTimes(1)
		const payload = vi.mocked(responseStream).mock.calls[0]?.[0]
		expect(JSON.parse(payload?.stateJson ?? "{}")).toMatchObject({ stateRevision: 2 })
		expect(getState).toHaveBeenCalledTimes(3)
	})
})
