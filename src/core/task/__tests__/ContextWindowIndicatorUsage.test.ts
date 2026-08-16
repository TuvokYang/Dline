import { describe, expect, it } from "vitest"
import {
	getContextWindowProviderUsageTotal,
	mergeContextWindowProviderUsage,
	type ContextWindowProviderUsage,
} from "../ContextWindowIndicatorUsage"

describe("ContextWindowIndicatorUsage", () => {
	it("merges split provider usage without adding duplicate request snapshots", () => {
		const inputSnapshot = mergeContextWindowProviderUsage(undefined, {
			type: "usage",
			inputTokens: 100,
			outputTokens: 0,
			cacheWriteTokens: 10,
			cacheReadTokens: 5,
		})
		const outputSnapshot = mergeContextWindowProviderUsage(inputSnapshot, {
			type: "usage",
			inputTokens: 0,
			outputTokens: 25,
		})
		const finalSnapshot = mergeContextWindowProviderUsage(outputSnapshot, {
			type: "usage",
			inputTokens: 100,
			outputTokens: 50,
			cacheWriteTokens: 10,
			cacheReadTokens: 5,
		})

		expect(finalSnapshot).toEqual<ContextWindowProviderUsage>({
			inputTokens: 100,
			outputTokens: 50,
			cacheWriteTokens: 10,
			cacheReadTokens: 5,
		})
		expect(getContextWindowProviderUsageTotal(finalSnapshot)).toBe(165)
	})

	it("keeps the highest observed output snapshot when a later chunk is partial", () => {
		const first = mergeContextWindowProviderUsage(undefined, {
			type: "usage",
			inputTokens: 100,
			outputTokens: 50,
		})
		const laterPartial = mergeContextWindowProviderUsage(first, {
			type: "usage",
			inputTokens: 0,
			outputTokens: 10,
		})

		expect(laterPartial).toEqual<ContextWindowProviderUsage>({
			inputTokens: 100,
			outputTokens: 50,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
		})
	})
})
