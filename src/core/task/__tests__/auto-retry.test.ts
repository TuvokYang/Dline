import { strict as assert } from "node:assert"
import { describe, it } from "vitest"
import { getStreamRetryDecision, waitRetryDelay } from "../auto-retry"

describe("auto retry recovery", () => {
	it("stops the delayed retry when the task is aborted", async () => {
		let aborted = false
		const delayPromise = waitRetryDelay(1, () => aborted)

		aborted = true
		const shouldRetry = await delayPromise

		assert.equal(shouldRetry, false)
	})

	it("prompts api failure recovery after stream retries are exhausted", () => {
		const decision = getStreamRetryDecision({
			isSpendLimitError: false,
			autoRetryAttempts: 3,
		})

		assert.equal(decision.shouldPrompt, true)
		assert.equal(decision.shouldRetry, false)
	})

	it("does not prompt retry recovery for spend limit streaming failures", () => {
		const decision = getStreamRetryDecision({
			isSpendLimitError: true,
			autoRetryAttempts: 3,
		})

		assert.equal(decision.shouldPrompt, false)
		assert.equal(decision.shouldRetry, false)
	})
})
