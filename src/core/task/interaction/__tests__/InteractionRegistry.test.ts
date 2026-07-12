import { describe, expect, it } from "vitest"
import type { InteractionKind } from "../Interaction"
import { getInteraction, INTERACTION_KINDS } from "../InteractionRegistry"

interface InteractionCase {
	kind: InteractionKind
	taskAsk: string
	actions: string[]
	enterAction?: string
}

const CASES: InteractionCase[] = [
	{ kind: "tool_approval", taskAsk: "tool", actions: ["approve", "reject"] },
	{ kind: "command_approval", taskAsk: "command", actions: ["approve", "reject"] },
	{ kind: "focus_chain_change", taskAsk: "focus_chain_change", actions: ["approve", "reject"] },
	{ kind: "followup", taskAsk: "followup", actions: ["reply"], enterAction: "reply" },
	{ kind: "qna_response", taskAsk: "qna_respond", actions: ["reply"], enterAction: "reply" },
	{ kind: "resume", taskAsk: "resume_task", actions: ["resume"], enterAction: "resume" },
	{ kind: "error_retry", taskAsk: "api_req_failed", actions: ["retry", "start_new_task"] },
	{
		kind: "completion",
		taskAsk: "completion_result",
		actions: ["reply", "start_new_task"],
		enterAction: "reply",
	},
	{ kind: "status_acknowledgment", taskAsk: "status_acknowledgment", actions: ["acknowledge", "stop"] },
]

describe("InteractionRegistry", () => {
	it.each(CASES)("defines $kind", ({ kind, taskAsk, actions, enterAction }) => {
		const definition = getInteraction(kind)

		expect(definition.taskAsk).toBe(taskAsk)
		expect(definition.actions.map((action) => action.type)).toEqual(actions)
		expect(definition.input.enterAction).toBe(enterAction)
	})

	it("registers every interaction kind exactly once", () => {
		expect(new Set(INTERACTION_KINDS).size).toBe(INTERACTION_KINDS.length)
		for (const kind of INTERACTION_KINDS) {
			expect(getInteraction(kind).kind).toBe(kind)
		}
	})

	it("keeps tool approval draft-capable without Enter approval", () => {
		const definition = getInteraction("tool_approval")

		expect(definition.input).toMatchObject({ enabled: true, acceptsText: true })
		expect(definition.input.enterAction).toBeUndefined()
		expect(definition.actions[0].payloadPolicy).toBe("draft")
	})

	it("requires draft and selection for focus-chain approval", () => {
		const definition = getInteraction("focus_chain_change")
		expect(definition.actions[0].payloadPolicy).toBe("draft_and_selection")
	})
})
