import { describe, expect, it } from "vitest"
import type { ActiveInteraction } from "../../interaction/InteractionReducer"
import type { TaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"
import { projectInteraction } from "../InteractionProjector"
import { projectTaskView } from "../TaskViewProjector"

/** Create runtime state with one optional active interaction. */
function runtime(phase: TaskPhase, interaction?: ActiveInteraction): TaskRuntimeState {
	return {
		taskId: "task-1",
		phase,
		revision: 8,
		anchor: {
			apiIndex: 4,
			uiMessageTs: interaction?.anchor?.messageTs,
			turnId: interaction?.turnId,
			interactionId: interaction?.interactionId,
		},
		interaction,
	}
}

/** Create one causally identified active interaction. */
function active(kind: ActiveInteraction["kind"], messageType: "ask" | "say" = "ask"): ActiveInteraction {
	return {
		taskId: "task-1",
		turnId: "turn-1",
		interactionId: "interaction-1",
		kind,
		status: "awaiting",
		createdRevision: 7,
		anchor: { messageTs: 100, messageType },
	}
}

describe("projectTaskView", () => {
	it("projects tool approval from the active interaction", () => {
		const view = projectTaskView(runtime(TaskPhase.AWAITING_APPROVAL, active("tool_approval")))

		expect(view.input).toMatchObject({ enabled: true, acceptsText: true })
		expect(view.input.enterAction).toBeUndefined()
		expect(view.footer.actions.map((action) => action.type)).toEqual(["approve", "reject"])
		expect(view.activeInteraction).toMatchObject({ askMessageTs: 100, taskAsk: "tool" })
	})

	it("projects the current runtime revision as causal response identity", () => {
		const view = projectTaskView(runtime(TaskPhase.AWAITING_APPROVAL, active("tool_approval")))

		expect(view.activeInteraction?.stateRevision).toBe(8)
	})

	it("replaces Cancel with conversational input while an executing tool awaits a reply", () => {
		const view = projectTaskView(runtime(TaskPhase.EXECUTING, active("qna_response")))

		expect(view.input).toMatchObject({ enabled: true, enterAction: "reply" })
		expect(view.footer.actions.map((action) => action.type)).toEqual(["reply"])
		expect(view.footer.actions.some((action) => action.type === "cancel")).toBe(false)
	})

	it("disables resolving interaction input and actions", () => {
		const interaction = active("tool_approval")
		interaction.status = "resolving"
		const view = projectTaskView(runtime(TaskPhase.AWAITING_APPROVAL, interaction))

		expect(view.input.enabled).toBe(false)
		expect(view.footer.actions.every((action) => !action.enabled)).toBe(true)
	})

	it("projects focus-chain selection requirements", () => {
		const view = projectTaskView(runtime(TaskPhase.AWAITING_APPROVAL, active("focus_chain_change")))

		expect(view.footer.actions[0]).toMatchObject({ type: "approve", payloadPolicy: "draft_and_selection" })
	})

	it("projects resume input and Enter action", () => {
		const view = projectTaskView(runtime(TaskPhase.PAUSED, active("resume")))

		expect(view.input).toMatchObject({ enabled: true, enterAction: "resume" })
		expect(view.footer.actions.map((action) => action.type)).toEqual(["resume"])
	})

	it("projects error recovery actions", () => {
		const view = projectTaskView(runtime(TaskPhase.PAUSED, active("error_retry")))

		expect(view.footer.actions.map((action) => action.type)).toEqual(["retry", "start_new_task"])
	})

	it("projects completion feedback input and actions", () => {
		const view = projectTaskView(runtime(TaskPhase.COMPLETED, active("completion")))

		expect(view.input).toMatchObject({ enabled: true, enterAction: "reply" })
		expect(view.footer.actions.map((action) => action.type)).toEqual(["reply", "start_new_task"])
	})

	it("projects cancelling with a disabled cancel action", () => {
		const view = projectTaskView(runtime(TaskPhase.CANCELLING, active("tool_approval")))

		expect(view.input.enabled).toBe(false)
		expect(view.activeInteraction).toBeUndefined()
		expect(view.footer.actions).toEqual([
			{ type: "cancel", label: "Cancel", appearance: "danger", enabled: false, payloadPolicy: "none" },
		])
	})

	it("projects cancel from working runtime phase without message inference", () => {
		const view = projectTaskView(runtime(TaskPhase.STREAMING))

		expect(view.activeInteraction).toBeUndefined()
		expect(view.input.enabled).toBe(false)
		expect(view.footer.actions).toEqual([
			{ type: "cancel", label: "Cancel", appearance: "danger", enabled: true, payloadPolicy: "none" },
		])
	})
})

describe("projectInteraction", () => {
	it("never projects actions for a say anchor", () => {
		const result = projectInteraction(active("tool_approval", "say"), 8)

		expect(result.view).toBeUndefined()
		expect(result.diagnostic?.code).toBe("interaction_anchor_is_say")
	})
})
