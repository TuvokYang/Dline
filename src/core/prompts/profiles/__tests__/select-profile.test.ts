import { describe, expect, it } from "vitest"

import { selectPromptProfile } from "../select-profile"
import { PromptProfile } from "../types"

describe("selectPromptProfile", () => {
	it("defaults to Native when no custom prompt is provided", () => {
		expect(selectPromptProfile({})).toBe(PromptProfile.Native)
	})

	it("selects Native for an explicit native value", () => {
		expect(selectPromptProfile({ customPrompt: "native" })).toBe(PromptProfile.Native)
	})

	it("selects Lite only for an explicit lite value", () => {
		expect(selectPromptProfile({ customPrompt: "lite" })).toBe(PromptProfile.Lite)
	})

	it("does not map the legacy compact value to Lite", () => {
		expect(selectPromptProfile({ customPrompt: "compact" })).toBe(PromptProfile.Native)
	})

	it("ignores model and provider fields when selecting a profile", () => {
		const nativeInput = {
			customPrompt: "native",
			modelId: "small-local-model",
			providerId: "local-provider",
		}
		const liteInput = {
			customPrompt: "lite",
			modelId: "frontier-model",
			providerId: "remote-provider",
		}

		expect(selectPromptProfile(nativeInput)).toBe(PromptProfile.Native)
		expect(selectPromptProfile(liteInput)).toBe(PromptProfile.Lite)
	})
})
