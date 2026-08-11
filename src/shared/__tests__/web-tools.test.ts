import { describe, expect, it } from "vitest"
import { normalizeHostedWebSearchOperation, normalizeWebSearchItems } from "../web-tools"

describe("hosted Web Search presentation normalization", () => {
	it("normalizes current and deprecated search action query fields", () => {
		expect(
			normalizeHostedWebSearchOperation({
				type: "search",
				queries: [" Dline hosted search ", "", "OpenAI Responses"],
				query: "deprecated fallback",
			}),
		).toEqual({
			type: "search",
			queries: ["Dline hosted search", "OpenAI Responses"],
		})
		expect(normalizeHostedWebSearchOperation({ type: "search", query: " legacy query " })).toEqual({
			type: "search",
			queries: ["legacy query"],
		})
	})

	it("normalizes open_page and find_in_page actions from direct or completed payloads", () => {
		expect(
			normalizeHostedWebSearchOperation({
				type: "open_page",
				url: " https://example.com/current ",
			}),
		).toEqual({ type: "open_page", url: "https://example.com/current" })
		expect(
			normalizeHostedWebSearchOperation({
				action: {
					type: "find_in_page",
					url: "https://example.com/docs",
					pattern: " hosted search action ",
				},
			}),
		).toEqual({
			type: "find_in_page",
			url: "https://example.com/docs",
			pattern: "hosted search action",
		})
	})

	it("returns an explicit unknown operation when provider action content is unusable", () => {
		expect(normalizeHostedWebSearchOperation({ type: "future_action", opaque: true })).toEqual({
			type: "unknown",
			providerType: "future_action",
		})
		expect(normalizeHostedWebSearchOperation(undefined)).toEqual({ type: "unknown" })
	})

	it("merges results and action sources by URL while preserving complementary metadata", () => {
		expect(
			normalizeWebSearchItems({
				results: [
					{
						url: "https://example.com/shared",
						snippet: "Result snippet",
					},
					{
						url: "https://example.com/result-only",
						title: "Result only",
					},
				],
				action: {
					sources: [
						{
							url: "https://example.com/shared",
							title: "Shared title",
						},
						{
							url: "https://example.com/source-only",
						},
					],
				},
			}),
		).toEqual([
			{
				url: "https://example.com/shared",
				title: "Shared title",
				snippet: "Result snippet",
			},
			{
				url: "https://example.com/result-only",
				title: "Result only",
			},
			{
				url: "https://example.com/source-only",
			},
		])
	})
})
