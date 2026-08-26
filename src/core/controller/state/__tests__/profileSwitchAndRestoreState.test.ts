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

	it("rejects the deprecated compact-specific Restore RPC without invoking Task state", async () => {
		const controller = Object.create(Controller.prototype) as Controller
		const response = await restoreContextCompaction(
			controller,
			ContextCompactionRestoreRequest.create({
				operationId: "operation-1",
				target: ContextCompactionRestoreTarget.CONTEXT_COMPACTION_RESTORE_TARGET_PREVIOUS,
				expectedHeadCheckpointId: "checkpoint-2",
				expectedChainRevision: 3,
			}),
		)

		expect(response.status).toBe(ContextCompactionRestoreStatus.CONTEXT_COMPACTION_RESTORE_STATUS_REJECTED)
		expect(response.operationId).toBe("operation-1")
		expect(response.error).toContain("deprecated")
	})
})
