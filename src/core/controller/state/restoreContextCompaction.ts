import {
	ContextCompactionRestoreRequest,
	ContextCompactionRestoreResponse,
	ContextCompactionRestoreStatus,
	ContextCompactionRestoreTarget,
} from "@shared/proto/dline/state"
import { Controller } from ".."

/** Restore canonical Task context through the durable compaction checkpoint chain. */
export async function restoreContextCompaction(
	controller: Controller,
	request: ContextCompactionRestoreRequest,
): Promise<ContextCompactionRestoreResponse> {
	try {
		const target =
			request.target === ContextCompactionRestoreTarget.CONTEXT_COMPACTION_RESTORE_TARGET_PREVIOUS
				? "previous"
				: request.target === ContextCompactionRestoreTarget.CONTEXT_COMPACTION_RESTORE_TARGET_INITIAL
					? "initial"
					: undefined
		if (!target) throw new Error(`Invalid context compaction restore target: ${request.target}`)
		const result = await controller.restoreContextCompaction(
			target,
			request.operationId,
			request.expectedHeadCheckpointId,
			request.expectedChainRevision,
		)
		return ContextCompactionRestoreResponse.create({
			status: ContextCompactionRestoreStatus.CONTEXT_COMPACTION_RESTORE_STATUS_RESTORED,
			operationId: result.operationId,
			checkpointId: result.checkpointId,
			headCheckpointId: result.head.headCheckpointId,
			chainRevision: result.head.chainRevision,
			branchId: result.head.branchId,
		})
	} catch (error) {
		return ContextCompactionRestoreResponse.create({
			status: ContextCompactionRestoreStatus.CONTEXT_COMPACTION_RESTORE_STATUS_REJECTED,
			operationId: request.operationId,
			error: error instanceof Error ? error.message : "Context compaction restore failed.",
		})
	}
}
