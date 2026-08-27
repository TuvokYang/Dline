import { describe, expect, it } from "vitest"
import { anthropicModels } from "./anthropic"

describe("Anthropic model thinking metadata", () => {
	it("declares xhigh and max for models that support both effort levels", () => {
		const modelIds = ["claude-opus-5", "claude-fable-5", "claude-opus-4-8", "claude-sonnet-5", "claude-opus-4-7"]

		for (const modelId of modelIds) {
			expect(anthropicModels[modelId]?.capabilities?.thinking).toEqual({
				supported: true,
				mode: "effort",
				effortLevels: ["none", "low", "medium", "high", "xhigh", "max"],
			})
		}
	})

	it("declares max without xhigh for Claude 4.6 models", () => {
		const modelIds = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-opus-4-6:fast"]

		for (const modelId of modelIds) {
			expect(anthropicModels[modelId]?.capabilities?.thinking).toEqual({
				supported: true,
				mode: "effort",
				effortLevels: ["none", "low", "medium", "high", "max"],
			})
		}
	})
})
