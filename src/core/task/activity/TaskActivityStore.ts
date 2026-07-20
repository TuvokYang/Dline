import type {
	TaskActivityExecutionMode,
	TaskActivityKind,
	TaskActivityMetrics,
	TaskActivityRecord,
	TaskActivityStatus,
	TaskActivityUpdate,
} from "@shared/task-activity"
import { Logger } from "@/shared/services/Logger"

const FLUSH_DELAY_MS = 75
const MAX_OUTPUT_CHARS = 64 * 1024

type ActivityListener = (update: TaskActivityUpdate) => void | Promise<void>
type CancelActivity = () => void | Promise<void>

export interface CreateTaskActivityInput {
	activityId: string
	kind: TaskActivityKind
	executionMode: TaskActivityExecutionMode
	title: string
	detail?: string
	parentActivityId?: string
	status?: TaskActivityStatus
	cancel?: CancelActivity
}

/** Task-local activity state with bounded output and batched incremental notifications. */
export class TaskActivityStore {
	private readonly activities = new Map<string, TaskActivityRecord>()
	private readonly cancellers = new Map<string, CancelActivity>()
	private readonly listeners = new Map<ActivityListener, Promise<void>>()
	private readonly dirtyIds = new Set<string>()
	private flushTimer?: NodeJS.Timeout
	private sequence = 0

	constructor(readonly taskId: string) {}

	create(input: CreateTaskActivityInput): TaskActivityRecord {
		const existing = this.activities.get(input.activityId)
		if (existing) {
			if (input.cancel) this.cancellers.set(input.activityId, input.cancel)
			return { ...existing, metrics: existing.metrics ? { ...existing.metrics } : undefined }
		}
		const now = Date.now()
		const activity: TaskActivityRecord = {
			activityId: input.activityId,
			taskId: this.taskId,
			kind: input.kind,
			executionMode: input.executionMode,
			status: input.status ?? "running",
			createdAt: now,
			updatedAt: now,
			title: input.title,
			detail: input.detail,
			parentActivityId: input.parentActivityId,
		}
		this.activities.set(activity.activityId, activity)
		if (input.cancel) this.cancellers.set(activity.activityId, input.cancel)
		this.markDirty(activity.activityId, true)
		return { ...activity }
	}

	setCancel(activityId: string, cancel: CancelActivity): void {
		if (this.activities.has(activityId)) this.cancellers.set(activityId, cancel)
	}

	update(
		activityId: string,
		patch: Partial<
			Pick<
				TaskActivityRecord,
				"status" | "executionMode" | "title" | "detail" | "latestEvent" | "result" | "error" | "finishedAt"
			>
		> & { metrics?: Partial<TaskActivityMetrics> },
	): void {
		const activity = this.activities.get(activityId)
		if (!activity) return
		if (activity.status === "cancelled" && patch.status && patch.status !== "cancelled") return
		const previousStatus = activity.status
		const { metrics, ...activityPatch } = patch
		Object.assign(activity, activityPatch, { updatedAt: Date.now() })
		if (metrics) activity.metrics = { ...activity.metrics, ...metrics }
		if (this.isTerminal(activity.status) && !activity.finishedAt) activity.finishedAt = activity.updatedAt
		if (this.isTerminal(activity.status)) this.cancellers.delete(activityId)
		const priority = previousStatus !== activity.status || this.isTerminal(activity.status)
		this.markDirty(activityId, priority)
	}

	appendOutput(activityId: string, text: string): void {
		if (!text) return
		const activity = this.activities.get(activityId)
		if (!activity) return
		const combined = `${activity.output ?? ""}${text}`
		activity.output = combined.length > MAX_OUTPUT_CHARS ? combined.slice(-MAX_OUTPUT_CHARS) : combined
		activity.updatedAt = Date.now()
		this.markDirty(activityId, false)
	}

	get(activityId: string): TaskActivityRecord | undefined {
		const activity = this.activities.get(activityId)
		return activity ? { ...activity, metrics: activity.metrics ? { ...activity.metrics } : undefined } : undefined
	}

	list(): TaskActivityRecord[] {
		return Array.from(this.activities.values())
			.map((activity) => ({ ...activity, metrics: activity.metrics ? { ...activity.metrics } : undefined }))
			.sort((a, b) => b.createdAt - a.createdAt || a.activityId.localeCompare(b.activityId))
	}

	subscribe(listener: ActivityListener): () => void {
		this.listeners.set(listener, Promise.resolve())
		this.enqueue(listener, { sequence: ++this.sequence, snapshot: true, activities: this.list() })
		return () => this.listeners.delete(listener)
	}

	async cancel(activityIds: string[]): Promise<string[]> {
		const cancelled: string[] = []
		for (const activityId of activityIds) {
			const activity = this.activities.get(activityId)
			const cancel = this.cancellers.get(activityId)
			if (!activity || !cancel || activity.status !== "running") continue
			this.update(activityId, { status: "cancelling", latestEvent: "Cancellation requested" })
			try {
				await cancel()
				this.update(activityId, { status: "cancelled", latestEvent: "Cancelled by user" })
				cancelled.push(activityId)
			} catch (error) {
				this.update(activityId, {
					status: "failed",
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}
		return cancelled
	}

	dispose(): void {
		if (this.flushTimer) clearTimeout(this.flushTimer)
		this.flushTimer = undefined
		this.listeners.clear()
		this.cancellers.clear()
	}

	private markDirty(activityId: string, priority: boolean): void {
		this.dirtyIds.add(activityId)
		if (priority) {
			this.flush()
			return
		}
		if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_DELAY_MS)
	}

	private flush(): void {
		if (this.flushTimer) clearTimeout(this.flushTimer)
		this.flushTimer = undefined
		if (this.dirtyIds.size === 0) return
		if (this.listeners.size === 0) {
			this.dirtyIds.clear()
			return
		}
		const activities = Array.from(this.dirtyIds)
			.map((id) => this.get(id))
			.filter((activity): activity is TaskActivityRecord => Boolean(activity))
		this.dirtyIds.clear()
		const update: TaskActivityUpdate = { sequence: ++this.sequence, snapshot: false, activities }
		for (const listener of this.listeners.keys()) this.enqueue(listener, update)
	}

	private enqueue(listener: ActivityListener, update: TaskActivityUpdate): void {
		const previous = this.listeners.get(listener)
		if (!previous) return
		const delivery = previous
			.catch(() => undefined)
			.then(() => listener(update))
			.catch((error) => Logger.warn("[TaskActivityStore] Activity delivery failed", error))
		this.listeners.set(listener, delivery)
	}

	private isTerminal(status: TaskActivityStatus): boolean {
		return status === "completed" || status === "failed" || status === "timeout" || status === "cancelled"
	}
}
