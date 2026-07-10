import { describe, expect, it } from "vitest"
import { decideModeSwitch, getContextTokens, readContextTokens } from "../context-pressure"
import { computeCompactTrigger, computeSummarizeBudget } from "../context-window-utils"

/** Verify canonical context-pressure accounting and mode-switch decisions. */
describe("context pressure", () => {
	/** Prefer the normalized occupancy persisted by the request finalizer. */
	it("prefers canonical contextTokens", () => {
		expect(getContextTokens({ tokensIn: 5_000, tokensOut: 500, cacheReads: 9_000, contextTokens: 14_500 })).toBe(14_500)
	})

	/** Preserve compatibility with request records created before canonical occupancy existed. */
	it("supports legacy usage", () => {
		expect(readContextTokens(JSON.stringify({ tokensIn: 5_000, tokensOut: 500, cacheReads: 9_000 }))).toBe(14_500)
	})

	/** Treat malformed persisted request metadata as unavailable pressure. */
	it("returns zero for malformed usage", () => {
		expect(readContextTokens("not-json")).toBe(0)
	})

	/** Same-profile switches never require compaction confirmation. */
	it("skips warning for the same profile", () => {
		expect(
			decideModeSwitch({
				sourceProfile: "shared",
				targetProfile: "shared",
				sourceWindow: 128_000,
				targetWindow: 128_000,
				currentTokens: 120_000,
			}),
		).toEqual({ kind: "switch" })
	})

	/** Equal and larger target windows switch without compaction confirmation. */
	it("skips warning when the target window is not smaller", () => {
		expect(
			decideModeSwitch({
				sourceProfile: "source",
				targetProfile: "target",
				sourceWindow: 128_000,
				targetWindow: 200_000,
				currentTokens: 120_000,
			}),
		).toEqual({ kind: "switch" })
	})

	/** Smaller target windows warn only at the shared summary-aware trigger. */
	it("warns only when a smaller target window reaches its trigger", () => {
		const triggerTokens = computeCompactTrigger(128_000, computeSummarizeBudget())
		expect(
			decideModeSwitch({
				sourceProfile: "large",
				targetProfile: "small",
				sourceWindow: 272_000,
				targetWindow: 128_000,
				currentTokens: triggerTokens,
			}),
		).toEqual({ kind: "confirm", triggerTokens })
	})
})
