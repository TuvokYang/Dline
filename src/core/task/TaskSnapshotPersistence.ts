import type { TaskSnapshot } from "./TaskSnapshot"

const DEFAULT_FLUSH_INTERVAL_MS = 100

export interface TaskSnapshotPersistenceOptions {
	writeSnapshot: (snapshot: TaskSnapshot) => Promise<void>
	flushIntervalMs?: number
	setTimeoutFn?: typeof setTimeout
	clearTimeoutFn?: typeof clearTimeout
}

/**
 * Coalesces task snapshot.json writes while keeping the latest snapshot available for forced flushes.
 */
export class TaskSnapshotPersistence {
	private readonly writeSnapshot: (snapshot: TaskSnapshot) => Promise<void>
	private readonly flushIntervalMs: number
	private readonly setTimeoutFn: typeof setTimeout
	private readonly clearTimeoutFn: typeof clearTimeout
	private pendingSnapshot: TaskSnapshot | undefined
	private flushTimer: ReturnType<typeof setTimeout> | undefined
	private writeChain: Promise<void> = Promise.resolve()

	constructor(options: TaskSnapshotPersistenceOptions) {
		this.writeSnapshot = options.writeSnapshot
		this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
		this.setTimeoutFn = options.setTimeoutFn ?? setTimeout
		this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
	}

	/**
	 * Schedule a snapshot.json write, coalescing multiple updates into one interval.
	 * @param snapshot Latest snapshot to persist.
	 */
	schedule(snapshot: TaskSnapshot): void {
		this.pendingSnapshot = snapshot
		if (this.flushTimer) {
			return
		}
		this.flushTimer = this.setTimeoutFn(() => {
			this.flushTimer = undefined
			void this.flushNow()
		}, this.flushIntervalMs)
	}

	/**
	 * Immediately write the latest pending snapshot and cancel any scheduled timer.
	 */
	async flushNow(): Promise<void> {
		if (this.flushTimer) {
			this.clearTimeoutFn(this.flushTimer)
			this.flushTimer = undefined
		}
		const snapshot = this.pendingSnapshot
		if (!snapshot) {
			await this.writeChain
			return
		}
		this.pendingSnapshot = undefined
		this.writeChain = this.writeChain.then(() => this.writeSnapshot(snapshot))
		await this.writeChain
	}
}
