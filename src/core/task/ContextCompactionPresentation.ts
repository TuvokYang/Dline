import type { CompactionCheckpointHead } from "@core/context/context-management/compaction-checkpoint-chain"
import type { InternalCompactionAttemptIdentity } from "@core/context/context-management/internal-compaction-pass"
import {
	areCompactionPassIdentitiesEqual,
	type CompactionPassIdentity,
} from "@core/context/context-management/target-window-fitting"

export type ContextCompactionAttemptIdentity = InternalCompactionAttemptIdentity

export interface ContextCompactionPresentationSnapshot {
	passIdentity: CompactionPassIdentity
	attempt: ContextCompactionAttemptIdentity
	existingTs?: number
	content: string
	status: "running" | "retrying" | "failed" | "completed"
	error?: string
	prePassCheckpoint?: CompactionCheckpointHead
	postPassCheckpoint?: CompactionCheckpointHead
	retryAttempt?: number
	maxRetryAttempts?: number
}

/** Own stable per-Pass card identity and reject stale attempt events. */
export class ContextCompactionPresentation {
	private active?: ContextCompactionPresentationSnapshot

	startPass(passIdentity: CompactionPassIdentity, attempt: ContextCompactionAttemptIdentity): boolean {
		if (this.active) {
			if (areCompactionPassIdentitiesEqual(this.active.passIdentity, passIdentity)) return false
			if (
				this.active.passIdentity.operationId !== passIdentity.operationId ||
				this.active.status !== "completed" ||
				passIdentity.passIndex <= this.active.passIdentity.passIndex
			) {
				return false
			}
		}
		this.active = {
			passIdentity: { ...passIdentity },
			attempt: { ...attempt },
			existingTs: undefined,
			content: "",
			status: "running",
		}
		return true
	}

	partial(
		passIdentity: CompactionPassIdentity,
		attempt: ContextCompactionAttemptIdentity,
		content: string,
	): ContextCompactionPresentationSnapshot | undefined {
		if (!content.trim() || !this.isCurrent(passIdentity, attempt) || this.isTerminal()) return undefined
		this.active = {
			...this.active,
			content,
			status: "running",
			error: undefined,
			retryAttempt: undefined,
			maxRetryAttempts: undefined,
		} as ContextCompactionPresentationSnapshot
		return this.snapshot()
	}

	retry(
		passIdentity: CompactionPassIdentity,
		failedAttempt: ContextCompactionAttemptIdentity,
		nextAttempt: ContextCompactionAttemptIdentity,
		retryAttempt?: number,
		maxRetryAttempts?: number,
		error?: string,
	): ContextCompactionPresentationSnapshot | undefined {
		if (
			!this.isCurrent(passIdentity, failedAttempt) ||
			this.isTerminal() ||
			nextAttempt.attemptIndex !== failedAttempt.attemptIndex + 1 ||
			!nextAttempt.authorizationAttemptId
		) {
			return undefined
		}
		this.active = {
			...this.active,
			attempt: { ...nextAttempt },
			status: "retrying",
			error,
			retryAttempt,
			maxRetryAttempts,
		} as ContextCompactionPresentationSnapshot
		return this.snapshot()
	}

	complete(
		passIdentity: CompactionPassIdentity,
		attempt: ContextCompactionAttemptIdentity,
		content: string,
		checkpoints?: { prePass: CompactionCheckpointHead; postPass: CompactionCheckpointHead },
	): ContextCompactionPresentationSnapshot | undefined {
		if (!content.trim() || !this.isCurrent(passIdentity, attempt) || this.isTerminal()) return undefined
		this.active = {
			...this.active,
			content,
			status: "completed",
			error: undefined,
			prePassCheckpoint: checkpoints?.prePass ? { ...checkpoints.prePass } : undefined,
			postPassCheckpoint: checkpoints?.postPass ? { ...checkpoints.postPass } : undefined,
			retryAttempt: undefined,
			maxRetryAttempts: undefined,
		} as ContextCompactionPresentationSnapshot
		return this.snapshot()
	}

	fail(operationId: string): ContextCompactionPresentationSnapshot | undefined {
		if (!this.active || this.active.passIdentity.operationId !== operationId || this.active.status === "completed")
			return undefined
		this.active = {
			...this.active,
			existingTs: undefined,
			content: "",
			status: "failed",
			error: undefined,
			retryAttempt: undefined,
			maxRetryAttempts: undefined,
		}
		return this.snapshot()
	}

	bindMessageTs(passIdentity: CompactionPassIdentity, ts: number): boolean {
		if (!this.active || !areCompactionPassIdentitiesEqual(this.active.passIdentity, passIdentity)) return false
		if (this.active.existingTs !== undefined && this.active.existingTs !== ts) return false
		this.active = { ...this.active, existingTs: ts }
		return true
	}

	clear(operationId: string): void {
		if (this.active?.passIdentity.operationId === operationId) this.active = undefined
	}

	getSnapshot(): ContextCompactionPresentationSnapshot | undefined {
		return this.snapshot()
	}

	private isCurrent(passIdentity: CompactionPassIdentity, attempt: ContextCompactionAttemptIdentity): boolean {
		return (
			this.active !== undefined &&
			areCompactionPassIdentitiesEqual(this.active.passIdentity, passIdentity) &&
			this.active.attempt.attemptIndex === attempt.attemptIndex &&
			this.active.attempt.authorizationAttemptId === attempt.authorizationAttemptId
		)
	}

	private isTerminal(): boolean {
		return this.active?.status === "completed" || this.active?.status === "failed"
	}

	private snapshot(): ContextCompactionPresentationSnapshot | undefined {
		return this.active
			? {
					...this.active,
					passIdentity: { ...this.active.passIdentity },
					attempt: { ...this.active.attempt },
					prePassCheckpoint: this.active.prePassCheckpoint ? { ...this.active.prePassCheckpoint } : undefined,
					postPassCheckpoint: this.active.postPassCheckpoint ? { ...this.active.postPassCheckpoint } : undefined,
				}
			: undefined
	}
}
