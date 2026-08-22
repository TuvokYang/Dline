import type { ProfileSwitchSnapshot } from "@shared/profile-switch"
import { PlanActMode, ProfileSwitchResponse, ProfileSwitchStatus } from "@shared/proto/dline/state"
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { StateServiceClient } from "../../../services/grpc-client"
import { useProfileSwitch } from "./useProfileSwitch"

vi.mock("../../../services/grpc-client", () => ({
	StateServiceClient: {
		requestProfileSwitch: vi.fn(),
		confirmProfileSwitch: vi.fn(),
		cancelProfileSwitch: vi.fn(),
	},
}))

function response(status: ProfileSwitchStatus, operationId = "profile-operation-1", error?: string): ProfileSwitchResponse {
	return ProfileSwitchResponse.create({ status, operationId, error })
}

function snapshot(phase: ProfileSwitchSnapshot["phase"]): ProfileSwitchSnapshot {
	return {
		phase,
		operationId: "profile-operation-1",
		taskId: "task-1",
		activeMode: "act",
		targetModes: ["act"],
		sourceProfile: "large-profile",
		targetProfile: "small-profile",
		currentTokens: 92_000,
		targetContextWindow: 100_000,
		fittingExitTarget: 80_000,
	}
}

describe("useProfileSwitch", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(StateServiceClient.requestProfileSwitch).mockResolvedValue(
			response(ProfileSwitchStatus.PROFILE_SWITCH_STATUS_CONFIRMATION_REQUIRED),
		)
		vi.mocked(StateServiceClient.confirmProfileSwitch).mockResolvedValue(
			response(ProfileSwitchStatus.PROFILE_SWITCH_STATUS_SWITCHED),
		)
		vi.mocked(StateServiceClient.cancelProfileSwitch).mockResolvedValue(
			response(ProfileSwitchStatus.PROFILE_SWITCH_STATUS_REJECTED),
		)
	})

	it("requests an active-task Profile transition without optimistically adopting the target", async () => {
		const { result } = renderHook(() =>
			useProfileSwitch({
				stateRevision: 1,
				profileSwitch: { phase: "idle" },
			}),
		)

		await act(async () => result.current.requestSwitch("small-profile", ["act"]))

		expect(StateServiceClient.requestProfileSwitch).toHaveBeenCalledWith(
			expect.objectContaining({
				targetProfile: "small-profile",
				targetModes: [PlanActMode.ACT],
			}),
		)
		expect(result.current.isSwitchPending).toBe(true)
	})

	it("describes target-Profile compaction and keeps the transaction pending", () => {
		const { result } = renderHook(() =>
			useProfileSwitch({
				stateRevision: 2,
				profileSwitch: snapshot("compacting"),
			}),
		)

		expect(result.current.isSwitchPending).toBe(true)
		expect(result.current.statusText).toBe("Compacting with small-profile...")
	})

	it("keeps terminal compaction failure out of the persistent Profile selector status", async () => {
		const { result } = renderHook(() =>
			useProfileSwitch({
				stateRevision: 2,
				profileSwitch: { ...snapshot("failed"), error: "Compaction failed." },
			}),
		)

		await waitFor(() => expect(result.current.isSwitchPending).toBe(false))
		expect(result.current.statusText).toBeUndefined()
		expect(result.current.error).toBe("Compaction failed.")
	})

	it("releases local pending after a confirmed Profile switch succeeds", async () => {
		const { result } = renderHook(() => useProfileSwitch({ stateRevision: 1, profileSwitch: { phase: "idle" } }))

		await act(async () => result.current.requestSwitch("small-profile", ["act"]))
		await act(async () => result.current.confirmSwitch("profile-operation-1"))

		await waitFor(() => expect(result.current.isSwitchPending).toBe(false))
	})

	it("confirms and cancels by immutable operation identity", async () => {
		const { result } = renderHook(() =>
			useProfileSwitch({
				stateRevision: 2,
				profileSwitch: snapshot("awaiting_confirmation"),
			}),
		)

		await act(async () => result.current.confirmSwitch("profile-operation-1"))
		await act(async () => result.current.cancelSwitch("profile-operation-1"))

		expect(StateServiceClient.confirmProfileSwitch).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "profile-operation-1" }),
		)
		expect(StateServiceClient.cancelProfileSwitch).toHaveBeenCalledWith(
			expect.objectContaining({ operationId: "profile-operation-1" }),
		)
	})
})
