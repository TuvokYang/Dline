import { describe, expect, it } from "vitest"
import { type ActiveInteraction, reduceInteraction } from "../InteractionReducer"

/** Create one awaiting interaction with causal identity. */
function awaiting(kind: ActiveInteraction["kind"] = "tool_approval"): ActiveInteraction {
	return {
		taskId: "task-1",
		turnId: "turn-1",
		interactionId: "interaction-1",
		kind,
		status: "awaiting",
		createdRevision: 4,
	}
}

describe("reduceInteraction", () => {
	it("accepts a valid action and moves to resolving", () => {
		const result = reduceInteraction(awaiting(), {
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			actionId: "approve",
			stateRevision: 4,
			draft: { text: "use smaller edits", images: [], files: [] },
		})

		expect(result).toMatchObject({ accepted: true, next: { status: "resolving" } })
	})

	it("rejects stale identity without mutation", () => {
		const state = awaiting()
		const result = reduceInteraction(state, {
			taskId: "task-1",
			turnId: "turn-old",
			interactionId: "interaction-1",
			actionId: "approve",
			stateRevision: 4,
			draft: { text: "", images: [], files: [] },
		})

		expect(result).toEqual({ accepted: false, next: state, error: { code: "stale_interaction" } })
	})

	it("rejects focus-chain approval without selection", () => {
		const state = awaiting("focus_chain_change")
		const result = reduceInteraction(state, {
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			actionId: "approve",
			stateRevision: 4,
			draft: { text: "", images: [], files: [] },
		})

		expect(result).toEqual({ accepted: false, next: state, error: { code: "invalid_interaction_payload" } })
	})
})
