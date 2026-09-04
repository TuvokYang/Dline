import { act, render } from "@testing-library/react"
import { useEffect, useRef } from "react"
import { describe, expect, it, vi } from "vitest"
import { ExtensionStateContextProvider, useExtensionState } from "./ExtensionStateContext"

vi.mock("@/services/grpc-client", () => {
	const neverResolving = () => new Promise(() => {})
	const stream = () => () => {}
	return {
		StateServiceClient: {
			subscribeToState: stream,
			getLatestState: neverResolving,
			getAvailableTerminalProfiles: neverResolving,
			subscribeToPartialMessage: stream,
		},
		UiServiceClient: {
			initializeWebview: neverResolving,
			subscribeToPartialMessage: stream,
			subscribeToTheme: stream,
			subscribeToMcpButtonClicked: stream,
			subscribeToHistoryButtonClicked: stream,
			subscribeToChatButtonClicked: stream,
			subscribeToAccountButtonClicked: stream,
			subscribeToSettingsButtonClicked: stream,
			subscribeToWorktreesButtonClicked: stream,
			subscribeToFocusChatInput: stream,
			subscribeToRelinquishControl: stream,
			subscribeToAddToInput: stream,
		},
		ModelsServiceClient: {
			subscribeToOpenRouterModels: stream,
			subscribeToLiteLlmModels: stream,
			refreshOpenRouterModelsRpc: neverResolving,
			refreshHicapModels: neverResolving,
			refreshLiteLlmModelsRpc: neverResolving,
			refreshBasetenModelsRpc: neverResolving,
			refreshVercelAiGatewayModelsRpc: neverResolving,
			refreshClineModelsRpc: neverResolving,
		},
		McpServiceClient: {
			subscribeToMcpServers: stream,
			subscribeToMcpMarketplaceCatalog: stream,
		},
		FileServiceClient: {
			subscribeToWorkspaceUpdates: stream,
		},
		TaskServiceClient: {
			fetchMessage: neverResolving,
		},
		AccountServiceClient: {},
		WorktreeServiceClient: {},
	}
})

/**
 * Records every context value the provider hands to consumers, plus how many
 * times the consumer re-rendered. The consumer itself holds no state, so a new
 * render can only come from the provider publishing a new value.
 */
function createValueProbe() {
	const values: unknown[] = []
	const Probe = () => {
		const value = useExtensionState()
		const renderCount = useRef(0)
		renderCount.current += 1
		values.push(value)
		return null
	}
	return { values, Probe }
}

/** Drives a provider-internal state update without changing observable data. */
function createUnrelatedUpdateTrigger() {
	let trigger: (() => void) | undefined
	const Trigger = () => {
		const { setTotalTasksSize } = useExtensionState()
		useEffect(() => {
			trigger = () => setTotalTasksSize(0)
		}, [setTotalTasksSize])
		return null
	}
	return { Trigger, fire: () => trigger?.() }
}

describe("ExtensionStateContext provider value stability", () => {
	it("keeps the context value referentially stable across re-renders with unchanged state", async () => {
		const { values, Probe } = createValueProbe()

		const { rerender } = render(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)

		const initialValue = values[values.length - 1]

		// Re-render the provider itself without touching any of its state.
		rerender(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)

		expect(values[values.length - 1]).toBe(initialValue)
	})

	it("exposes stable function identities so consumer effects do not re-run", () => {
		const { values, Probe } = createValueProbe()

		const { rerender } = render(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)

		const first = values[values.length - 1] as Record<string, unknown>

		rerender(
			<ExtensionStateContextProvider>
				<Probe />
			</ExtensionStateContextProvider>,
		)

		const second = values[values.length - 1] as Record<string, unknown>

		const functionKeys = Object.keys(first).filter((key) => typeof first[key] === "function")
		expect(functionKeys.length).toBeGreaterThan(0)

		const unstable = functionKeys.filter((key) => first[key] !== second[key])
		expect(unstable).toEqual([])
	})

	it("publishes a new value when observable state actually changes", () => {
		const { values, Probe } = createValueProbe()
		const { Trigger, fire } = createUnrelatedUpdateTrigger()

		render(
			<ExtensionStateContextProvider>
				<Trigger />
				<Probe />
			</ExtensionStateContextProvider>,
		)

		const before = values[values.length - 1] as Record<string, unknown>
		expect(before.totalTasksSize).not.toBe(0)

		act(() => {
			fire()
		})

		const after = values[values.length - 1] as Record<string, unknown>
		expect(after).not.toBe(before)
		expect(after.totalTasksSize).toBe(0)
	})
})
