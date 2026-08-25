import { anthropicModels } from "@core/api/providers/models/anthropic"
import { deepSeekModels } from "@core/api/providers/models/deepseek"
import { ApiProfile } from "@shared/proto/dline/profile"
import { AnthropicProviderConfig } from "@shared/proto/dline/provider/anthropic"
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

	it("does not inherit the provider default model metadata for an explicit custom model id", () => {
		const profile = ApiProfile.create({
			provider: "openai",
			modelId: "custom-model",
			openai: OpenAiProviderConfig.create({
				customModelEnabled: true,
				capabilities: {
					contextWindow: 131_072,
					maxTokens: 8_192,
				},
			}),
		})

		const result = resolveProfileModelInfo(profile, {
			models: {
				"default-model": {
					id: "default-model",
					name: "Provider Default",
					capabilities: {
						contextWindow: 272_000,
						contextWindowTiers: [
							{ id: "standard", contextWindow: 272_000, label: "272K" },
							{ id: "long", contextWindow: 1_050_000, label: "1.05M" },
						],
					},
				},
			},
			defaultModelId: "default-model",
		})

		expect(result.id).to.equal("custom-model")
		expect(result.name).to.equal(undefined)
		expect(result.capabilities?.contextWindow).to.equal(131_072)
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

	it("enables the 1M long context by default for Anthropic profiles without an explicit flag", () => {
		const profile = ApiProfile.create({
			provider: "anthropic",
			modelId: "claude-sonnet-4-6",
			anthropic: AnthropicProviderConfig.create(),
		})

		const result = resolveProfileModelInfo(profile, {
			models: anthropicModels,
			defaultModelId: "claude-sonnet-4-6",
		})

		expect(result.capabilities?.contextWindow).to.equal(1_000_000)
	})

	it("uses the selected tier window instead of a legacy standalone context override", () => {
		const profile = ApiProfile.create({
			provider: "anthropic",
			modelId: "claude-sonnet-4-6",
			anthropic: AnthropicProviderConfig.create({
				enableLongContext: false,
				capabilities: {
					contextWindow: 999_999,
					contextWindowTiers: [
						{ id: "standard", contextWindow: 160_000, label: "160K" },
						{ id: "long", contextWindow: 1_500_000, label: "1.5M", apiModelSuffix: ":1m" },
					],
				},
			}),
		})

		const result = resolveProfileModelInfo(profile, {
			models: anthropicModels,
			defaultModelId: "claude-sonnet-4-6",
		})

		expect(result.capabilities?.contextWindow).to.equal(160_000)
	})

	it("allows the selected long tier window to exceed one million tokens", () => {
		const profile = ApiProfile.create({
			provider: "anthropic",
			modelId: "claude-sonnet-4-6",
			anthropic: AnthropicProviderConfig.create({
				enableLongContext: true,
				capabilities: {
					contextWindowTiers: [
						{ id: "standard", contextWindow: 200_000, label: "200K" },
						{ id: "long", contextWindow: 1_500_000, label: "1.5M", apiModelSuffix: ":1m" },
					],
				},
			}),
		})

		const result = resolveProfileModelInfo(profile, {
			models: anthropicModels,
			defaultModelId: "claude-sonnet-4-6",
		})

		expect(result.capabilities?.contextWindow).to.equal(1_500_000)
	})

	it("falls back to the standard 200K tier when long context is explicitly disabled", () => {
		const profile = ApiProfile.create({
			provider: "anthropic",
			modelId: "claude-sonnet-4-6",
			anthropic: AnthropicProviderConfig.create({ enableLongContext: false }),
		})

		const result = resolveProfileModelInfo(profile, {
			models: anthropicModels,
			defaultModelId: "claude-sonnet-4-6",
		})

		expect(result.capabilities?.contextWindow).to.equal(200_000)
	})
})
