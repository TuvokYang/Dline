import type { ClineMessage } from "@shared/ExtensionMessage"
import { FetchMessageRequest } from "@shared/proto/dline/task"
import { convertProtoToClineMessage } from "@shared/proto-conversions/cline-message"
import type React from "react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Virtuoso } from "react-virtuoso"
import { StickyUserMessage } from "@/components/chat/task-header/StickyUserMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { TaskServiceClient } from "@/services/grpc-client"
import { isApiReqActive } from "@/utils/streaming"

import type { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"
import { isToolGroup } from "../../utils/messageUtils"
import {
	DEFAULT_MESSAGE_WINDOW_LIMITS,
	isWholeConversationLoaded,
	type MessageWindow,
	planWindowExtensions,
	planWindowTrim,
	type VisibleMessageRange,
} from "../../utils/messageWindowPlan"
import { buildMessageRowKey, getBottomFollowIntent, mergeMessageWindow } from "../../utils/messageWindowUtils"
import { LAYOUT_SETTLE_RETRY_MS } from "../../utils/scrollArbiter"
import { createMessageRenderer } from "../messages/MessageRenderer"

const LOAD_COUNT = DEFAULT_MESSAGE_WINDOW_LIMITS.loadCount
/**
 * Rendered rows left beyond the viewport before a fetch is requested.
 *
 * Grouping collapses many messages into one row, so a window that still holds
 * plenty of messages can be only a few rows away from its edge.
 */
const ROW_LOAD_THRESHOLD = 8

/** Sentinel value to prevent Virtuoso zero-sized-element warnings when data is empty */
// @ts-expect-error — Virtuoso sentinel; only ts/type needed, full ClineMessage shape not required
const EMPTY_PLACEHOLDER_MSG: ClineMessage = { ts: -1, type: "__empty_placeholder__" } as ClineMessage

interface MessagesAreaProps {
	task: ClineMessage
	groupedMessages: (ClineMessage | ClineMessage[])[]
	modifiedMessages: ClineMessage[]
	scrollBehavior: ScrollBehavior
	chatState: ChatState
	messageHandlers: MessageHandlers
	onFollowupOptionSelect: (message: ClineMessage, option: string) => Promise<void>
}

type RenderRow = {
	row: ClineMessage | ClineMessage[]
	startMessageIndex: number
	endMessageIndex: number
	startMessageTs?: number
	endMessageTs?: number
}

type PendingAnchor = {
	ts: number
	align: "start" | "center" | "end"
}

type ScrollEdge = "top" | "bottom"

export const MessagesArea: React.FC<MessagesAreaProps> = ({
	task,
	groupedMessages,
	modifiedMessages,
	scrollBehavior,
	chatState,
	messageHandlers,
	onFollowupOptionSelect,
}) => {
	const { clineMessages, setClineMessages, totalMessageCount, firstItemIndex, setFirstItemIndex } = useExtensionState()

	const firstItemIndexRef = useRef(firstItemIndex)
	const clineMessagesLengthRef = useRef(clineMessages.length)
	const inflightRef = useRef<Set<string>>(new Set())
	const pendingAnchorRef = useRef<PendingAnchor | null>(null)
	const pendingEdgeScrollRef = useRef<ScrollEdge | null>(null)
	const latestVisibleMessageRangeRef = useRef<VisibleMessageRange | null>(null)
	const latestExtensionRangeRef = useRef<VisibleMessageRange | null>(null)
	const latestVisibleAnchorTsRef = useRef<number | null>(null)
	const isUserScrollingRef = useRef(false)
	const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const windowVersionRef = useRef(0)
	const edgeJumpInFlightRef = useRef<ScrollEdge | null>(null)

	// Floating scroll-to-bottom/top button state
	const [floatingBtnVisible, setFloatingBtnVisible] = useState(false)
	const [floatingBtnDir, setFloatingBtnDir] = useState<"bottom" | "top">("bottom")
	const hideBtnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const wasBtnShownRef = useRef(false)
	const showScrollToBottomRef = useRef(false)
	// Track webview visibility so we can pause Virtuoso updates when hidden
	const isWebviewHiddenRef = useRef(false)
	const lastMessageSignatureRef = useRef("")
	// Cache the last visible messages snapshot so Virtuoso data stays stable while hidden
	const cachedVisibleMessagesRef = useRef<(ClineMessage | ClineMessage[])[]>([])

	useEffect(() => {
		firstItemIndexRef.current = firstItemIndex
	}, [firstItemIndex])

	useEffect(() => {
		clineMessagesLengthRef.current = clineMessages.length
	}, [clineMessages.length])

	const lastRawMessage = useMemo(() => clineMessages.at(-1), [clineMessages])
	const lastMessageSignature = useMemo(() => {
		if (!lastRawMessage) return ""
		return `${lastRawMessage.ts}:${lastRawMessage.partial === true ? "partial" : "final"}:${lastRawMessage.text ?? ""}`
	}, [lastRawMessage])

	// Reset auto-scroll flag when entering a new task so the view scrolls
	// to the bottom instead of staying wherever the previous task left it.
	useEffect(() => {
		scrollBehavior.disableAutoScrollRef.current = false
	}, [scrollBehavior.disableAutoScrollRef])

	const {
		virtuosoRef,
		scrollContainerRef,
		toggleRowExpansion,
		handleRowHeightChange,
		setIsAtBottom,
		setShowScrollToBottom,
		disableAutoScrollRef,
		requestProgrammaticScroll,
		cancelProgrammaticScroll,
		scrolledPastUserMessage,
		isAtBottom,
		isAtBottomRef,
		showScrollToBottom,
	} = scrollBehavior

	useEffect(() => {
		showScrollToBottomRef.current = showScrollToBottom
	}, [showScrollToBottom])

	// Pause range processing while the webview is hidden. Restoring the bottom
	// is owned by useScrollBehavior so only one visibility listener can issue a
	// programmatic scroll through the shared arbiter.
	useEffect(() => {
		const handleVisibility = () => {
			isWebviewHiddenRef.current = document.visibilityState === "hidden"
		}

		handleVisibility()
		document.addEventListener("visibilitychange", handleVisibility)
		return () => document.removeEventListener("visibilitychange", handleVisibility)
	}, [])

	const messageIndexByTs = useMemo(() => {
		const map = new Map<number, number>()

		clineMessages.forEach((msg, offset) => {
			map.set(msg.ts, firstItemIndex + offset)
		})

		return map
	}, [clineMessages, firstItemIndex])

	const renderRows = useMemo<RenderRow[]>(() => {
		let fallbackIndex = firstItemIndex

		return groupedMessages.map((row) => {
			const rowMessages = Array.isArray(row) ? row : [row]

			const mappedIndexes = rowMessages
				.map((msg) => messageIndexByTs.get(msg.ts))
				.filter((index): index is number => typeof index === "number")

			const startMessageIndex = mappedIndexes.length > 0 ? Math.min(...mappedIndexes) : fallbackIndex
			const endMessageIndex =
				mappedIndexes.length > 0 ? Math.max(...mappedIndexes) : startMessageIndex + rowMessages.length - 1

			fallbackIndex = Math.max(fallbackIndex, endMessageIndex + 1)

			return {
				row,
				startMessageIndex,
				endMessageIndex,
				startMessageTs: rowMessages.at(0)?.ts,
				endMessageTs: rowMessages.at(-1)?.ts,
			}
		})
	}, [groupedMessages, messageIndexByTs, firstItemIndex])

	const visibleGroupedMessages = useMemo<(ClineMessage | ClineMessage[])[]>(() => {
		// When the webview is hidden (user switched to another tab), return the
		// cached snapshot so Virtuoso stays idle instead of re-laying-out invisibly.
		if (isWebviewHiddenRef.current) {
			const cached = cachedVisibleMessagesRef.current
			if (cached.length > 0) {
				return cached
			}
		}

		const rows = renderRows.map((renderRow) => renderRow.row)
		// Prevent Virtuoso zero-sized-element warning when data is empty.
		// A single invisible placeholder row keeps Virtuoso's measurement happy.
		let result: (ClineMessage | ClineMessage[])[]
		if (rows.length === 0) {
			result = [EMPTY_PLACEHOLDER_MSG]
		} else {
			result = rows
		}
		// Always update the cache when we compute a fresh result so the next
		// hidden-cycle can reuse it.
		cachedVisibleMessagesRef.current = result
		return result
	}, [renderRows])

	const findRowOffsetByMessageTs = useCallback(
		(ts: number) => {
			return renderRows.findIndex((renderRow) => {
				if (Array.isArray(renderRow.row)) {
					return renderRow.row.some((msg) => msg.ts === ts)
				}

				return renderRow.row.ts === ts
			})
		},
		[renderRows],
	)

	const scrollToRowOffset = useCallback(
		(index: number, align: "start" | "center" | "end" = "start", behavior: "auto" | "smooth" = "smooth") => {
			virtuosoRef.current?.scrollToIndex({
				index,
				align,
				behavior,
			})
		},
		[virtuosoRef],
	)

	const clearEdgeScrollTimers = cancelProgrammaticScroll

	/**
	 * Read the absolute bounds of the currently loaded message window.
	 *
	 * @returns Window bounds derived from the live refs and the backend total.
	 */
	const currentMessageWindow = useCallback((): MessageWindow => {
		const start = firstItemIndexRef.current
		const length = clineMessagesLengthRef.current
		return { start, length, total: totalMessageCount ?? length }
	}, [totalMessageCount])

	/**
	 * Report whether the loaded window already covers the requested edge.
	 *
	 * @param edge Conversation edge the pending jump targets.
	 * @returns True when scrolling now lands on the real first or last message.
	 */
	const isEdgeWindowReady = useCallback(
		(edge: ScrollEdge) => {
			if (renderRows.length === 0) return false

			const window = currentMessageWindow()
			return edge === "top" ? window.start <= 0 : window.start + window.length >= window.total
		},
		[currentMessageWindow, renderRows.length],
	)

	const scrollToBottomLast = useCallback(
		(behavior: "auto" | "smooth" = "auto") => {
			virtuosoRef.current?.scrollToIndex({
				index: "LAST",
				align: "end",
				behavior,
			})
		},
		[virtuosoRef],
	)

	const scrollToLoadedEdge = useCallback(
		(edge: ScrollEdge, behavior: "auto" | "smooth" = "auto", retryAfterLayout = false) => {
			if (renderRows.length === 0) return

			const index = edge === "top" ? 0 : renderRows.length - 1
			const align = edge === "top" ? "start" : "end"

			requestProgrammaticScroll({
				run: () => {
					if (edge === "bottom") {
						scrollToBottomLast(behavior)
						return
					}
					scrollToRowOffset(index, align, behavior)
				},
				// Streaming issues this on nearly every chunk. Retrying each of them
				// stacked hundreds of deferred scrolls and produced the bounce, so
				// only an explicit jump asks for the settle chain.
				retryDelaysMs: retryAfterLayout ? LAYOUT_SETTLE_RETRY_MS : undefined,
				isStillWanted: () => edge === "top" || !disableAutoScrollRef.current,
			})
		},
		[disableAutoScrollRef, renderRows.length, requestProgrammaticScroll, scrollToBottomLast, scrollToRowOffset],
	)

	useLayoutEffect(() => {
		const pendingEdge = pendingEdgeScrollRef.current
		if (pendingEdge) {
			// The jump replaced the whole window, but React can run this effect
			// against the previous rows. Landing on a stale window is what made
			// "to top" and "to bottom" stop short of the real edge, so wait until
			// the window that the jump requested is the one being rendered.
			if (!isEdgeWindowReady(pendingEdge)) {
				return
			}
			pendingEdgeScrollRef.current = null
			// Row heights are unknown until Virtuoso measures the new window.
			scrollToLoadedEdge(pendingEdge, "auto", true)
			return
		}

		const pendingAnchor = pendingAnchorRef.current
		if (!pendingAnchor) return
		if (renderRows.length === 0) return

		const rowOffset = findRowOffsetByMessageTs(pendingAnchor.ts)
		if (rowOffset < 0) return

		pendingAnchorRef.current = null
		scrollToRowOffset(rowOffset, pendingAnchor.align, "auto")
	}, [renderRows.length, findRowOffsetByMessageTs, isEdgeWindowReady, scrollToLoadedEdge, scrollToRowOffset])

	useEffect(() => clearEdgeScrollTimers, [clearEdgeScrollTimers])

	useLayoutEffect(() => {
		const window = currentMessageWindow()
		const absoluteBottomLoaded = window.start + window.length >= window.total
		const previousSignature = lastMessageSignatureRef.current
		const lastMessageTsChanged = previousSignature.split(":", 1)[0] !== String(lastRawMessage?.ts ?? "")
		const lastMessageContentChanged = previousSignature !== "" && previousSignature !== lastMessageSignature
		lastMessageSignatureRef.current = lastMessageSignature

		const intent = getBottomFollowIntent({
			disableAutoScroll: disableAutoScrollRef.current,
			absoluteBottomLoaded,
			lastMessageTsChanged,
			lastMessageContentChanged,
		})

		if (intent === "follow") {
			scrollToLoadedEdge("bottom", "auto")
		}
	}, [currentMessageWindow, disableAutoScrollRef, lastRawMessage?.ts, lastMessageSignature, scrollToLoadedEdge])

	const scrolledPastUserMessageRowOffset = useMemo(() => {
		if (!scrolledPastUserMessage) return -1
		return findRowOffsetByMessageTs(scrolledPastUserMessage.ts)
	}, [findRowOffsetByMessageTs, scrolledPastUserMessage])

	const handleScrollToUserMessage = useCallback(() => {
		if (scrolledPastUserMessageRowOffset >= 0) {
			scrollToRowOffset(scrolledPastUserMessageRowOffset, "center")
		}
	}, [scrolledPastUserMessageRowOffset, scrollToRowOffset])

	const { expandedRows, setActiveQuote, setInputValue } = chatState
	const addToInput = useCallback(
		(text: string) => setInputValue((current) => (current ? `${current}\n${text}\n` : `${text}\n`)),
		[setInputValue],
	)

	const lastVisibleRow = useMemo(() => visibleGroupedMessages.at(-1), [visibleGroupedMessages])

	const lastVisibleMessage = useMemo(() => {
		const lastRow = lastVisibleRow
		if (!lastRow) return undefined
		return Array.isArray(lastRow) ? lastRow.at(-1) : lastRow
	}, [lastVisibleRow])

	const isWaitingForResponse = useMemo(() => {
		const lastMsg = modifiedMessages[modifiedMessages.length - 1]

		if (lastRawMessage?.type === "ask") return false
		if (lastRawMessage?.type === "say" && lastRawMessage.say === "completion_result") return false

		if (lastRawMessage?.type === "say" && lastRawMessage.say === "api_req_started" && !isApiReqActive(lastRawMessage)) {
			return false
		}

		if (visibleGroupedMessages.length === 0) return true
		if (!lastVisibleMessage) return true
		if (lastVisibleRow && isToolGroup(lastVisibleRow)) return true
		if (lastVisibleMessage.partial !== true) return true
		if (!lastMsg) return true
		if (lastMsg.say === "user_feedback" || lastMsg.say === "user_feedback_diff") return true

		if (lastMsg.say === "api_req_started") {
			try {
				const info = JSON.parse(lastMsg.text || "{}")
				return info.cost == null
			} catch {
				return true
			}
		}

		return false
	}, [lastRawMessage, visibleGroupedMessages.length, lastVisibleMessage, lastVisibleRow, modifiedMessages])

	const showThinkingLoaderRow = useMemo(() => {
		const handoffToReasoningPending =
			lastRawMessage?.type === "say" &&
			lastRawMessage.say === "reasoning" &&
			lastRawMessage.partial === true &&
			lastVisibleMessage?.say !== "reasoning"

		return isWaitingForResponse || handoffToReasoningPending
	}, [isWaitingForResponse, lastRawMessage, lastVisibleMessage?.say])

	const itemContent = useMemo(() => {
		const realRenderer = createMessageRenderer(
			visibleGroupedMessages,
			modifiedMessages,
			expandedRows,
			toggleRowExpansion,
			handleRowHeightChange,
			addToInput,
			setActiveQuote,
			onFollowupOptionSelect,
			messageHandlers,
			false,
		)

		// Wrap to handle the empty placeholder row — returns a 1px invisible
		// spacer so Virtuoso never encounters a zero-sized element.
		return (index: number, item: ClineMessage | ClineMessage[]) => {
			if (item === EMPTY_PLACEHOLDER_MSG) {
				return <div style={{ height: 1 }} />
			}
			return realRenderer(index, item)
		}
	}, [
		visibleGroupedMessages,
		modifiedMessages,
		expandedRows,
		toggleRowExpansion,
		handleRowHeightChange,
		addToInput,
		setActiveQuote,
		onFollowupOptionSelect,
		messageHandlers,
	])

	const virtuosoComponents = useMemo(
		() => ({
			Footer: () => (
				<>
					{showThinkingLoaderRow && <div className="min-h-1" />}
					<div className="min-h-1" />
				</>
			),
		}),
		[showThinkingLoaderRow],
	)

	const computeItemKey = useCallback((index: number, item: ClineMessage | ClineMessage[]) => {
		return buildMessageRowKey(item, index)
	}, [])

	const fetchAndMerge = useCallback(
		async (start: number, count: number, anchor?: PendingAnchor) => {
			const key = `${start}:${count}`
			if (inflightRef.current.has(key)) return false

			inflightRef.current.add(key)
			const requestVersion = windowVersionRef.current

			if (anchor) {
				pendingAnchorRef.current = anchor
			}

			try {
				const resp = await TaskServiceClient.fetchMessage(FetchMessageRequest.create({ referenceIndex: start, count }))
				const msgs = resp.messages.map((message) => convertProtoToClineMessage(message))
				const si = resp.startIndex

				if (requestVersion !== windowVersionRef.current) {
					if (anchor) pendingAnchorRef.current = null
					return false
				}

				if (msgs.length === 0) {
					if (anchor) pendingAnchorRef.current = null
					return false
				}

				let merged = false

				setClineMessages((prev) => {
					const fi = firstItemIndexRef.current
					const result = mergeMessageWindow({
						existing: prev,
						incoming: msgs,
						existingStartIndex: fi,
						incomingStartIndex: si,
					})

					if (!result.merged) {
						return prev
					}

					merged = true
					clineMessagesLengthRef.current = result.messages.length

					if (result.firstItemIndex !== fi) {
						firstItemIndexRef.current = result.firstItemIndex
						setFirstItemIndex(result.firstItemIndex)
					}

					return result.messages
				})

				if (!merged && anchor) {
					pendingAnchorRef.current = null
				}

				return merged
			} catch (e) {
				if (anchor) pendingAnchorRef.current = null
				console.error("fetchMessage:", e)
				return false
			} finally {
				inflightRef.current.delete(key)
			}
		},
		[setClineMessages, setFirstItemIndex],
	)

	const requestWindowExtensions = useCallback(
		(visible: VisibleMessageRange, anchorTs: number | null) => {
			if (isWebviewHiddenRef.current) return

			const window = currentMessageWindow()
			if (isWholeConversationLoaded(window)) return

			for (const extension of planWindowExtensions(window, visible)) {
				if (extension.side === "leading") {
					if (anchorTs == null) continue
					void fetchAndMerge(extension.startIndex, extension.count, {
						ts: anchorTs,
						align: "start",
					})
					continue
				}
				void fetchAndMerge(extension.startIndex, extension.count)
			}
		},
		[currentMessageWindow, fetchAndMerge],
	)

	const jumpToEdge = useCallback(
		async (edge: ScrollEdge) => {
			if (edgeJumpInFlightRef.current === edge) return

			edgeJumpInFlightRef.current = edge
			windowVersionRef.current += 1
			const requestVersion = windowVersionRef.current
			inflightRef.current.clear()
			pendingAnchorRef.current = null
			latestVisibleMessageRangeRef.current = null
			latestExtensionRangeRef.current = null
			latestVisibleAnchorTsRef.current = null
			pendingEdgeScrollRef.current = edge

			try {
				const request =
					edge === "top"
						? FetchMessageRequest.create({ referenceIndex: 0, count: LOAD_COUNT })
						: FetchMessageRequest.create({ referenceIndex: -1, count: LOAD_COUNT })

				const resp = await TaskServiceClient.fetchMessage(request)
				if (requestVersion !== windowVersionRef.current) return

				const converted = resp.messages.map((message) => convertProtoToClineMessage(message))
				const nextFirstItemIndex = Math.max(0, resp.startIndex)

				firstItemIndexRef.current = nextFirstItemIndex
				clineMessagesLengthRef.current = converted.length
				setClineMessages(converted)
				setFirstItemIndex(nextFirstItemIndex)

				if (converted.length === 0) {
					pendingEdgeScrollRef.current = null
				}
			} catch (e) {
				pendingEdgeScrollRef.current = null
				console.error("fetchMessage:", e)
			} finally {
				if (edgeJumpInFlightRef.current === edge) {
					edgeJumpInFlightRef.current = null
				}
			}
		},
		[setClineMessages, setFirstItemIndex],
	)

	const handleRangeChanged = useCallback(
		(range: { startIndex: number; endIndex: number }) => {
			// When the webview is hidden, skip all range computations —
			// Virtuoso layout runs invisibly and wastes CPU across multiple panels.
			if (isWebviewHiddenRef.current) return

			if (clineMessagesLengthRef.current === 0) return
			if (renderRows.length === 0) return

			const localStart = range.startIndex
			const localEnd = range.endIndex
			const firstVisibleRow = renderRows[localStart]
			const lastVisibleRow = renderRows[localEnd]

			if (!firstVisibleRow || !lastVisibleRow) return

			const window = currentMessageWindow()
			const visible: VisibleMessageRange = {
				firstMessageIndex: firstVisibleRow.startMessageIndex,
				lastMessageIndex: lastVisibleRow.endMessageIndex,
			}
			latestVisibleMessageRangeRef.current = visible
			latestVisibleAnchorTsRef.current = firstVisibleRow.startMessageTs ?? null
			const allLoaded = isWholeConversationLoaded(window)

			// The button state describes what the user can currently reach, so it
			// has to follow every range report. Throttling it together with the
			// fetch scheduling left the control stale mid-scroll.
			setShowScrollToBottom(disableAutoScrollRef.current || !allLoaded || visible.lastMessageIndex < window.total - 1)

			if (allLoaded) {
				latestExtensionRangeRef.current = null
				return
			}

			// Grouping means a window with plenty of messages can still be a
			// couple of rows from its edge, so the row distance widens the
			// message-count rule rather than replacing it.
			const nearTopRow = localStart <= ROW_LOAD_THRESHOLD
			const nearBottomRow = renderRows.length - 1 - localEnd <= ROW_LOAD_THRESHOLD
			const rowUrgency: VisibleMessageRange = {
				firstMessageIndex: nearTopRow ? window.start : visible.firstMessageIndex,
				lastMessageIndex: nearBottomRow ? window.start + window.length - 1 : visible.lastMessageIndex,
			}

			latestExtensionRangeRef.current = rowUrgency
			requestWindowExtensions(rowUrgency, latestVisibleAnchorTsRef.current)
		},
		[currentMessageWindow, renderRows, disableAutoScrollRef, setShowScrollToBottom, requestWindowExtensions],
	)

	// A merge can leave the viewport inside the load threshold. Re-plan from the
	// last reported absolute range instead of waiting for Virtuoso to emit a new
	// range event, which it is not required to do after a state-only update.
	useEffect(() => {
		if (firstItemIndexRef.current !== firstItemIndex || clineMessagesLengthRef.current !== clineMessages.length) return

		const visible = latestExtensionRangeRef.current
		if (!visible) return
		requestWindowExtensions(visible, latestVisibleAnchorTsRef.current)
	}, [clineMessages.length, firstItemIndex, requestWindowExtensions])

	const applyIdleTrim = useCallback(() => {
		if (isUserScrollingRef.current) return
		if (clineMessagesLengthRef.current === 0) return

		const visible = latestVisibleMessageRangeRef.current
		if (!visible) return

		const window = currentMessageWindow()
		if (isWholeConversationLoaded(window)) return

		const trim = planWindowTrim(window, visible)
		if (!trim) return

		if (trim.side === "leading") {
			const anchorTs = latestVisibleAnchorTsRef.current
			if (anchorTs != null) {
				pendingAnchorRef.current = { ts: anchorTs, align: "start" }
			}

			firstItemIndexRef.current = trim.nextStart
			clineMessagesLengthRef.current = trim.nextLength
			setFirstItemIndex(trim.nextStart)
			setClineMessages((prev) => prev.slice(Math.min(trim.count, prev.length)))
			return
		}

		clineMessagesLengthRef.current = trim.nextLength
		setClineMessages((prev) => prev.slice(0, Math.min(trim.nextLength, prev.length)))
	}, [currentMessageWindow, setClineMessages, setFirstItemIndex])

	// Floating button: scroll listener for visibility + wheel listener for direction.
	// Attached to Virtuoso inner scroller, not the outer scrollContainerRef.
	useEffect(() => {
		const container = scrollContainerRef.current
		if (!container) return

		const showButton = () => {
			if (hideBtnTimerRef.current) clearTimeout(hideBtnTimerRef.current)
			if (!isAtBottomRef.current || showScrollToBottomRef.current) {
				setFloatingBtnVisible(true)
				wasBtnShownRef.current = true
				hideBtnTimerRef.current = setTimeout(() => {
					setFloatingBtnVisible(false)
				}, 5000)
			}
		}

		const onScroll = () => {
			isUserScrollingRef.current = true
			if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
			scrollTimerRef.current = setTimeout(() => {
				isUserScrollingRef.current = false
				applyIdleTrim()
			}, 300)

			showButton()
		}

		// Wheel event carries deltaY — use it to determine scroll direction
		const onWheel = (e: WheelEvent) => {
			if (Math.abs(e.deltaY) < 5) return // ignore micro-scrolls / trackpad noise
			setFloatingBtnDir(e.deltaY < 0 ? "top" : "bottom")
			showButton()
		}

		const raf = requestAnimationFrame(() => {
			const el = container.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement | null
			if (el) {
				el.addEventListener("scroll", onScroll, { passive: true })
				el.addEventListener("wheel", onWheel, { passive: true })
			}
		})

		return () => {
			cancelAnimationFrame(raf)
			const el = container.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement | null
			if (el) {
				el.removeEventListener("scroll", onScroll)
				el.removeEventListener("wheel", onWheel)
			}
			if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
			if (hideBtnTimerRef.current) clearTimeout(hideBtnTimerRef.current)
		}
	}, [applyIdleTrim, scrollContainerRef, isAtBottomRef])

	// Re-evaluate trim after a merge or window replacement. If that render
	// happened during scrolling, the idle timer above performs the deferred run.
	useEffect(() => {
		if (firstItemIndexRef.current !== firstItemIndex || clineMessagesLengthRef.current !== clineMessages.length) return
		applyIdleTrim()
	}, [applyIdleTrim, clineMessages.length, firstItemIndex])

	return (
		<div className="overflow-hidden flex flex-col h-full relative">
			<div
				className={cn(
					"absolute top-0 left-0 right-0 z-10 pl-[15px] pr-[14px] bg-background",
					scrolledPastUserMessage && "pb-2",
				)}>
				<StickyUserMessage
					isVisible={!!scrolledPastUserMessage}
					lastUserMessage={scrolledPastUserMessage}
					onScrollToMessage={handleScrollToUserMessage}
				/>
			</div>

			<div className="grow flex relative" ref={scrollContainerRef}>
				<Virtuoso
					atBottomStateChange={(atBottom) => {
						setIsAtBottom(atBottom)
						// Keep ref in sync so scroll handlers read the latest value immediately
						isAtBottomRef.current = atBottom

						const total = totalMessageCount ?? clineMessagesLengthRef.current
						const absoluteBottomLoaded = firstItemIndexRef.current + clineMessagesLengthRef.current >= total

						// Reset auto-scroll only at the real conversation bottom, not merely
						// the bottom of the currently loaded sliding window.
						if (atBottom && absoluteBottomLoaded) {
							disableAutoScrollRef.current = false
						}

						const shouldShowScrollToBottom = !absoluteBottomLoaded || (disableAutoScrollRef.current && !atBottom)
						setShowScrollToBottom(shouldShowScrollToBottom)

						if (atBottom && !absoluteBottomLoaded) {
							setFloatingBtnDir("bottom")
							setFloatingBtnVisible(true)
						}
					}}
					atBottomThreshold={10}
					className="scrollable grow overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
					components={virtuosoComponents}
					computeItemKey={computeItemKey}
					data={visibleGroupedMessages}
					firstItemIndex={0}
					increaseViewportBy={{ top: 100, bottom: 100 }}
					initialTopMostItemIndex={Math.max(visibleGroupedMessages.length - 1, 0)}
					itemContent={itemContent}
					key={task.ts}
					rangeChanged={handleRangeChanged}
					ref={virtuosoRef}
					style={{ overflowAnchor: "none" }}
					totalCount={visibleGroupedMessages.length}
				/>

				{/* Floating scroll direction button — appears on scroll, auto-hides after 5s idle */}
				{(!isAtBottom || showScrollToBottom) && (
					<div
						className={cn(
							"absolute bottom-4 right-4 z-20 transition-all duration-300 ease-out",
							floatingBtnVisible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
						)}>
						<button
							aria-label={floatingBtnDir === "bottom" ? "Scroll to bottom" : "Scroll to top"}
							className={cn(
								"w-10 h-10 rounded-full bg-background/65 backdrop-blur-sm shadow-md",
								"flex items-center justify-center cursor-pointer border-0",
								"hover:bg-background/90 hover:shadow-xl hover:scale-105",
								"active:scale-95 transition-all duration-200",
							)}
							onClick={() => {
								if (floatingBtnDir === "bottom") {
									disableAutoScrollRef.current = false
									void jumpToEdge("bottom")
								} else {
									disableAutoScrollRef.current = true
									void jumpToEdge("top")
								}
								if (hideBtnTimerRef.current) clearTimeout(hideBtnTimerRef.current)
								setFloatingBtnVisible(false)
							}}
							style={{
								animation: !wasBtnShownRef.current
									? undefined
									: floatingBtnVisible
										? "btnAppear 400ms cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards"
										: undefined,
							}}
							type="button">
							<span
								className={cn(
									"codicon text-base",
									floatingBtnDir === "bottom" ? "codicon-chevron-down" : "codicon-chevron-up",
								)}
							/>
						</button>
					</div>
				)}
			</div>

			{/* Button appear animation */}
			<style>{`
				@keyframes btnAppear {
					0% { transform: scale(0); opacity: 0; box-shadow: 0 0 0 0 rgba(0,0,0,0); }
					40% { transform: scale(1.4); opacity: 1; box-shadow: 0 0 16px 2px rgba(0,0,0,0.25); }
					70% { transform: scale(0.85); box-shadow: 0 0 8px 1px rgba(0,0,0,0.12); }
					100% { transform: scale(1); box-shadow: 0 1px 3px 1px rgba(0,0,0,0.08); }
				}
			`}</style>
		</div>
	)
}
