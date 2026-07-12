import { describe, expect, it, vi } from "vitest"
import { TaskPhase } from "../TaskPhase"
import { TaskPhaseMachine } from "../TaskPhaseMachine"

const ALLOWED_TRANSITIONS: ReadonlyArray<readonly [TaskPhase, TaskPhase]> = [
	[TaskPhase.IDLE, TaskPhase.INITIALIZING],
	[TaskPhase.INITIALIZING, TaskPhase.WAITING_FOR_TASK],
	[TaskPhase.INITIALIZING, TaskPhase.STREAMING],
	[TaskPhase.INITIALIZING, TaskPhase.PAUSED],
	[TaskPhase.INITIALIZING, TaskPhase.CANCELLING],
	[TaskPhase.INITIALIZING, TaskPhase.ABORTED],
	[TaskPhase.WAITING_FOR_TASK, TaskPhase.STREAMING],
	[TaskPhase.WAITING_FOR_TASK, TaskPhase.CANCELLING],
	[TaskPhase.WAITING_FOR_TASK, TaskPhase.ABORTED],
	[TaskPhase.STREAMING, TaskPhase.AWAITING_APPROVAL],
	[TaskPhase.STREAMING, TaskPhase.EXECUTING],
	[TaskPhase.STREAMING, TaskPhase.BETWEEN_TURNS],
	[TaskPhase.STREAMING, TaskPhase.PAUSED],
	[TaskPhase.STREAMING, TaskPhase.CANCELLING],
	[TaskPhase.STREAMING, TaskPhase.COMPLETED],
	[TaskPhase.STREAMING, TaskPhase.ABORTED],
	[TaskPhase.AWAITING_APPROVAL, TaskPhase.EXECUTING],
	[TaskPhase.AWAITING_APPROVAL, TaskPhase.BETWEEN_TURNS],
	[TaskPhase.AWAITING_APPROVAL, TaskPhase.STREAMING],
	[TaskPhase.AWAITING_APPROVAL, TaskPhase.PAUSED],
	[TaskPhase.AWAITING_APPROVAL, TaskPhase.CANCELLING],
	[TaskPhase.AWAITING_APPROVAL, TaskPhase.COMPLETED],
	[TaskPhase.EXECUTING, TaskPhase.AWAITING_APPROVAL],
	[TaskPhase.EXECUTING, TaskPhase.BETWEEN_TURNS],
	[TaskPhase.EXECUTING, TaskPhase.STREAMING],
	[TaskPhase.EXECUTING, TaskPhase.PAUSED],
	[TaskPhase.EXECUTING, TaskPhase.CANCELLING],
	[TaskPhase.EXECUTING, TaskPhase.COMPLETED],
	[TaskPhase.BETWEEN_TURNS, TaskPhase.STREAMING],
	[TaskPhase.BETWEEN_TURNS, TaskPhase.AWAITING_APPROVAL],
	[TaskPhase.BETWEEN_TURNS, TaskPhase.PAUSED],
	[TaskPhase.BETWEEN_TURNS, TaskPhase.CANCELLING],
	[TaskPhase.BETWEEN_TURNS, TaskPhase.COMPLETED],
	[TaskPhase.PAUSED, TaskPhase.RESUMING],
	[TaskPhase.PAUSED, TaskPhase.CANCELLING],
	[TaskPhase.PAUSED, TaskPhase.ABORTED],
	[TaskPhase.RESUMING, TaskPhase.AWAITING_APPROVAL],
	[TaskPhase.RESUMING, TaskPhase.EXECUTING],
	[TaskPhase.RESUMING, TaskPhase.STREAMING],
	[TaskPhase.RESUMING, TaskPhase.PAUSED],
	[TaskPhase.RESUMING, TaskPhase.CANCELLING],
	[TaskPhase.RESUMING, TaskPhase.ABORTED],
	[TaskPhase.CANCELLING, TaskPhase.PAUSED],
	[TaskPhase.CANCELLING, TaskPhase.ABORTED],
	[TaskPhase.COMPLETED, TaskPhase.STREAMING],
	[TaskPhase.COMPLETED, TaskPhase.CANCELLING],
	[TaskPhase.COMPLETED, TaskPhase.ABORTED],
]

/** Restore a machine to a phase without persisting a new snapshot. */
function restorePhase(phase: TaskPhase): TaskPhaseMachine {
	const machine = new TaskPhaseMachine()
	machine.restoreFrom({ phase, apiIndex: 0, timestamp: 1 })
	return machine
}

describe("TaskPhaseMachine legal transitions", () => {
	it.each(ALLOWED_TRANSITIONS)("accepts %s -> %s", async (from, to) => {
		const machine = restorePhase(from)

		expect(machine.canTransition(to)).toBe(true)
		const result = await machine.transition(to, { apiIndex: 0 })

		expect(result).toMatchObject({ accepted: true, snapshot: { phase: to, apiIndex: 0 } })
		expect(machine.phase).toBe(to)
	})

	it.each([
		[TaskPhase.IDLE, TaskPhase.EXECUTING],
		[TaskPhase.WAITING_FOR_TASK, TaskPhase.COMPLETED],
		[TaskPhase.PAUSED, TaskPhase.STREAMING],
		[TaskPhase.COMPLETED, TaskPhase.EXECUTING],
	] as const)("rejects %s -> %s without changing state", async (from, to) => {
		const machine = restorePhase(from)
		const onSnapshot = vi.fn()

		expect(machine.canTransition(to)).toBe(false)
		const result = await machine.transition(to, { apiIndex: 0, onSnapshot })

		expect(result).toEqual({
			accepted: false,
			error: { code: "invalid_phase_transition", from, to },
		})
		expect(machine.phase).toBe(from)
		expect(onSnapshot).not.toHaveBeenCalled()
	})
})
