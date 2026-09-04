import { describe, expect, it } from "vitest"
import {
	canRestoreRejectedInteractionDraft,
	captureInteractionDraft,
	createAcceptedInteractionSettlement,
	type InteractionDraft,
} from "../types"

const dispatchedRequest = {
	taskId: "task-1",
	turnId: "turn-1",
	interactionId: "interaction-1",
	actionId: "approve" as const,
	stateRevision: 8,
	draft: { text: "original", images: ["image"], files: ["file"] },
}

function submittedDraft(): InteractionDraft {
	return {
		text: "original",
		images: ["image"],
		files: ["file"],
		activeQuote: "quote",
		ownerRevision: 3,
	}
}

/** The composer state left behind by an optimistic clear. */
function clearedDraft(ownerRevision: number): InteractionDraft {
	return { text: "", images: [], files: [], activeQuote: null, ownerRevision }
}

describe("rejected interaction draft rollback", () => {
	// Every submit path now clears before dispatching, so a rejected dispatch has
	// to put the exact submitted draft back. Without this the user silently loses
	// what they typed whenever the backend declines the interaction.
	it("restores the submitted draft when the composer is still empty", () => {
		const settlement = createAcceptedInteractionSettlement(dispatchedRequest, submittedDraft())

		expect(canRestoreRejectedInteractionDraft("task-1", clearedDraft(4), settlement)).toBe(true)
	})

	// Rollback is a recovery affordance, not an override: anything the user typed
	// while the dispatch was in flight is newer and must win.
	it("refuses to overwrite content typed while the dispatch was in flight", () => {
		const settlement = createAcceptedInteractionSettlement(dispatchedRequest, submittedDraft())
		const retyped: InteractionDraft = { ...clearedDraft(5), text: "typed while waiting" }

		expect(canRestoreRejectedInteractionDraft("task-1", retyped, settlement)).toBe(false)
	})

	it("refuses to restore into an attachment the user added while waiting", () => {
		const settlement = createAcceptedInteractionSettlement(dispatchedRequest, submittedDraft())
		const withImage: InteractionDraft = { ...clearedDraft(5), images: ["late-image"] }
		const withFile: InteractionDraft = { ...clearedDraft(5), files: ["late-file"] }

		expect(canRestoreRejectedInteractionDraft("task-1", withImage, settlement)).toBe(false)
		expect(canRestoreRejectedInteractionDraft("task-1", withFile, settlement)).toBe(false)
	})

	// A rejection that arrives after the user moved on belongs to a task that is
	// no longer on screen; restoring there would inject foreign text.
	it("refuses to restore a draft into a different task", () => {
		const settlement = createAcceptedInteractionSettlement(dispatchedRequest, submittedDraft())

		expect(canRestoreRejectedInteractionDraft("task-2", clearedDraft(4), settlement)).toBe(false)
	})

	it("carries the submitted draft so the owner can restore it verbatim", () => {
		const draft = submittedDraft()
		const settlement = createAcceptedInteractionSettlement(dispatchedRequest, captureInteractionDraft(draft))

		expect(settlement.draft).toMatchObject({
			text: "original",
			images: ["image"],
			files: ["file"],
			activeQuote: "quote",
		})
	})
})
