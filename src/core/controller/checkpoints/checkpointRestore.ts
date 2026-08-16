import { CheckpointRestoreRequest } from "@shared/proto/dline/checkpoints"
import { Empty } from "@shared/proto/dline/common"
import pWaitFor from "p-wait-for"
import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/dline/host"
import { Logger } from "@/shared/services/Logger"
import { ClineCheckpointRestore } from "../../../shared/WebviewMessage"
import { Controller } from ".."

export async function checkpointRestore(controller: Controller, request: CheckpointRestoreRequest): Promise<Empty> {
	const { compactionOperationId, compactionCheckpointId, compactionExpectedHeadCheckpointId, compactionExpectedChainRevision } =
		request
	if (
		compactionOperationId !== undefined &&
		compactionCheckpointId !== undefined &&
		compactionExpectedHeadCheckpointId !== undefined &&
		compactionExpectedChainRevision !== undefined
	) {
		await controller.task?.restoreContextCompactionCheckpoint(
			compactionOperationId,
			compactionCheckpointId,
			compactionExpectedHeadCheckpointId,
			compactionExpectedChainRevision,
		)
		return Empty.create({})
	}
	if (request.number) {
		// wait for messages to be loaded
		await pWaitFor(() => controller.task?.taskState.isInitialized === true, {
			timeout: 3_000,
		}).catch((error) => {
			Logger.log("Failed to init new Dline instance to restore checkpoint", error)
			HostProvider.window.showMessage({
				type: ShowMessageType.ERROR,
				message: "Failed to restore checkpoint",
			})
			throw error
		})

		// File-only restore must not alter the active conversation runtime.
		// Chat restore owns stream termination because it rewinds persisted conversation state.
		if (request.restoreType !== "workspace") {
			try {
				await controller.task?.interrupt()
			} catch (error) {
				Logger.error("[checkpointRestore] interrupt failed (non-fatal):", error)
			}
		}

		await controller.task?.checkpointManager?.restoreCheckpoint(
			request.number,
			request.restoreType as ClineCheckpointRestore,
			request.offset,
			request.editedText || undefined,
		)
	}
	return Empty.create({})
}
