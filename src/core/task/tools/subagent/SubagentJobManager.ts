import type { SubagentExecResult } from "./SubagentExecutor"

export type SubagentJobStatus = "running" | "completed" | "failed" | "timeout" | "cancelled"
export type SubagentInjectionState = "pending" | "injected" | "consumed"
export type SubagentJobRunner = () => Promise<SubagentExecResult>

export type SubagentJobListener = (job: SubagentJobRecord, batch?: SubagentBatchRecord) => void | Promise<void>

export interface StartSubagentJobInput {
	subagentName?: string
	task: string
	prompt: string
	timeoutSeconds: number
	runner: SubagentJobRunner
	onStatusChange?: SubagentJobListener
}

export interface StartSubagentBatchItemInput {
	subagentName?: string
	task: string
	prompt: string
	runner: SubagentJobRunner
}

export interface StartSubagentBatchInput {
	timeoutSeconds: number
	items: StartSubagentBatchItemInput[]
	onStatusChange?: SubagentJobListener
	onCreated?: (batch: SubagentBatchRecord) => void
}

export interface SubagentJobRecord {
	jobId: string
	batchJobId?: string
	subagentName?: string
	task: string
	prompt: string
	status: SubagentJobStatus
	startedAt: number
	finishedAt?: number
	timeoutSeconds: number
	result?: string
	error?: string
	stats?: SubagentExecResult["stats"]
	injectionState: SubagentInjectionState
}

export interface SubagentBatchRecord {
	batchJobId: string
	status: SubagentJobStatus
	startedAt: number
	finishedAt?: number
	timeoutSeconds: number
	itemJobIds: string[]
	injectionState: SubagentInjectionState
}

export type SubagentInjectableResult =
	| { kind: "single"; job: SubagentJobRecord }
	| { kind: "batch"; batch: SubagentBatchRecord; jobs: SubagentJobRecord[] }

/** Manage task-local background subagent jobs and batches. */
export class SubagentJobManager {
	private jobs = new Map<string, SubagentJobRecord>()
	private batches = new Map<string, SubagentBatchRecord>()
	private nextJobNumber = 1
	private nextBatchNumber = 1

	/**
	 * Start one background subagent job.
	 * @param input Job metadata and runner callback.
	 * @returns Created running job record.
	 */
	startJob(input: StartSubagentJobInput): SubagentJobRecord {
		const job = this.createJob(input)
		void this.runJob(job.jobId, input.runner, undefined, input.onStatusChange)
		return job
	}

	/**
	 * Start a background batch with one job per item.
	 * @param input Batch metadata and item runners.
	 * @returns Created running batch record.
	 */
	startBatch(input: StartSubagentBatchInput): SubagentBatchRecord {
		const batchJobId = this.nextBatchId()
		const itemJobIds: string[] = []
		const batch: SubagentBatchRecord = {
			batchJobId,
			status: "running",
			startedAt: Date.now(),
			timeoutSeconds: input.timeoutSeconds,
			itemJobIds,
			injectionState: "pending",
		}
		this.batches.set(batchJobId, batch)
		const runners: Array<{ jobId: string; runner: SubagentJobRunner }> = []
		for (const item of input.items) {
			const job = this.createJob({ ...item, timeoutSeconds: input.timeoutSeconds }, batchJobId)
			batch.itemJobIds.push(job.jobId)
			runners.push({ jobId: job.jobId, runner: item.runner })
		}
		input.onCreated?.({ ...batch, itemJobIds: [...batch.itemJobIds] })
		for (const item of runners) {
			void this.runJob(item.jobId, item.runner, batchJobId, input.onStatusChange)
		}
		return { ...batch, itemJobIds: [...batch.itemJobIds] }
	}

	/**
	 * Get one job record by id.
	 * @param jobId Job id to read.
	 * @returns Job record copy, or undefined.
	 */
	getJob(jobId: string): SubagentJobRecord | undefined {
		const job = this.jobs.get(jobId)
		return job ? { ...job } : undefined
	}

	/**
	 * Get one batch record by id.
	 * @param batchJobId Batch id to read.
	 * @returns Batch record copy, or undefined.
	 */
	getBatch(batchJobId: string): SubagentBatchRecord | undefined {
		const batch = this.batches.get(batchJobId)
		return batch ? { ...batch, itemJobIds: [...batch.itemJobIds] } : undefined
	}

	/**
	 * List all tracked jobs.
	 * @returns Job record copies.
	 */
	listJobs(): SubagentJobRecord[] {
		return Array.from(this.jobs.values()).map((job) => ({ ...job }))
	}

	/**
	 * List all tracked batches.
	 * @returns Batch record copies.
	 */
	listBatches(): SubagentBatchRecord[] {
		return Array.from(this.batches.values()).map((batch) => ({ ...batch, itemJobIds: [...batch.itemJobIds] }))
	}

	/**
	 * List completed jobs that have not been injected into model context.
	 * @returns Job records pending result injection.
	 */
	listInjectableJobs(): SubagentJobRecord[] {
		return this.listJobs().filter((job) => job.status !== "running" && job.injectionState === "pending")
	}

	/**
	 * List completed single jobs and batches that are ready for model context injection.
	 * @returns Batch-aware injectable result records.
	 */
	listInjectableResults(): SubagentInjectableResult[] {
		const results: SubagentInjectableResult[] = []
		const batchedJobIds = new Set<string>()
		for (const batch of this.listBatches()) {
			if (batch.status === "running" || batch.injectionState !== "pending") continue
			const jobs = batch.itemJobIds.map((jobId) => this.getJob(jobId)).filter((job): job is SubagentJobRecord => !!job)
			if (jobs.length === 0) continue
			jobs.forEach((job) => batchedJobIds.add(job.jobId))
			results.push({ kind: "batch", batch, jobs })
		}
		for (const job of this.listInjectableJobs()) {
			if (job.batchJobId || batchedJobIds.has(job.jobId)) continue
			results.push({ kind: "single", job })
		}
		return results
	}

	/**
	 * Mark jobs and batches as injected.
	 * @param ids Job or batch identifiers.
	 */
	markInjected(ids: string[]): void {
		this.markInjectionState(ids, "injected")
	}

	/**
	 * Mark jobs and batches as consumed.
	 * @param ids Job or batch identifiers.
	 */
	markConsumed(ids: string[]): void {
		this.markInjectionState(ids, "consumed")
	}

	/**
	 * Create a job record without waiting for the runner.
	 * @param input Job metadata.
	 * @param batchJobId Optional parent batch id.
	 * @returns Created running job record.
	 */
	private createJob(input: StartSubagentJobInput, batchJobId?: string): SubagentJobRecord {
		const job: SubagentJobRecord = {
			jobId: this.nextJobId(),
			batchJobId,
			subagentName: input.subagentName,
			task: input.task,
			prompt: input.prompt,
			status: "running",
			startedAt: Date.now(),
			timeoutSeconds: input.timeoutSeconds,
			injectionState: "pending",
		}
		this.jobs.set(job.jobId, job)
		return { ...job }
	}

	/**
	 * Run a job and persist its final status.
	 * @param jobId Job id to update.
	 * @param runner Runner callback.
	 * @param batchJobId Optional parent batch id.
	 */
	private async runJob(
		jobId: string,
		runner: SubagentJobRunner,
		batchJobId?: string,
		onStatusChange?: SubagentJobListener,
	): Promise<void> {
		try {
			this.finishJob(jobId, await runner())
		} catch (error) {
			this.failJob(jobId, error)
		} finally {
			if (batchJobId) this.refreshBatch(batchJobId)
			const job = this.jobs.get(jobId)
			const batch = batchJobId ? this.batches.get(batchJobId) : undefined
			if (job && onStatusChange)
				void onStatusChange({ ...job }, batch ? { ...batch, itemJobIds: [...batch.itemJobIds] } : undefined)
		}
	}

	/**
	 * Persist a completed job result.
	 * @param jobId Job id to update.
	 * @param result Runner result.
	 */
	private finishJob(jobId: string, result: SubagentExecResult): void {
		const job = this.jobs.get(jobId)
		if (!job) return
		job.status = result.status === "completed" ? "completed" : result.status === "timeout" ? "timeout" : "failed"
		job.finishedAt = Date.now()
		job.result = result.result
		job.error = result.error
		job.stats = result.stats
	}

	/**
	 * Persist a failed job result.
	 * @param jobId Job id to update.
	 * @param error Unknown runner error.
	 */
	private failJob(jobId: string, error: unknown): void {
		const job = this.jobs.get(jobId)
		if (!job) return
		job.status = "failed"
		job.finishedAt = Date.now()
		job.error = error instanceof Error ? error.message : String(error)
	}

	/**
	 * Refresh aggregate batch status from item jobs.
	 * @param batchJobId Batch id to update.
	 */
	private refreshBatch(batchJobId: string): void {
		const batch = this.batches.get(batchJobId)
		if (!batch) return
		const jobs = batch.itemJobIds.map((jobId) => this.jobs.get(jobId)).filter((job): job is SubagentJobRecord => !!job)
		if (jobs.some((job) => job.status === "running")) {
			batch.status = "running"
			return
		}
		batch.finishedAt = Date.now()
		if (jobs.some((job) => job.status === "timeout")) batch.status = "timeout"
		else if (jobs.some((job) => job.status === "failed")) batch.status = "failed"
		else batch.status = "completed"
	}

	/**
	 * Mark injection state for jobs and batches.
	 * @param ids Job or batch identifiers.
	 * @param state Injection state to apply.
	 */
	private markInjectionState(ids: string[], state: SubagentInjectionState): void {
		for (const id of ids) {
			const job = this.jobs.get(id)
			if (job) {
				this.moveJobState(job, state)
				if (job.batchJobId) this.refreshBatchState(job.batchJobId)
			}
			const batch = this.batches.get(id)
			if (batch) this.moveBatchState(batch, state)
		}
	}

	/**
	 * Move a single job injection state when the transition is valid.
	 * @param job Job record to update.
	 * @param state Requested injection state.
	 */
	private moveJobState(job: SubagentJobRecord, state: SubagentInjectionState): void {
		if (this.canMoveState(job.injectionState, state)) job.injectionState = state
	}

	/**
	 * Move a batch and all item jobs when the transition is valid.
	 * @param batch Batch record to update.
	 * @param state Requested injection state.
	 */
	private moveBatchState(batch: SubagentBatchRecord, state: SubagentInjectionState): void {
		if (!this.canMoveState(batch.injectionState, state)) return
		batch.injectionState = state
		for (const jobId of batch.itemJobIds) {
			const job = this.jobs.get(jobId)
			if (job) this.moveJobState(job, state)
		}
	}

	/**
	 * Refresh a batch injection state from all item jobs.
	 * @param batchJobId Batch id to update.
	 */
	private refreshBatchState(batchJobId: string): void {
		const batch = this.batches.get(batchJobId)
		if (!batch) return
		const jobs = batch.itemJobIds.map((jobId) => this.jobs.get(jobId)).filter((job): job is SubagentJobRecord => !!job)
		if (jobs.length === 0) return
		if (jobs.every((job) => job.injectionState === "consumed") && this.canMoveState(batch.injectionState, "consumed")) {
			batch.injectionState = "consumed"
			return
		}
		if (jobs.every((job) => job.injectionState !== "pending") && this.canMoveState(batch.injectionState, "injected")) {
			batch.injectionState = "injected"
		}
	}

	/**
	 * Check whether an injection state transition is valid.
	 * @param current Current injection state.
	 * @param next Requested injection state.
	 * @returns True when the transition keeps the state moving forward.
	 */
	private canMoveState(current: SubagentInjectionState, next: SubagentInjectionState): boolean {
		const order: Record<SubagentInjectionState, number> = { pending: 0, injected: 1, consumed: 2 }
		return order[next] === order[current] + 1
	}

	/** Build a stable job id. */
	private nextJobId(): string {
		return `subagent_${this.nextJobNumber++}`
	}

	/** Build a stable batch id. */
	private nextBatchId(): string {
		return `subagent_batch_${this.nextBatchNumber++}`
	}
}
