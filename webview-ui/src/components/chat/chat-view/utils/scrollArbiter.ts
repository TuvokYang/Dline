/**
 * Single owner of programmatic chat scrolls.
 *
 * The chat used to issue scroll commands from four independent places: the
 * streaming auto-scroll, the row height observer, the visibility restore and
 * the edge jump. Each of them queued its own animation frame plus a private
 * chain of retry timers, and none of them could cancel another. Overlapping
 * chains kept re-targeting Virtuoso while the user was still scrolling, which
 * is what produced the visible bounce and the "list refuses to move" feeling.
 *
 * Routing every request through one arbiter makes the newest intent win and
 * guarantees at most one pending chain exists at a time.
 */

/** Scroll request accepted by the arbiter. */
export interface ScrollRequest {
	/** Runs the actual scroll. Called once per attempt. */
	run: () => void
	/**
	 * Extra attempts after the initial frame, in milliseconds.
	 *
	 * Virtuoso can settle its layout after the first frame (images, code
	 * blocks, a restored panel), so a bottom-follow needs a short retry chain.
	 * Ordinary follow-ups during streaming should pass an empty list.
	 */
	retryDelaysMs?: readonly number[]
	/** Aborts the request and any pending retry when it returns false. */
	isStillWanted?: () => boolean
}

/** Cancellable handle over the arbiter's pending work. */
export interface ScrollArbiter {
	/** Replaces any pending scroll with this request. */
	request: (request: ScrollRequest) => void
	/** Drops pending work without scheduling anything new. */
	cancel: () => void
}

/**
 * Create a scroll arbiter that keeps at most one pending scroll chain.
 *
 * @returns Arbiter whose `request` supersedes any previously pending scroll.
 */
export function createScrollArbiter(): ScrollArbiter {
	let frameId: number | null = null
	let timers: ReturnType<typeof setTimeout>[] = []

	const cancel = (): void => {
		if (frameId !== null) {
			cancelAnimationFrame(frameId)
			frameId = null
		}
		for (const timer of timers) {
			clearTimeout(timer)
		}
		timers = []
	}

	const request = (scrollRequest: ScrollRequest): void => {
		cancel()

		const attempt = () => {
			if (scrollRequest.isStillWanted && !scrollRequest.isStillWanted()) {
				cancel()
				return
			}
			scrollRequest.run()
		}

		frameId = requestAnimationFrame(() => {
			frameId = null
			attempt()
		})

		const retryDelaysMs = scrollRequest.retryDelaysMs ?? []
		if (retryDelaysMs.length > 0) {
			timers = retryDelaysMs.map((delay) => setTimeout(attempt, delay))
		}
	}

	return { request, cancel }
}

/** Retry chain used when layout is expected to settle late (restore, edge jump). */
export const LAYOUT_SETTLE_RETRY_MS: readonly number[] = [50, 200, 500]
