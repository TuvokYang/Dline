import { describe, expect, it } from "vitest"
import type { ClineStorageMessage } from "@/shared/messages"
import { COMPACTION_WINDOW_BUDGET_MARKER, resolveCompactionWindowBudget } from "../compaction-window-budget"

function compactionMessages(): ClineStorageMessage[] {
	return [
		{ role: "user", content: [{ type: "text", text: "Preserve this canonical history." }] },
		{
			role: "user",
			content: [{ type: "text", text: `Summarize now.\n\n${COMPACTION_WINDOW_BUDGET_MARKER}` }],
		},
	]
}

describe("compaction window budget", () => {
	it("resolves the marker from the complete request without mutating canonical messages", () => {
		const messages = compactionMessages()
		const original = JSON.stringify(messages)
		const result = resolveCompactionWindowBudget({
			contextWindow: 32_000,
			maxOutputTokens: 4_096,
			systemPrompt: "SYSTEM ".repeat(400),
			messages,
			tools: [{ type: "function", function: { name: "summarize_task", description: "tool".repeat(300) } }],
			serverTools: [{ type: "web_search" }],
		})
		const rendered = JSON.stringify(result.messages)

		expect(JSON.stringify(messages)).toBe(original)
		expect(rendered).not.toContain(COMPACTION_WINDOW_BUDGET_MARKER)
		expect(rendered).toContain("# Compaction Window Budget")
		expect(rendered).toContain(`${result.budget.availableRemainder}`)
		expect(rendered).toContain(`${result.budget.outputHardLimit}`)
		expect(result.budget.estimatedInputTokens).toBeGreaterThan(0)
		expect(result.budget.rawRemainder).toBe(32_000 - result.budget.estimatedInputTokens)
		expect(result.budget.availableRemainder).toBe(Math.max(0, result.budget.rawRemainder))
		expect(result.budget.providerOutputCap).toBe(Math.min(result.budget.availableRemainder, 4_096))
		expect(result.budget.outputHardLimit).toBe(result.budget.providerOutputCap)
		expect(result.budget.decision).toBe("ready")
		expect(result.budget.recommendedMin).toBe(Math.min(Math.floor(result.budget.availableRemainder * 0.8), 5_000))
		expect(result.budget.recommendedMax).toBe(Math.min(Math.floor(result.budget.availableRemainder * 0.9), 30_000))
		expect(result.budget.recommendedMin).toBeLessThanOrEqual(result.budget.recommendedMax)
		expect(result.budget.recommendedMax).toBeLessThanOrEqual(result.budget.availableRemainder)
	})

	it("resolves the marker nested inside a manual compaction tool result", () => {
		const messages: ClineStorageMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						function_id: "call_manual_compact",
						dline_tid: "dline_tid_manual_compact",
						content: [{ type: "text", text: `${COMPACTION_WINDOW_BUDGET_MARKER}\n\nPreserve user feedback.` }],
					},
				],
			},
		]

		const result = resolveCompactionWindowBudget({
			contextWindow: 32_000,
			maxOutputTokens: 4_096,
			systemPrompt: "system",
			messages,
		})
		const rendered = JSON.stringify(result.messages)

		expect(rendered).not.toContain(COMPACTION_WINDOW_BUDGET_MARKER)
		expect(rendered).toContain("# Compaction Window Budget")
		expect(rendered).toContain("Preserve user feedback.")
	})

	it("caps the summary response at the model output limit without exceeding context remainder", () => {
		const common = {
			contextWindow: 64_000,
			systemPrompt: "system",
			messages: compactionMessages(),
		}
		const missing = resolveCompactionWindowBudget(common)
		const small = resolveCompactionWindowBudget({ ...common, maxOutputTokens: 1_024 })
		const large = resolveCompactionWindowBudget({ ...common, maxOutputTokens: 500_000 })

		expect(missing.budget.providerOutputCap).toBe(missing.budget.availableRemainder)
		expect(small.budget.providerOutputCap).toBe(Math.min(small.budget.availableRemainder, 1_024))
		expect(large.budget.providerOutputCap).toBe(Math.min(large.budget.availableRemainder, 500_000))
		expect(small.budget.providerOutputCap).toBeLessThan(missing.budget.providerOutputCap)
	})

	it("requests a smaller input instead of inventing an output cap when no remainder exists", () => {
		const result = resolveCompactionWindowBudget({
			contextWindow: 128,
			maxOutputTokens: 500_000,
			systemPrompt: "system".repeat(1_000),
			messages: compactionMessages(),
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
			messages: compactionMessages(),
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
