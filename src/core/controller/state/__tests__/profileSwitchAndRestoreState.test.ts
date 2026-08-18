import {
	ContextCompactionRestoreRequest,
	ContextCompactionRestoreStatus,
	ContextCompactionRestoreTarget,
	PlanActMode,
	ProfileSwitchRequest,
	ProfileSwitchStatus,
} from "@shared/proto/dline/state"
import { describe, expect, it, vi } from "vitest"
import { Controller } from "../.."
import { requestProfileSwitch } from "../requestProfileSwitch"
import { restoreContextCompaction } from "../restoreContextCompaction"

describe("Profile switch and context restore StateService handlers", () => {
	it("maps ordered target modes into the task-local Profile transaction", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		const request = vi.spyOn(controller, "requestProfileSwitch").mockResolvedValue({
			status: "confirmation_required",
			operationId: "profile-operation-1",
		})

		const response = await requestProfileSwitch(
			controller,
			ProfileSwitchRequest.create({
				targetProfile: "small-profile",
				targetModes: [PlanActMode.PLAN, PlanActMode.ACT],
			}),
		)

		expect(request).toHaveBeenCalledWith("small-profile", ["plan", "act"], undefined)
		expect(response.status).toBe(ProfileSwitchStatus.PROFILE_SWITCH_STATUS_CONFIRMATION_REQUIRED)
		expect(response.operationId).toBe("profile-operation-1")
	})

	it("maps previous restore with the immutable checkpoint CAS identity", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		const restore = vi.spyOn(controller, "restoreContextCompaction").mockResolvedValue({
			operationId: "operation-1",
			checkpointId: "checkpoint-1",
			head: {
				schemaVersion: 1,
				operationId: "operation-1",
				rootCheckpointId: "checkpoint-0",
				headCheckpointId: "checkpoint-1",
				chainRevision: 4,
				branchId: "branch-restore",
				sequence: 2,
				depth: 1,
			},
			phase: "completed",
			fittingState: {} as never,
		})

		const response = await restoreContextCompaction(
			controller,
			ContextCompactionRestoreRequest.create({
				operationId: "operation-1",
				target: ContextCompactionRestoreTarget.CONTEXT_COMPACTION_RESTORE_TARGET_PREVIOUS,
				expectedHeadCheckpointId: "checkpoint-2",
				expectedChainRevision: 3,
			}),
		)

		expect(restore).toHaveBeenCalledWith("previous", "operation-1", "checkpoint-2", 3)
		expect(response.status).toBe(ContextCompactionRestoreStatus.CONTEXT_COMPACTION_RESTORE_STATUS_RESTORED)
		expect(response.headCheckpointId).toBe("checkpoint-1")
		expect(response.chainRevision).toBe(4)
	})

	it("returns stale CAS failures as rejected responses", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		vi.spyOn(controller, "restoreContextCompaction").mockRejectedValue(
			new Error("Compaction checkpoint head or revision is stale."),
		)

		const response = await restoreContextCompaction(
			controller,
			ContextCompactionRestoreRequest.create({
				operationId: "operation-1",
				target: ContextCompactionRestoreTarget.CONTEXT_COMPACTION_RESTORE_TARGET_INITIAL,
				expectedHeadCheckpointId: "stale-head",
				expectedChainRevision: 1,
			}),
		)

		expect(response.status).toBe(ContextCompactionRestoreStatus.CONTEXT_COMPACTION_RESTORE_STATUS_REJECTED)
		expect(response.error).toContain("head or revision is stale")
	})
})
