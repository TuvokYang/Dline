import { strict as assert } from "node:assert"
import { describe, it, vi } from "vitest"
import { BlockPhase } from "../BlockPhaseMachine"
import type { MessageChannel } from "../MessageChannel"
import { TaskController } from "../TaskController"
import { TaskPhase } from "../TaskPhase"
import type { TaskSnapshot } from "../TaskSnapshot"

const mockChannel: MessageChannel = {
	say: vi.fn(),
	ask: vi.fn(),
	resolve: vi.fn(),
} as unknown as MessageChannel

describe("TaskController.buildTaskUiState", () => {
	it("returns idle state when snapshot is null", () => {
		const tc = new TaskController(mockChannel)
		const uiState = tc.buildTaskUiState(null)

		assert.equal(uiState.phase, "idle")
		assert.equal(uiState.inputEnabled, true)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, false)
		assert.equal(uiState.actions.length, 0)
		assert.equal(uiState.reason, "no-snapshot")
	})

	it("returns working cancel state when runtime is active before a snapshot exists", () => {
		const tc = new TaskController(mockChannel)
		const uiState = tc.buildTaskUiState(null, { isTaskWorking: true, runtimeWorking: true })

		assert.equal(uiState.phase, "working")
		assert.equal(uiState.inputEnabled, false)
		assert.equal(uiState.cancelEnabled, true)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "cancel")
		assert.equal(uiState.actions[0].label, "Cancel")
		assert.equal(uiState.reason, "working:runtime")
	})

	it("returns working state with cancel button when streaming", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.STREAMING,
			apiIndex: 1,
			timestamp: Date.now(),
		}
		const uiState = tc.buildTaskUiState(snapshot)

		assert.equal(uiState.phase, "working")
		assert.equal(uiState.inputEnabled, false)
		assert.equal(uiState.cancelEnabled, true)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "cancel")
		assert.equal(uiState.actions[0].label, "Cancel")
		assert.equal(uiState.actions[0].enabled, true)
		assert.equal(uiState.reason, "working:streaming")
	})

	it("returns resume state for historical streaming snapshot when task is not working", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.STREAMING,
			apiIndex: 1,
			timestamp: Date.now(),
		}
		const uiState = tc.buildTaskUiState(snapshot, { isTaskWorking: false })

		assert.equal(uiState.phase, "awaiting_resume")
		assert.equal(uiState.inputEnabled, true)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "resume")
		assert.equal(uiState.actions[0].label, "Resume")
		assert.equal(uiState.activeAsk, "resume_task")
		assert.equal(uiState.reason, "resume-from-stale-working:streaming")
	})

	it("returns resume state for historical cancelling snapshot when task is not working", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.CANCELLING,
			apiIndex: 2,
			timestamp: Date.now(),
			cancel: {
				source: "user",
				fromPhase: TaskPhase.STREAMING,
			},
		}
		const uiState = tc.buildTaskUiState(snapshot, { isTaskWorking: false })

		assert.equal(uiState.phase, "awaiting_resume")
		assert.equal(uiState.inputEnabled, true)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "resume")
		assert.equal(uiState.activeAsk, "resume_task")
		assert.equal(uiState.reason, "resume-from-stale-working:cancelling")
	})

	it("returns disabled cancel state while cancelling even if runtime is still active", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.CANCELLING,
			apiIndex: 2,
			timestamp: Date.now(),
			cancel: {
				source: "user",
				fromPhase: TaskPhase.STREAMING,
			},
		}
		const uiState = tc.buildTaskUiState(snapshot, { isTaskWorking: true, runtimeWorking: true })

		assert.equal(uiState.phase, "cancelled")
		assert.equal(uiState.inputEnabled, false)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "cancel")
		assert.equal(uiState.actions[0].label, "Cancel")
		assert.equal(uiState.actions[0].enabled, false)
		assert.equal(uiState.reason, "cancelling")
	})

	it("returns approval awaiting state with approve/reject buttons", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.AWAITING_APPROVAL,
			apiIndex: 2,
			timestamp: Date.now(),
			awaiting: {
				kind: "approval",
				taskAsk: "tool",
				activeFunctionId: "call_123",
				messageTs: Date.now(),
			},
			approval: {
				mode: "serial",
				blocks: [
					{
						functionId: "call_123",
						name: "write_to_file",
						phase: BlockPhase.AWAITING_APPROVAL,
						apiIndex: 2,
					},
				],
				activeFunctionId: "call_123",
			},
		}
		const uiState = tc.buildTaskUiState(snapshot)

		assert.equal(uiState.phase, "awaiting_approval")
		assert.equal(uiState.inputEnabled, false)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 2)
		assert.equal(uiState.actions[0].type, "approve")
		assert.equal(uiState.actions[0].label, "Approve")
		assert.equal(uiState.actions[1].type, "reject")
		assert.equal(uiState.actions[1].label, "Reject")
		assert.equal(uiState.activeAsk, "tool")
		assert.equal(uiState.activeFunctionId, "call_123")
		assert.equal(uiState.reason, "approval-awaiting")
	})

	it("returns error recovery state with retry button for api_req_failed", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.BETWEEN_TURNS,
			apiIndex: 3,
			timestamp: Date.now(),
			awaiting: {
				kind: "error_recovery",
				taskAsk: "api_req_failed",
				messageTs: Date.now(),
			},
			error: {
				kind: "api_req_failed",
				sourceAsk: "api_req_failed",
				message: "API request failed",
				actions: ["retry", "start_new_task"],
				retryable: true,
				processAllowed: false,
			},
		}
		const uiState = tc.buildTaskUiState(snapshot)

		assert.equal(uiState.phase, "awaiting_error_recovery")
		assert.equal(uiState.inputEnabled, true)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 2)
		assert.equal(uiState.actions[0].type, "retry")
		assert.equal(uiState.actions[0].label, "Retry")
		assert.equal(uiState.actions[1].type, "start_new_task")
		assert.equal(uiState.actions[1].label, "Start New Task")
		assert.equal(uiState.activeAsk, "api_req_failed")
		assert.equal(uiState.message, "API request failed")
		assert.equal(uiState.reason, "error-recovery:api_req_failed")
	})

	it("returns error recovery state with process_anyway for mistake_limit_reached", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.BETWEEN_TURNS,
			apiIndex: 4,
			timestamp: Date.now(),
			awaiting: {
				kind: "error_recovery",
				taskAsk: "mistake_limit_reached",
				messageTs: Date.now(),
			},
			error: {
				kind: "mistake_limit_reached",
				sourceAsk: "mistake_limit_reached",
				message: "Mistake limit reached",
				actions: ["process_anyway", "start_new_task"],
				retryable: false,
				processAllowed: true,
			},
		}
		const uiState = tc.buildTaskUiState(snapshot)

		assert.equal(uiState.phase, "awaiting_error_recovery")
		assert.equal(uiState.inputEnabled, true) // mistake_limit_reached allows input
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 2)
		assert.equal(uiState.actions[0].type, "process_anyway")
		assert.equal(uiState.actions[0].label, "Process Anyway")
		assert.equal(uiState.actions[1].type, "start_new_task")
		assert.equal(uiState.reason, "error-recovery:mistake_limit_reached")
	})

	it("returns resume awaiting state with resume button", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.RESUMING,
			apiIndex: 5,
			timestamp: Date.now(),
			awaiting: {
				kind: "resume",
				taskAsk: "resume_task",
				messageTs: Date.now(),
			},
		}
		const uiState = tc.buildTaskUiState(snapshot)

		assert.equal(uiState.phase, "awaiting_resume")
		assert.equal(uiState.inputEnabled, false)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "resume")
		assert.equal(uiState.actions[0].label, "Resume")
		assert.equal(uiState.activeAsk, "resume_task")
		assert.equal(uiState.reason, "resume-awaiting")
	})

	it("returns condense utility action for condense awaiting", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.BETWEEN_TURNS,
			apiIndex: 5,
			timestamp: Date.now(),
			awaiting: {
				kind: "conversation",
				taskAsk: "condense",
				messageTs: Date.now(),
			},
		}
		const uiState = tc.buildTaskUiState(snapshot)

		assert.equal(uiState.phase, "awaiting_input")
		assert.equal(uiState.inputEnabled, true)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "utility")
		assert.equal(uiState.actions[0].label, "Condense Conversation")
		assert.equal(uiState.activeAsk, "condense")
		assert.equal(uiState.reason, "utility-awaiting:condense")
	})

	it("returns completed state for resume_completed_task awaiting", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.PAUSED,
			apiIndex: 5,
			timestamp: Date.now(),
			awaiting: {
				kind: "resume",
				taskAsk: "resume_completed_task",
				messageTs: Date.now(),
			},
		}
		const uiState = tc.buildTaskUiState(snapshot, { isTaskWorking: false })

		assert.equal(uiState.phase, "completed")
		assert.equal(uiState.inputEnabled, true)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "start_new_task")
		assert.equal(uiState.actions[0].label, "Start New Task")
		assert.equal(uiState.activeAsk, "resume_completed_task")
		assert.equal(uiState.reason, "completion-resume-awaiting")
	})

	it("returns completed state with start-new-task action for completion awaiting", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.COMPLETED,
			apiIndex: 6,
			timestamp: Date.now(),
			awaiting: {
				kind: "completion",
				taskAsk: "completion_result",
				messageTs: Date.now(),
			},
		}
		const uiState = tc.buildTaskUiState(snapshot, { isTaskWorking: false })

		assert.equal(uiState.phase, "completed")
		assert.equal(uiState.inputEnabled, true)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "start_new_task")
		assert.equal(uiState.actions[0].label, "Start New Task")
		assert.equal(uiState.activeAsk, "completion_result")
		assert.equal(uiState.reason, "completion-awaiting")
	})

	it("shows cancel for stale completion snapshot when runtime is actively working", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.COMPLETED,
			apiIndex: 6,
			timestamp: Date.now(),
			awaiting: {
				kind: "completion",
				taskAsk: "completion_result",
				messageTs: Date.now(),
			},
		}
		const uiState = tc.buildTaskUiState(snapshot, { isTaskWorking: true, runtimeWorking: true })

		assert.equal(uiState.phase, "working")
		assert.equal(uiState.inputEnabled, false)
		assert.equal(uiState.cancelEnabled, true)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "cancel")
		assert.equal(uiState.reason, "working:runtime")
	})

	it("returns conversation awaiting state for plan_mode_respond", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.BETWEEN_TURNS,
			apiIndex: 6,
			timestamp: Date.now(),
			awaiting: {
				kind: "conversation",
				taskAsk: "plan_mode_respond",
				messageTs: Date.now(),
			},
		}
		const uiState = tc.buildTaskUiState(snapshot)

		assert.equal(uiState.phase, "awaiting_input")
		assert.equal(uiState.inputEnabled, true)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, false)
		assert.equal(uiState.actions.length, 0)
		assert.equal(uiState.activeAsk, "plan_mode_respond")
		assert.equal(uiState.reason, "conversation-awaiting")
	})

	it("keeps conversation-awaiting state when only stale message inference marks task as working", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.AWAITING_APPROVAL,
			apiIndex: 1,
			timestamp: Date.now(),
			awaiting: {
				kind: "conversation",
				taskAsk: "qna_respond",
				messageTs: Date.now(),
			},
		}
		const uiState = tc.buildTaskUiState(snapshot, { isTaskWorking: true, runtimeWorking: false })

		assert.equal(uiState.phase, "awaiting_input")
		assert.equal(uiState.inputEnabled, true)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.showFooter, false)
		assert.equal(uiState.actions.length, 0)
		assert.equal(uiState.activeAsk, "qna_respond")
		assert.equal(uiState.reason, "conversation-awaiting")
	})

	it("shows cancel for stale conversation snapshot when runtime is actively working", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.STREAMING,
			apiIndex: 1,
			timestamp: Date.now(),
			awaiting: {
				kind: "conversation",
				taskAsk: "qna_respond",
				messageTs: Date.now(),
			},
		}
		const uiState = tc.buildTaskUiState(snapshot, { isTaskWorking: true, runtimeWorking: true })

		assert.equal(uiState.phase, "working")
		assert.equal(uiState.inputEnabled, false)
		assert.equal(uiState.cancelEnabled, true)
		assert.equal(uiState.showFooter, true)
		assert.equal(uiState.actions.length, 1)
		assert.equal(uiState.actions[0].type, "cancel")
		assert.equal(uiState.reason, "working:streaming")
	})

	it("returns conversation-awaiting state when isTaskWorking is false (existing behavior)", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.AWAITING_APPROVAL,
			apiIndex: 1,
			timestamp: Date.now(),
			awaiting: {
				kind: "conversation",
				taskAsk: "qna_respond",
				messageTs: Date.now(),
			},
		}
		const uiState = tc.buildTaskUiState(snapshot, { isTaskWorking: false })

		assert.equal(uiState.phase, "awaiting_input")
		assert.equal(uiState.showFooter, false)
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.actions.length, 0)
		assert.equal(uiState.reason, "conversation-awaiting")
		assert.equal(uiState.activeAsk, "qna_respond")
	})

	it("prioritizes error_recovery Retry over runtimeWorking Cancel for api_req_failed", () => {
		const tc = new TaskController(mockChannel)
		const snapshot: TaskSnapshot = {
			phase: TaskPhase.AWAITING_APPROVAL,
			apiIndex: 3,
			timestamp: Date.now(),
			awaiting: {
				kind: "error_recovery",
				taskAsk: "api_req_failed",
				messageTs: Date.now(),
			},
			error: {
				kind: "api_req_failed",
				sourceAsk: "api_req_failed",
				message: "API request failed after auto-retry",
				actions: ["retry", "start_new_task"],
				retryable: true,
				processAllowed: false,
			},
		}
		// runtimeWorking=true simulates the auto-retry/cancel loop still being active
		const uiState = tc.buildTaskUiState(snapshot, { runtimeWorking: true })

		assert.equal(uiState.phase, "awaiting_error_recovery")
		assert.equal(uiState.cancelEnabled, false)
		assert.equal(uiState.actions[0].type, "retry")
		assert.equal(uiState.actions[0].label, "Retry")
		assert.equal(uiState.reason, "error-recovery:api_req_failed")
	})
})
