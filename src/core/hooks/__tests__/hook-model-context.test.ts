import { describe, it } from "vitest"
import "should"
import { getHookModelContext } from "../hook-model-context"

describe("getHookModelContext", () => {
	it("should return concrete provider and model slug for plan mode", () => {
		const api = {
			getModel: () => ({ id: "handler-model-id" }),
		} as any

		const stateManager = {
			getGlobalSettingsKey: (key: string) => (key === "mode" ? "plan" : undefined),
			getApiConfiguration: () => ({
				planModeProfile: "openrouter",
				planModeOpenRouterModelId: "anthropic/claude-sonnet-4.5",
				actModeProfile: "openai",
			}),
		} as any

		const context = getHookModelContext(api, stateManager)
		context.provider?.should.equal("openrouter")
		context.slug?.should.equal("anthropic/claude-sonnet-4.5")
	})

	it("should return concrete provider and model slug for act mode", () => {
		const api = {
			getModel: () => ({ id: "handler-act-model" }),
		} as any

		const stateManager = {
			getGlobalSettingsKey: (key: string) => (key === "mode" ? "act" : undefined),
			getApiConfiguration: () => ({
				planModeProfile: "openrouter",
				actModeProfile: "openai",
				actModeOpenAiModelId: "gpt-5",
			}),
		} as any

		const context = getHookModelContext(api, stateManager)
		context.provider?.should.equal("openai")
		context.slug?.should.equal("gpt-5")
	})

	it("should fall back to unknown values when provider/slug are unavailable", () => {
		const api = {
			getModel: () => ({ id: "" }),
		} as any

		const stateManager = {
			getGlobalSettingsKey: (_: string) => "act",
			getApiConfiguration: () => ({
				planModeProfile: "anthropic",
				actModeProfile: "",
			}),
		} as any

		const context = getHookModelContext(api, stateManager)
		context.provider?.should.equal("unknown")
		context.slug?.should.equal("unknown")
	})
})
