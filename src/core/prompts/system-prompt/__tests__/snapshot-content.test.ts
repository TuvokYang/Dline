import { describe, expect, it } from "vitest"
import { assertPromptContent } from "./snapshot-content"

describe("prompt snapshot content", () => {
	it("accepts a fully resolved prompt", () => {
		expect(() => assertPromptContent("prompt.snap", "You are Dline.")).not.toThrow()
	})

	it("rejects unresolved i18n markers before snapshot persistence", () => {
		expect(() => assertPromptContent("prompt.snap", "[MISSING: agentRole.main]")).toThrowError(
			"Refusing to use unresolved prompt content for snapshot: prompt.snap",
		)
	})
})
