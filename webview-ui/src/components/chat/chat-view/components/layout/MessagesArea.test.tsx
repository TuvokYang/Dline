import type { ClineMessage } from "@shared/ExtensionMessage"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { MessagesArea } from "./MessagesArea"

interface VirtuosoTestProps {
	rangeChanged?: (range: { startIndex: number; endIndex: number }) => void
}

const mocks = vi.hoisted(() => ({
	fetchMessage: vi.fn(),
	initialMessages: [] as ClineMessage[],
	initialFirstItemIndex: 0,
	totalMessageCount: 0,
	currentMessages: [] as ClineMessage[],
	currentFirstItemIndex: 0,
	virtuosoProps: undefined as VirtuosoTestProps | undefined,
	scrollToIndex: vi.fn(),
}))

vi.mock("@/context/ExtensionStateContext", async () => {
	const ReactModule = await import("react")

	return {
		useExtensionState: () => {
			const [clineMessages, setClineMessages] = ReactModule.useState(() => mocks.initialMessages)
			const [firstItemIndex, setFirstItemIndex] = ReactModule.useState(mocks.initialFirstItemIndex)

			mocks.currentMessages = clineMessages
			mocks.currentFirstItemIndex = firstItemIndex

			return {
				clineMessages,
				setClineMessages,
				totalMessageCount: mocks.totalMessageCount,
				firstItemIndex,
				setFirstItemIndex,
			}
		},
	}
})

vi.mock("@/services/grpc-client", () => ({
	TaskServiceClient: {
		fetchMessage: mocks.fetchMessage,
	},
}))

vi.mock("@shared/proto-conversions/cline-message", () => ({
	convertProtoToClineMessage: (message: ClineMessage) => message,
}))

vi.mock("react-virtuoso", async () => {
	const ReactModule = await import("react")
	const Virtuoso = ReactModule.forwardRef<unknown, VirtuosoTestProps>((props, ref) => {
		mocks.virtuosoProps = props
		ReactModule.useImperativeHandle(ref, () => ({
			scrollToIndex: mocks.scrollToIndex,
		}))
		return ReactModule.createElement("div", {
			"data-testid": "virtuoso",
			"data-virtuoso-scroller": "true",
		})
	})

	return { Virtuoso }
})

vi.mock("@/components/chat/task-header/StickyUserMessage", () => ({
	StickyUserMessage: () => null,
}))

vi.mock("../messages/MessageRenderer", () => ({
	createMessageRenderer: () => () => null,
}))

function createMessages(startIndex: number, count: number): ClineMessage[] {
	return Array.from({ length: count }, (_, offset) => {
		const absoluteIndex = startIndex + offset
		return {
			ts: absoluteIndex + 1,
			type: "say",
			say: "text",
			text: `message-${absoluteIndex}`,
		} as ClineMessage
	})
}

function createScrollBehavior(): ScrollBehavior {
	return {
		virtuosoRef: React.createRef(),
		scrollContainerRef: React.createRef(),
		disableAutoScrollRef: { current: false },
		isAtBottomRef: { current: true },
		requestProgrammaticScroll: vi.fn(),
		cancelProgrammaticScroll: vi.fn(),
		scrollToBottomSmooth: vi.fn(),
		scrollToBottomAuto: vi.fn(),
		scrollToMessage: vi.fn(),
		toggleRowExpansion: vi.fn(),
		handleRowHeightChange: vi.fn(),
		showScrollToBottom: false,
		setShowScrollToBottom: vi.fn(),
		isAtBottom: true,
		setIsAtBottom: vi.fn(),
		pendingScrollToMessage: null,
		setPendingScrollToMessage: vi.fn(),
		scrolledPastUserMessage: null,
		handleRangeChanged: vi.fn(),
	}
}

function renderMessagesArea(scrollBehavior = createScrollBehavior()) {
	const messages = mocks.initialMessages
	const task = messages[0] ?? createMessages(0, 1)[0]

	render(
		<MessagesArea
			chatState={
				{
					expandedRows: {},
					setActiveQuote: vi.fn(),
					setInputValue: vi.fn(),
				} as unknown as ChatState
			}
			groupedMessages={messages}
			messageHandlers={{ handleSendMessage: vi.fn() } as unknown as MessageHandlers}
			modifiedMessages={messages}
			onFollowupOptionSelect={vi.fn()}
			scrollBehavior={scrollBehavior}
			task={task}
		/>,
	)

	return scrollBehavior
}

describe("MessagesArea sliding-window integration", () => {
	beforeEach(() => {
		mocks.fetchMessage.mockReset()
		mocks.scrollToIndex.mockReset()
		mocks.virtuosoProps = undefined
		mocks.initialMessages = createMessages(300, 400)
		mocks.initialFirstItemIndex = 300
		mocks.totalMessageCount = 1000
		mocks.currentMessages = []
		mocks.currentFirstItemIndex = 0
	})

	afterEach(() => {
		cleanup()
		vi.useRealTimers()
	})

	it("follows a loaded absolute bottom even when the window starts after zero", () => {
		mocks.initialMessages = createMessages(800, 200)
		mocks.initialFirstItemIndex = 800
		mocks.totalMessageCount = 1000
		const scrollBehavior = renderMessagesArea()

		expect(scrollBehavior.requestProgrammaticScroll).toHaveBeenCalledTimes(1)
	})

	it("does not lose a boundary fetch when two ranges arrive within the old throttle window", async () => {
		mocks.fetchMessage.mockResolvedValue({ messages: [], startIndex: 0 })
		renderMessagesArea()

		act(() => {
			mocks.virtuosoProps?.rangeChanged({ startIndex: 150, endIndex: 250 })
			mocks.virtuosoProps?.rangeChanged({ startIndex: 0, endIndex: 20 })
		})

		await waitFor(() => {
			expect(mocks.fetchMessage).toHaveBeenCalledTimes(1)
		})
		expect(mocks.fetchMessage.mock.calls[0][0]).toMatchObject({ referenceIndex: 100, count: 200 })
	})

	it("replans after a merge when the viewport remains inside the extension threshold", async () => {
		mocks.initialMessages = createMessages(300, 250)
		mocks.initialFirstItemIndex = 300
		mocks.fetchMessage
			.mockResolvedValueOnce({ messages: createMessages(250, 50), startIndex: 250 })
			.mockResolvedValueOnce({ messages: [], startIndex: 50 })
		renderMessagesArea()

		act(() => {
			mocks.virtuosoProps?.rangeChanged({ startIndex: 0, endIndex: 20 })
		})

		await waitFor(() => {
			expect(mocks.fetchMessage).toHaveBeenCalledTimes(2)
		})
		expect(mocks.fetchMessage.mock.calls[0][0]).toMatchObject({ referenceIndex: 100, count: 200 })
		expect(mocks.fetchMessage.mock.calls[1][0]).toMatchObject({ referenceIndex: 50, count: 200 })
	})

	it("trims from the last visible absolute range after scrolling becomes idle", () => {
		vi.useFakeTimers()
		mocks.initialMessages = createMessages(100, 700)
		mocks.initialFirstItemIndex = 100
		mocks.totalMessageCount = 2000
		renderMessagesArea()

		act(() => {
			vi.advanceTimersByTime(16)
			mocks.virtuosoProps?.rangeChanged({ startIndex: 400, endIndex: 450 })
		})

		fireEvent.scroll(screen.getByTestId("virtuoso"))

		act(() => {
			vi.advanceTimersByTime(299)
		})
		expect(mocks.currentMessages).toHaveLength(700)

		act(() => {
			vi.advanceTimersByTime(1)
		})
		expect(mocks.currentFirstItemIndex).toBe(320)
		expect(mocks.currentMessages).toHaveLength(480)
	})
})
