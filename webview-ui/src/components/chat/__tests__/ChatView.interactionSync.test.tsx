import type { ClineMessage, TaskViewState } from "@shared/ExtensionMessage"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AcceptedInteractionSettlement, InteractionDraft } from "@/task-interaction/types"

const mocks = vi.hoisted(() => ({
	extensionState: {} as Record<string, unknown>,
	dispatchInteraction: vi.fn(async () => ({ accepted: true, result: "accepted" })),
}))

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
	TaskServiceClient: { dispatchInteraction: mocks.dispatchInteraction },
	UiServiceClient: {
		subscribeToAddToInput: vi.fn(() => () => undefined),
		subscribeToShowWebview: vi.fn(() => () => undefined),
	},
}))
vi.mock("@/task-interaction/InteractionHost", () => ({ InteractionHost: () => null }))
vi.mock("../activity/TaskActivityPanel", () => ({ TaskActivityPanel: () => null }))
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
			draft,
			enabled,
			onSubmit,
		}: {
			draft: InteractionDraft
			enabled?: boolean
			onSubmit?: (draft: InteractionDraft) => Promise<AcceptedInteractionSettlement | undefined>
		}) => (
			<div>
				<textarea aria-label="Task input" disabled={!enabled} />
				<button aria-label="Invoke Enter" onClick={() => void onSubmit?.(draft)} type="button">
					Enter
				</button>
			</div>
		),
		MessagesArea: () => null,
		TaskSection: () => null,
		TaskActivityPanel: () => null,
		TaskActivityTabs: () => null,
		WelcomeSection: () => null,
		convertHtmlToMarkdown: async (value: string) => value,
		filterVisibleMessages: (messages: ClineMessage[]) => messages,
		groupLowStakesTools: (messages: ClineMessage[]) => messages,
		groupMessages: (messages: ClineMessage[]) => messages,
		useChatState: () => ({
			inputValue: "draft",
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
		}),
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

function renderChat(messages: ClineMessage[], view: TaskViewState = taskView()): void {
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
		currentTaskItem: { id: "task-1", task: "Task", ts: 1 },
		taskTitleMessage: { ts: 1, type: "say", say: "task", text: "Task" },
	}
	render(<ChatView hideAnnouncement={vi.fn()} isHidden={false} showAnnouncement={false} showHistoryView={vi.fn()} />)
}

describe("ChatView interaction anchor synchronization", () => {
	beforeEach(() => {
		mocks.dispatchInteraction.mockClear()
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

	it("enables InputSection and submits Enter for the exact anchor", async () => {
		renderChat([ASK])

		expect(screen.getByRole("textbox", { name: "Task input" })).toBeEnabled()
		fireEvent.click(screen.getByRole("button", { name: "Invoke Enter" }))

		await waitFor(() => expect(mocks.dispatchInteraction).toHaveBeenCalledOnce())
	})
})
