import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiRateTracker } from "./api-rate-tracker"

afterEach(() => {
	vi.useRealTimers()
})

describe("ApiRateTracker", () => {
	it("reports requests and exact-or-estimated tokens from the trailing minute", () => {
		vi.useFakeTimers()
		vi.setSystemTime(new Date("2026-08-10T09:00:00.000Z"))
		const tracker = new ApiRateTracker()

		tracker.recordRequestStarted()
		tracker.recordEstimatedTokens(120)
		expect(tracker.getSnapshot()).toEqual({ requestsPerMinute: 1, tokensPerMinute: 120 })

		tracker.recordExactTokens(1_500)
		expect(tracker.getSnapshot()).toEqual({ requestsPerMinute: 1, tokensPerMinute: 1_500 })

		vi.advanceTimersByTime(30_000)
		tracker.recordRequestStarted()
		tracker.recordEstimatedTokens(250)
		expect(tracker.getSnapshot()).toEqual({ requestsPerMinute: 2, tokensPerMinute: 1_750 })

		vi.advanceTimersByTime(30_001)
		expect(tracker.getSnapshot()).toEqual({ requestsPerMinute: 1, tokensPerMinute: 250 })
	})

	it("notifies when the oldest sample expires from the trailing minute", async () => {
		vi.useFakeTimers()
		const onChanged = vi.fn()
		const tracker = new ApiRateTracker({ onChanged })

		tracker.recordRequestStarted()
		onChanged.mockClear()
		await vi.advanceTimersByTimeAsync(60_001)

		expect(onChanged).toHaveBeenCalled()
		expect(tracker.getSnapshot()).toEqual({ requestsPerMinute: 0, tokensPerMinute: 0 })
		tracker.dispose()
	})
})
