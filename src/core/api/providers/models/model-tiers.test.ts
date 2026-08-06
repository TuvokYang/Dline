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
