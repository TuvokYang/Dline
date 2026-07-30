import { describe, expect, it } from "vitest"
import {
	createMissingToolResultMessage,
	createResumeContinuationText,
	createResumeInteractionPresentation,
} from "../ResumeProvenance"

describe("ResumeProvenance", () => {
	it("presents session restoration without inventing a missing prior tool result", () => {
		const presentation = createResumeInteractionPresentation()

		expect(presentation).toContain("session was closed")
		expect(presentation).toContain("has now been restored")
		expect(presentation).not.toContain("tool call result is missing")
		expect(presentation).not.toContain("outcome is unknown")
		expect(presentation).not.toContain("abnormal")
		expect(presentation).not.toContain("assume the tool use was not successful")
	})

	it("projects missing tool results as unknown and requires observable verification before retry", () => {
		const message = createMissingToolResultMessage("replace_in_file")

		expect(message).toContain("replace_in_file")
		expect(message).toContain("result is missing")
		expect(message).toContain("outcome is unknown")
		expect(message).toContain("inspect its observable state")
		expect(message).toContain("before retrying")
		expect(message).not.toContain("may have been abnormal")
	})

	it("includes the same restoration provenance in model continuation without losing user draft text", () => {
		const continuation = createResumeContinuationText("Continue with the focused test.")

		expect(continuation).toContain("session was closed")
		expect(continuation).not.toContain("tool call result is missing")
		expect(continuation).not.toContain("outcome is unknown")
		expect(continuation).toContain("Continue with the focused test.")
	})
})
