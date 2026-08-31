import { describe, expect, it } from "vitest"
import {
	canDisableClaudeAdaptiveThinking,
	isClaudeAdaptiveThinkingEnabledByDefault,
	isClaudeOpusAdaptiveThinkingModel,
} from "./reasoning-support"

describe("Claude adaptive thinking model detection", () => {
	it("recognizes Claude Opus 5", () => {
		expect(isClaudeOpusAdaptiveThinkingModel("claude-opus-5")).toBe(true)
	})

	it("identifies models whose adaptive thinking is enabled by default", () => {
		for (const modelId of ["claude-fable-5", "claude-opus-5", "claude-sonnet-5"]) {
			expect(isClaudeAdaptiveThinkingEnabledByDefault(modelId)).toBe(true)
		}
		expect(isClaudeAdaptiveThinkingEnabledByDefault("claude-opus-4-8")).toBe(false)
	})

	it("allows explicit disabled thinking except for Fable 5", () => {
		expect(canDisableClaudeAdaptiveThinking("claude-fable-5")).toBe(false)
		expect(canDisableClaudeAdaptiveThinking("claude-opus-5")).toBe(true)
	})
})
