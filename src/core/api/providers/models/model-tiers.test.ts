import { describe, expect, it } from "vitest"
import { anthropicModels } from "./anthropic"
import { openAiCodexModels } from "./openai-codex"
import { openAiNativeModels } from "./openai-native"

describe("provider model tiers", () => {
	it("defines OpenAI Native 5.6 context and pricing tiers", () => {
		for (const modelId of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
			const model = openAiNativeModels[modelId]
			expect(model?.capabilities?.contextWindow).toBe(272_000)
			expect(model?.capabilities?.contextWindowTiers?.map((tier) => tier.contextWindow)).toEqual([272_000, 1_050_000])
			expect(model?.pricing?.tiers).toHaveLength(2)
		}
	})

	it("keeps OpenAI Codex 5.6 fixed at 353K without tiers", () => {
		for (const modelId of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
			const model = openAiCodexModels[modelId]
			expect(model?.capabilities?.contextWindow).toBe(353_000)
			expect(model?.capabilities?.contextWindowTiers).toBeUndefined()
			expect(model?.pricing?.tiers).toBeUndefined()
		}
	})

	it("stores Anthropic long context metadata only on base model IDs", () => {
		expect(Object.keys(anthropicModels).filter((modelId) => modelId.includes(":1m"))).toEqual([])

		for (const modelId of ["claude-sonnet-4-6", "claude-opus-4-6", "claude-opus-4-6:fast"]) {
			const model = anthropicModels[modelId]
			expect(model?.capabilities?.contextWindow).toBe(200_000)
			expect(model?.capabilities?.contextWindowTiers).toEqual([
				{ id: "standard", contextWindow: 200_000, label: "200K" },
				{ id: "long", contextWindow: 1_000_000, label: "1M", apiModelSuffix: ":1m" },
			])
		}
		expect(anthropicModels["claude-sonnet-4-6"]?.pricing?.tiers).toEqual(expect.any(Array))
		expect(anthropicModels["claude-opus-4-6"]?.pricing?.tiers).toEqual(expect.any(Array))
		expect(anthropicModels["claude-opus-4-6:fast"]?.pricing?.tiers).toBeUndefined()
	})
})
