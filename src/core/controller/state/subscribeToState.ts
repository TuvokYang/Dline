import type { AccountUsage } from "@core/api"
import { EmptyRequest } from "@shared/proto/dline/common"
import { State } from "@shared/proto/dline/state"
import { accountUsageToProto } from "@shared/proto-conversions/account-usage-conversion"
import { telemetryService } from "@/services/telemetry"
import { ExtensionState } from "@/shared/ExtensionMessage"
import { Logger } from "@/shared/services/Logger"
import { getRequestRegistry, StreamingResponseHandler } from "../grpc-handler"
import { Controller } from "../index"

// Per-controller subscription sets to isolate state updates between
// independent webviews (sidebar vs. editor panels). Each Controller
// only pushes state to its own subscribers.
const controllerSubscriptions = new Map<Controller, Set<StreamingResponseHandler<State>>>()

// Debounce state is now per-controller so rapid-fire updates from one
// task don't flood a different task's webview.
type PendingUpdate = {
	stateJson: string
	accountUsage: AccountUsage | undefined
}
const pendingUpdates = new Map<Controller, PendingUpdate>()
const debounceTimers = new Map<Controller, ReturnType<typeof setTimeout>>()

type StateUpdateOptions = {
	immediate?: boolean
}

/**
 * Subscribe to state updates for a specific controller.
 * Only state from this controller will be sent to the given responseStream.
 *
 * @param controller The controller instance (acts as subscription owner)
 * @param _request The empty request
 * @param responseStream The streaming response handler
 * @param requestId The ID of the request (passed by the gRPC handler)
 */
export async function subscribeToState(
	controller: Controller,
	_request: EmptyRequest,
	responseStream: StreamingResponseHandler<State>,
	requestId?: string,
): Promise<void> {
	// Get or create the subscription set for this controller
	let subs = controllerSubscriptions.get(controller)
	if (!subs) {
		subs = new Set()
		controllerSubscriptions.set(controller, subs)
	}
	subs.add(responseStream)

	// Register cleanup when the connection is closed
	const cleanup = () => {
		const set = controllerSubscriptions.get(controller)
		if (set) {
			set.delete(responseStream)
			if (set.size === 0) {
				controllerSubscriptions.delete(controller)
				pendingUpdates.delete(controller)
				const timer = debounceTimers.get(controller)
				if (timer) {
					clearTimeout(timer)
					debounceTimers.delete(controller)
				}
			}
		}
	}

	// Register the cleanup function with the request registry if we have a requestId
	if (requestId) {
		getRequestRegistry().registerRequest(requestId, cleanup, { type: "state_subscription" }, responseStream)
	}

	// Send the initial state
	const initialState = await controller.getStateToPostToWebview()
	const initialStateJson = JSON.stringify(initialState)
	const accountUsage = controller.getAccountUsage()

	recordStateSizeTelemetry(Buffer.byteLength(initialStateJson, "utf8"))

	try {
		await responseStream(
			{
				stateJson: initialStateJson,
				accountUsage: accountUsageToProto(accountUsage),
			},
			false, // Not the last message
		)
	} catch (error) {
		Logger.error("Error sending initial state:", error)
		cleanup()
	}
}

/**
 * Send a state update to a specific controller's subscribers.
 * Only webviews subscribed to this controller receive the update.
 *
 * @param controller The controller whose subscribers should receive the update
 * @param state The state to send
 * @param accountUsage Optional account usage data
 * @param options Debounce / immediate options
 */
export async function sendStateUpdate(
	controller: Controller,
	state: ExtensionState,
	accountUsage?: AccountUsage,
	options?: StateUpdateOptions,
): Promise<void> {
	let stateJson: string
	try {
		stateJson = JSON.stringify(state)
	} catch (error) {
		Logger.error("Error serializing state update:", error)
		return
	}

	pendingUpdates.set(controller, { stateJson, accountUsage })

	if (options?.immediate) {
		const timer = debounceTimers.get(controller)
		if (timer) {
			clearTimeout(timer)
			debounceTimers.delete(controller)
		}

		const pending = pendingUpdates.get(controller)
		if (pending) {
			pendingUpdates.delete(controller)
			await sendStateJsonToSubscribers(controller, pending.stateJson, pending.accountUsage)
		}
		return
	}

	if (debounceTimers.has(controller)) {
		return // debounce in progress, latest state will be sent when timer fires
	}

	debounceTimers.set(
		controller,
		setTimeout(async () => {
			debounceTimers.delete(controller)
			const pending = pendingUpdates.get(controller)
			if (pending) {
				pendingUpdates.delete(controller)
				await sendStateJsonToSubscribers(controller, pending.stateJson, pending.accountUsage)
			}
		}, 50),
	)
}

// Global serialization chain to prevent concurrent JSON.stringify + gRPC writes
// from multiple controllers blocking the Node.js event loop. Each controller's
// send is queued on this chain so only one state update is in-flight at a time.
let gStateSendChain: Promise<void> = Promise.resolve()

/**
 * Sends the state JSON to all subscribers of a specific controller.
 * Serialized globally to prevent multi-controller event-loop contention.
 */
async function sendStateJsonToSubscribers(
	controller: Controller,
	finalStateJson: string,
	finalAccountUsage?: AccountUsage,
): Promise<void> {
	// Chain onto the global serialization promise to serialize across controllers
	const previousChain = gStateSendChain
	let releaseChain: (() => void) | undefined
	gStateSendChain = new Promise<void>((resolve) => {
		releaseChain = resolve
	})

	try {
		await previousChain

		const startTime = performance.now()
		const stateSizeBytes = Buffer.byteLength(finalStateJson, "utf8")
		recordStateSizeTelemetry(stateSizeBytes)

		const subs = controllerSubscriptions.get(controller)
		if (!subs || subs.size === 0) return

		const promises = Array.from(subs).map(async (responseStream) => {
			try {
				await responseStream(
					{
						stateJson: finalStateJson,
						accountUsage: accountUsageToProto(finalAccountUsage),
					},
					false, // Not the last message
				)
			} catch (error) {
				Logger.error("Error sending state update:", error)
				subs.delete(responseStream)
			}
		})

		await Promise.all(promises)

		const durationMs = Math.round(performance.now() - startTime)
		if (durationMs > 20) {
			Logger.debug(
				`[StateUpdate] sendStateJsonToSubscribers took ${durationMs}ms, size=${stateSizeBytes}B, subs=${subs?.size ?? 0}`,
			)
		}
	} finally {
		releaseChain?.()
	}
}

function recordStateSizeTelemetry(sizeBytes: number): void {
	telemetryService.captureGrpcResponseSize(sizeBytes, "cline.StateService", "subscribeToState")
}
