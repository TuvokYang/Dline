import type { ModeSwitchSnapshot } from "@shared/mode-switch"
import { ModeSwitchResponse, ModeSwitchStatus } from "@shared/proto/dline/state"
import type { Mode } from "@shared/storage/types"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { StateServiceClient } from "@/services/grpc-client"
import { type ModeSwitchDraft, useModeSwitch } from "./useModeSwitch"

vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		togglePlanActModeProto: vi.fn(),
		confirmModeSwitch: vi.fn(),
		cancelModeSwitch: vi.fn(),
	},
}))

interface HookProps {
	mode: Mode
	stateRevision: number
	modeSwitch?: ModeSwitchSnapshot
	attachDraft: boolean
}

const DRAFT: ModeSwitchDraft = {
	text: "draft text",
	images: ["image-data"],
	files: ["file-path"],
}

/** Create a transaction snapshot for one operation and phase. */
function createSnapshot(phase: ModeSwitchSnapshot["phase"], operationId = "operation-1"): ModeSwitchSnapshot {
	return {
		phase,
		operationId,
		sourceMode: "plan",
		targetMode: "act",
	}
}

/** Create a typed mode-switch RPC response fixture. */
function createResponse(status: ModeSwitchStatus, operationId = "operation-1", error?: string): ModeSwitchResponse {
	return ModeSwitchResponse.create({ status, operationId, error })
}

/** Verify draft ownership and transaction completion semantics without timeout fallbacks. */
describe("useModeSwitch", () => {
	const onSend = vi.fn<(draft: ModeSwitchDraft) => void>()
	const clearDraft = vi.fn<() => void>()

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(StateServiceClient.togglePlanActModeProto).mockResolvedValue(
			createResponse(ModeSwitchStatus.MODE_SWITCH_STATUS_CONFIRMATION_REQUIRED),
		)
		vi.mocked(StateServiceClient.confirmModeSwitch).mockResolvedValue(
			createResponse(ModeSwitchStatus.MODE_SWITCH_STATUS_SWITCHED),
		)
		vi.mocked(StateServiceClient.cancelModeSwitch).mockResolvedValue(
			createResponse(ModeSwitchStatus.MODE_SWITCH_STATUS_REJECTED),
		)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	/** Preserve a backend-owned draft while user confirmation is pending. */
	it("does not clear draft when confirmation is required", async () => {
		const { result } = renderHook(
			(props: HookProps) =>
				useModeSwitch({
					...props,
					draft: DRAFT,
					onSend,
					clearDraft,
				}),
			{
				initialProps: { mode: "plan", stateRevision: 1, modeSwitch: { phase: "idle" }, attachDraft: true },
			},
		)

		await act(async () => result.current.requestSwitch("act"))

		expect(result.current.isSwitchPending).toBe(true)
		expect(clearDraft).not.toHaveBeenCalled()
		expect(onSend).not.toHaveBeenCalled()
		expect(StateServiceClient.togglePlanActModeProto).toHaveBeenCalledWith(
			expect.objectContaining({ chatContent: { message: "draft text", images: ["image-data"], files: ["file-path"] } }),
		)
	})

	/** Keep the externally supplied source mode while backend compaction is active. */
	it("keeps source mode while compacting", () => {
		const { result } = renderHook(() =>
			useModeSwitch({
				mode: "plan",
				stateRevision: 2,
				modeSwitch: createSnapshot("compacting"),
				draft: DRAFT,
				attachDraft: false,
				onSend,
				clearDraft,
			}),
		)

		expect(result.current.displayMode).toBe("plan")
		expect(result.current.isSwitchPending).toBe(true)
		expect(result.current.statusText).toBe("Compacting...")
	})

	/** Never release a compacting transaction because an arbitrary duration elapsed. */
	it("disables re-entry without any timeout", async () => {
		vi.useFakeTimers()
		const { result } = renderHook(() =>
			useModeSwitch({
				mode: "plan",
				stateRevision: 2,
				modeSwitch: createSnapshot("compacting"),
				draft: DRAFT,
				attachDraft: false,
				onSend,
				clearDraft,
			}),
		)

		await act(async () => vi.advanceTimersByTimeAsync(10_000))

		expect(result.current.isSwitchPending).toBe(true)
	})

	/** Send a frontend-owned draft exactly once after a newer committed state arrives. */
	it("submits text images and files once after switched", async () => {
		const { result, rerender } = renderHook(
			(props: HookProps) =>
				useModeSwitch({
					...props,
					draft: DRAFT,
					onSend,
					clearDraft,
				}),
			{
				initialProps: { mode: "plan", stateRevision: 1, modeSwitch: { phase: "idle" }, attachDraft: false },
			},
		)

		await act(async () => result.current.requestSwitch("act"))
		rerender({ mode: "plan", stateRevision: 2, modeSwitch: createSnapshot("compacting"), attachDraft: false })
		rerender({ mode: "act", stateRevision: 3, modeSwitch: { phase: "idle" }, attachDraft: false })

		await waitFor(() => expect(onSend).toHaveBeenCalledWith(DRAFT))
		rerender({ mode: "act", stateRevision: 4, modeSwitch: { phase: "idle" }, attachDraft: false })
		expect(onSend).toHaveBeenCalledTimes(1)
		expect(clearDraft).not.toHaveBeenCalled()
	})

	/** Cancel only transaction metadata and preserve all input fields. */
	it("preserves draft after cancel", async () => {
		const { result } = renderHook(() =>
			useModeSwitch({
				mode: "plan",
				stateRevision: 2,
				modeSwitch: createSnapshot("awaiting_confirmation"),
				draft: DRAFT,
				attachDraft: true,
				onSend,
				clearDraft,
			}),
		)

		await act(async () => result.current.cancelSwitch("operation-1"))

		expect(clearDraft).not.toHaveBeenCalled()
		expect(onSend).not.toHaveBeenCalled()
		expect(StateServiceClient.cancelModeSwitch).toHaveBeenCalledTimes(1)
	})

	/** Preserve draft content when backend compaction enters a failed terminal state. */
	it("preserves draft after compact failure", async () => {
		const { result, rerender } = renderHook(
			(props: HookProps) => useModeSwitch({ ...props, draft: DRAFT, onSend, clearDraft }),
			{
				initialProps: { mode: "plan", stateRevision: 1, modeSwitch: { phase: "idle" }, attachDraft: true },
			},
		)
		await act(async () => result.current.requestSwitch("act"))

		rerender({
			mode: "plan",
			stateRevision: 2,
			modeSwitch: { ...createSnapshot("failed"), error: "Compaction failed." },
			attachDraft: true,
		})

		await waitFor(() => expect(result.current.isSwitchPending).toBe(false))
		expect(clearDraft).not.toHaveBeenCalled()
		expect(onSend).not.toHaveBeenCalled()
	})

	/** Ignore a terminal snapshot that belongs to a different operation identity. */
	it("ignores stale operation snapshots", async () => {
		const { result, rerender } = renderHook(
			(props: HookProps) => useModeSwitch({ ...props, draft: DRAFT, onSend, clearDraft }),
			{
				initialProps: { mode: "plan", stateRevision: 1, modeSwitch: { phase: "idle" }, attachDraft: false },
			},
		)
		await act(async () => result.current.requestSwitch("act"))

		rerender({
			mode: "plan",
			stateRevision: 2,
			modeSwitch: { ...createSnapshot("failed", "stale-operation"), error: "Stale failure." },
			attachDraft: false,
		})

		expect(result.current.isSwitchPending).toBe(true)
		expect(onSend).not.toHaveBeenCalled()
	})
})
