import { describe, expect, it } from "vitest"
import { isClaudeOpusAdaptiveThinkingModel } from "./reasoning-support"

describe("Claude adaptive thinking model detection", () => {
	it("recognizes Claude Opus 5", () => {
		expect(isClaudeOpusAdaptiveThinkingModel("claude-opus-5")).toBe(true)
	})
})
