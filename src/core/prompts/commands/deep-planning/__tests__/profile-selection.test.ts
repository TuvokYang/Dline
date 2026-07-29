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
	it("exposes exactly Standard and Lite variants without model metadata", () => {
		expect(DEEP_PLANNING_VARIANTS.map((variant) => variant.id)).toEqual(["standard", "lite"])
		for (const variant of DEEP_PLANNING_VARIANTS) {
			expect(variant).not.toHaveProperty("family")
			expect(variant).not.toHaveProperty("matcher")
		}
	})

	it("selects distinct Standard and Lite command contracts without model inference", () => {
		const standardFromGpt = getDeepPlanningPrompt(
			PromptProfile.Standard,
			{ enabled: true },
			createProviderInfo("gpt-5.1"),
			false,
		)
		const standardFromOtherModel = getDeepPlanningPrompt(
			PromptProfile.Standard,
			{ enabled: true },
			createProviderInfo("unrelated-model"),
			false,
		)
		const liteFromGpt = getDeepPlanningPrompt(PromptProfile.Lite, { enabled: true }, createProviderInfo("gpt-5.1"), false)
		const liteFromOtherModel = getDeepPlanningPrompt(
			PromptProfile.Lite,
			{ enabled: true },
			createProviderInfo("unrelated-model"),
			false,
		)

		expect(standardFromGpt).toBe(standardFromOtherModel)
		expect(liteFromGpt).toBe(liteFromOtherModel)
		expect(standardFromGpt).not.toBe(liteFromGpt)
	})

	it("never injects task-progress instructions into Lite", () => {
		const enabled = getDeepPlanningPrompt(PromptProfile.Lite, { enabled: true }, createProviderInfo("gpt-5.1"), false)
		const disabled = getDeepPlanningPrompt(PromptProfile.Lite, { enabled: false }, createProviderInfo("gpt-5.1"), false)

		expect(enabled).not.toContain("task_progress")
		expect(disabled).not.toContain("task_progress")
		expect(enabled.match(/<IMPORTANT>/g)).toHaveLength(1)
		expect(enabled.match(/<\/IMPORTANT>/g)).toHaveLength(1)
		expect(disabled.match(/<IMPORTANT>/g)).toHaveLength(1)
		expect(disabled.match(/<\/IMPORTANT>/g)).toHaveLength(1)
	})

	it.each([PromptProfile.Standard, PromptProfile.Lite])("keeps the multi-turn XML new_task boundary for %s", (profile) => {
		const prompt = getDeepPlanningPrompt(profile, { enabled: true }, createProviderInfo("gpt-5.1"), true)

		expect(prompt).toContain("<new_task>")
		expect(prompt).toContain("</new_task>")
		expect(prompt).not.toContain('"name": "new_task"')
	})
})
