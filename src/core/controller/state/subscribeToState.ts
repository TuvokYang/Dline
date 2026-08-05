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
	state: ExtensionState
	accountUsage: AccountUsage | undefined
}
const pendingUpdates = new Map<Controller, PendingUpdate>()
const debounceTimers = new Map<Controller, ReturnType<typeof setTimeout>>()
const controllerSendChains = new Map<Controller, Promise<void>>()

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

	// E2E-only: deterministically overtake the first snapshot with an unsent build.
	const forceStaleInitialState = process.env.E2E_TEST === "true" && process.env.DLINE_E2E_FORCE_STALE_INITIAL_STATE === "true"
	if (typeof controller.ensureWorkspaceManager === "function") {
		await controller.ensureWorkspaceManager()
	}
	let initialState = await controller.getStateToPostToWebview()
	if (forceStaleInitialState) {
		const overtakingState = await controller.getStateToPostToWebview()
		Logger.log(
			`[E2E state hydration race] Overtook revision ${initialState.stateRevision} with ${overtakingState.stateRevision}`,
		)
	}
	while (!controller.isStateCurrent(initialState.stateRevision)) {
		initialState = await controller.getStateToPostToWebview()
	}
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
		if (forceStaleInitialState) {
			Logger.log(`[E2E state hydration race] Delivered initial revision ${initialState.stateRevision}`)
		}
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
	pendingUpdates.set(controller, { state, accountUsage })

	if (options?.immediate) {
		const timer = debounceTimers.get(controller)
		if (timer) {
			clearTimeout(timer)
			debounceTimers.delete(controller)
		}

		const pending = pendingUpdates.get(controller)
		if (pending) {
			pendingUpdates.delete(controller)
			await sendStateToSubscribers(controller, pending.state, pending.accountUsage)
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
				await sendStateToSubscribers(controller, pending.state, pending.accountUsage)
			}
		}, 50),
	)
}

/** Send an account-usage-only event without rebuilding or serializing ExtensionState. */
export async function sendAccountUsageUpdate(controller: Controller, accountUsage?: AccountUsage): Promise<void> {
	await enqueueControllerSend(controller, async () => {
		await sendPayloadToSubscribers(controller, "", accountUsage)
	})
}

async function sendStateToSubscribers(
	controller: Controller,
	state: ExtensionState,
	finalAccountUsage?: AccountUsage,
): Promise<void> {
	try {
		const stateJson = JSON.stringify(state)
		const stateSizeBytes = Buffer.byteLength(stateJson, "utf8")
		recordStateSizeTelemetry(stateSizeBytes)
		await enqueueControllerSend(controller, async () => {
			await sendPayloadToSubscribers(controller, stateJson, finalAccountUsage, stateSizeBytes)
		})
	} catch (error) {
		Logger.error("Error serializing state update:", error)
	}
}

function enqueueControllerSend(controller: Controller, send: () => Promise<void>): Promise<void> {
	const previous = controllerSendChains.get(controller) ?? Promise.resolve()
	const next = previous.then(send, send)
	controllerSendChains.set(controller, next)
	return next.finally(() => {
		if (controllerSendChains.get(controller) === next) {
			controllerSendChains.delete(controller)
		}
	})
}

async function sendPayloadToSubscribers(
	controller: Controller,
	stateJson: string,
	accountUsage?: AccountUsage,
	stateSizeBytes = 0,
): Promise<void> {
	const startTime = performance.now()
	const subs = controllerSubscriptions.get(controller)
	if (!subs || subs.size === 0) return

	await Promise.all(
		Array.from(subs).map(async (responseStream) => {
			try {
				await responseStream({ stateJson, accountUsage: accountUsageToProto(accountUsage) }, false)
			} catch (error) {
				Logger.error("Error sending state update:", error)
				subs.delete(responseStream)
			}
		}),
	)

	const durationMs = Math.round(performance.now() - startTime)
	if (durationMs > 20) {
		Logger.debug(`[StateUpdate] sendPayloadToSubscribers took ${durationMs}ms, size=${stateSizeBytes}B, subs=${subs.size}`)
	}
}

function recordStateSizeTelemetry(sizeBytes: number): void {
	telemetryService.captureGrpcResponseSize(sizeBytes, "cline.StateService", "subscribeToState")
}
