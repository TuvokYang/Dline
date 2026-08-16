import type { CompactionPassIdentity } from "@core/context/context-management/target-window-fitting"
import { describe, expect, it } from "vitest"
import { ContextCompactionPresentation } from "../ContextCompactionPresentation"

function pass(passIndex: number): CompactionPassIdentity {
	return {
		operationId: "operation-1",
		passIndex,
		passStartTurnIndex: passIndex,
		passEndTurnIndex: passIndex,
		coveredTurnCount: passIndex,
		summaryBaselineHash: `summary-${passIndex}`,
		passHistoryHash: `history-${passIndex}`,
	}
}

const attempt0 = { attemptIndex: 0, authorizationAttemptId: "attempt-0" }
const attempt1 = { attemptIndex: 1, authorizationAttemptId: "attempt-1" }

/** Lock per-Pass card identity independently from Task message persistence. */
describe("ContextCompactionPresentation", () => {
	it("creates no card until the first real partial and keeps retry on the same Pass card", () => {
		const presentation = new ContextCompactionPresentation()
		const firstPass = pass(0)

		expect(presentation.startPass(firstPass, attempt0)).toBe(true)
		const firstPartial = presentation.partial(firstPass, attempt0, "partial zero")
		expect(firstPartial).toMatchObject({
			existingTs: undefined,
			content: "partial zero",
			status: "running",
			attempt: attempt0,
		})
		expect(presentation.bindMessageTs(firstPass, 101)).toBe(true)

		const retry = presentation.retry(firstPass, attempt0, attempt1, 1, 3, "network failure")
		expect(retry).toMatchObject({ existingTs: 101, content: "partial zero", status: "retrying", attempt: attempt1 })
		const retriedPartial = presentation.partial(firstPass, attempt1, "partial one")
		expect(retriedPartial).toMatchObject({ existingTs: 101, content: "partial one", status: "running", attempt: attempt1 })
	})

	it("unbinds a deleted Pass row before publishing terminal failure after rollback", () => {
		const presentation = new ContextCompactionPresentation()
		const firstPass = pass(0)

		presentation.startPass(firstPass, attempt0)
		presentation.partial(firstPass, attempt0, "partial zero")
		presentation.bindMessageTs(firstPass, 101)

		expect(presentation.fail("operation-1")).toMatchObject({
			existingTs: undefined,
			content: "",
			status: "failed",
		})
	})

	it("keeps an output-limit replay on the same card without inventing automatic retry totals", () => {
		const presentation = new ContextCompactionPresentation()
		const firstPass = pass(0)

		presentation.startPass(firstPass, attempt0)
		presentation.partial(firstPass, attempt0, "partial zero")
		presentation.bindMessageTs(firstPass, 101)

		expect(presentation.retry(firstPass, attempt0, attempt1)).toMatchObject({
			existingTs: 101,
			status: "retrying",
			attempt: attempt1,
			retryAttempt: undefined,
			maxRetryAttempts: undefined,
		})
	})

	it("creates a new card for the next Pass and rejects stale Pass or attempt updates", () => {
		const presentation = new ContextCompactionPresentation()
		const firstPass = pass(0)
		const secondPass = pass(1)

		presentation.startPass(firstPass, attempt0)
		presentation.partial(firstPass, attempt0, "first")
		presentation.bindMessageTs(firstPass, 101)
		expect(presentation.complete(firstPass, attempt0, "completed first")).toMatchObject({
			existingTs: 101,
			status: "completed",
		})

		expect(presentation.startPass(secondPass, attempt0)).toBe(true)
		expect(presentation.partial(secondPass, attempt0, "second")).toMatchObject({ existingTs: undefined, status: "running" })
		expect(presentation.partial(firstPass, attempt0, "late first")).toBeUndefined()
		expect(presentation.partial(secondPass, attempt1, "unannounced retry")).toBeUndefined()
		expect(presentation.fail("operation-1")).toMatchObject({
			existingTs: undefined,
			content: "",
			status: "failed",
			error: undefined,
			passIdentity: secondPass,
			attempt: attempt0,
		})
	})
})
