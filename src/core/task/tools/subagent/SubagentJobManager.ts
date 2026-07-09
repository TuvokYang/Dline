import type { SubagentExecResult } from "./SubagentExecutor"

export type SubagentJobStatus = "running" | "completed" | "failed" | "timeout" | "cancelled"
export type SubagentInjectionState = "pending" | "injected" | "consumed"
export type SubagentJobRunner = () => Promise<SubagentExecResult>

export interface StartSubagentJobInput {
	subagentName?: string
	task: string
	prompt: string
	timeoutSeconds: number
	runner: SubagentJobRunner
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
		void this.runJob(job.jobId, input.runner)
		return job
	}

	/**
	 * Start a background batch with one job per item.
	 * @param input Batch metadata and item runners.
	 * @returns Created running batch record.
	 */
	startBatch(input: StartSubagentBatchInput): SubagentBatchRecord {
		const batchJobId = this.nextBatchId()
		const itemJobIds = input.items.map((item) => {
			const job = this.createJob({ ...item, timeoutSeconds: input.timeoutSeconds }, batchJobId)
			void this.runJob(job.jobId, item.runner, batchJobId)
			return job.jobId
		})
		const batch: SubagentBatchRecord = {
			batchJobId,
			status: "running",
			startedAt: Date.now(),
			timeoutSeconds: input.timeoutSeconds,
			itemJobIds,
			injectionState: "pending",
		}
		this.batches.set(batchJobId, batch)
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
	private async runJob(jobId: string, runner: SubagentJobRunner, batchJobId?: string): Promise<void> {
		try {
			this.finishJob(jobId, await runner())
		} catch (error) {
			this.failJob(jobId, error)
		} finally {
			if (batchJobId) this.refreshBatch(batchJobId)
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

	/** Build a stable job id. */
	private nextJobId(): string {
		return `subagent_${this.nextJobNumber++}`
	}

	/** Build a stable batch id. */
	private nextBatchId(): string {
		return `subagent_batch_${this.nextBatchNumber++}`
	}
}
