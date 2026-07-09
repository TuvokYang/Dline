// @vitest-environment jsdom

import type { ClineMessage, TaskUiState } from "@shared/ExtensionMessage"
import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatState } from "../types/chatTypes"
import { useMessageHandlers } from "./useMessageHandlers"

const grpcMocks = vi.hoisted(() => ({
	taskAskResponse: vi.fn(),
	taskNewTask: vi.fn(),
	taskClearTask: vi.fn(),
	taskCancelBackgroundCommand: vi.fn(),
	taskCancelTask: vi.fn(),
	slashCondense: vi.fn(),
	slashReportBug: vi.fn(),
}))

vi.mock("@/components/chat/FocusChainChangeRow", () => ({
	getFocusChainSelectedPlan: vi.fn(() => ""),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ backgroundCommandRunning: false }),
}))

vi.mock("@/utils/streaming", () => ({
	isApiReqActive: vi.fn(() => false),
}))

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		askResponse: grpcMocks.taskAskResponse,
		newTask: grpcMocks.taskNewTask,
		clearTask: grpcMocks.taskClearTask,
		cancelBackgroundCommand: grpcMocks.taskCancelBackgroundCommand,
		cancelTask: grpcMocks.taskCancelTask,
	},
	SlashServiceClient: {
		condense: grpcMocks.slashCondense,
		reportBug: grpcMocks.slashReportBug,
	},
}))

/**
 * Create a minimal chat state for useMessageHandlers tests.
 * @param overrides Fields to override for a specific test case.
 * @returns ChatState with mocked mutators and derived values.
 */
function createChatState(overrides: Partial<ChatState> = {}): ChatState {
	return {
		inputValue: "",
		setInputValue: vi.fn(),
		activeQuote: null,
		setActiveQuote: vi.fn(),
		isTextAreaFocused: false,
		setIsTextAreaFocused: vi.fn(),
		selectedImages: [],
		setSelectedImages: vi.fn(),
		selectedFiles: [],
		setSelectedFiles: vi.fn(),
		sendingDisabled: false,
		setSendingDisabled: vi.fn(),
		enableButtons: true,
		setEnableButtons: vi.fn(),
		primaryButtonText: undefined,
		setPrimaryButtonText: vi.fn(),
		secondaryButtonText: undefined,
		setSecondaryButtonText: vi.fn(),
		expandedRows: {},
		setExpandedRows: vi.fn(),
		textAreaRef: { current: null },
		activeBlock: undefined,
		taskUiState: undefined,
		lastMessage: undefined,
		secondLastMessage: undefined,
		clineAsk: undefined,
		task: undefined,
		handleFocusChange: vi.fn(),
		clearExpandedRows: vi.fn(),
		resetState: vi.fn(),
		...overrides,
	}
}

/**
 * Create a snapshot-only message used when raw ask messages are hidden.
 * @param taskUiState Task UI state to mirror in the snapshot text.
 * @returns ClineMessage representing an internal state snapshot.
 */
function createSnapshotMessage(taskUiState: TaskUiState): ClineMessage {
	return {
		ts: 200,
		type: "say",
		say: "state_snapshot",
		text: JSON.stringify({
			phase: taskUiState.phase,
			apiIndex: 3,
			timestamp: 200,
			awaiting: taskUiState.activeAsk
				? {
						kind: taskUiState.phase === "completed" ? "completion" : "conversation",
						taskAsk: taskUiState.activeAsk,
						messageTs: 100,
					}
				: undefined,
		}),
		conversationHistoryIndex: 3,
	}
}

describe("useMessageHandlers taskUiState routing", () => {
	beforeEach(() => {
		Object.values(grpcMocks).forEach((mock) => mock.mockReset())
		grpcMocks.taskAskResponse.mockResolvedValue({})
		grpcMocks.taskNewTask.mockResolvedValue({})
		grpcMocks.taskClearTask.mockResolvedValue({})
		grpcMocks.taskCancelBackgroundCommand.mockResolvedValue({})
		grpcMocks.taskCancelTask.mockResolvedValue({})
	})

	it("sends awaiting conversation input using taskUiState when raw clineAsk is missing", async () => {
		const taskUiState: TaskUiState = {
			phase: "awaiting_input",
			inputEnabled: true,
			cancelEnabled: false,
			showFooter: false,
			actions: [],
			activeAsk: "qna_respond",
			reason: "conversation-awaiting",
		}
		const lastMessage = createSnapshotMessage(taskUiState)
		const chatState = createChatState({ taskUiState, lastMessage, clineAsk: undefined })
		const { result } = renderHook(() => useMessageHandlers([lastMessage], chatState))

		await act(async () => {
			await result.current.handleSendMessage("answer from input", [], [])
		})

		expect(grpcMocks.taskAskResponse).toHaveBeenCalledTimes(1)
		expect(grpcMocks.taskAskResponse.mock.calls[0]?.[0]).toMatchObject({
			responseType: "messageResponse",
			text: "answer from input",
		})
	})

	it("sends completion feedback using taskUiState when completion ask row is hidden", async () => {
		const taskUiState: TaskUiState = {
			phase: "completed",
			inputEnabled: true,
			cancelEnabled: false,
			showFooter: true,
			actions: [{ type: "start_new_task", label: "Start New Task", enabled: true }],
			activeAsk: "completion_result",
			reason: "completion-awaiting",
		}
		const lastMessage = createSnapshotMessage(taskUiState)
		const chatState = createChatState({ taskUiState, lastMessage, clineAsk: undefined })
		const { result } = renderHook(() => useMessageHandlers([lastMessage], chatState))

		await act(async () => {
			await result.current.handleSendMessage("please adjust the result", [], [])
		})

		expect(grpcMocks.taskAskResponse).toHaveBeenCalledTimes(1)
		expect(grpcMocks.taskAskResponse.mock.calls[0]?.[0]).toMatchObject({
			responseType: "messageResponse",
			text: "please adjust the result",
		})
	})

	it("sends process-anyway action input using taskUiState", async () => {
		const taskUiState: TaskUiState = {
			phase: "awaiting_error_recovery",
			inputEnabled: true,
			cancelEnabled: false,
			showFooter: true,
			actions: [{ type: "process_anyway", label: "Process Anyway", enabled: true }],
			activeAsk: "mistake_limit_reached",
			reason: "error-recovery:mistake_limit_reached",
		}
		const lastMessage = createSnapshotMessage(taskUiState)
		const chatState = createChatState({
			inputValue: "继续但不要重复刚才的空上下文错误",
			selectedImages: ["image-data"],
			selectedFiles: ["file-data"],
			taskUiState,
			lastMessage,
			clineAsk: undefined,
		})
		const { result } = renderHook(() => useMessageHandlers([lastMessage], chatState))

		await act(async () => {
			await result.current.executeTaskUiAction(taskUiState.actions[0])
		})

		expect(grpcMocks.taskAskResponse).toHaveBeenCalledTimes(1)
		expect(grpcMocks.taskAskResponse.mock.calls[0]?.[0]).toMatchObject({
			responseType: "messageResponse",
			text: "继续但不要重复刚才的空上下文错误",
			images: ["image-data"],
			files: ["file-data"],
		})
		expect(chatState.setInputValue).toHaveBeenCalledWith("")
	})

	it("sends condense utility input using taskUiState when raw clineAsk is missing", async () => {
		const taskUiState: TaskUiState = {
			phase: "awaiting_input",
			inputEnabled: true,
			cancelEnabled: false,
			showFooter: true,
			actions: [{ type: "utility", label: "Condense Conversation", enabled: true }],
			activeAsk: "condense",
			reason: "utility-awaiting:condense",
		}
		const lastMessage = createSnapshotMessage(taskUiState)
		const chatState = createChatState({
			inputValue: "压缩时保留最近的失败上下文",
			selectedImages: ["condense-image"],
			selectedFiles: ["condense-file"],
			taskUiState,
			lastMessage,
			clineAsk: undefined,
		})
		const { result } = renderHook(() => useMessageHandlers([lastMessage], chatState))

		await act(async () => {
			await result.current.executeTaskUiAction(taskUiState.actions[0])
		})

		expect(grpcMocks.taskAskResponse).toHaveBeenCalledTimes(1)
		expect(grpcMocks.taskAskResponse.mock.calls[0]?.[0]).toMatchObject({
			responseType: "yesButtonClicked",
			text: "压缩时保留最近的失败上下文",
			images: ["condense-image"],
			files: ["condense-file"],
		})
		expect(grpcMocks.slashCondense).not.toHaveBeenCalled()
		expect(chatState.setInputValue).toHaveBeenCalledWith("")
	})

	it("sends resume action input using taskUiState when resume ask row is hidden", async () => {
		const taskUiState: TaskUiState = {
			phase: "awaiting_resume",
			inputEnabled: true,
			cancelEnabled: false,
			showFooter: true,
			actions: [{ type: "resume", label: "Resume", enabled: true }],
			activeAsk: "resume_task",
			reason: "resume-from-stale-working:streaming",
		}
		const lastMessage = createSnapshotMessage(taskUiState)
		const chatState = createChatState({
			inputValue: "继续执行并带上说明",
			selectedImages: ["image-data"],
			selectedFiles: ["file-data"],
			taskUiState,
			lastMessage,
			clineAsk: undefined,
		})
		const { result } = renderHook(() => useMessageHandlers([lastMessage], chatState))

		await act(async () => {
			await result.current.executeTaskUiAction(taskUiState.actions[0])
		})

		expect(grpcMocks.taskAskResponse).toHaveBeenCalledTimes(1)
		expect(grpcMocks.taskAskResponse.mock.calls[0]?.[0]).toMatchObject({
			responseType: "yesButtonClicked",
			text: "继续执行并带上说明",
			images: ["image-data"],
			files: ["file-data"],
		})
		expect(chatState.setInputValue).toHaveBeenCalledWith("")
	})

	it("sends retry action input using taskUiState", async () => {
		const taskUiState: TaskUiState = {
			phase: "awaiting_error_recovery",
			inputEnabled: true,
			cancelEnabled: false,
			showFooter: true,
			actions: [{ type: "retry", label: "Retry", enabled: true }],
			activeAsk: "api_req_failed",
			reason: "error-recovery:api_req_failed",
		}
		const lastMessage = createSnapshotMessage(taskUiState)
		const chatState = createChatState({
			inputValue: "重试时请降低并发",
			selectedImages: ["retry-image"],
			selectedFiles: ["retry-file"],
			taskUiState,
			lastMessage,
			clineAsk: undefined,
		})
		const { result } = renderHook(() => useMessageHandlers([lastMessage], chatState))

		await act(async () => {
			await result.current.executeTaskUiAction(taskUiState.actions[0])
		})

		expect(grpcMocks.taskAskResponse).toHaveBeenCalledTimes(1)
		expect(grpcMocks.taskAskResponse.mock.calls[0]?.[0]).toMatchObject({
			responseType: "yesButtonClicked",
			text: "重试时请降低并发",
			images: ["retry-image"],
			files: ["retry-file"],
		})
		expect(chatState.setInputValue).toHaveBeenCalledWith("")
	})

	it("sends retry button input using legacy button action", async () => {
		const chatState = createChatState({ clineAsk: "api_req_failed" })
		const { result } = renderHook(() => useMessageHandlers([], chatState))

		await act(async () => {
			await result.current.executeButtonAction("retry", "  retry with smaller payload  ", ["legacy-image"], ["legacy-file"])
		})

		expect(grpcMocks.taskAskResponse).toHaveBeenCalledTimes(1)
		expect(grpcMocks.taskAskResponse.mock.calls[0]?.[0]).toMatchObject({
			responseType: "yesButtonClicked",
			text: "retry with smaller payload",
			images: ["legacy-image"],
			files: ["legacy-file"],
		})
	})

	it("sends status acknowledgment input using taskUiState primary action", async () => {
		const taskUiState: TaskUiState = {
			phase: "awaiting_acknowledgment",
			inputEnabled: true,
			cancelEnabled: false,
			showFooter: true,
			actions: [{ type: "primary", label: "Acknowledge", enabled: true }],
			activeAsk: "status_acknowledgment",
			reason: "status-acknowledgment",
		}
		const lastMessage = createSnapshotMessage(taskUiState)
		const chatState = createChatState({
			inputValue: "我知道了，下一步先检查配置",
			selectedImages: ["ack-image"],
			selectedFiles: ["ack-file"],
			taskUiState,
			lastMessage,
			clineAsk: undefined,
		})
		const { result } = renderHook(() => useMessageHandlers([lastMessage], chatState))

		await act(async () => {
			await result.current.executeTaskUiAction(taskUiState.actions[0])
		})

		expect(grpcMocks.taskAskResponse).toHaveBeenCalledTimes(1)
		expect(grpcMocks.taskAskResponse.mock.calls[0]?.[0]).toMatchObject({
			responseType: "yesButtonClicked",
			text: "我知道了，下一步先检查配置",
			images: ["ack-image"],
			files: ["ack-file"],
		})
	})

	it("sends status acknowledgment stop input using taskUiState secondary action", async () => {
		const taskUiState: TaskUiState = {
			phase: "awaiting_acknowledgment",
			inputEnabled: true,
			cancelEnabled: false,
			showFooter: true,
			actions: [{ type: "secondary", label: "Stop", enabled: true }],
			activeAsk: "status_acknowledgment",
			reason: "status-acknowledgment",
		}
		const lastMessage = createSnapshotMessage(taskUiState)
		const chatState = createChatState({
			inputValue: "先停止，我要调整方向",
			selectedImages: ["stop-image"],
			selectedFiles: ["stop-file"],
			taskUiState,
			lastMessage,
			clineAsk: undefined,
		})
		const { result } = renderHook(() => useMessageHandlers([lastMessage], chatState))

		await act(async () => {
			await result.current.executeTaskUiAction(taskUiState.actions[0])
		})

		expect(grpcMocks.taskAskResponse).toHaveBeenCalledTimes(1)
		expect(grpcMocks.taskAskResponse.mock.calls[0]?.[0]).toMatchObject({
			responseType: "noButtonClicked",
			text: "先停止，我要调整方向",
			images: ["stop-image"],
			files: ["stop-file"],
		})
	})
})
