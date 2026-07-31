import { openAiModels } from "@shared/api"
import { allProviderModels } from "@shared/providers/model-infos"
import PROVIDERS from "@shared/providers/providers.json"
import { describe, expect, it } from "vitest"

describe("OpenAI provider consolidation", () => {
	it("exposes one API-key OpenAI provider with the official model catalog", () => {
		const apiKeyProviders = PROVIDERS.list.filter(({ value }) => value === "openai" || value === "openai-native")

		expect(apiKeyProviders).toEqual([{ value: "openai", label: "OpenAI" }])
		expect(allProviderModels.openai.models).toEqual(openAiModels)
		expect(allProviderModels["openai-native"]).toBeUndefined()
	})
})
