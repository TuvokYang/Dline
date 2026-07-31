import { ApiFormat } from "@shared/proto/dline/models/metadata"
import { describe, expect, it } from "vitest"
import { normalizeApiProfile } from "../getApiProfiles"

describe("OpenAI profile migration", () => {
	it("moves legacy openai-native profiles onto the unified OpenAI config", () => {
		const profile = normalizeApiProfile({
			id: "legacy-openai",
			name: "My OpenAI profile",
			provider: "openai-native",
			modelId: "gpt-5.6-sol",
			baseUrl: "https://api.openai.com/v1",
			openaiNative: {
				reasoning: { enableThinking: true, effort: "high" },
				enableLongContext: true,
				serviceTier: "priority",
				apiFormat: "OPENAI_RESPONSES",
			},
		})

		expect(profile.provider).toBe("openai")
		expect(profile.openaiNative).toBeUndefined()
		expect(profile.openai?.reasoning?.effort).toBe("high")
		expect(profile.openai?.serviceTier).toBe("priority")
		expect(profile.openai?.enableLongContext).toBe(true)
		expect(profile.openai?.apiFormat).toBe(ApiFormat.OPENAI_RESPONSES)
	})

	it("maps the legacy OpenAI endpoint string to typed API format", () => {
		const profile = normalizeApiProfile({
			id: "legacy-compatible",
			provider: "openai",
			modelId: "custom-model",
			openai: { apiEndpoint: "responses" },
		})

		expect(profile.openai?.apiFormat).toBe(ApiFormat.OPENAI_RESPONSES)
	})
})
