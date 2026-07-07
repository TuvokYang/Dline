import { expect } from "chai"
import { describe, it } from "vitest"
import { showContextUsage } from "../environment-context"

describe("showContextUsage", () => {
	it("keeps context window details visible for next-gen models after profile switches", () => {
		const result = showContextUsage({
			contextWindow: 1_000_000,
			lastApiReqTotalTokens: 10_000,
			modelId: "claude-sonnet-4-6[1m]",
		})

		expect(result).to.equal(true)
	})
})
