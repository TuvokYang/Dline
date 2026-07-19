import { deepSeekModels } from "@core/api/providers/models/deepseek"
import { ApiProfile } from "@shared/proto/dline/profile"
import { BaseProviderConfig } from "@shared/proto/dline/provider/common"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { expect } from "chai"
import { describe, it } from "vitest"
import { resolveProfileModelInfo } from "../profile-model-info"

describe("resolveProfileModelInfo", () => {
	it("resolves DeepSeek context window from registry when profile modelInfo is absent", () => {
		const profile = ApiProfile.create({
			provider: "deepseek",
			modelId: "deepseek-v4-pro",
			deepseek: BaseProviderConfig.create(),
		})

		const result = resolveProfileModelInfo(profile, {
			models: deepSeekModels,
			defaultModelId: "deepseek-v4-pro",
		})

		expect(result.id).to.equal("deepseek-v4-pro")
		expect(result.capabilities?.contextWindow).to.equal(1_000_000)
		expect(result.capabilities?.supportsPromptCache).to.equal(true)
	})

	it("uses the enabled prompt-cache product default when custom metadata omits the capability", () => {
		const profile = ApiProfile.create({
			provider: "openai",
			modelId: "custom-model",
			openai: OpenAiProviderConfig.create(),
		})

		const result = resolveProfileModelInfo(profile)

		expect(result.capabilities?.supportsPromptCache).to.equal(true)
	})

	it("preserves an explicit prompt-cache opt-out", () => {
		const profile = ApiProfile.create({
			provider: "openai",
			modelId: "custom-model",
			openai: OpenAiProviderConfig.create({ capabilities: { supportsPromptCache: false } }),
		})

		const result = resolveProfileModelInfo(profile)

		expect(result.capabilities?.supportsPromptCache).to.equal(false)
	})

	it("merges provider capability overrides into registry metadata", () => {
		const profile = ApiProfile.create({
			provider: "deepseek",
			modelId: "deepseek-v4-pro",
			deepseek: BaseProviderConfig.create({
				capabilities: {
					contextWindow: 272_000,
					maxTokens: 128_000,
				},
			}),
		})

		const result = resolveProfileModelInfo(profile, {
			models: deepSeekModels,
			defaultModelId: "deepseek-v4-pro",
		})

		expect(result.id).to.equal("deepseek-v4-pro")
		expect(result.capabilities?.contextWindow).to.equal(272_000)
		expect(result.capabilities?.maxTokens).to.equal(128_000)
		expect(result.capabilities?.supportsReasoning).to.equal(true)
	})
})
