import { describe, expect, it } from "vitest"
import type { ApiProviderInfo } from "@/core/api"
import { PromptProfile } from "../../../profiles/types"
import { getDeepPlanningPrompt } from "../index"
import { DEEP_PLANNING_VARIANTS } from "../variants"

function createProviderInfo(modelId: string): ApiProviderInfo {
	return {
		providerId: "openai",
		model: { id: modelId, info: {} },
		mode: "act",
	} as unknown as ApiProviderInfo
}

describe("deep-planning explicit profile selection", () => {
	it("rejects a missing PromptProfile instead of defaulting inside the Prompt domain", () => {
		expect(() => getDeepPlanningPrompt({ enabled: true }, createProviderInfo("gpt-5.1"), false)).toThrowError(
			"PromptProfile must be supplied explicitly",
		)
	})

	it("exposes exactly Native and Lite variants without model metadata", () => {
		expect(DEEP_PLANNING_VARIANTS.map((variant) => variant.id)).toEqual(["native", "lite"])
		for (const variant of DEEP_PLANNING_VARIANTS) {
			expect(variant).not.toHaveProperty("family")
			expect(variant).not.toHaveProperty("matcher")
		}
	})

	it("selects distinct Native and Lite command contracts without model inference", () => {
		const nativeFromGpt = getDeepPlanningPrompt({ enabled: true }, createProviderInfo("gpt-5.1"), false, PromptProfile.Native)
		const nativeFromOtherModel = getDeepPlanningPrompt(
			{ enabled: true },
			createProviderInfo("unrelated-model"),
			false,
			PromptProfile.Native,
		)
		const liteFromGpt = getDeepPlanningPrompt({ enabled: true }, createProviderInfo("gpt-5.1"), false, PromptProfile.Lite)
		const liteFromOtherModel = getDeepPlanningPrompt(
			{ enabled: true },
			createProviderInfo("unrelated-model"),
			false,
			PromptProfile.Lite,
		)

		expect(nativeFromGpt).toBe(nativeFromOtherModel)
		expect(liteFromGpt).toBe(liteFromOtherModel)
		expect(nativeFromGpt).not.toBe(liteFromGpt)
	})
})
