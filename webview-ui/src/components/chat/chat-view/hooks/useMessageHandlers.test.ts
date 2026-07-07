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

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ backgroundCommandRunning: false }),
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
})
