export interface ApiRateSnapshot {
	requestsPerMinute: number
	tokensPerMinute: number
}

interface ApiRateSample {
	startedAtMs: number
	estimatedTokens: number
	exactTokens?: number
}

interface ApiRateTrackerOptions {
	now?: () => number
	onChanged?: () => void
	windowMs?: number
}

const DEFAULT_WINDOW_MS = 60_000

/** Tracks request and token activity in a trailing time window for one Task. */
export class ApiRateTracker {
	private readonly now: () => number
	private readonly onChanged?: () => void
	private readonly windowMs: number
	private readonly samples: ApiRateSample[] = []
	private expiryTimer: ReturnType<typeof setTimeout> | undefined

	constructor(options: ApiRateTrackerOptions = {}) {
		this.now = options.now ?? Date.now
		this.onChanged = options.onChanged
		this.windowMs = options.windowMs ?? DEFAULT_WINDOW_MS
	}

	recordRequestStarted(): void {
		this.prune()
		this.samples.push({ startedAtMs: this.now(), estimatedTokens: 0 })
		this.scheduleExpiry()
		this.onChanged?.()
	}

	recordEstimatedTokens(tokens: number): void {
		if (!Number.isFinite(tokens) || tokens <= 0) return
		this.prune()
		const sample = this.samples.at(-1)
		if (!sample) return
		sample.estimatedTokens += Math.round(tokens)
		this.onChanged?.()
	}

	recordExactTokens(tokens: number): void {
		if (!Number.isFinite(tokens) || tokens < 0) return
		this.prune()
		const sample = this.samples.at(-1)
		if (!sample) return
		sample.exactTokens = Math.round(tokens)
		this.onChanged?.()
	}

	getSnapshot(): ApiRateSnapshot {
		this.prune()
		return {
			requestsPerMinute: this.samples.length,
			tokensPerMinute: this.samples.reduce((total, sample) => total + (sample.exactTokens ?? sample.estimatedTokens), 0),
		}
	}

	dispose(): void {
		if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer)
		this.expiryTimer = undefined
		this.samples.length = 0
	}

	private prune(): void {
		const threshold = this.now() - this.windowMs
		while (this.samples[0] && this.samples[0].startedAtMs <= threshold) this.samples.shift()
		this.scheduleExpiry()
	}

	private scheduleExpiry(): void {
		if (this.expiryTimer !== undefined) clearTimeout(this.expiryTimer)
		const oldest = this.samples[0]
		if (!oldest) {
			this.expiryTimer = undefined
			return
		}
		const delay = Math.max(1, oldest.startedAtMs + this.windowMs - this.now() + 1)
		this.expiryTimer = setTimeout(() => {
			this.expiryTimer = undefined
			this.prune()
			this.onChanged?.()
		}, delay)
		this.expiryTimer.unref?.()
	}
}
