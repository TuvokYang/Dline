import { Task } from "@core/task"
import { describe, expect, it, vi } from "vitest"

/** Verify invalid Profile admission stops before approval or Provider lifecycle begins. */
describe("Task Profile admission", () => {
	it("reuses one manual Hosted Web approval until the auto-approval Settings version changes", async () => {
		let settingsVersion = 4
		const open = vi.fn(async () => ({ actionId: "approve" as const }))
		const releaseApiContinuationForRequestGate = vi.fn(async () => false)
		const admitApiRequest = vi.fn(async () => undefined)
		const fakeTask = {
			taskId: "task-1",
			taskState: { hostedWebApprovalLeaseVersion: undefined as number | undefined },
			validateApiProfileAdmission: vi.fn(async () => true),
			stateManager: {
				getGlobalSettingsKey: vi.fn(() => ({ version: settingsVersion, actions: { useWeb: false } })),
			},
			toolExecutor: { isAutoApproved: vi.fn(() => false) },
			interactionCoordinator: { releaseApiContinuationForRequestGate, open },
			admitApiRequest,
		}
		const completeApiRequestGate = Reflect.get(Task.prototype, "completeApiRequestGate") as (
			this: typeof fakeTask,
			requestScope: {
				webSearchRoutingPlan: { route: "hosted" }
				providerInfo: { providerId: string }
			},
			apiIndex: number,
		) => Promise<boolean>
		const requestScope = {
			webSearchRoutingPlan: { route: "hosted" as const },
			providerInfo: { providerId: "openai" },
		}

		await expect(completeApiRequestGate.call(fakeTask, requestScope, 4)).resolves.toBe(true)
		expect(open).toHaveBeenCalledTimes(1)
		expect(fakeTask.taskState.hostedWebApprovalLeaseVersion).toBe(4)

		await expect(completeApiRequestGate.call(fakeTask, requestScope, 5)).resolves.toBe(true)
		expect(open).toHaveBeenCalledTimes(1)
		expect(admitApiRequest).toHaveBeenCalledTimes(2)

		settingsVersion = 5
		await expect(completeApiRequestGate.call(fakeTask, requestScope, 6)).resolves.toBe(true)
		expect(open).toHaveBeenCalledTimes(2)
		expect(fakeTask.taskState.hostedWebApprovalLeaseVersion).toBe(5)
	})

	it("blocks before Hosted Web approval and API_REQUEST_STARTED", async () => {
		const beforeApiRequestStarted = vi.fn(async () => undefined)
		const validateApiProfileAdmission = vi.fn(async () => false)
		const isAutoApproved = vi.fn()
		const releaseApiContinuationForRequestGate = vi.fn()
		const admitApiRequest = vi.fn()
		const fakeTask = {
			taskId: "task-1",
			validateApiProfileAdmission,
			toolExecutor: { isAutoApproved },
			interactionCoordinator: { releaseApiContinuationForRequestGate },
			admitApiRequest,
		}
		const completeApiRequestGate = Reflect.get(Task.prototype, "completeApiRequestGate") as (
			this: typeof fakeTask,
			requestScope: {
				webSearchRoutingPlan: { route: "none" }
				providerInfo: { providerId: string }
			},
			apiIndex: number,
			beforeApiRequestStarted?: () => Promise<void>,
		) => Promise<boolean>

		const approved = await completeApiRequestGate.call(
			fakeTask,
			{
				webSearchRoutingPlan: { route: "none" },
				providerInfo: { providerId: "unavailable" },
			},
			4,
			beforeApiRequestStarted,
		)

		expect(approved).toBe(false)
		expect(beforeApiRequestStarted).toHaveBeenCalledOnce()
		expect(validateApiProfileAdmission).toHaveBeenCalledOnce()
		expect(isAutoApproved).not.toHaveBeenCalled()
		expect(releaseApiContinuationForRequestGate).not.toHaveBeenCalled()
		expect(admitApiRequest).not.toHaveBeenCalled()
	})
})
