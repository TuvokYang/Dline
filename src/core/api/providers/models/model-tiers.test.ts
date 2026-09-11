import { ApiFormat } from "@shared/proto/dline/models/metadata"
import { describe, expect, it } from "vitest"
import { anthropicModels } from "./anthropic"
import { openAiModels } from "./openai"
import { openAiCodexModels } from "./openai-codex"

describe("provider model tiers", () => {
	it("keeps OpenAI 5.6 fixed by context size with usage-based pricing tiers only", () => {
		for (const modelId of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
			const model = openAiModels[modelId]
			expect(model?.capabilities?.contextWindow).toBe(272_000)
			// OpenAI models have no context-window tiers; context is controlled directly.
			expect(model?.capabilities?.contextWindowTiers).toBeUndefined()
			// Pricing tiers are usage-based tiered pricing and stay editable.
			expect(model?.pricing?.tiers).toHaveLength(2)
			expect(model?.apiFormats).toEqual([ApiFormat.OPENAI_RESPONSES, ApiFormat.OPENAI_CHAT])
		}
	})

	it("keeps OpenAI Codex 5.6 fixed at 372K without tiers", () => {
		for (const modelId of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
			const model = openAiCodexModels[modelId]
			expect(model?.capabilities?.contextWindow).toBe(372_000)
			expect(model?.capabilities?.contextWindowTiers).toBeUndefined()
			expect(model?.pricing?.tiers).toBeUndefined()
		}
	})

	it("keeps official Anthropic models at their native 1M window without legacy tiers", () => {
		expect(Object.keys(anthropicModels).filter((modelId) => modelId.includes(":1m"))).toEqual([])

		for (const model of Object.values(anthropicModels)) {
			expect(model.capabilities?.contextWindow).toBe(1_000_000)
			expect(model.capabilities?.contextWindowTiers).toBeUndefined()
			expect(model.pricing?.tiers).toBeUndefined()
		}
	})
})
