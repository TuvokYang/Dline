import type { ClineMessage, TaskViewState } from "@shared/ExtensionMessage"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AcceptedInteractionSettlement, InteractionDraft } from "@/task-interaction/types"

const mocks = vi.hoisted(() => {
	const chatState = {
		inputValue: "draft",
		setInputValue: vi.fn(),
		activeQuote: null as string | null,
		setActiveQuote: vi.fn(),
		isTextAreaFocused: false,
		setIsTextAreaFocused: vi.fn(),
		selectedImages: [] as string[],
		setSelectedImages: vi.fn(),
		selectedFiles: [] as string[],
		setSelectedFiles: vi.fn(),
		sendingDisabled: false,
		setSendingDisabled: vi.fn(),
		enableButtons: false,
		setEnableButtons: vi.fn(),
		primaryButtonText: undefined,
		setPrimaryButtonText: vi.fn(),
		secondaryButtonText: undefined,
		setSecondaryButtonText: vi.fn(),
		expandedRows: {},
		setExpandedRows: vi.fn(),
		textAreaRef: { current: null },
		handleFocusChange: vi.fn(),
		clearExpandedRows: vi.fn(),
		resetState: vi.fn(),
	}
	return {
		chatState,
		extensionState: {} as Record<string, unknown>,
		dispatchInteraction: vi.fn(async () => ({ accepted: true, result: "accepted" })),
		compactTask: vi.fn(async () => ({ accepted: true, result: "accepted" })),
		useChatState: vi.fn(() => chatState),
	}
})

vi.mock("@shared/combineApiRequests", () => ({ combineApiRequests: (messages: unknown) => messages }))
vi.mock("@shared/combineCommandSequences", () => ({ combineCommandSequences: (messages: unknown) => messages }))
vi.mock("@shared/combineErrorRetryMessages", () => ({ combineErrorRetryMessages: (messages: unknown) => messages }))
vi.mock("@shared/combineHookSequences", () => ({ combineHookSequences: (messages: unknown) => messages }))
vi.mock("@/components/settings/providers/useApiProfiles", () => ({ useApiProfiles: () => ({ profiles: [] }) }))
vi.mock("@/components/settings/providers/useProviderModels", () => ({
	useProviderModels: () => ({ models: {}, defaultModelId: "" }),
}))
vi.mock("@/context/ExtensionStateContext", () => ({ useExtensionState: () => mocks.extensionState }))
vi.mock("@/context/PlatformContext", () => ({ useShowNavbar: () => false }))
vi.mock("@/services/grpc-client", () => ({
	FileServiceClient: {
		copyToClipboard: vi.fn(async () => undefined),
		selectFiles: vi.fn(async () => ({ values1: [], values2: [] })),
	},
	TaskServiceClient: {
		compactTask: mocks.compactTask,
		dispatchInteraction: mocks.dispatchInteraction,
	},
	UiServiceClient: {
		subscribeToAddToInput: vi.fn(() => () => undefined),
		subscribeToShowWebview: vi.fn(() => () => undefined),
	},
}))
vi.mock("@/task-interaction/InteractionHost", () => ({ InteractionHost: () => null }))
vi.mock("../activity/TaskActivityPanel", () => ({
	DEFAULT_TASK_ACTIVITY_FILTERS: { statuses: ["active"], kinds: [] },
	TaskActivityPanel: () => null,
}))
vi.mock("../activity/TaskActivityTabs", () => ({ TaskActivityTabs: () => null }))
vi.mock("../activity/useTaskActivities", () => ({ useTaskActivities: () => ({ activeCount: 0 }) }))
vi.mock("../auto-approve-menu/AutoApproveBar", () => ({ default: () => null }))
vi.mock("../menu/Navbar", () => ({ Navbar: () => null }))
vi.mock("../chat-view/utils/profileUtils", () => ({
	resolveActiveProfile: () => undefined,
	resolveTaskCurrency: (currency: string | undefined) => currency ?? "USD",
}))
vi.mock("../chat-view", () => {
	return {
		CHAT_CONSTANTS: { MAX_IMAGES_AND_FILES_PER_MESSAGE: 20 },
		ChatLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		InputSection: ({
			chatState,
			draft,
			enabled,
			onDraftAccepted,
			onSubmit,
		}: {
			chatState: { inputValue: string }
			draft: InteractionDraft
			enabled?: boolean
			onDraftAccepted: (settlement: AcceptedInteractionSettlement) => void
			onSubmit?: (draft: InteractionDraft) => Promise<AcceptedInteractionSettlement | undefined>
		}) => (
			<div>
				<textarea aria-label="Task input" disabled={!enabled} readOnly value={chatState.inputValue} />
				<button
					aria-label="Invoke Enter"
					onClick={() => {
						void onSubmit?.(draft).then((settlement) => {
							if (settlement) onDraftAccepted(settlement)
						})
					}}
					type="button">
					Enter
				</button>
			</div>
		),
		MessagesArea: () => null,
		TaskSection: ({
			compactTaskDisabled,
			onCompactTask,
		}: {
			compactTaskDisabled?: boolean
			onCompactTask?: () => Promise<boolean>
		}) =>
			onCompactTask ? (
				<button
					aria-disabled={compactTaskDisabled ? "true" : "false"}
					aria-label="Compact task"
					disabled={compactTaskDisabled}
					onClick={() => void onCompactTask()}
					type="button">
					Compact
				</button>
			) : null,
		TaskActivityPanel: () => null,
		TaskActivityTabs: () => null,
		WelcomeSection: () => null,
		convertHtmlToMarkdown: async (value: string) => value,
		filterVisibleMessages: (messages: ClineMessage[]) => messages,
		groupLowStakesTools: (messages: ClineMessage[]) => messages,
		groupMessages: (messages: ClineMessage[]) => messages,
		useChatState: mocks.useChatState,
		useMessageHandlers: () => ({
			handleSendMessage: vi.fn(async () => undefined),
			handleTaskCloseButtonClick: vi.fn(),
			startNewTask: vi.fn(async () => undefined),
		}),
		useScrollBehavior: () => ({
			disableAutoScrollRef: { current: false },
			isAtBottom: true,
			scrollToBottomAuto: vi.fn(),
		}),
	}
})

import ChatView from "../ChatView"

const ASK: ClineMessage = {
	ts: 100,
	type: "ask",
	ask: "qna_respond",
	text: "Question",
	interactionId: "interaction-1",
}

function taskView(): TaskViewState {
	return {
		taskId: "task-1",
		phase: "awaiting_approval",
		stateRevision: 8,
		activeInteraction: {
			taskId: "task-1",
			turnId: "turn-1",
			interactionId: "interaction-1",
			kind: "qna_response",
			status: "awaiting",
			stateRevision: 8,
			taskAsk: "qna_respond",
			presentationKind: "qna_response",
			askMessageTs: 100,
		},
		input: {
			enabled: true,
			acceptsText: true,
			acceptsImages: true,
			acceptsFiles: true,
			enterAction: "reply",
		},
		footer: { actions: [] },
	}
}

function chatView() {
	return <ChatView hideAnnouncement={vi.fn()} isHidden={false} showAnnouncement={false} showHistoryView={vi.fn()} />
}

function renderChat(
	messages: ClineMessage[],
	view: TaskViewState = taskView(),
	includeHistoryItem = true,
): ReturnType<typeof render> {
	mocks.extensionState = {
		version: "test",
		clineMessages: messages,
		taskHistory: [],
		apiConfiguration: {},
		telemetrySetting: "disabled",
		mode: "act",
		currentFocusChainChecklist: "",
		focusChainSettings: { enabled: false },
		hooksEnabled: false,
		apiMetrics: { totalTokensIn: 0, totalTokensOut: 0, totalCost: 0 },
		lastApiReqTotalTokens: 0,
		taskViewState: view,
		currentTaskItem: includeHistoryItem ? { id: "task-1", task: "Task", ts: 1 } : undefined,
		taskTitleMessage: { ts: 1, type: "say", say: "task", text: "Task" },
	}
	return render(chatView())
}

describe("ChatView interaction anchor synchronization", () => {
	beforeEach(() => {
		mocks.compactTask.mockClear()
		mocks.dispatchInteraction.mockClear()
		mocks.useChatState.mockClear()
		mocks.chatState.inputValue = "draft"
		mocks.chatState.activeQuote = null
		mocks.chatState.selectedImages = []
		mocks.chatState.selectedFiles = []
		mocks.chatState.setInputValue.mockClear()
		mocks.chatState.setActiveQuote.mockClear()
		mocks.chatState.setSelectedImages.mockClear()
		mocks.chatState.setSelectedFiles.mockClear()
	})

	it("keeps runtime task ownership when the shared history item is temporarily unavailable", () => {
		renderChat([ASK], taskView(), false)

		expect(mocks.useChatState).toHaveBeenCalledWith([ASK], "task-1")
	})

	it.each([
		["missing", []],
		["timestamp", [{ ...ASK, ts: 101 }]],
		["missing interaction identity", [{ ...ASK, interactionId: undefined }]],
		["interaction identity", [{ ...ASK, interactionId: "interaction-2" }]],
		["task ask", [{ ...ASK, ask: "command" as const }]],
		["duplicate exact identity", [ASK, { ...ASK, text: "Duplicate question" }]],
	] as const)("disables InputSection and rejects Enter for a %s anchor", async (_case, messages) => {
		renderChat([...messages])

		expect(screen.getByRole("textbox", { name: "Task input" })).toBeDisabled()
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Invoke Enter" }))
		})
		expect(mocks.dispatchInteraction).not.toHaveBeenCalled()
	})

	it("disables InputSection and rejects Enter when the interaction renderer is unsupported", async () => {
		const view = taskView()
		if (!view.activeInteraction) throw new Error("Expected active interaction")
		view.activeInteraction.presentationKind = "unsupported"
		renderChat([ASK], view)

		expect(screen.getByRole("textbox", { name: "Task input" })).toBeDisabled()
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Invoke Enter" }))
		})
		expect(mocks.dispatchInteraction).not.toHaveBeenCalled()
	})

	it("keeps Compact enabled whenever the footer input is enabled, regardless of enter action", () => {
		const view = taskView()
		view.input.enterAction = "reject"
		renderChat([ASK], view)

		expect(screen.getByRole("textbox", { name: "Task input" })).toBeEnabled()
		expect(screen.getByRole("button", { name: "Compact task" })).toBeEnabled()
	})

	it("keeps Compact visible but disabled when the footer input is unavailable", () => {
		const view = taskView()
		view.input.enabled = false
		renderChat([ASK], view)

		expect(screen.getByRole("textbox", { name: "Task input" })).toBeDisabled()
		const compactButton = screen.getByRole("button", { name: "Compact task" })
		expect(compactButton).toBeDisabled()
		fireEvent.click(compactButton)
		expect(mocks.compactTask).not.toHaveBeenCalled()
	})

	it("routes Compact through the dedicated task RPC instead of the active interaction", async () => {
		const view = taskView()
		view.input.enterAction = "reject"
		renderChat([ASK], view)

		fireEvent.click(screen.getByRole("button", { name: "Compact task" }))

		await waitFor(() => expect(mocks.compactTask).toHaveBeenCalledOnce())
		expect(mocks.compactTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: "task-1" }))
		expect(mocks.dispatchInteraction).not.toHaveBeenCalled()
	})

	it("enables InputSection and submits Enter for the exact anchor", async () => {
		renderChat([ASK])

		expect(screen.getByRole("textbox", { name: "Task input" })).toBeEnabled()
		fireEvent.click(screen.getByRole("button", { name: "Invoke Enter" }))

		await waitFor(() => expect(mocks.dispatchInteraction).toHaveBeenCalledOnce())
	})

	it("submits condense feedback as Reject when Enter is pressed", async () => {
		const view = taskView()
		if (!view.activeInteraction) throw new Error("Expected active interaction")
		view.activeInteraction = {
			...view.activeInteraction,
			kind: "condense",
			taskAsk: "condense",
			presentationKind: "condense",
		}
		view.input.enterAction = "reject"
		view.footer.actions = [
			{
				type: "confirm_utility",
				label: "Condense Conversation",
				appearance: "primary",
				enabled: true,
				payloadPolicy: "draft",
				dispatchTarget: "interaction",
			},
			{
				type: "reject",
				label: "Regenerate Summary",
				appearance: "secondary",
				enabled: true,
				payloadPolicy: "draft",
				dispatchTarget: "interaction",
			},
		]
		const condenseAsk: ClineMessage = { ...ASK, ask: "condense", text: "Summary preview" }
		mocks.chatState.inputValue = "Keep the deployment details"

		renderChat([condenseAsk], view)
		fireEvent.click(screen.getByRole("button", { name: "Invoke Enter" }))

		await waitFor(() => expect(mocks.dispatchInteraction).toHaveBeenCalledOnce())
		expect(mocks.dispatchInteraction).toHaveBeenCalledWith(
			expect.objectContaining({
				actionId: "reject",
				draft: { text: "Keep the deployment details", images: [], files: [] },
			}),
		)
		expect(mocks.chatState.setInputValue).toHaveBeenCalledWith("")
	})

	it("clears the complete submitted draft before dispatch settles", async () => {
		let resolveDispatch: ((response: { accepted: boolean; result: string }) => void) | undefined
		mocks.dispatchInteraction.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveDispatch = resolve
				}),
		)
		mocks.chatState.activeQuote = "quoted context"
		mocks.chatState.selectedImages = ["image.png"]
		mocks.chatState.selectedFiles = ["file.txt"]
		renderChat([ASK])

		fireEvent.click(screen.getByRole("button", { name: "Invoke Enter" }))

		expect(mocks.dispatchInteraction).toHaveBeenCalledOnce()
		expect(mocks.chatState.setInputValue).toHaveBeenCalledWith("")
		expect(mocks.chatState.setSelectedImages).toHaveBeenCalledWith([])
		expect(mocks.chatState.setSelectedFiles).toHaveBeenCalledWith([])
		expect(mocks.chatState.setActiveQuote).toHaveBeenCalledWith(null)
		await act(async () => resolveDispatch?.({ accepted: true, result: "accepted" }))
	})

	it("does not restore the submitted draft when dispatch rejects it", async () => {
		mocks.dispatchInteraction.mockResolvedValueOnce({ accepted: false, result: "rejected" })
		renderChat([ASK])

		fireEvent.click(screen.getByRole("button", { name: "Invoke Enter" }))
		await waitFor(() => expect(mocks.dispatchInteraction).toHaveBeenCalledOnce())

		expect(mocks.chatState.setInputValue).toHaveBeenCalledWith("")
		expect(mocks.chatState.setInputValue).not.toHaveBeenCalledWith("draft")
	})

	it("does not clear a newer draft when the original dispatch settles", async () => {
		let resolveDispatch: ((response: { accepted: boolean; result: string }) => void) | undefined
		mocks.dispatchInteraction.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					resolveDispatch = resolve
				}),
		)
		const rendered = renderChat([ASK])

		fireEvent.click(screen.getByRole("button", { name: "Invoke Enter" }))
		await waitFor(() => expect(mocks.dispatchInteraction).toHaveBeenCalledOnce())
		expect(mocks.chatState.setInputValue).toHaveBeenCalledWith("")
		mocks.chatState.setInputValue.mockClear()
		mocks.chatState.inputValue = "new draft"
		rendered.rerender(chatView())

		expect(screen.getByRole("textbox", { name: "Task input" })).toHaveValue("new draft")
		await act(async () => resolveDispatch?.({ accepted: true, result: "accepted" }))
		expect(mocks.chatState.setInputValue).not.toHaveBeenCalled()
	})
})
