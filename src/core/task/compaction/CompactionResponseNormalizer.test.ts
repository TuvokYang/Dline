import { describe, expect, it } from "vitest"
import { normalizeCompactionResponse } from "./CompactionResponseNormalizer"

describe("normalizeCompactionResponse", () => {
	it("removes terminal empty calls after a complete summary", () => {
		const response = "<summarize_task><context>summary</context></summarize_task>\n<summarize_task />"

		expect(normalizeCompactionResponse(response)).toEqual({
			assistantText: "<summarize_task><context>summary</context></summarize_task>",
			removedEmptyCallCount: 1,
			synthesizedMissingContext: false,
		})
	})

	it("preserves a quoted empty call inside the summary body", () => {
		const response =
			"<summarize_task><context>Do not emit `<summarize_task />` after this summary.</context></summarize_task>"

		expect(normalizeCompactionResponse(response)).toEqual({
			assistantText: response,
			removedEmptyCallCount: 0,
			synthesizedMissingContext: false,
		})
	})

	it("converts an only-empty terminal call into a missing-context tool call", () => {
		expect(normalizeCompactionResponse("<summarize_task />")).toEqual({
			assistantText: "<summarize_task><context></context></summarize_task>",
			removedEmptyCallCount: 1,
			synthesizedMissingContext: true,
		})
	})

	it("preserves leading assistant text when synthesizing the missing-context call", () => {
		expect(normalizeCompactionResponse("Unable to summarize.\n<summarize_task />").assistantText).toBe(
			"Unable to summarize.\n<summarize_task><context></context></summarize_task>",
		)
	})

	it("suppresses a terminal partial call until its syntax is known", () => {
		expect(normalizeCompactionResponse("<summarize_task /")).toEqual({
			assistantText: "",
			removedEmptyCallCount: 0,
			synthesizedMissingContext: false,
		})
	})
})
