import { describe, expect, it } from "vitest"
import type { ActiveInteraction } from "../../interaction/InteractionReducer"
import type { TaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"
import { projectTaskView } from "../TaskViewProjector"

/** Create runtime state carrying one active interaction in the given status. */
function runtimeWithInteraction(phase: TaskPhase, status: ActiveInteraction["status"]): TaskRuntimeState {
	const interaction: ActiveInteraction = {
		taskId: "task-1",
		turnId: "turn-1",
		interactionId: "interaction-1",
		kind: "tool_approval",
		status,
		createdRevision: 7,
		anchor: { messageTs: 100, messageType: "ask" },
	}
	return {
		taskId: "task-1",
		phase,
		revision: 8,
		anchor: {
			apiIndex: 4,
			uiMessageTs: interaction.anchor?.messageTs,
			turnId: interaction.turnId,
			interactionId: interaction.interactionId,
		},
		interaction,
	}
}

function actionTypes(state: ReturnType<typeof projectTaskView>): string[] {
	return state.footer.actions.map((action) => action.type)
}

describe("cancel availability across interaction lifecycle", () => {
	// An interaction is created before its anchor is approved by the user, so a
	// long-running turn can sit in `opening` for an arbitrary time. The footer
	// must keep offering Cancel for every cancellable phase: dropping it strands
	// the user with a running task and no way to stop it.
	it("keeps Cancel while an interaction is still opening in a cancellable phase", () => {
		const view = projectTaskView(runtimeWithInteraction(TaskPhase.EXECUTING, "opening"))

		expect(actionTypes(view)).toContain("cancel")
		expect(view.footer.actions.find((action) => action.type === "cancel")).toMatchObject({
			enabled: true,
			dispatchTarget: "task",
		})
	})

	it("keeps Cancel while an interaction is opening during streaming", () => {
		const view = projectTaskView(runtimeWithInteraction(TaskPhase.STREAMING, "opening"))

		expect(actionTypes(view)).toContain("cancel")
	})

	// `resolving` already had this guarantee; assert it stays intact so the
	// `opening` fix does not regress the sibling branch.
	it("keeps only Cancel while an interaction is resolving in a cancellable phase", () => {
		const view = projectTaskView(runtimeWithInteraction(TaskPhase.EXECUTING, "resolving"))

		expect(actionTypes(view)).toEqual(["cancel"])
	})

	// Opening interactions in a non-cancellable phase must not invent a Cancel
	// the backend cannot honour.
	it("does not offer Cancel while opening outside a cancellable phase", () => {
		const view = projectTaskView(runtimeWithInteraction(TaskPhase.AWAITING_APPROVAL, "opening"))

		expect(actionTypes(view)).not.toContain("cancel")
	})

	// Outside a cancellable phase an opening interaction keeps projecting its own
	// actions, disabled until it reaches `awaiting`. The Cancel fallback must not
	// leak into that path.
	it("projects disabled interaction actions while opening outside a cancellable phase", () => {
		const view = projectTaskView(runtimeWithInteraction(TaskPhase.AWAITING_APPROVAL, "opening"))

		expect(actionTypes(view)).toEqual(["approve", "reject"])
		expect(view.footer.actions.every((action) => action.enabled === false)).toBe(true)
	})

	// `resolving` outside a cancellable phase stays action-free: the response is
	// already committed and no control can be honoured.
	it("exposes no actions while resolving outside a cancellable phase", () => {
		const view = projectTaskView(runtimeWithInteraction(TaskPhase.AWAITING_APPROVAL, "resolving"))

		expect(view.footer.actions).toEqual([])
	})
})
