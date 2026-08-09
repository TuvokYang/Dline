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
		expect(view.input.enterAction).toBe("reject")
		expect(view.footer.actions.map((action) => action.type)).toEqual(["approve", "reject"])
		expect(view.footer.actions.every((action) => action.dispatchTarget === "interaction")).toBe(true)
		expect(view.activeInteraction).toMatchObject({ askMessageTs: 100, taskAsk: "tool" })
	})

	it("projects Hosted Web request approval with tool presentation and approval actions", () => {
		const view = projectTaskView(runtime(TaskPhase.AWAITING_APPROVAL, active("hosted_web_approval")))

		expect(view.activeInteraction).toMatchObject({
			kind: "hosted_web_approval",
			presentationKind: "tool_approval",
			taskAsk: "tool",
		})
		expect(view.footer.actions.map((action) => action.type)).toEqual(["approve", "reject"])
	})

	it("projects the current runtime revision as causal response identity", () => {
		const view = projectTaskView(runtime(TaskPhase.AWAITING_APPROVAL, active("tool_approval")))

		expect(view.activeInteraction?.stateRevision).toBe(8)
	})

	it.each([
		"followup",
		"make_plan",
		"qna_response",
		"generate_report",
	] as const)("keeps %s input enabled without footer actions", (kind) => {
		const view = projectTaskView(runtime(TaskPhase.EXECUTING, active(kind)))

		expect(view.input).toMatchObject({ enabled: true, enterAction: "reply" })
		expect(view.footer.actions).toEqual([])
	})

	it("removes approval actions once the approval response is resolving", () => {
		const interaction = active("tool_approval")
		interaction.status = "resolving"
		interaction.acceptedResponse = {
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			actionId: "approve",
			stateRevision: 8,
			draft: { text: "approved", images: [], files: [] },
		}
		const view = projectTaskView(runtime(TaskPhase.AWAITING_APPROVAL, interaction))

		expect(view.input.enabled).toBe(false)
		expect(view.footer.actions.map((action) => action.type)).toEqual([])
	})

	it("restores Cancel while an approved command is running", () => {
		const interaction = active("command_approval")
		interaction.status = "resolving"
		const view = projectTaskView(runtime(TaskPhase.EXECUTING, interaction))

		expect(view.input.enabled).toBe(false)
		expect(view.footer.actions).toEqual([
			{
				type: "cancel",
				label: "Cancel",
				appearance: "danger",
				enabled: true,
				payloadPolicy: "none",
				dispatchTarget: "task",
			},
		])
	})

	it("projects focus-chain selection requirements", () => {
		const view = projectTaskView(runtime(TaskPhase.AWAITING_APPROVAL, active("focus_chain_change")))

		expect(view.footer.actions[0]).toMatchObject({ type: "approve", payloadPolicy: "draft_and_selection" })
	})

	it("projects manual condense acceptance and feedback regeneration", () => {
		const view = projectTaskView(runtime(TaskPhase.AWAITING_APPROVAL, active("condense")))

		expect(view.input).toMatchObject({ enabled: true, enterAction: "reject" })
		expect(view.footer.actions).toEqual([
			{
				type: "confirm_utility",
				label: "Condense Conversation",
				appearance: "primary",
				enabled: true,
				payloadPolicy: "none",
				dispatchTarget: "interaction",
			},
			{
				type: "reject",
				label: "Regenerate Summary",
				appearance: "secondary",
				enabled: true,
				payloadPolicy: "draft",
				dispatchTarget: "interaction",
			},
		])
	})

	it("projects Resume for a paused synthesized anchored resume interaction", () => {
		const view = projectTaskView(runtime(TaskPhase.PAUSED, active("resume")))

		expect(view.activeInteraction).toMatchObject({ kind: "resume", interactionId: "interaction-1" })
		expect(view.input).toMatchObject({ enabled: true, enterAction: "resume" })
		expect(view.footer.actions.map((action) => action.type)).toEqual(["resume"])
	})

	it("does not invent task-level Resume when PAUSED has no interaction", () => {
		const view = projectTaskView(runtime(TaskPhase.PAUSED))

		expect(view.input.enabled).toBe(false)
		expect(view.footer.actions).toEqual([])
	})

	it("keeps reply input without Resume for a paused anchored followup", () => {
		const view = projectTaskView(runtime(TaskPhase.PAUSED, active("followup")))

		expect(view.activeInteraction).toMatchObject({ kind: "followup", interactionId: "interaction-1" })
		expect(view.input).toMatchObject({ enabled: true, enterAction: "reply" })
		expect(view.footer.actions).toEqual([])
	})

	it("keeps Approve and Reject for a paused anchored tool approval", () => {
		const view = projectTaskView(runtime(TaskPhase.PAUSED, active("tool_approval")))

		expect(view.activeInteraction).toMatchObject({ kind: "tool_approval", interactionId: "interaction-1" })
		expect(view.input).toMatchObject({ enabled: true, enterAction: "reject" })
		expect(view.footer.actions.map((action) => action.type)).toEqual(["approve", "reject"])
	})

	it.each([
		"tool_approval",
		"followup",
		"completion",
		"resume",
	] as const)("exposes no action buttons while an anchored %s interaction is resolving", (kind) => {
		const interaction = active(kind)
		interaction.status = "resolving"

		const view = projectTaskView(runtime(TaskPhase.PAUSED, interaction))

		expect(view.input.enabled).toBe(false)
		expect(view.footer.actions).toEqual([])
	})

	it("projects error recovery actions", () => {
		const view = projectTaskView(runtime(TaskPhase.PAUSED, active("error_retry")))

		expect(view.footer.actions.map((action) => action.type)).toEqual(["retry", "start_new_task"])
	})

	it("keeps Retry mounted but disabled while an automatic retry request is in flight", () => {
		const view = projectTaskView(runtime(TaskPhase.STREAMING), {
			autoRetryActive: true,
			autoRetryPending: false,
		})

		expect(view.footer.actions).toEqual([
			{
				type: "retry",
				label: "Retry",
				appearance: "primary",
				enabled: false,
				payloadPolicy: "none",
				dispatchTarget: "task",
			},
			{
				type: "cancel",
				label: "Cancel",
				appearance: "danger",
				enabled: true,
				payloadPolicy: "none",
				dispatchTarget: "task",
			},
		])
	})

	it("projects Retry and Cancel during an automatic retry countdown", () => {
		const view = projectTaskView(runtime(TaskPhase.STREAMING), {
			autoRetryActive: true,
			autoRetryPending: true,
		})

		expect(view.footer.actions.map((action) => action.type)).toEqual(["retry", "cancel"])
		expect(view.footer.actions[0].enabled).toBe(true)
	})

	it("projects feedback input and only Start New Task for a completed anchored completion", () => {
		const view = projectTaskView(runtime(TaskPhase.COMPLETED, active("completion")))

		expect(view.activeInteraction).toMatchObject({ kind: "completion", interactionId: "interaction-1" })
		expect(view.input).toMatchObject({ enabled: true, enterAction: "reply" })
		expect(view.footer.actions.map((action) => action.type)).toEqual(["start_new_task"])
	})

	it("projects cancelling with a disabled cancel action", () => {
		const view = projectTaskView(runtime(TaskPhase.CANCELLING, active("tool_approval")))

		expect(view.input.enabled).toBe(false)
		expect(view.activeInteraction).toBeUndefined()
		expect(view.footer.actions).toEqual([
			{
				type: "cancel",
				label: "Cancel",
				appearance: "danger",
				enabled: false,
				payloadPolicy: "none",
				dispatchTarget: "task",
			},
		])
	})

	it("projects cancel from working runtime phase without message inference", () => {
		const view = projectTaskView(runtime(TaskPhase.STREAMING))

		expect(view.activeInteraction).toBeUndefined()
		expect(view.input.enabled).toBe(false)
		expect(view.footer.actions).toEqual([
			{
				type: "cancel",
				label: "Cancel",
				appearance: "danger",
				enabled: true,
				payloadPolicy: "none",
				dispatchTarget: "task",
			},
		])
	})
})

describe("projectInteraction", () => {
	it("never projects actions for a say anchor", () => {
		const result = projectInteraction(active("tool_approval", "say"), 8)

		expect(result.view).toBeUndefined()
		expect(result.diagnostic?.code).toBe("interaction_anchor_is_say")
	})

	it("carries an invalid anchor diagnostic into the complete task view", () => {
		const view = projectTaskView(runtime(TaskPhase.PAUSED, active("tool_approval", "say")))

		expect(view.activeInteraction).toBeUndefined()
		expect(view.footer.actions).toEqual([])
		expect(view.diagnostic).toEqual({ code: "interaction_anchor_is_say", interactionId: "interaction-1" })
	})

	it("surfaces a failed opening recovery interaction without projecting controls", () => {
		const interaction = active("resume")
		interaction.status = "opening"
		delete interaction.anchor
		const state = runtime(TaskPhase.PAUSED, interaction)
		state.error = {
			effectId: "effect-ask",
			effectType: "APPEND_ASK",
			originRevision: 7,
			message: "ask persistence failed",
		}

		const view = projectTaskView(state)

		expect(view.activeInteraction).toBeUndefined()
		expect(view.footer.actions).toEqual([])
		expect(view.diagnostic).toEqual({ code: "interaction_anchor_missing", interactionId: "interaction-1" })
	})
})
