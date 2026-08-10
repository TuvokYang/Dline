import { OpenAiHandler } from "@core/api/providers/openai"
import {
	DEFAULT_AUTO_CONDENSE_MAX_CONTEXT_TOKENS,
	DEFAULT_AUTO_CONDENSE_TRIGGER_PERCENT,
	normalizeAutoCondenseMaxContextTokens,
	normalizeAutoCondenseTriggerPercent,
} from "@shared/auto-condense"
import type { ModelInfo } from "@shared/proto/dline/models"
import { describe, expect, it } from "vitest"
import {
	computeCompactTrigger,
	computeSafetyBuffer,
	computeSummarizeBudget,
	getContextWindowInfo,
	getEstimationTolerance,
	shouldCompactProjectedUsage,
} from "../context-window-utils"

function openAiHandlerWithModel(id: string, contextWindow?: number): OpenAiHandler {
	const handler = Object.create(OpenAiHandler.prototype) as OpenAiHandler
	handler.getModel = () => ({
		id,
		info: {
			id,
			...(contextWindow !== undefined
				? { capabilities: { contextWindow, maxTokens: 8192 } as ModelInfo["capabilities"] }
				: {}),
		} as ModelInfo,
	})
	return handler
}

describe("auto-condense context trigger", () => {
	it("reserves three percent clamped to 5K through 30K", () => {
		expect(computeSafetyBuffer(64_000)).toBe(5_000)
		expect(computeSafetyBuffer(500_000)).toBe(15_000)
		expect(computeSafetyBuffer(1_000_000)).toBe(30_000)
		expect(computeSafetyBuffer(2_000_000)).toBe(30_000)
	})

	it("preserves the 372K safety and trigger contract while applying the 2K admission tolerance", () => {
		const summarizeBudget = computeSummarizeBudget()
		const triggerTokens = computeCompactTrigger(372_000, summarizeBudget)

		expect(computeSafetyBuffer(372_000)).toBe(11_160)
		expect(summarizeBudget).toBe(2_500)
		expect(triggerTokens).toBe(358_340)
		expect(getEstimationTolerance()).toBe(2_000)
		expect(shouldCompactProjectedUsage(356_339, triggerTokens)).toBe(false)
		expect(shouldCompactProjectedUsage(356_340, triggerTokens)).toBe(true)
	})

	it("uses only the hard ceiling when no auto-condense settings are supplied", () => {
		const summarizeBudget = computeSummarizeBudget()
		expect(computeCompactTrigger(128_000, summarizeBudget)).toBe(120_500)
		expect(computeCompactTrigger(1_000_000, summarizeBudget)).toBe(967_500)
		expect(computeCompactTrigger(2_000_000, summarizeBudget)).toBe(1_967_500)
	})

	it("applies the default auto-condense percentage when it is explicitly supplied", () => {
		expect(
			computeCompactTrigger(2_000_000, computeSummarizeBudget(), {
				triggerPercent: DEFAULT_AUTO_CONDENSE_TRIGGER_PERCENT,
			}),
		).toBe(1_940_000)
	})

	it("uses whichever configured percentage or absolute cap is reached first", () => {
		const summarizeBudget = computeSummarizeBudget()
		expect(
			computeCompactTrigger(1_000_000, summarizeBudget, {
				triggerPercent: 60,
				maxContextTokens: 500_000,
			}),
		).toBe(500_000)
		expect(
			computeCompactTrigger(1_000_000, summarizeBudget, {
				triggerPercent: 60,
				maxContextTokens: 700_000,
			}),
		).toBe(600_000)
	})

	it("treats zero as no absolute cap", () => {
		expect(
			computeCompactTrigger(1_000_000, computeSummarizeBudget(), {
				triggerPercent: 50,
				maxContextTokens: 0,
			}),
		).toBe(500_000)
	})

	it("deducts summarize instructions only from the hard ceiling", () => {
		expect(
			computeCompactTrigger(1_000_000, computeSummarizeBudget(), {
				triggerPercent: 50,
				maxContextTokens: 600_000,
			}),
		).toBe(500_000)
	})

	it("normalizes persisted values into supported ranges", () => {
		expect(normalizeAutoCondenseTriggerPercent(undefined)).toBe(DEFAULT_AUTO_CONDENSE_TRIGGER_PERCENT)
		expect(normalizeAutoCondenseTriggerPercent(0)).toBe(1)
		expect(normalizeAutoCondenseTriggerPercent(120)).toBe(97)
		expect(normalizeAutoCondenseMaxContextTokens(undefined)).toBe(DEFAULT_AUTO_CONDENSE_MAX_CONTEXT_TOKENS)
		expect(normalizeAutoCondenseMaxContextTokens(-1)).toBe(0)
		expect(normalizeAutoCondenseMaxContextTokens(600_000.9)).toBe(600_000)
	})
})

describe("getContextWindowInfo", () => {
	it("preserves an explicit OpenAI-compatible context window for DeepSeek model IDs", () => {
		expect(getContextWindowInfo(openAiHandlerWithModel("custom-deepseek-v4", 256_000))).toEqual({
			contextWindow: 256_000,
			maxAllowedSize: 216_000,
		})
	})

	it("falls back to the default context window when capabilities are missing", () => {
		expect(getContextWindowInfo(openAiHandlerWithModel("gpt-5-nano"))).toEqual({
			contextWindow: 128_000,
			maxAllowedSize: 98_000,
		})
	})
})
