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

	it("resolves Anthropic budget capability when registry metadata only marks reasoning support", () => {
		const thinking = resolveTaskThinkingConfig("anthropic", { supportsReasoning: true })

		expect(thinking).to.deep.include({ supported: true, mode: "budget", maxBudget: 6_000 })
		expect(thinking?.effortLevels).to.deep.equal([])
		expect(validateTaskReasoningOverride({ kind: "budget", budgetTokens: 2_048 }, thinking)).to.deep.equal({
			valid: true,
			override: { kind: "budget", budgetTokens: 2_048 },
		})
	})

	it("projects Anthropic adaptive-thinking metadata with max into Task-local overrides", () => {
		const thinking = resolveTaskThinkingConfig("anthropic", {
			supportsReasoning: true,
			thinking: {
				supported: true,
				mode: "effort",
				effortLevels: ["none", "low", "medium", "high", "max"],
			},
		})

		expect(thinking).to.deep.include({ supported: true, mode: "effort" })
		expect(thinking?.effortLevels).to.deep.equal(["none", "low", "medium", "high", "max"])
		expect(validateTaskReasoningOverride({ kind: "effort", effort: "max" }, thinking)).to.deep.equal({
			valid: true,
			override: { kind: "effort", effort: "max" },
		})
	})

	it("uses an enabled Provider reasoning config when model capability hydration is unavailable", () => {
		const deepSeekThinking = resolveTaskThinkingConfig("deepseek", undefined, {
			enableThinking: true,
			effort: "high",
		})
		const anthropicThinking = resolveTaskThinkingConfig("anthropic", undefined, {
			enableThinking: true,
			thinkingBudget: 2_048,
		})

		expect(deepSeekThinking).to.deep.include({ supported: true, mode: "effort" })
		expect(deepSeekThinking?.effortLevels).to.deep.equal([...DEEPSEEK_REASONING_EFFORT_OPTIONS])
		expect(anthropicThinking).to.deep.include({ supported: true, mode: "budget", maxBudget: 6_000 })
		expect(validateTaskReasoningOverride({ kind: "budget", budgetTokens: 2_048 }, anthropicThinking)).to.deep.equal({
			valid: true,
			override: { kind: "budget", budgetTokens: 2_048 },
		})
	})

	it("honors an explicit Provider disable and does not invent unsupported reasoning", () => {
		expect(resolveTaskThinkingConfig("deepseek", { supportsReasoning: true }, { enableThinking: false })).to.equal(undefined)
		expect(resolveTaskThinkingConfig("anthropic", undefined, undefined)).to.equal(undefined)
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

	it("resolves DeepSeek efforts from a compatible Provider model ID", () => {
		const thinking = resolveTaskThinkingConfig(
			"openrouter",
			{ supportsReasoning: true },
			{ enableThinking: true, effort: "high" },
			"deepseek/deepseek-chat",
		)

		expect(thinking).to.include({ supported: true, mode: "effort" })
		expect(thinking?.effortLevels).to.deep.equal([...DEEPSEEK_REASONING_EFFORT_OPTIONS])
		for (const effort of DEEPSEEK_REASONING_EFFORT_OPTIONS) {
			expect(validateTaskReasoningOverride({ kind: "effort", effort }, thinking)).to.deep.equal({
				valid: true,
				override: { kind: "effort", effort },
			})
		}
	})

	it("accepts only OpenAI service tiers supported by the SDK", () => {
		expect(OPENAI_SERVICE_TIER_OPTIONS).to.deep.equal(["auto", "default", "flex", "scale", "priority", "ultrafast"])
		expect(normalizeOpenAiServiceTier("priority")).to.equal("priority")
		expect(normalizeOpenAiServiceTier("ultrafast")).to.equal("ultrafast")
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
