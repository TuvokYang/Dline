import { describe, expect, it, vi } from "vitest"
import { BlockPhase } from "../../BlockPhaseMachine"
import { createTaskRuntimeState } from "../../runtime/TaskRuntimeState"
import { TaskPhase } from "../../TaskPhase"
import { createSnapshot, hydrateSnapshot } from "../../TaskSnapshot"
import { ResumeCoordinator, type ResumeCoordinatorPorts } from "../ResumeCoordinator"
import type { ResumeEntry, ResumeInput } from "../ResumeInput"

/** Build a strict resumable input without any post-snapshot tail. */
function input(): ResumeInput {
	return {
		taskId: "task-1",
		snapshot: createSnapshot(
			createTaskRuntimeState({ taskId: "task-1", phase: TaskPhase.STREAMING, revision: 3, anchor: { apiIndex: 2 } }),
			100,
		),
		uiTail: [],
		apiTail: [],
		apiHistoryLength: 3,
	}
}

/** Create observable coordinator ports. */
function ports(order: string[]): ResumeCoordinatorPorts {
	return {
		load: vi.fn(async () => {
			order.push("load")
			return input()
		}),
		persist: vi.fn(async () => {
			order.push("persist")
		}),
		hydrate: vi.fn(async (result) => {
			order.push(
				result.entry.type === "read_only_failure"
					? "hydrate:read_only"
					: `hydrate:${hydrateSnapshot(result.snapshot).phase}`,
			)
		}),
		dispatch: vi.fn(async (entry: ResumeEntry) => {
			order.push(`dispatch:${entry.type}`)
		}),
	}
}

describe("ResumeCoordinator", () => {
	it("runs the exact load-reconcile-persist-hydrate-dispatch order", async () => {
		const order: string[] = []
		const coordinator = new ResumeCoordinator(ports(order))

		const result = await coordinator.resume("task-1")

		expect(result.entry).toEqual({ type: "continue_api_turn", apiIndex: 2 })
		expect(order).toEqual(["load", "persist", "hydrate:streaming", "dispatch:continue_api_turn"])
	})

	it("dispatches missing-identity diagnostics even when the snapshot cannot hydrate", async () => {
		const order: string[] = []
		const coordinatorPorts = ports(order)
		coordinatorPorts.load = vi.fn(async () => {
			order.push("load")
			const value = input()
			value.snapshot.turn = {
				turnId: "turn-1",
				assistantApiIndex: 2,
				mode: "serial",
				blocks: [
					{
						dlineTid: "",
						callId: "call-1",
						toolName: "read_file",
						phase: BlockPhase.EXECUTING,
						ts: 90,
						requiresApproval: false,
						conversationHistoryIndex: 2,
					},
				],
			}
			return value
		})
		const coordinator = new ResumeCoordinator(coordinatorPorts)

		const result = await coordinator.resume("task-1")

		expect(result.diagnostics).toEqual([{ code: "missing_identity", field: "dlineTid" }])
		expect(coordinatorPorts.persist).toHaveBeenCalledWith(expect.objectContaining({ entry: { type: "read_only_failure" } }))
		expect(coordinatorPorts.dispatch).toHaveBeenCalledWith({
			type: "read_only_failure",
			diagnostics: [{ code: "missing_identity", field: "dlineTid" }],
		})
	})

	it("persists and dispatches read-only failure diagnostics without guessing", async () => {
		const order: string[] = []
		const coordinatorPorts = ports(order)
		coordinatorPorts.load = vi.fn(async () => {
			order.push("load")
			const value = input()
			value.snapshot.anchor = { apiIndex: -2 }
			return value
		})
		const coordinator = new ResumeCoordinator(coordinatorPorts)

		const result = await coordinator.resume("task-1")

		expect(result.entry).toEqual({ type: "read_only_failure" })
		expect(result.diagnostics).toEqual([{ code: "corrupt_anchor", field: "apiIndex" }])
		expect(order).toEqual(["load", "persist", "hydrate:read_only", "dispatch:read_only_failure"])
		expect(coordinatorPorts.dispatch).toHaveBeenCalledWith({
			type: "read_only_failure",
			diagnostics: [{ code: "corrupt_anchor", field: "apiIndex" }],
		})
	})
})
