import { strict as assert } from "node:assert"
import { describe, it } from "vitest"
import { TaskState } from "../../../TaskState"
import type { TaskConfig } from "../../types/TaskConfig"
import {
	buildSubagentOutputBudgetPrompt,
	estimateSubagentOutputTokens,
	resolveSubagentOutputBudget,
	truncateTextToSubagentOutputBudget,
} from "../SubagentOutputBudget"

function createConfig(contextWindow: number, contextTokens: number): Pick<TaskConfig, "api" | "messageState" | "taskState"> {
	return {
		api: {
			getModel: () => ({
				id: "main-model",
				info: { capabilities: { contextWindow } },
			}),
		} as TaskConfig["api"],
		messageState: {
			clineMessages:
				contextTokens > 0
					? [
							{
								type: "say",
								say: "api_req_started",
								text: JSON.stringify({ contextTokens }),
								ts: 1,
							},
						]
					: [],
		} as TaskConfig["messageState"],
		taskState: new TaskState(),
	}
}

describe("SubagentOutputBudget", () => {
	it("uses five percent of the main task remaining context by default", () => {
		const budget = resolveSubagentOutputBudget(createConfig(200_000, 100_000))

		assert.equal(budget.mainTaskRemainingTokens, 100_000)
		assert.equal(budget.outputTokens, 5_000)
		assert.equal(budget.source, "default_ratio")
	})

	it("supports an explicit ratio and caps it at the main task remaining context", () => {
		const budget = resolveSubagentOutputBudget(createConfig(10_000, 9_000), 0.5)

		assert.equal(budget.requestedOutputTokens, 500)
		assert.equal(budget.outputTokens, 500)
		assert.equal(budget.source, "configured_ratio")
	})

	it("keeps a one-token budget when a non-empty remaining window is smaller than the ratio floor", () => {
		const budget = resolveSubagentOutputBudget(createConfig(10_000, 9_990))

		assert.equal(budget.mainTaskRemainingTokens, 10)
		assert.equal(budget.requestedOutputTokens, 1)
		assert.equal(budget.outputTokens, 1)
	})

	it("supports an explicit absolute token count and caps it at remaining context", () => {
		const budget = resolveSubagentOutputBudget(createConfig(10_000, 9_000), 10_240)

		assert.equal(budget.requestedOutputTokens, 10_240)
		assert.equal(budget.outputTokens, 1_000)
		assert.equal(budget.source, "configured_absolute")
	})

	it("falls back to the default ratio for an invalid runtime configuration", () => {
		const budget = resolveSubagentOutputBudget(createConfig(10_000, 9_000), 1.5)

		assert.equal(budget.outputTokens, 50)
		assert.equal(budget.source, "default_ratio")
	})

	it("injects the effective output budget into the subagent task prompt", () => {
		const prompt = buildSubagentOutputBudgetPrompt("<task>inspect</task>", 10_240)

		assert.match(prompt, /within 10,240 tokens/)
		assert.match(prompt, /attempt_completion result is returned to the main task/)
	})

	it("truncates final output without exceeding the estimated token budget", () => {
		const source = "abcdefghij".repeat(100)
		const result = truncateTextToSubagentOutputBudget(source, 20)

		assert.ok(result.length < source.length)
		assert.ok(estimateSubagentOutputTokens(result) <= 20)
	})
})
