import assert from "node:assert/strict"
import { describe, it } from "vitest"
import { resolveCommandTimeoutSeconds } from "../ExecuteCommandToolHandler"

describe("ExecuteCommandToolHandler timeout policy", () => {
	it("uses explicit timeout when provided", () => {
		const timeout = resolveCommandTimeoutSeconds("45")
		assert.equal(timeout, 45)
	})

	it("leaves omitted and invalid values for the runtime setting", () => {
		assert.equal(resolveCommandTimeoutSeconds(undefined), undefined)
		assert.equal(resolveCommandTimeoutSeconds("invalid"), undefined)
	})
})
