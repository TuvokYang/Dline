import type { ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import should from "should"
import { describe, it } from "vitest"
import { buildEffectiveModelInfo } from "../effective-model-info"

describe("buildEffectiveModelInfo", () => {
	it("should merge provider capability and pricing overrides into a registry model", () => {
		const registryModel: ModelInfo = {
			id: "registry-model",
			name: "Registry Model",
			capabilities: {
				maxTokens: 4096,
				contextWindow: 128_000,
				supportsImages: false,
				supportsPromptCache: false,
			} as ModelCapabilities,
			pricing: {
				inputPrice: 1,
				outputPrice: 2,
				currency: "USD",
			} as ModelPricing,
		}

		const result = buildEffectiveModelInfo("registry-model", registryModel, {
			capabilities: {
				maxTokens: 64_000,
				supportsImages: true,
				temperature: 0.7,
			} as unknown as ModelCapabilities,
			pricing: {
				inputPrice: 0.5,
				cacheReadsPrice: 0.05,
			} as ModelPricing,
		})

		result.id.should.equal("registry-model")
		result.name?.should.equal("Registry Model")
		result.capabilities?.contextWindow?.should.equal(128_000)
		result.capabilities?.maxTokens?.should.equal(64_000)
		result.capabilities?.supportsImages?.should.equal(true)
		;(result.capabilities as unknown as { temperature?: number }).temperature?.should.equal(0.7)
		result.pricing?.inputPrice?.should.equal(0.5)
		result.pricing?.outputPrice?.should.equal(2)
		result.pricing?.cacheReadsPrice?.should.equal(0.05)
		result.pricing?.currency?.should.equal("USD")
	})

	it("should compose model info from provider overrides when model id is empty", () => {
		const result = buildEffectiveModelInfo(undefined, undefined, {
			capabilities: {
				contextWindow: 32_000,
				supportsPromptCache: true,
				temperature: 0.2,
			} as unknown as ModelCapabilities,
			pricing: {
				inputPrice: 0.1,
				outputPrice: 0.2,
			} as ModelPricing,
		})

		result.id.should.equal("")
		result.capabilities?.contextWindow?.should.equal(32_000)
		result.capabilities?.supportsPromptCache?.should.equal(true)
		;(result.capabilities as unknown as { temperature?: number }).temperature?.should.equal(0.2)
		result.pricing?.inputPrice?.should.equal(0.1)
		result.pricing?.outputPrice?.should.equal(0.2)
	})

	it("should use the explicit model id when registry metadata is missing", () => {
		const result = buildEffectiveModelInfo("custom-model", undefined, {
			capabilities: {
				maxTokens: 8192,
			} as ModelCapabilities,
		})

		result.id.should.equal("custom-model")
		result.capabilities?.maxTokens?.should.equal(8192)
		should(result.pricing).be.undefined()
	})
})
