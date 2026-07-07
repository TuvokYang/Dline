import { deepSeekModels } from "@core/api/providers/models/deepseek"
import { ApiProfile } from "@shared/proto/dline/profile"
import { BaseProviderConfig } from "@shared/proto/dline/provider/common"
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
