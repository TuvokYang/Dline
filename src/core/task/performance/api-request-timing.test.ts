import { describe, expect, it } from "vitest"
import { calculateApiRequestTiming } from "./api-request-timing"

describe("calculateApiRequestTiming", () => {
	it("separates local preparation, upstream TTFB, stream consumption, and total duration", () => {
		expect(
			calculateApiRequestTiming({
				requestStartedAtMs: 100,
				providerRequestStartedAtMs: 350,
				firstChunkAtMs: 500,
				streamCompletedAtMs: 900,
			}),
		).toEqual({
			localPrepareMs: 250,
			upstreamTtfbMs: 150,
			streamMs: 400,
			totalMs: 800,
		})
	})

	it("clamps invalid clock ordering to zero-length phases", () => {
		expect(
			calculateApiRequestTiming({
				requestStartedAtMs: 500,
				providerRequestStartedAtMs: 400,
				firstChunkAtMs: 300,
				streamCompletedAtMs: 200,
			}),
		).toEqual({
			localPrepareMs: 0,
			upstreamTtfbMs: 0,
			streamMs: 0,
			totalMs: 0,
		})
	})
})
