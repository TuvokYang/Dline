import { describe, expect, it } from "vitest"
import { BlockPhase } from "../BlockPhaseMachine"
import { type ActiveInteraction } from "../interaction/InteractionReducer"
import type { TaskRuntimeState, TurnState } from "../runtime/TaskRuntimeState"
import { TaskPhase } from "../TaskPhase"
import { createSnapshot, hydrateSnapshot, TaskSnapshotIdentityError } from "../TaskSnapshot"

/** Create one canonical turn with a focus-chain approval block. */
function focusChainTurn(): TurnState {
	return {
		turnId: "turn-1",
		assistantApiIndex: 4,
		mode: "serial",
		activeDlineTid: "tid-1",
		blocks: [
			{
				dlineTid: "tid-1",
				functionId: "call-1",
				toolName: "focus_chain_change",
				phase: BlockPhase.AWAITING_APPROVAL,
				ts: 100,
				requiresApproval: true,
				conversationHistoryIndex: 4,
			},
		],
	}
}

/** Create the active interaction associated with the canonical turn. */
function focusChainInteraction(): ActiveInteraction {
	return {
		taskId: "task-1",
		turnId: "turn-1",
		interactionId: "interaction-1",
		kind: "focus_chain_change",
		status: "awaiting",
		createdRevision: 7,
	}
}

/** Create runtime state containing canonical turn and interaction identity. */
function runtimeState(): TaskRuntimeState {
	return {
		taskId: "task-1",
		phase: TaskPhase.AWAITING_APPROVAL,
		revision: 7,
		anchor: {
			apiIndex: 4,
			uiMessageTs: 100,
			turnId: "turn-1",
			interactionId: "interaction-1",
		},
		turn: focusChainTurn(),
		interaction: focusChainInteraction(),
	}
}

describe("TaskSnapshot v2 schema", () => {
	it("round-trips canonical turn and active interaction", () => {
		const state = runtimeState()
		const snapshot = createSnapshot(state, 200)

		expect(snapshot).toMatchObject({
			version: 2,
			taskId: "task-1",
			revision: 7,
			anchor: { apiIndex: 4, uiMessageTs: 100, turnId: "turn-1", interactionId: "interaction-1" },
			turn: { activeDlineTid: "tid-1" },
			interaction: { kind: "focus_chain_change", status: "awaiting" },
		})
		expect(hydrateSnapshot(snapshot)).toEqual(state)
	})

	it("round-trips the accepted response required by a resolving interaction", () => {
		const state = runtimeState()
		state.interaction = {
			...focusChainInteraction(),
			status: "resolving",
			acceptedResponse: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "interaction-1",
				actionId: "approve",
				stateRevision: 7,
				draft: { text: "Approved", images: ["image"], files: ["file"] },
				selection: { values: ["item"] },
			},
		}

		const hydrated = hydrateSnapshot(createSnapshot(state, 200))

		expect(hydrated.interaction?.acceptedResponse).toEqual(state.interaction.acceptedResponse)
		expect(hydrated.interaction?.acceptedResponse).not.toBe(state.interaction.acceptedResponse)
		expect(hydrated.interaction?.acceptedResponse?.draft?.images).not.toBe(state.interaction.acceptedResponse?.draft?.images)
	})

	it("rejects a resolving interaction without its accepted response", () => {
		const state = runtimeState()
		state.interaction = { ...focusChainInteraction(), status: "resolving" }

		expect(() => createSnapshot(state, 200)).toThrowError("invalid_resolving_interaction")
	})

	it("rejects a resolving response with mismatched causal identity", () => {
		const state = runtimeState()
		state.interaction = {
			...focusChainInteraction(),
			status: "resolving",
			acceptedResponse: {
				taskId: "other-task",
				turnId: "turn-1",
				interactionId: "interaction-1",
				actionId: "approve",
				stateRevision: 7,
				draft: { text: "", images: [], files: [] },
			},
		}

		expect(() => createSnapshot(state, 200)).toThrowError("invalid_resolving_interaction_identity")
	})

	it("rejects a turn block without canonical dline identity", () => {
		const snapshot = createSnapshot(runtimeState(), 200)
		if (!snapshot.turn) {
			throw new Error("Expected snapshot turn")
		}
		snapshot.turn.blocks[0] = { ...snapshot.turn.blocks[0], dlineTid: "" }

		expect(() => hydrateSnapshot(snapshot)).toThrowError(TaskSnapshotIdentityError)
		expect(() => hydrateSnapshot(snapshot)).toThrowError("invalid_snapshot_identity: dlineTid")
	})

	it("rejects missing turn identity", () => {
		const snapshot = createSnapshot(runtimeState(), 200)
		if (!snapshot.turn) {
			throw new Error("Expected snapshot turn")
		}
		snapshot.turn.turnId = ""

		expect(() => hydrateSnapshot(snapshot)).toThrowError("invalid_snapshot_identity: turnId")
	})

	it("rejects missing interaction identity", () => {
		const snapshot = createSnapshot(runtimeState(), 200)
		if (!snapshot.interaction) {
			throw new Error("Expected snapshot interaction")
		}
		snapshot.interaction.interactionId = ""

		expect(() => hydrateSnapshot(snapshot)).toThrowError("invalid_snapshot_identity: interactionId")
	})
})
