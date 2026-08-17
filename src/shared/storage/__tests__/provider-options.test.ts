import {
	normalizeOpenAiServiceTier,
	normalizeOpenaiReasoningEffort,
	OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS,
	OPENAI_REASONING_EFFORT_OPTIONS,
	OPENAI_SERVICE_TIER_OPTIONS,
} from "@shared/storage/types"
import { resolveTaskThinkingConfig, validateTaskReasoningOverride } from "@shared/task-reasoning"
import { DEEPSEEK_REASONING_EFFORT_OPTIONS, resolveDeepSeekAdaptiveThinking } from "@shared/utils/reasoning-support"
import { expect } from "chai"
import { describe, it } from "vitest"

describe("provider reasoning and service-tier options", () => {
	it("exposes current OpenAI SDK efforts and compatible ultra effort", () => {
		expect(OPENAI_REASONING_EFFORT_OPTIONS).to.deep.equal(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
		expect(OPENAI_COMPATIBLE_REASONING_EFFORT_OPTIONS).to.deep.equal([...OPENAI_REASONING_EFFORT_OPTIONS, "ultra"])
		expect(normalizeOpenaiReasoningEffort("ultra")).to.equal("ultra")
	})

	it("resolves OpenAI Profile reasoning capability for Task-local overrides", () => {
		const thinking = resolveTaskThinkingConfig("openai", { supportsReasoning: true })

		expect(thinking?.effortLevels).to.deep.equal([...OPENAI_REASONING_EFFORT_OPTIONS])
		expect(validateTaskReasoningOverride({ kind: "effort", effort: "high" }, thinking)).to.deep.equal({
			valid: true,
			override: { kind: "effort", effort: "high" },
		})
	})

	it("projects DeepSeek low, high and max efforts into the shared Task override policy", () => {
		const thinking = resolveTaskThinkingConfig("deepseek", { supportsReasoning: true })

		expect(thinking).to.include({ supported: true, mode: "effort" })
		expect(thinking?.effortLevels).to.deep.equal([...DEEPSEEK_REASONING_EFFORT_OPTIONS])
		expect(validateTaskReasoningOverride({ kind: "effort", effort: "low" }, thinking)).to.deep.equal({
			valid: true,
			override: { kind: "effort", effort: "low" },
		})
		expect(validateTaskReasoningOverride({ kind: "effort", effort: "max" }, thinking)).to.deep.equal({
			valid: true,
			override: { kind: "effort", effort: "max" },
		})
	})

	it("accepts only OpenAI service tiers supported by the SDK", () => {
		expect(OPENAI_SERVICE_TIER_OPTIONS).to.deep.equal(["auto", "default", "flex", "scale", "priority"])
		expect(normalizeOpenAiServiceTier("priority")).to.equal("priority")
		expect(normalizeOpenAiServiceTier("unsupported")).to.equal(undefined)
	})

	it("supports native DeepSeek low, high and max efforts while migrating legacy xhigh", () => {
		expect(DEEPSEEK_REASONING_EFFORT_OPTIONS).to.deep.equal(["low", "high", "max"])
		expect(resolveDeepSeekAdaptiveThinking("low")).to.deep.equal({ enabled: true, effort: "low" })
		expect(resolveDeepSeekAdaptiveThinking("high")).to.deep.equal({ enabled: true, effort: "high" })
		expect(resolveDeepSeekAdaptiveThinking("max")).to.deep.equal({ enabled: true, effort: "max" })
		expect(resolveDeepSeekAdaptiveThinking("xhigh")).to.deep.equal({ enabled: true, effort: "max" })
	})
})
