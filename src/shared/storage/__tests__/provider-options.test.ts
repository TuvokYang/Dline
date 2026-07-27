import {
	normalizeOpenAiServiceTier,
	normalizeOpenaiReasoningEffort,
	OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS,
	OPENAI_REASONING_EFFORT_OPTIONS,
	OPENAI_SERVICE_TIER_OPTIONS,
} from "@shared/storage/types"
import { DEEPSEEK_REASONING_EFFORT_OPTIONS, resolveDeepSeekAdaptiveThinking } from "@shared/utils/reasoning-support"
import { expect } from "chai"
import { describe, it } from "vitest"

describe("provider reasoning and service-tier options", () => {
	it("exposes current OpenAI SDK efforts and compatible ultra effort", () => {
		expect(OPENAI_REASONING_EFFORT_OPTIONS).to.deep.equal(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
		expect(OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS).to.deep.equal([...OPENAI_REASONING_EFFORT_OPTIONS, "ultra"])
		expect(normalizeOpenaiReasoningEffort("ultra")).to.equal("ultra")
	})

	it("accepts only OpenAI service tiers supported by the SDK", () => {
		expect(OPENAI_SERVICE_TIER_OPTIONS).to.deep.equal(["auto", "default", "flex", "scale", "priority"])
		expect(normalizeOpenAiServiceTier("priority")).to.equal("priority")
		expect(normalizeOpenAiServiceTier("unsupported")).to.equal(undefined)
	})

	it("restricts DeepSeek to high and max while migrating legacy xhigh", () => {
		expect(DEEPSEEK_REASONING_EFFORT_OPTIONS).to.deep.equal(["high", "max"])
		expect(resolveDeepSeekAdaptiveThinking("high")).to.deep.equal({ enabled: true, effort: "high" })
		expect(resolveDeepSeekAdaptiveThinking("max")).to.deep.equal({ enabled: true, effort: "max" })
		expect(resolveDeepSeekAdaptiveThinking("xhigh")).to.deep.equal({ enabled: true, effort: "max" })
	})
})
