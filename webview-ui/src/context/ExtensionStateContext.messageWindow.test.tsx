import type { ExtensionState } from "@shared/ExtensionMessage"
import { convertClineMessageToProto } from "@shared/proto-conversions/cline-message"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useEffect } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const subscriptions = vi.hoisted(() => ({
	state: undefined as undefined | { onResponse: (response: { stateJson?: string }) => void },
	partial: undefined as undefined | { onResponse: (message: ReturnType<typeof convertClineMessageToProto>) => void },
}))

vi.mock("../services/grpc-client", () => {
	const unsubscribe = () => {}
	const stream = (_request: unknown, _handlers: unknown) => unsubscribe
	return {
		StateServiceClient: {
			subscribeToState: vi.fn((_request: unknown, handlers: typeof subscriptions.state) => {
				subscriptions.state = handlers
				return unsubscribe
			}),
			getAvailableTerminalProfiles: vi.fn(async () => ({ profiles: [] })),
		},
		TaskServiceClient: {
			fetchMessage: vi.fn(async () => ({ messages: [], startIndex: 0 })),
			dispatchInteraction: vi.fn(async () => ({ accepted: true, result: "accepted" })),
		},
		UiServiceClient: {
			subscribeToMcpButtonClicked: vi.fn(stream),
			subscribeToHistoryButtonClicked: vi.fn(stream),
			subscribeToChatButtonClicked: vi.fn(stream),
			subscribeToSettingsButtonClicked: vi.fn(stream),
			subscribeToWorktreesButtonClicked: vi.fn(stream),
			subscribeToPartialMessage: vi.fn((_request: unknown, handlers: typeof subscriptions.partial) => {
				subscriptions.partial = handlers
				return unsubscribe
			}),
			subscribeToAccountButtonClicked: vi.fn(stream),
			subscribeToRelinquishControl: vi.fn(stream),
			initializeWebview: vi.fn(async () => undefined),
		},
		McpServiceClient: {
			subscribeToMcpServers: vi.fn(stream),
			subscribeToMcpMarketplaceCatalog: vi.fn(stream),
		},
		ModelsServiceClient: {
			subscribeToOpenRouterModels: vi.fn(stream),
			subscribeToLiteLlmModels: vi.fn(stream),
			refreshOpenRouterModelsRpc: vi.fn(async () => ({ models: {} })),
			refreshHicapModels: vi.fn(async () => ({ models: {} })),
			refreshLiteLlmModelsRpc: vi.fn(async () => ({ models: {} })),
			refreshBasetenModelsRpc: vi.fn(async () => ({ models: {} })),
			refreshVercelAiGatewayModelsRpc: vi.fn(async () => ({ models: {} })),
			refreshClineModelsRpc: vi.fn(async () => ({ models: {} })),
		},
	}
})

import { ChatRowContent } from "../components/chat/ChatRow"
import { useChatState } from "../components/chat/chat-view/hooks/useChatState"
import { TaskServiceClient } from "../services/grpc-client"
import { InteractionHost } from "../task-interaction/InteractionHost"
import { ExtensionStateContextProvider, useExtensionState } from "./ExtensionStateContext"

function MessageProbe() {
	const { clineMessages } = useExtensionState()
	return (
		<div>
			{clineMessages.map((message, index) => (
				<ChatRowContent
					isExpanded={false}
					isLast={index === clineMessages.length - 1}
					key={message.ts}
					message={message}
					onSetQuote={vi.fn()}
					onToggleExpand={vi.fn()}
				/>
			))}
		</div>
	)
}

function InteractionProbe({ observedTaskIds }: { observedTaskIds: Array<string | undefined> }) {
	const { clineMessages, currentTaskItem, taskViewState } = useExtensionState()
	const chatState = useChatState(clineMessages, currentTaskItem?.id)

	useEffect(() => {
		observedTaskIds.push(currentTaskItem?.id)
	}, [currentTaskItem?.id, observedTaskIds])

	return (
		<>
			<label>
				Interaction draft
				<input onChange={(event) => chatState.setInputValue(event.target.value)} value={chatState.inputValue} />
			</label>
			<div data-testid="active-task-id">{currentTaskItem?.id ?? "none"}</div>
			{taskViewState ? (
				<InteractionHost
					dispatch={TaskServiceClient.dispatchInteraction}
					draft={{
						text: chatState.inputValue,
						images: chatState.selectedImages,
						files: chatState.selectedFiles,
					}}
					messages={clineMessages}
					view={taskViewState}
				/>
			) : null}
		</>
	)
}

function outOfSyncInteractionState(revision: number): ExtensionState {
	return {
		...stateSnapshot({ revision, total: 1 }),
		taskViewState: {
			taskId: "task-1",
			phase: "awaiting_approval",
			stateRevision: revision,
			activeInteraction: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "interaction-1",
				kind: "qna_response",
				status: "awaiting",
				stateRevision: revision,
				taskAsk: "qna_respond",
				presentationKind: "qna_response",
				askMessageTs: 100,
			},
			input: { enabled: true, acceptsText: true, acceptsImages: true, acceptsFiles: true, enterAction: "reply" },
			footer: { actions: [] },
		},
	} as ExtensionState
}

function stateSnapshot(input: { revision: number; total: number }): ExtensionState {
	return {
		stateRevision: input.revision,
		version: "test",
		currentTaskItem: { id: "task-1", task: "Task", ts: 1 },
		taskTitleMessage: { ts: 1, type: "say", say: "task", text: "Task" },
		totalMessageCount: input.total,
		welcomeViewCompleted: true,
	} as ExtensionState
}

function resumeInteractionState(revision: number): ExtensionState {
	return {
		...stateSnapshot({ revision, total: 1 }),
		taskViewState: {
			taskId: "task-1",
			phase: "paused",
			stateRevision: revision,
			activeInteraction: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "resume-1",
				kind: "resume",
				status: "awaiting",
				stateRevision: revision,
				taskAsk: "resume_task",
				presentationKind: "resume",
				askMessageTs: 100,
			},
			input: { enabled: true, acceptsText: true, acceptsImages: true, acceptsFiles: true, enterAction: "resume" },
			footer: {
				actions: [
					{
						type: "resume",
						label: "Resume",
						appearance: "primary",
						enabled: true,
						payloadPolicy: "draft",
					},
				],
			},
		},
	} as ExtensionState
}

function completionInteractionState(revision: number): ExtensionState {
	return {
		...stateSnapshot({ revision, total: 1 }),
		taskViewState: {
			taskId: "task-1",
			phase: "completed",
			stateRevision: revision,
			activeInteraction: {
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "completion-1",
				kind: "completion",
				status: "awaiting",
				stateRevision: revision,
				taskAsk: "completion_result",
				presentationKind: "completion",
				askMessageTs: 100,
			},
			input: { enabled: true, acceptsText: true, acceptsImages: true, acceptsFiles: true, enterAction: "reply" },
			footer: {
				actions: [
					{
						type: "start_new_task",
						label: "Start New Task",
						appearance: "primary",
						enabled: true,
						payloadPolicy: "draft",
					},
				],
			},
		},
	} as ExtensionState
}

describe("ExtensionStateContext persisted message reconciliation", () => {
	beforeEach(() => {
		vi.mocked(TaskServiceClient.fetchMessage).mockReset().mockResolvedValue({ messages: [], startIndex: 0 })
		vi.mocked(TaskServiceClient.dispatchInteraction).mockReset().mockResolvedValue({ accepted: true, result: "accepted" })
		subscriptions.state = undefined
		subscriptions.partial = undefined
	})

	it("dispatches anchored Resume without clearing the active task identity or draft", async () => {
		const resumeAsk = convertClineMessageToProto({
			ts: 100,
			type: "ask",
			ask: "resume_task",
			text: "Resume task",
			interactionId: "resume-1",
		})
		vi.mocked(TaskServiceClient.fetchMessage).mockResolvedValue({ messages: [resumeAsk], startIndex: 0 })
		const observedTaskIds: Array<string | undefined> = []
		render(
			<ExtensionStateContextProvider>
				<InteractionProbe observedTaskIds={observedTaskIds} />
			</ExtensionStateContextProvider>,
		)
		await waitFor(() => expect(subscriptions.state).toBeDefined())

		act(() => {
			subscriptions.state?.onResponse({ stateJson: JSON.stringify(resumeInteractionState(1)) })
		})
		await waitFor(() => expect(screen.getByTestId("active-task-id")).toHaveTextContent("task-1"))
		await waitFor(() => expect(screen.getByRole("button", { name: "Resume" })).toBeVisible())
		fireEvent.change(screen.getByLabelText("Interaction draft"), { target: { value: "continue carefully" } })
		observedTaskIds.length = 0

		fireEvent.click(screen.getByRole("button", { name: "Resume" }))
		await waitFor(() => expect(TaskServiceClient.dispatchInteraction).toHaveBeenCalledOnce())
		await waitFor(() => expect(screen.getByTestId("active-task-id")).toHaveTextContent("task-1"))

		expect(TaskServiceClient.dispatchInteraction).toHaveBeenCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				turnId: "turn-1",
				interactionId: "resume-1",
				actionId: "resume",
				stateRevision: 1,
				draft: { text: "continue carefully", images: [], files: [] },
			}),
		)
		expect(screen.getByLabelText("Interaction draft")).toHaveValue("continue carefully")
		expect(observedTaskIds).not.toContain(undefined)
	})

	it("automatically refetches a missing exact anchor without clearing the draft", async () => {
		const ask = convertClineMessageToProto({
			ts: 100,
			type: "ask",
			ask: "qna_respond",
			text: "Question",
			interactionId: "interaction-1",
		})
		vi.mocked(TaskServiceClient.fetchMessage)
			.mockResolvedValueOnce({ messages: [], startIndex: 0 })
			.mockResolvedValueOnce({ messages: [ask], startIndex: 0 })
		render(
			<ExtensionStateContextProvider>
				<InteractionProbe observedTaskIds={[]} />
			</ExtensionStateContextProvider>,
		)
		await waitFor(() => expect(subscriptions.state).toBeDefined())

		act(() => {
			subscriptions.state?.onResponse({ stateJson: JSON.stringify(outOfSyncInteractionState(1)) })
		})
		fireEvent.change(screen.getByLabelText("Interaction draft"), { target: { value: "keep unsent draft" } })

		await waitFor(() => expect(screen.getByText("Question")).toBeVisible())
		expect(screen.getByLabelText("Interaction draft")).toHaveValue("keep unsent draft")
		expect(TaskServiceClient.fetchMessage).toHaveBeenCalledTimes(2)
		expect(TaskServiceClient.fetchMessage).toHaveBeenCalledWith({ referenceIndex: -1, count: 200 })
	})

	it("does not let a stale completion say downgrade a realtime completion ask anchor", async () => {
		const staleSay = convertClineMessageToProto({
			ts: 100,
			type: "say",
			say: "completion_result",
			text: "Completed",
		})
		const completionAsk = convertClineMessageToProto({
			ts: 100,
			type: "ask",
			ask: "completion_result",
			text: "Completed",
			interactionId: "completion-1",
		})
		let resolveStaleFetch: ((value: { messages: [typeof staleSay]; startIndex: number }) => void) | undefined
		const staleFetch = new Promise<{ messages: [typeof staleSay]; startIndex: number }>((resolve) => {
			resolveStaleFetch = resolve
		})
		vi.mocked(TaskServiceClient.fetchMessage)
			.mockReturnValueOnce(staleFetch)
			.mockResolvedValue({ messages: [staleSay], startIndex: 0 })

		render(
			<ExtensionStateContextProvider>
				<InteractionProbe observedTaskIds={[]} />
			</ExtensionStateContextProvider>,
		)
		await waitFor(() => expect(subscriptions.state).toBeDefined())
		act(() => {
			subscriptions.state?.onResponse({ stateJson: JSON.stringify(completionInteractionState(1)) })
		})
		await waitFor(() => expect(TaskServiceClient.fetchMessage).toHaveBeenCalledOnce())

		act(() => {
			subscriptions.partial?.onResponse(completionAsk)
		})
		await waitFor(() => expect(screen.getByRole("button", { name: "Start New Task" })).toBeVisible())

		await act(async () => {
			resolveStaleFetch?.({ messages: [staleSay], startIndex: 0 })
			await staleFetch
		})

		await waitFor(() => expect(TaskServiceClient.fetchMessage).toHaveBeenCalledTimes(2))
		expect(screen.getByRole("button", { name: "Start New Task" })).toBeVisible()
	})

	it("renders partial user_feedback through ChatRow when the realtime event arrives normally", async () => {
		const feedback = convertClineMessageToProto({
			ts: 20,
			type: "say",
			say: "user_feedback",
			text: "streaming feedback",
			partial: true,
		})
		render(
			<ExtensionStateContextProvider>
				<MessageProbe />
			</ExtensionStateContextProvider>,
		)
		await waitFor(() => expect(subscriptions.state).toBeDefined())
		act(() => {
			subscriptions.state?.onResponse({ stateJson: JSON.stringify(stateSnapshot({ revision: 1, total: 1 })) })
		})
		await waitFor(() => expect(TaskServiceClient.fetchMessage).toHaveBeenCalledOnce())

		act(() => {
			subscriptions.partial?.onResponse(feedback)
		})

		await waitFor(() => expect(screen.getByText("streaming feedback")).toBeVisible())
		expect(screen.getAllByText("streaming feedback")).toHaveLength(1)
	})

	it("fetches the missing tail when persisted user_feedback increases the total but its stream event is lost", async () => {
		const initial = convertClineMessageToProto({ ts: 10, type: "say", say: "text", text: "assistant" })
		const feedback = convertClineMessageToProto({ ts: 20, type: "say", say: "user_feedback", text: "visible feedback" })
		vi.mocked(TaskServiceClient.fetchMessage)
			.mockResolvedValueOnce({ messages: [initial], startIndex: 0 })
			.mockResolvedValueOnce({ messages: [initial, feedback], startIndex: 0 })

		render(
			<ExtensionStateContextProvider>
				<MessageProbe />
			</ExtensionStateContextProvider>,
		)
		await waitFor(() => expect(subscriptions.state).toBeDefined())

		act(() => {
			subscriptions.state?.onResponse({ stateJson: JSON.stringify(stateSnapshot({ revision: 1, total: 1 })) })
		})
		await waitFor(() => expect(screen.getByText("assistant")).toBeVisible())

		act(() => {
			subscriptions.state?.onResponse({ stateJson: JSON.stringify(stateSnapshot({ revision: 2, total: 2 })) })
		})

		await waitFor(() => expect(screen.getByText("visible feedback")).toBeVisible())
		expect(TaskServiceClient.fetchMessage).toHaveBeenCalledTimes(2)
		expect(screen.getAllByText("visible feedback")).toHaveLength(1)
		expect(subscriptions.partial).toBeDefined()
	})

	it("recovers a missed message even when a later realtime message is already present", async () => {
		const initial = convertClineMessageToProto({ ts: 10, type: "say", say: "text", text: "assistant" })
		const feedback = convertClineMessageToProto({ ts: 20, type: "say", say: "user_feedback", text: "missed feedback" })
		const later = convertClineMessageToProto({ ts: 30, type: "say", say: "text", text: "later response" })
		vi.mocked(TaskServiceClient.fetchMessage)
			.mockResolvedValueOnce({ messages: [initial], startIndex: 0 })
			.mockResolvedValueOnce({ messages: [initial, feedback, later], startIndex: 0 })

		render(
			<ExtensionStateContextProvider>
				<MessageProbe />
			</ExtensionStateContextProvider>,
		)
		await waitFor(() => expect(subscriptions.state).toBeDefined())
		act(() => {
			subscriptions.state?.onResponse({ stateJson: JSON.stringify(stateSnapshot({ revision: 1, total: 1 })) })
		})
		await waitFor(() => expect(screen.getByText("assistant")).toBeVisible())

		act(() => {
			subscriptions.partial?.onResponse(later)
			subscriptions.state?.onResponse({ stateJson: JSON.stringify(stateSnapshot({ revision: 2, total: 3 })) })
		})

		await waitFor(() => expect(screen.getByText("missed feedback")).toBeVisible())
		expect(screen.getAllByText("later response")).toHaveLength(1)
		expect(TaskServiceClient.fetchMessage).toHaveBeenCalledTimes(2)
		expect(
			screen.getByText("missed feedback").compareDocumentPosition(screen.getByText("later response")) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
	})

	it("deduplicates a delayed partial event after the persisted tail has already been recovered", async () => {
		const initial = convertClineMessageToProto({ ts: 10, type: "say", say: "text", text: "assistant" })
		const feedback = convertClineMessageToProto({ ts: 20, type: "say", say: "user_feedback", text: "visible feedback" })
		const stalePartial = convertClineMessageToProto({
			ts: 20,
			type: "say",
			say: "user_feedback",
			text: "stale fragment",
			partial: true,
		})
		vi.mocked(TaskServiceClient.fetchMessage)
			.mockResolvedValueOnce({ messages: [initial], startIndex: 0 })
			.mockResolvedValueOnce({ messages: [initial, feedback], startIndex: 0 })

		render(
			<ExtensionStateContextProvider>
				<MessageProbe />
			</ExtensionStateContextProvider>,
		)
		await waitFor(() => expect(subscriptions.state).toBeDefined())
		act(() => {
			subscriptions.state?.onResponse({ stateJson: JSON.stringify(stateSnapshot({ revision: 1, total: 1 })) })
		})
		await waitFor(() => expect(screen.getByText("assistant")).toBeVisible())
		act(() => {
			subscriptions.state?.onResponse({ stateJson: JSON.stringify(stateSnapshot({ revision: 2, total: 2 })) })
		})
		await waitFor(() => expect(TaskServiceClient.fetchMessage).toHaveBeenCalledTimes(2))
		await waitFor(() => expect(screen.getByText("visible feedback")).toBeVisible())

		act(() => {
			subscriptions.partial?.onResponse(stalePartial)
		})

		await waitFor(() => expect(screen.getAllByText("visible feedback")).toHaveLength(1))
		expect(screen.queryByText("stale fragment")).toBeNull()
	})
})
