import type {
	TaskActivityCancellationOwner,
	TaskActivityEvent,
	TaskActivityEventInput,
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
const MAX_EVENT_TEXT_CHARS = 16 * 1024
const MAX_EVENTS_PER_ACTIVITY = 500
const AUTHORIZATION_VALUE_PATTERN = /(\bauthorization\s*[:=]\s*)(?:(?:bearer|basic)\s+)?([^\s,;]+)/gi
const BEARER_TOKEN_PATTERN = /(\bbearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi
const SENSITIVE_VALUE_PATTERN = /(api[_-]?key|access[_-]?token|password|secret)(\s*[:=]\s*)([^\s,;]+)/gi
const KNOWN_SECRET_TOKEN_PATTERN =
	/\b(?:github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g

function redactSensitiveText(text: string): string {
	return text
		.replace(AUTHORIZATION_VALUE_PATTERN, "$1[REDACTED]")
		.replace(BEARER_TOKEN_PATTERN, "$1[REDACTED]")
		.replace(SENSITIVE_VALUE_PATTERN, "$1$2[REDACTED]")
		.replace(KNOWN_SECRET_TOKEN_PATTERN, "[REDACTED]")
}

type ActivityListener = (update: TaskActivityUpdate) => void | Promise<void>
type CancelActivity = () => void | Promise<void>

export interface TaskActivityPersistencePort {
	load(): Promise<TaskActivityRecord[]>
	save(activities: TaskActivityRecord[]): Promise<void>
}

export interface CreateTaskActivityInput {
	activityId: string
	kind: TaskActivityKind
	executionMode: TaskActivityExecutionMode
	cancellationOwner?: TaskActivityCancellationOwner
	title: string
	detail?: string
	timeoutSeconds?: number
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
	private persistenceSequence = Promise.resolve()
	private hydratePromise?: Promise<void>

	constructor(
		readonly taskId: string,
		private readonly persistence?: TaskActivityPersistencePort,
	) {}

	async hydrate(): Promise<void> {
		if (!this.persistence) return
		this.hydratePromise ??= this.loadPersistedActivities()
		await this.hydratePromise
	}

	/** Finalize persisted in-flight work after the caller has acquired the task lock. */
	async recoverInterruptedActivities(): Promise<string[]> {
		await this.hydrate()
		const interruptedActivityIds: string[] = []
		for (const activity of this.activities.values()) {
			if (!this.isTransient(activity.status) || this.cancellers.has(activity.activityId)) continue
			interruptedActivityIds.push(activity.activityId)
			this.update(activity.activityId, {
				status: "interrupted",
				latestEvent: "Interrupted before completion",
			})
		}
		await this.waitForPersistence()
		return interruptedActivityIds
	}

	private async loadPersistedActivities(): Promise<void> {
		if (!this.persistence) return
		for (const activity of await this.persistence.load()) {
			if (!this.activities.has(activity.activityId)) {
				this.activities.set(activity.activityId, this.clone(activity))
			}
			for (const event of activity.events) this.sequence = Math.max(this.sequence, event.sequence)
		}
	}

	create(input: CreateTaskActivityInput): TaskActivityRecord {
		const existing = this.activities.get(input.activityId)
		if (existing) {
			if (input.cancel) this.cancellers.set(input.activityId, input.cancel)
			return this.clone(existing)
		}
		const now = Date.now()
		const activity: TaskActivityRecord = {
			schemaVersion: 1,
			activityId: input.activityId,
			taskId: this.taskId,
			kind: input.kind,
			executionMode: input.executionMode,
			cancellationOwner: input.cancellationOwner ?? "task",
			status: input.status ?? "running",
			createdAt: now,
			updatedAt: now,
			title: redactSensitiveText(input.title),
			detail: input.detail === undefined ? undefined : redactSensitiveText(input.detail),
			timeoutSeconds: input.timeoutSeconds,
			parentActivityId: input.parentActivityId,
			events: [],
		}
		this.activities.set(activity.activityId, activity)
		if (input.cancel) this.cancellers.set(activity.activityId, input.cancel)
		this.appendEvent(input.activityId, { kind: "status", status: activity.status, text: "Activity started" }, true)
		return this.clone(activity)
	}

	setCancel(activityId: string, cancel: CancelActivity): void {
		if (this.activities.has(activityId)) this.cancellers.set(activityId, cancel)
	}

	isCancellable(activityId: string): boolean {
		const activity = this.activities.get(activityId)
		return activity?.status === "running" && this.cancellers.has(activityId)
	}

	update(
		activityId: string,
		patch: Partial<
			Pick<
				TaskActivityRecord,
				| "status"
				| "executionMode"
				| "cancellationOwner"
				| "title"
				| "detail"
				| "latestEvent"
				| "result"
				| "error"
				| "finishedAt"
			>
		> & { metrics?: Partial<TaskActivityMetrics> },
	): void {
		const activity = this.activities.get(activityId)
		if (!activity) return
		if (
			(activity.status === "cancelled" || activity.status === "interrupted") &&
			patch.status &&
			patch.status !== activity.status
		) {
			return
		}
		const previousStatus = activity.status
		const { metrics, ...activityPatch } = patch
		const sanitizedPatch = {
			...activityPatch,
			...(activityPatch.title === undefined ? {} : { title: redactSensitiveText(activityPatch.title) }),
			...(activityPatch.detail === undefined ? {} : { detail: redactSensitiveText(activityPatch.detail) }),
			...(activityPatch.latestEvent === undefined ? {} : { latestEvent: redactSensitiveText(activityPatch.latestEvent) }),
			...(activityPatch.result === undefined ? {} : { result: redactSensitiveText(activityPatch.result) }),
			...(activityPatch.error === undefined ? {} : { error: redactSensitiveText(activityPatch.error) }),
		}
		Object.assign(activity, sanitizedPatch, { updatedAt: Date.now() })
		if (metrics && activity.kind === "subagent") {
			activity.metrics = { ...activity.metrics, ...metrics }
			this.appendEvent(activityId, { kind: "metrics", metrics: { ...activity.metrics } }, false)
		}
		if (previousStatus !== activity.status) {
			this.appendEvent(activityId, { kind: "status", status: activity.status, text: activity.latestEvent }, false)
		}
		if (this.isTerminal(activity.status) && !activity.finishedAt) activity.finishedAt = activity.updatedAt
		if (this.isTerminal(activity.status)) this.cancellers.delete(activityId)
		const priority = previousStatus !== activity.status || this.isTerminal(activity.status)
		this.markDirty(activityId, priority)
	}

	appendOutput(activityId: string, text: string): void {
		if (!text) return
		const activity = this.activities.get(activityId)
		if (!activity) return
		const safeText = redactSensitiveText(text)
		const combined = `${activity.output ?? ""}${safeText}`
		activity.output = combined.length > MAX_OUTPUT_CHARS ? combined.slice(-MAX_OUTPUT_CHARS) : combined
		activity.updatedAt = Date.now()
		if (activity.kind === "command") {
			this.markDirty(activityId, false)
		} else {
			this.appendEvent(activityId, { kind: "output", text: safeText }, false)
		}
	}

	appendEvent(activityId: string, input: TaskActivityEventInput, priority = false): TaskActivityEvent | undefined {
		const activity = this.activities.get(activityId)
		if (!activity) return undefined
		const event = this.createEvent(input)
		activity.events.push(event)
		if (activity.events.length > MAX_EVENTS_PER_ACTIVITY) {
			activity.events.splice(0, activity.events.length - MAX_EVENTS_PER_ACTIVITY)
		}
		activity.updatedAt = event.timestamp
		this.markDirty(activityId, priority)
		return event
	}

	get(activityId: string): TaskActivityRecord | undefined {
		const activity = this.activities.get(activityId)
		return activity ? this.clone(activity) : undefined
	}

	list(): TaskActivityRecord[] {
		return Array.from(this.activities.values())
			.map((activity) => this.clone(activity))
			.sort((a, b) => b.createdAt - a.createdAt || a.activityId.localeCompare(b.activityId))
	}

	listRunning(cancellationOwner?: TaskActivityCancellationOwner): TaskActivityRecord[] {
		return this.list().filter(
			(activity) =>
				activity.status === "running" && (!cancellationOwner || activity.cancellationOwner === cancellationOwner),
		)
	}

	subscribe(listener: ActivityListener): () => void {
		this.listeners.set(listener, Promise.resolve())
		void this.hydrate().then(() => {
			if (this.listeners.has(listener)) {
				this.enqueue(listener, { sequence: ++this.sequence, snapshot: true, activities: this.list() })
			}
		})
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

	async waitForPersistence(): Promise<void> {
		this.flush()
		await this.persistenceSequence
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
		const activities = Array.from(this.dirtyIds)
			.map((id) => this.get(id))
			.filter((activity): activity is TaskActivityRecord => Boolean(activity))
		this.dirtyIds.clear()
		this.persist()
		if (this.listeners.size === 0) return
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

	private createEvent(input: TaskActivityEventInput): TaskActivityEvent {
		return this.redactEvent({
			...input,
			sequence: ++this.sequence,
			timestamp: Date.now(),
		} as TaskActivityEvent)
	}

	private clone(activity: TaskActivityRecord): TaskActivityRecord {
		return {
			...activity,
			title: redactSensitiveText(activity.title),
			detail: activity.detail === undefined ? undefined : redactSensitiveText(activity.detail),
			latestEvent: activity.latestEvent === undefined ? undefined : redactSensitiveText(activity.latestEvent),
			output: activity.output === undefined ? undefined : redactSensitiveText(activity.output),
			result: activity.result === undefined ? undefined : redactSensitiveText(activity.result),
			error: activity.error === undefined ? undefined : redactSensitiveText(activity.error),
			metrics: activity.metrics ? { ...activity.metrics } : undefined,
			events: activity.events.map((event) => this.redactEvent({ ...event })),
		}
	}

	private redactEvent(event: TaskActivityEvent): TaskActivityEvent {
		if ("text" in event && typeof event.text === "string") {
			event.text = redactSensitiveText(event.text)
			if (event.text.length > MAX_EVENT_TEXT_CHARS) event.text = event.text.slice(-MAX_EVENT_TEXT_CHARS)
		}
		if ("summary" in event && typeof event.summary === "string") event.summary = redactSensitiveText(event.summary)
		if ("error" in event && typeof event.error === "string") event.error = redactSensitiveText(event.error)
		return event
	}

	private persist(): void {
		const persistence = this.persistence
		if (!persistence) return
		this.persistenceSequence = this.persistenceSequence
			.catch(() => undefined)
			.then(() => this.hydrate())
			.then(() => persistence.save(this.list()))
			.catch((error) => Logger.warn("[TaskActivityStore] Failed to persist activity history", error))
	}

	private isTransient(status: TaskActivityStatus): boolean {
		return status === "awaiting_approval" || status === "running" || status === "cancelling"
	}

	private isTerminal(status: TaskActivityStatus): boolean {
		return (
			status === "completed" ||
			status === "failed" ||
			status === "timeout" ||
			status === "cancelled" ||
			status === "interrupted"
		)
	}
}
