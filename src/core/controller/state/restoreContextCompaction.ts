import {
	ContextCompactionRestoreRequest,
	ContextCompactionRestoreResponse,
	ContextCompactionRestoreStatus,
} from "@shared/proto/dline/state"
import { Controller } from ".."

/** @deprecated Compact-specific Restore is disabled; current cards use ordinary Restore Chat. */
export async function restoreContextCompaction(
	_controller: Controller,
	request: ContextCompactionRestoreRequest,
): Promise<ContextCompactionRestoreResponse> {
	return ContextCompactionRestoreResponse.create({
		status: ContextCompactionRestoreStatus.CONTEXT_COMPACTION_RESTORE_STATUS_REJECTED,
		operationId: request.operationId,
		error: "Context compaction Restore is deprecated. Use Restore Chat on a current compaction card.",
	})
}
