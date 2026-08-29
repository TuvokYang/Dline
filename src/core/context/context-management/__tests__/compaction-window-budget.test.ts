import { describe, expect, it } from "vitest"
import type { ClineStorageMessage } from "@/shared/messages"
import { resolveCompactionWindowBudget } from "../compaction-window-budget"

function compactionMessages(budgetGuidance = ""): ClineStorageMessage[] {
	return [
		{ role: "user", content: [{ type: "text", text: "Preserve this canonical history." }] },
		{
			role: "user",
			content: [{ type: "text", text: `Summarize now.\n\n${budgetGuidance}` }],
		},
	]
}

describe("compaction window budget", () => {
	it("rebuilds only the explicit instruction without mutating canonical messages", () => {
		const messages = compactionMessages()
		const original = JSON.stringify(messages)
		const result = resolveCompactionWindowBudget({
			contextWindow: 32_000,
			maxOutputTokens: 4_096,
			systemPrompt: "SYSTEM ".repeat(400),
			buildMessages: compactionMessages,
			tools: [{ type: "function", function: { name: "summarize_task", description: "tool".repeat(300) } }],
			serverTools: [{ type: "web_search" }],
		})
		const rendered = JSON.stringify(result.messages)

		expect(JSON.stringify(messages)).toBe(original)
		expect(rendered).toContain("# Compaction Window Budget")
		expect(rendered).toContain(`${result.budget.availableRemainder}`)
		expect(rendered).toContain(`${result.budget.outputHardLimit}`)
		expect(result.budget.estimatedInputTokens).toBeGreaterThan(0)
		expect(result.budget.rawRemainder).toBe(32_000 - result.budget.estimatedInputTokens)
		expect(result.budget.availableRemainder).toBe(Math.max(0, result.budget.rawRemainder))
		expect(result.budget.providerOutputCap).toBe(
			Math.min(4_096, Math.floor(result.budget.availableRemainder * 0.9), result.budget.availableRemainder - 3_000),
		)
		expect(result.budget.outputHardLimit).toBe(result.budget.providerOutputCap)
		expect(result.budget.decision).toBe("ready")
		expect(result.budget.closureReserveTokens).toBe(3_000)
		expect(result.budget.reservedRequestTokens).toBe(
			result.budget.estimatedInputTokens + result.budget.providerOutputCap + result.budget.closureReserveTokens,
		)
		expect(result.budget.reservedRequestTokens).toBeLessThanOrEqual(32_000)
		expect(result.budget.recommendedMax).toBe(
			Math.min(Math.floor(result.budget.availableRemainder * 0.9), 30_000, result.budget.providerOutputCap),
		)
		expect(result.budget.recommendedMin).toBe(
			Math.min(Math.floor(result.budget.availableRemainder * 0.8), 5_000, result.budget.recommendedMax),
		)
		expect(result.budget.recommendedMin).toBeLessThanOrEqual(result.budget.recommendedMax)
		expect(result.budget.recommendedMax).toBeLessThanOrEqual(result.budget.availableRemainder)
	})

	it("preserves existing tool results while rebuilding the explicit instruction", () => {
		const history: ClineStorageMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						function_id: "call_manual_compact",
						dline_tid: "dline_tid_manual_compact",
						content: [{ type: "text", text: "Preserve user feedback exactly." }],
					},
				],
			},
		]

		const result = resolveCompactionWindowBudget({
			contextWindow: 32_000,
			maxOutputTokens: 4_096,
			systemPrompt: "system",
			buildMessages: (budgetGuidance) => [
				...history,
				{ role: "user", content: [{ type: "text", text: `Summarize now.\n\n${budgetGuidance}` }] },
			],
		})
		const rendered = JSON.stringify(result.messages)

		expect(rendered).toContain("# Compaction Window Budget")
		expect(rendered).toContain("Preserve user feedback exactly.")
	})

	it("caps the summary response at the next-Pass carry limit", () => {
		const result = resolveCompactionWindowBudget({
			contextWindow: 64_000,
			maxOutputTokens: 32_000,
			summaryOutputLimitTokens: 1_250,
			systemPrompt: "system",
			buildMessages: compactionMessages,
		})

		expect(result.budget.providerOutputCap).toBe(1_250)
		expect(result.budget.outputHardLimit).toBe(1_250)
		expect(result.budget.recommendedMax).toBeLessThanOrEqual(1_250)
		expect(JSON.stringify(result.messages)).toContain("Hard limit for the complete response: 1250 tokens")
	})

	it("caps the summary response at the model output limit without exceeding context remainder", () => {
		const common = {
			contextWindow: 64_000,
			systemPrompt: "system",
			buildMessages: compactionMessages,
		}
		const missing = resolveCompactionWindowBudget(common)
		const small = resolveCompactionWindowBudget({ ...common, maxOutputTokens: 1_024 })
		const large = resolveCompactionWindowBudget({ ...common, maxOutputTokens: 500_000 })

		expect(missing.budget.providerOutputCap).toBe(
			Math.min(Math.floor(missing.budget.availableRemainder * 0.9), missing.budget.availableRemainder - 3_000),
		)
		expect(small.budget.providerOutputCap).toBe(
			Math.min(1_024, Math.floor(small.budget.availableRemainder * 0.9), small.budget.availableRemainder - 3_000),
		)
		expect(large.budget.providerOutputCap).toBe(
			Math.min(500_000, Math.floor(large.budget.availableRemainder * 0.9), large.budget.availableRemainder - 3_000),
		)
		expect(small.budget.providerOutputCap).toBeLessThan(missing.budget.providerOutputCap)
	})

	it("rejects a zero next-Pass carry limit instead of generating an uncarryable summary", () => {
		const result = resolveCompactionWindowBudget({
			contextWindow: 64_000,
			maxOutputTokens: 32_000,
			summaryOutputLimitTokens: 0,
			systemPrompt: "system",
			buildMessages: compactionMessages,
		})

		expect(result.budget.providerOutputCap).toBe(0)
		expect(result.budget.decision).toBe("needs_smaller_input")
	})

	it("requests a smaller input instead of inventing an output cap when no remainder exists", () => {
		const result = resolveCompactionWindowBudget({
			contextWindow: 128,
			maxOutputTokens: 500_000,
			systemPrompt: "system".repeat(1_000),
			buildMessages: compactionMessages,
		})

		expect(result.budget.rawRemainder).toBeLessThan(0)
		expect(result.budget.availableRemainder).toBe(0)
		expect(result.budget.providerOutputCap).toBe(0)
		expect(result.budget.outputHardLimit).toBe(0)
		expect(result.budget.decision).toBe("needs_smaller_input")
	})

	it("includes system prompt and tool schemas in the request estimate", () => {
		const common = {
			contextWindow: 64_000,
			maxOutputTokens: 32_000,
			buildMessages: compactionMessages,
		}
		const small = resolveCompactionWindowBudget({ ...common, systemPrompt: "small", tools: [] })
		const large = resolveCompactionWindowBudget({
			...common,
			systemPrompt: "large-system".repeat(2_000),
			tools: [{ type: "function", function: { name: "large_tool", description: "schema".repeat(2_000) } }],
		})

		expect(large.budget.estimatedInputTokens).toBeGreaterThan(small.budget.estimatedInputTokens)
		expect(large.budget.availableRemainder).toBeLessThan(small.budget.availableRemainder)
	})
})
