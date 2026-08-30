import { TaskPhase } from "@core/task/TaskPhase"
import { normalizeLegacyTaskSnapshot } from "@core/task/TaskSnapshot"
import fs from "fs/promises"
import path from "path"
import type { HistoryItem } from "@/shared/HistoryItem"
import { ensureTaskDirectoryExists, GlobalFileNames } from "./disk"

/** Completion verdict recovered from one Task's canonical snapshot. */
export interface RecoveredCompletion {
	isCompleted: boolean
}

/**
 * Read one Task's completion verdict from its canonical snapshot.
 *
 * `snapshot.json` is the same source the runtime projects from, so a repair
 * built on it agrees with what the Task itself would persist on reopen.
 *
 * @param taskId Task whose snapshot should be inspected.
 * @returns The verdict, or undefined when no readable snapshot exists.
 */
export async function readPersistedTaskCompletion(taskId: string): Promise<RecoveredCompletion | undefined> {
	let raw: string
	try {
		const taskDir = await ensureTaskDirectoryExists(taskId)
		raw = await fs.readFile(path.join(taskDir, GlobalFileNames.taskSnapshot), "utf8")
	} catch {
		// A Task without a snapshot carries no authoritative verdict.
		return undefined
	}

	try {
		const snapshot = normalizeLegacyTaskSnapshot(JSON.parse(raw))
		return { isCompleted: snapshot.phase === TaskPhase.COMPLETED && snapshot.completion !== undefined }
	} catch {
		return undefined
	}
}

export interface TaskCompletionBackfillOptions {
	/** History rows to inspect, newest first. */
	listTasks(): Promise<HistoryItem[]>
	/**
	 * Read the canonical completion verdict of one Task.
	 *
	 * Returns undefined when the Task has no readable snapshot, which is not an
	 * error: such a Task simply has no authoritative verdict to project.
	 */
	readCompletion(taskId: string): Promise<RecoveredCompletion | undefined>
	/** Durably patch one completion projection; returns false when rejected as stale. */
	persist(taskId: string, isCompleted: boolean, revision: number): Promise<boolean>
	/** Notify that at least one projection changed, so caches and views can refresh. */
	onRepaired?(repairedCount: number): Promise<void> | void
	/** Yield between chunks so the scan cannot monopolize the event loop. */
	yieldBetweenChunks?(): Promise<void>
}

export interface TaskCompletionBackfillResult {
	scanned: number
	repaired: number
	failed: number
}

/** Rows examined before yielding control back to the event loop. */
const CHUNK_SIZE = 25

/**
 * Delay before the one-time repair scan starts.
 *
 * Activation, the first webview render and history compaction all compete for
 * IO right after launch, so the scan waits until that burst has settled.
 */
export const TASK_COMPLETION_BACKFILL_DELAY_MS = 15_000

/**
 * Repair task-history completion projections that earlier versions lost.
 *
 * A defect used to persist `isCompleted: false` whenever a finished Task was
 * reopened, so histories written by those versions carry wrong or missing
 * verdicts. Those rows cannot repair themselves: the projection is only
 * rewritten while a Task is open, so a task the user never reopens would keep
 * showing no checkmark forever.
 *
 * This scan runs off the startup path, reads each Task's canonical snapshot and
 * rewrites only the rows whose stored verdict disagrees with it. It never
 * invents a verdict: a Task without a readable snapshot is left untouched.
 */
export class TaskCompletionBackfill {
	constructor(private readonly options: TaskCompletionBackfillOptions) {}

	/**
	 * Scan the whole history once and repair disagreeing projections.
	 *
	 * @returns Counts describing what the scan observed and changed.
	 */
	async run(): Promise<TaskCompletionBackfillResult> {
		const tasks = await this.options.listTasks()
		const result: TaskCompletionBackfillResult = { scanned: 0, repaired: 0, failed: 0 }

		for (let index = 0; index < tasks.length; index++) {
			if (index > 0 && index % CHUNK_SIZE === 0) {
				await this.yield()
			}
			result.scanned++
			try {
				if (await this.repairTask(tasks[index])) result.repaired++
			} catch {
				// One unreadable Task must not abort the whole scan; the row simply
				// keeps its current projection and can be repaired on a later run.
				result.failed++
			}
		}

		if (result.repaired > 0) {
			await this.options.onRepaired?.(result.repaired)
		}
		return result
	}

	/** Rewrite one row when its stored verdict disagrees with its snapshot. */
	private async repairTask(item: HistoryItem): Promise<boolean> {
		const recovered = await this.options.readCompletion(item.id)
		if (!recovered) return false

		const storedRevision = item.completionStateRevision
		const stored = storedRevision === undefined ? undefined : item.isCompleted === true
		if (stored === recovered.isCompleted) return false

		// Stay above the stored watermark so the durable store cannot reject the
		// repair as stale.
		return await this.options.persist(item.id, recovered.isCompleted, (storedRevision ?? 0) + 1)
	}

	private async yield(): Promise<void> {
		const yieldBetweenChunks = this.options.yieldBetweenChunks
		if (yieldBetweenChunks) {
			await yieldBetweenChunks()
			return
		}
		await new Promise<void>((resolve) => setImmediate(resolve))
	}
}
