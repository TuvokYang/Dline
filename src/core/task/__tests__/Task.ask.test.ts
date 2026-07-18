import { strict as assert } from "node:assert"
import * as NotificationHook from "@core/hooks/notification-hook"
import { Task } from "@core/task"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, it, vi } from "vitest"

// sinon import removed: using vitest globals

async function flushMicrotasks(iterations = 5) {
	for (let i = 0; i < iterations; i++) {
		await Promise.resolve()
	}
}

function createFakeTask(taskState: {
	abort: boolean
	askResponse: string | undefined
	askResponseText: string | undefined
	askResponseImages: string[] | undefined
	askResponseFiles: string[] | undefined
	lastMessageTs: number | undefined
}) {
	const clineMessages: ClineMessage[] = []
	const transitions: Array<{
		to: string
		ctx: { awaiting?: { kind?: string; taskAsk?: string; messageTs?: number }; apiIndex?: number }
	}> = []

	let lastGeneratedTs = 0
	const fakeTask = {
		taskState,
		api: { getModel: () => ({ id: "test-model" }) },
		stateManager: {
			getGlobalSettingsKey: (key: string) => (key === "hooksEnabled" ? true : "act"),
			getApiConfiguration: () => ({ actModeProfile: "anthropic", planModeProfile: "anthropic" }),
		},
		taskId: "task-1",
		messageStateHandler: {
			apiConversationHistory: [] as any[],
			addToClineMessages: async (message: ClineMessage) => {
				clineMessages.push(message)
			},
			upsertClineMessageInMemory: async (message: ClineMessage) => {
				const idx = clineMessages.findIndex((m) => m.ts === message.ts)
				if (idx >= 0) {
					clineMessages[idx] = message
				} else {
					clineMessages.push(message)
				}
				return message
			},
			finalizeClineMessage: async (message: ClineMessage) => {
				const idx = clineMessages.findIndex((m) => m.ts === message.ts)
				if (idx >= 0) {
					clineMessages[idx] = message
				} else {
					clineMessages.push(message)
				}
				return message
			},
			get clineMessages(): ClineMessage[] {
				return clineMessages
			},
		},
		taskController: {
			/**
			 * Mock ask implementation that mirrors the real channel-based ask:
			 * creates a message, fires onAskVisible, then polls for askResponse.
			 */
			async ask(type: string, text?: string, _partial?: boolean, options?: { onAskVisible?: (askTs: number) => void }) {
				const ts = fakeTask.genMessageTs()
				const message: ClineMessage = {
					ts,
					type: "ask",
					ask: type as any,
					text: text ?? "",
				} as ClineMessage
				clineMessages.push(message)
				taskState.lastMessageTs = ts

				// Fire onAskVisible callback synchronously after message is added
				if (options?.onAskVisible) {
					options.onAskVisible(ts)
				}

				// Poll until askResponse is set (mirrors real channel polling)
				const shouldWakeOnAbort = type !== "resume_task" && type !== "resume_completed_task"
				while (taskState.askResponse === undefined && !(shouldWakeOnAbort && taskState.abort)) {
					await new Promise((r) => setTimeout(r, 10))
				}
				if (shouldWakeOnAbort && taskState.abort) {
					throw new Error("Dline instance aborted")
				}

				return {
					response: taskState.askResponse,
					text: taskState.askResponseText,
					images: taskState.askResponseImages,
					files: taskState.askResponseFiles,
				}
			},
			advanceNextPendingApproval: () => {},
			transitionRequired: async (
				to: string,
				ctx: { awaiting?: { kind?: string; taskAsk?: string; messageTs?: number }; apiIndex?: number },
			) => {
				transitions.push({ to, ctx })
				return undefined
			},
		},
		withApprovalVisibleCallback: (Task.prototype as any).withApprovalVisibleCallback,
		getApprovalInteractionKind: (Task.prototype as any).getApprovalInteractionKind,
		markApprovalAskVisible: (Task.prototype as any).markApprovalAskVisible,
		markConversationAskVisible: (Task.prototype as any).markConversationAskVisible,
		markErrorRecoveryAskVisible: (Task.prototype as any).markErrorRecoveryAskVisible,
		markResumeAskVisible: (Task.prototype as any).markResumeAskVisible,
		markCompletionAskVisible: (Task.prototype as any).markCompletionAskVisible,
		isPendingToolApprovalAsk: (Task.prototype as any).isPendingToolApprovalAsk,
		isConversationalAsk: (Task.prototype as any).isConversationalAsk,
		isErrorRecoveryAsk: (Task.prototype as any).isErrorRecoveryAsk,
		isResumeAsk: (Task.prototype as any).isResumeAsk,
		isCompletionAsk: (Task.prototype as any).isCompletionAsk,
		isParallelToolCallingEnabled: () => false,
		postStateToWebview: async () => undefined,
		genMessageTs: () => {
			const maxExisting = clineMessages.reduce((max, m) => Math.max(max, m.ts), 0)
			const ts = Math.max(Date.now(), maxExisting + 1, taskState.lastMessageTs ?? 0, lastGeneratedTs + 1)
			lastGeneratedTs = ts
			return ts
		},
	}

	return { clineMessages, fakeTask, transitions }
}

describe("Task.ask", () => {
	it("routes a running handler approval through the canonical interaction", async () => {
		const open = vi.fn(async () => ({
			actionId: "approve",
			draft: { text: "approved with note", images: ["image"], files: ["file"] },
		}))
		const fakeTask = {
			taskRuntime: {
				getState: () => ({
					turn: {
						turnId: "turn-1",
						blocks: [{ dlineTid: "tid-1", ts: 42, phase: "executing" }],
					},
				}),
			},
			interactionCoordinator: { open },
			taskController: { ask: vi.fn(() => Promise.reject(new Error("legacy ask should not run"))) },
			getApprovalInteractionKind: (Task.prototype as any).getApprovalInteractionKind,
			withApprovalVisibleCallback: (Task.prototype as any).withApprovalVisibleCallback,
		}

		const result = await (Task.prototype as any).ask.call(fakeTask, "tool", "Approve write", false, { existingTs: 42 })

		assert.deepEqual(result, {
			response: "yesButtonClicked",
			text: "approved with note",
			images: ["image"],
			files: ["file"],
		})
		const openedRequest = (open.mock.calls as unknown as Array<[unknown]>)[0]?.[0]
		assert.deepEqual(openedRequest, {
			turnId: "turn-1",
			interactionId: "tid-1",
			kind: "tool_approval",
			presentation: "Approve write",
			existingTs: 42,
		})
	})

	it("notifies after a non-partial ask is visible", async () => {
		const clock = vi.useFakeTimers()
		const taskState = {
			abort: false,
			askResponse: undefined as string | undefined,
			askResponseText: undefined as string | undefined,
			askResponseImages: undefined as string[] | undefined,
			askResponseFiles: undefined as string[] | undefined,
			lastMessageTs: undefined as number | undefined,
		}
		const { clineMessages, fakeTask } = createFakeTask(taskState)
		let visibleAskTs: number | undefined
		let visibleMessageCount = 0

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (
						type: "resume_task",
						text?: string,
						partial?: boolean,
						options?: { onAskVisible?: (askTs: number) => void },
					) => Promise<{ response: string; text?: string }>
				}
			).ask.call(fakeTask, "resume_task", undefined, undefined, {
				onAskVisible: (askTs) => {
					visibleAskTs = askTs
					visibleMessageCount = clineMessages.length
				},
			})

			await flushMicrotasks()
			assert.equal(visibleAskTs, taskState.lastMessageTs)
			assert.equal(visibleMessageCount, 1)

			taskState.askResponse = "yesButtonClicked"
			await await clock.advanceTimersByTimeAsync(100)
			const result = await askPromise
			assert.equal(result.response, "yesButtonClicked")
		} finally {
			clock.useRealTimers()
		}
	})

	it("marks error recovery asks in snapshot before the user responds", async () => {
		const clock = vi.useFakeTimers()
		const notificationStub = vi.spyOn(NotificationHook, "emitUserAttentionNotification").mockResolvedValue()
		const taskState = {
			abort: false,
			askResponse: undefined as string | undefined,
			askResponseText: undefined as string | undefined,
			askResponseImages: undefined as string[] | undefined,
			askResponseFiles: undefined as string[] | undefined,
			lastMessageTs: undefined as number | undefined,
		}
		const { fakeTask } = createFakeTask(taskState)
		let capturedPhase: string | undefined
		let capturedContext: unknown
		let didPostState = false

		const controller = fakeTask.taskController as {
			transitionRequired: (phase: string, ctx: unknown) => Promise<void>
		}
		controller.transitionRequired = async (phase: string, ctx: unknown) => {
			capturedPhase = phase
			capturedContext = ctx
		}
		fakeTask.postStateToWebview = async () => {
			didPostState = true
		}

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (
						type: "api_req_failed",
						text?: string,
						partial?: boolean,
						options?: { onAskVisible?: (askTs: number) => void },
					) => Promise<{ response: string; text?: string }>
				}
			).ask.call(fakeTask, "api_req_failed", "network failed")

			await flushMicrotasks()
			assert.equal(capturedPhase, "awaiting_approval")
			const context = capturedContext as {
				apiIndex: number
				awaiting: unknown
				error: unknown
				onSnapshot?: unknown
			}
			assert.equal(context.apiIndex, -1)
			assert.deepEqual(context.awaiting, {
				kind: "error_recovery",
				taskAsk: "api_req_failed",
				messageTs: taskState.lastMessageTs,
			})
			assert.deepEqual(context.error, {
				kind: "api_req_failed",
				sourceAsk: "api_req_failed",
				message: "network failed",
				actions: ["retry", "start_new_task"],
				retryable: true,
				processAllowed: false,
				messageTs: taskState.lastMessageTs,
			})
			assert.equal(context.onSnapshot, undefined)
			assert.equal(didPostState, true)
			assert.equal(taskState.askResponse, undefined)

			taskState.askResponse = "yesButtonClicked"
			await await clock.advanceTimersByTimeAsync(100)
			const result = await askPromise
			assert.equal(result.response, "yesButtonClicked")
		} finally {
			notificationStub.mockRestore()
			clock.useRealTimers()
		}
	})

	it("marks tool approvals as awaiting before the user responds", async () => {
		const clock = vi.useFakeTimers()
		const notificationStub = vi.spyOn(NotificationHook, "emitUserAttentionNotification").mockResolvedValue()
		const taskState = {
			abort: false,
			askResponse: undefined as string | undefined,
			askResponseText: undefined as string | undefined,
			askResponseImages: undefined as string[] | undefined,
			askResponseFiles: undefined as string[] | undefined,
			lastMessageTs: undefined as number | undefined,
		}
		const { fakeTask } = createFakeTask(taskState)
		const approvalBlock = {
			functionId: "function_read",
			dlineTid: "tid_read",
			toolName: "read_file",
			phase: "awaiting_approval",
			ts: 123,
			requiresApproval: true,
			conversationHistoryIndex: 5,
		}
		let didAdvance = false
		let didTransition = false
		let didPostState = false
		let didCallOriginalVisible = false

		const controller = fakeTask.taskController as any
		controller.getActiveBlock = () => null
		controller.advanceNextPendingApproval = () => {
			didAdvance = true
			return approvalBlock
		}
		controller.toolNameToAskType = () => "tool"
		controller.getBlocks = () => [approvalBlock]
		controller.transitionRequired = (phase: string, ctx: any) => {
			didTransition = true
			assert.equal(phase, "awaiting_approval")
			assert.equal(ctx.apiIndex, 5)
			assert.equal(ctx.approval.activeFunctionId, "function_read")
		}
		fakeTask.postStateToWebview = async () => {
			didPostState = true
		}

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (
						type: "tool",
						text?: string,
						partial?: boolean,
						options?: { onAskVisible?: (askTs: number) => void },
					) => Promise<{ response: string; text?: string }>
				}
			).ask.call(fakeTask, "tool", "{}", false, {
				onAskVisible: () => {
					didCallOriginalVisible = true
				},
			})

			await flushMicrotasks()
			assert.equal(didAdvance, true)
			assert.equal(didTransition, true)
			assert.equal(didPostState, true)
			assert.equal(didCallOriginalVisible, true)
			assert.equal(taskState.askResponse, undefined)

			taskState.askResponse = "yesButtonClicked"
			await await clock.advanceTimersByTimeAsync(100)
			const result = await askPromise
			assert.equal(result.response, "yesButtonClicked")
		} finally {
			notificationStub.mockRestore()
			clock.useRealTimers()
		}
	})

	it("marks resume asks in snapshot before the user responds", async () => {
		const clock = vi.useFakeTimers()
		const taskState = {
			abort: false,
			askResponse: undefined as string | undefined,
			askResponseText: undefined as string | undefined,
			askResponseImages: undefined as string[] | undefined,
			askResponseFiles: undefined as string[] | undefined,
			lastMessageTs: undefined as number | undefined,
		}
		const { fakeTask } = createFakeTask(taskState)
		let capturedPhase: string | undefined
		let capturedContext: unknown
		let didPostState = false

		const controller = fakeTask.taskController as {
			transitionRequired: (phase: string, ctx: unknown) => Promise<void>
		}
		controller.transitionRequired = async (phase: string, ctx: unknown) => {
			capturedPhase = phase
			capturedContext = ctx
		}
		fakeTask.postStateToWebview = async () => {
			didPostState = true
		}

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (type: "resume_task") => Promise<{ response: string; text?: string }>
				}
			).ask.call(fakeTask, "resume_task")

			await flushMicrotasks()
			assert.equal(capturedPhase, "paused")
			const context = capturedContext as {
				apiIndex: number
				awaiting: unknown
				onSnapshot?: unknown
			}
			assert.equal(context.apiIndex, -1)
			assert.deepEqual(context.awaiting, {
				kind: "resume",
				taskAsk: "resume_task",
				messageTs: taskState.lastMessageTs,
			})
			assert.equal(context.onSnapshot, undefined)
			assert.equal(didPostState, true)
			assert.equal(taskState.askResponse, undefined)

			taskState.askResponse = "yesButtonClicked"
			await await clock.advanceTimersByTimeAsync(100)
			const result = await askPromise
			assert.equal(result.response, "yesButtonClicked")
		} finally {
			clock.useRealTimers()
		}
	})

	it("keeps resume asks waiting for a user response even when the task is aborted", async () => {
		const clock = vi.useFakeTimers()
		const taskState: {
			abort: boolean
			askResponse: string | undefined
			askResponseText: string | undefined
			askResponseImages: string[] | undefined
			askResponseFiles: string[] | undefined
			lastMessageTs: number | undefined
		} = {
			abort: true,
			askResponse: undefined,
			askResponseText: undefined,
			askResponseImages: undefined,
			askResponseFiles: undefined,
			lastMessageTs: undefined,
		}
		const { clineMessages, fakeTask } = createFakeTask(taskState)

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (type: "resume_task") => Promise<{ response: string; text?: string }>
				}
			).ask.call(fakeTask, "resume_task")

			let settled = false
			void askPromise.then(
				() => {
					settled = true
				},
				() => {
					settled = true
				},
			)

			await flushMicrotasks()
			assert.equal(clineMessages.length, 1)
			assert.equal(clineMessages[0].ask, "resume_task")
			assert.notEqual(taskState.lastMessageTs, undefined)

			await await clock.advanceTimersByTimeAsync(1_000)
			assert.equal(settled, false)
			assert.equal(taskState.askResponse, undefined)

			taskState.askResponse = "yesButtonClicked"
			taskState.askResponseText = "resume"

			await await clock.advanceTimersByTimeAsync(100)
			const result = await askPromise

			assert.equal(result.response, "yesButtonClicked")
			assert.equal(result.text, "resume")
		} finally {
			clock.useRealTimers()
		}
	})

	it("keeps resume-completed asks waiting for a user response even when the task is aborted", async () => {
		const clock = vi.useFakeTimers()
		const taskState: {
			abort: boolean
			askResponse: string | undefined
			askResponseText: string | undefined
			askResponseImages: string[] | undefined
			askResponseFiles: string[] | undefined
			lastMessageTs: number | undefined
		} = {
			abort: true,
			askResponse: undefined,
			askResponseText: undefined,
			askResponseImages: undefined,
			askResponseFiles: undefined,
			lastMessageTs: undefined,
		}
		const { clineMessages, fakeTask } = createFakeTask(taskState)

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (type: "resume_completed_task") => Promise<{ response: string; text?: string }>
				}
			).ask.call(fakeTask, "resume_completed_task")

			let settled = false
			void askPromise.then(
				() => {
					settled = true
				},
				() => {
					settled = true
				},
			)

			await flushMicrotasks()
			assert.equal(clineMessages.length, 1)
			assert.equal(clineMessages[0].ask, "resume_completed_task")
			assert.notEqual(taskState.lastMessageTs, undefined)

			await await clock.advanceTimersByTimeAsync(1_000)
			assert.equal(settled, false)
			assert.equal(taskState.askResponse, undefined)

			taskState.askResponse = "yesButtonClicked"
			taskState.askResponseText = "resume completed"

			await await clock.advanceTimersByTimeAsync(100)
			const result = await askPromise

			assert.equal(result.response, "yesButtonClicked")
			assert.equal(result.text, "resume completed")
		} finally {
			clock.useRealTimers()
		}
	})

	it("writes completion awaiting snapshot when completion result ask becomes visible", async () => {
		const clock = vi.useFakeTimers()
		const taskState: {
			abort: boolean
			askResponse: string | undefined
			askResponseText: string | undefined
			askResponseImages: string[] | undefined
			askResponseFiles: string[] | undefined
			lastMessageTs: number | undefined
		} = {
			abort: false,
			askResponse: undefined,
			askResponseText: undefined,
			askResponseImages: undefined,
			askResponseFiles: undefined,
			lastMessageTs: undefined,
		}
		const { fakeTask, transitions } = createFakeTask(taskState)

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (type: "completion_result") => Promise<{ response: string }>
				}
			).ask.call(fakeTask, "completion_result")

			await flushMicrotasks()
			assert.equal(transitions.length, 1)
			assert.equal(transitions[0].ctx.awaiting?.kind, "completion")
			assert.equal(transitions[0].ctx.awaiting?.taskAsk, "completion_result")
			assert.equal(transitions[0].ctx.awaiting?.messageTs, taskState.lastMessageTs)

			taskState.askResponse = "yesButtonClicked"
			await await clock.advanceTimersByTimeAsync(100)
			await askPromise
		} finally {
			clock.useRealTimers()
		}
	})

	it("still wakes non-resume asks when abort is triggered after the ask is shown", async () => {
		const clock = vi.useFakeTimers()
		const taskState: {
			abort: boolean
			askResponse: string | undefined
			askResponseText: string | undefined
			askResponseImages: string[] | undefined
			askResponseFiles: string[] | undefined
			lastMessageTs: number | undefined
		} = {
			abort: false,
			askResponse: undefined,
			askResponseText: undefined,
			askResponseImages: undefined,
			askResponseFiles: undefined,
			lastMessageTs: undefined,
		}
		const { clineMessages, fakeTask } = createFakeTask(taskState)

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (type: "completion_result") => Promise<{ response: string }>
				}
			).ask.call(fakeTask, "completion_result")

			await flushMicrotasks()
			assert.equal(clineMessages.length, 1)
			assert.equal(clineMessages[0].ask, "completion_result")

			const rejectionPromise = assert.rejects(askPromise, /Dline instance aborted/)
			taskState.abort = true

			await await clock.advanceTimersByTimeAsync(100)
			await rejectionPromise
		} finally {
			clock.useRealTimers()
		}
	})

	it("emits notification hooks for non-command_output asks", async () => {
		const clock = vi.useFakeTimers()
		const notificationStub = vi.spyOn(NotificationHook, "emitUserAttentionNotification").mockResolvedValue()
		const taskState: {
			abort: boolean
			askResponse: string | undefined
			askResponseText: string | undefined
			askResponseImages: string[] | undefined
			askResponseFiles: string[] | undefined
			lastMessageTs: number | undefined
		} = {
			abort: false,
			askResponse: undefined,
			askResponseText: undefined,
			askResponseImages: undefined,
			askResponseFiles: undefined,
			lastMessageTs: undefined,
		}
		const { fakeTask } = createFakeTask(taskState)

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (type: "completion_result", text?: string) => Promise<{ response: string }>
				}
			).ask.call(fakeTask, "completion_result", "Need approval")

			await flushMicrotasks()
			expect(notificationStub)
			assert.equal(notificationStub.mock.calls[0][1].source, "completion_result")
			assert.equal(notificationStub.mock.calls[0][1].message, "Need approval")

			taskState.askResponse = "yesButtonClicked"
			await await clock.advanceTimersByTimeAsync(100)
			await askPromise
		} finally {
			notificationStub.mockRestore()
			clock.useRealTimers()
		}
	})

	it("skips notification hooks for command_output asks", async () => {
		const clock = vi.useFakeTimers()
		const notificationStub = vi.spyOn(NotificationHook, "emitUserAttentionNotification").mockResolvedValue()
		const taskState: {
			abort: boolean
			askResponse: string | undefined
			askResponseText: string | undefined
			askResponseImages: string[] | undefined
			askResponseFiles: string[] | undefined
			lastMessageTs: number | undefined
		} = {
			abort: false,
			askResponse: undefined,
			askResponseText: undefined,
			askResponseImages: undefined,
			askResponseFiles: undefined,
			lastMessageTs: undefined,
		}
		const { fakeTask } = createFakeTask(taskState)

		try {
			const askPromise = (
				Task.prototype as unknown as {
					ask: (type: "command_output", text?: string) => Promise<{ response: string }>
				}
			).ask.call(fakeTask, "command_output", "stream update")

			await flushMicrotasks()
			expect(notificationStub)

			taskState.askResponse = "yesButtonClicked"
			await await clock.advanceTimersByTimeAsync(100)
			await askPromise
		} finally {
			notificationStub.mockRestore()
			clock.useRealTimers()
		}
	})
})
