import { ClineMessage } from "@shared/ExtensionMessage"
import debounce from "debounce"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import { ListRange, VirtuosoHandle } from "react-virtuoso"
import { ScrollBehavior } from "../types/chatTypes"
import { resolveMessageRowExpanded, toggleMessageRowExpansion } from "../utils/messageUtils"

// Height of the sticky user message header (padding + content)
const STICKY_HEADER_HEIGHT = 32

/**
 * Custom hook for managing scroll behavior
 * Handles auto-scrolling, manual scrolling, and scroll-to-message functionality
 */
export function useScrollBehavior(
	messages: ClineMessage[],
	visibleMessages: ClineMessage[],
	groupedMessages: (ClineMessage | ClineMessage[])[],
	expandedRows: Record<number, boolean>,
	setExpandedRows: React.Dispatch<React.SetStateAction<Record<number, boolean>>>,
): ScrollBehavior & {
	showScrollToBottom: boolean
	setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>
	isAtBottom: boolean
	setIsAtBottom: React.Dispatch<React.SetStateAction<boolean>>
	pendingScrollToMessage: number | null
	setPendingScrollToMessage: React.Dispatch<React.SetStateAction<number | null>>
	scrolledPastUserMessage: ClineMessage | null
	handleRangeChanged: (range: ListRange) => void
} {
	// Refs
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const scrollContainerRef = useRef<HTMLDivElement>(null)
	const disableAutoScrollRef = useRef(false)
	// Ref mirror of isAtBottom so scroll handlers can read the latest value
	// without stale-closure issues (Virtuoso atBottomStateChange fires after scroll events)
	const isAtBottomRef = useRef(false)
	// Throttle timestamp for handleRowHeightChange to prevent scroll jitter
	const lastRowHeightChangeRef = useRef(0)
	const pendingAutoScrollRef = useRef(false)
	const autoScrollRetryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

	// State
	const [showScrollToBottom, setShowScrollToBottom] = useState(false)
	const [isAtBottom, setIsAtBottom] = useState(false)
	const [pendingScrollToMessage, setPendingScrollToMessage] = useState<number | null>(null)
	const [scrolledPastUserMessage, setScrolledPastUserMessage] = useState<ClineMessage | null>(null)

	// Find all user feedback messages
	const userFeedbackMessages = useMemo(() => {
		return visibleMessages.filter((msg) => msg.say === "user_feedback")
	}, [visibleMessages])

	// Track scroll position to detect which user message has been scrolled past
	// Shows the most recent user message that's above the current viewport
	const checkScrolledPastUserMessage = useCallback(() => {
		const scrollContainer = scrollContainerRef.current
		if (!scrollContainer || userFeedbackMessages.length === 0) {
			setScrolledPastUserMessage(null)
			return
		}

		const containerRect = scrollContainer.getBoundingClientRect()

		// Find the most recent (last in order) user message that's been scrolled past
		// We iterate from the end to find the latest one that's above the viewport
		let mostRecentScrolledPast: ClineMessage | null = null

		// Track if we've found any visible message element in the DOM
		// This helps us determine if missing elements are above or below viewport
		let foundAnyVisibleElement = false

		for (let i = userFeedbackMessages.length - 1; i >= 0; i--) {
			const msg = userFeedbackMessages[i]
			const messageElement = scrollContainer.querySelector(`[data-message-ts="${msg.ts}"]`) as HTMLElement

			if (messageElement) {
				foundAnyVisibleElement = true
				const messageRect = messageElement.getBoundingClientRect()
				// Message is scrolled past if its bottom edge is above (or near) the container's top
				// Add a small threshold so the pin appears slightly before message fully scrolls out
				const threshold = 10
				if (messageRect.bottom < containerRect.top + threshold) {
					mostRecentScrolledPast = msg
					break // Found the most recent one that's scrolled past
				}
			} else {
				// Element not in DOM - it's virtualized out
				// Only consider it scrolled past if we've already found a visible element after it
				// (meaning this missing element is above the viewport, not below)
				if (foundAnyVisibleElement) {
					mostRecentScrolledPast = msg
					break
				}
				// If we haven't found any visible elements yet, this message might be
				// below the viewport, so continue looking for visible elements
			}
		}

		setScrolledPastUserMessage(mostRecentScrolledPast)
	}, [userFeedbackMessages])

	// Use scroll event listener - attach to the scrollable element inside the container
	useEffect(() => {
		const scrollContainer = scrollContainerRef.current
		if (!scrollContainer) {
			return
		}

		// The scrollable element is the Virtuoso scroller or a child with overflow
		const findScrollableElement = () => {
			// Try finding the Virtuoso scroller
			const virtuosoScroller = scrollContainer.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement
			if (virtuosoScroller) {
				return virtuosoScroller
			}
			// Fallback to the first child with scrollable class
			const scrollable = scrollContainer.querySelector(".scrollable") as HTMLElement
			return scrollable || scrollContainer
		}

		const scrollableElement = findScrollableElement()

		const handleScroll = () => {
			checkScrolledPastUserMessage()
		}

		scrollableElement.addEventListener("scroll", handleScroll, { passive: true })

		// Also check on mount and when dependencies change
		checkScrolledPastUserMessage()

		return () => {
			scrollableElement.removeEventListener("scroll", handleScroll)
		}
	}, [checkScrolledPastUserMessage])

	// Handler for when visible range changes in Virtuoso (kept for compatibility but not used for sticky)
	const handleRangeChanged = useCallback((_range: ListRange) => {
		// Range changed callback - we now use scroll position instead
		// but keep this for potential future use
	}, [])
	// Refs for computing the last rendered Virtuoso row index.
	// The chat can group many messages into one row, so scroll targets must use
	// rendered row offsets instead of message indexes or totalMessageCount.
	const groupedLenRef = useRef(groupedMessages.length)
	groupedLenRef.current = groupedMessages.length

	const getLastRenderedRowIndex = useCallback(() => {
		const len = groupedLenRef.current
		return len - 1
	}, [])

	// User-initiated smooth scroll (e.g., to-bottom button). Automatic
	// streaming scrolls use instant behavior to avoid competing animations.
	const scrollToBottomSmooth = useMemo(
		() =>
			debounce(() => {
				const lastIdx = getLastRenderedRowIndex()
				if (lastIdx >= 0) {
					virtuosoRef.current?.scrollToIndex({
						index: lastIdx,
						align: "end",
						behavior: "smooth",
					})
				}
			}, 30),
		[getLastRenderedRowIndex],
	)

	// Programmatic instant scroll to bottom (auto-scroll, focus restore).
	const scrollToBottomAuto = useCallback(() => {
		const lastIdx = getLastRenderedRowIndex()
		if (lastIdx >= 0) {
			virtuosoRef.current?.scrollToIndex({
				index: lastIdx,
				align: "end",
				behavior: "auto",
			})
		}
	}, [getLastRenderedRowIndex])

	const clearAutoScrollRetryTimers = useCallback(() => {
		for (const timer of autoScrollRetryTimersRef.current) {
			clearTimeout(timer)
		}
		autoScrollRetryTimersRef.current = []
	}, [])

	const queueAutoScrollToBottom = useCallback(
		(retryAfterLayout = false) => {
			if (disableAutoScrollRef.current) {
				pendingAutoScrollRef.current = false
				clearAutoScrollRetryTimers()
				return
			}

			if (document.visibilityState === "hidden") {
				pendingAutoScrollRef.current = true
				return
			}

			pendingAutoScrollRef.current = false
			clearAutoScrollRetryTimers()

			const scroll = () => {
				if (!disableAutoScrollRef.current && document.visibilityState !== "hidden") {
					scrollToBottomAuto()
				}
			}

			const rafId = requestAnimationFrame(scroll)

			if (retryAfterLayout) {
				autoScrollRetryTimersRef.current = [50, 250, 750].map((delay) => setTimeout(scroll, delay))
			}

			return () => {
				cancelAnimationFrame(rafId)
			}
		},
		[clearAutoScrollRetryTimers, scrollToBottomAuto],
	)

	const scrollToMessage = useCallback(
		(messageIndex: number) => {
			setPendingScrollToMessage(messageIndex)

			const targetMessage = messages[messageIndex]
			if (!targetMessage) {
				setPendingScrollToMessage(null)
				return
			}

			const visibleIndex = visibleMessages.findIndex((msg) => msg.ts === targetMessage.ts)
			if (visibleIndex === -1) {
				setPendingScrollToMessage(null)
				return
			}

			let groupIndex = -1

			for (let i = 0; i < groupedMessages.length; i++) {
				const group = groupedMessages[i]
				if (Array.isArray(group)) {
					const messageInGroup = group.some((msg) => msg.ts === targetMessage.ts)
					if (messageInGroup) {
						groupIndex = i
						break
					}
				} else {
					if (group.ts === targetMessage.ts) {
						groupIndex = i
						break
					}
				}
			}

			if (groupIndex !== -1) {
				setPendingScrollToMessage(null)
				disableAutoScrollRef.current = true

				// Check if this is the first user feedback message (no sticky header would show when scrolling to it)
				const isFirstUserMessage =
					groupIndex === 0 || !visibleMessages.slice(0, visibleIndex).some((msg) => msg.say === "user_feedback")

				const stickyHeaderOffset = isFirstUserMessage ? 0 : STICKY_HEADER_HEIGHT

				// Use scrollToIndex with offset - Virtuoso handles this more reliably than manual scrollTo
				requestAnimationFrame(() => {
					virtuosoRef.current?.scrollToIndex({
						index: groupIndex,
						align: "start",
						behavior: "smooth",
						offset: -stickyHeaderOffset,
					})
				})
			}
		},
		[messages, visibleMessages, groupedMessages],
	)

	// scroll when user toggles certain rows
	const toggleRowExpansion = useCallback(
		(ts: number) => {
			const row = groupedMessages.find((candidate) => !Array.isArray(candidate) && candidate.ts === ts)
			const message = Array.isArray(row) ? undefined : row
			const isCollapsing = resolveMessageRowExpanded(message, expandedRows)
			const lastGroup = groupedMessages.at(-1)
			const isLast = Array.isArray(lastGroup) ? lastGroup[0].ts === ts : lastGroup?.ts === ts
			const secondToLastGroup = groupedMessages.at(-2)
			const isSecondToLast = Array.isArray(secondToLastGroup)
				? secondToLastGroup[0].ts === ts
				: secondToLastGroup?.ts === ts

			const isLastCollapsedApiReq =
				isLast &&
				!Array.isArray(lastGroup) && // Make sure it's not a browser session group
				lastGroup?.say === "api_req_started" &&
				!expandedRows[lastGroup.ts]

			setExpandedRows((prev) => toggleMessageRowExpansion(message, prev))

			// disable auto scroll when user expands row
			if (!isCollapsing) {
				disableAutoScrollRef.current = true
			}
			// Only scroll on collapse, never on expand - expanding should stay in place
			if (isCollapsing && isAtBottom) {
				const timer = setTimeout(() => {
					scrollToBottomAuto()
				}, 0)
				return () => clearTimeout(timer)
			}
			if (isCollapsing && (isLast || isSecondToLast)) {
				if (isSecondToLast && !isLastCollapsedApiReq) {
					return
				}
				const timer = setTimeout(() => {
					scrollToBottomAuto()
				}, 0)
				return () => clearTimeout(timer)
			}
			// When expanding, don't scroll - let the element expand in place
		},
		[groupedMessages, expandedRows, scrollToBottomAuto, isAtBottom, setExpandedRows],
	)

	// Handle row height changes during streaming.
	// Throttled to max once per 120ms so rapid height changes (e.g. during
	// streaming or cancel) don't trigger cascading scrolls that cause jitter.
	// The wider window reduces overlap with the groupedMessages.length
	// useEffect auto-scroll, lowering the chance of dual-path scroll conflicts.
	const handleRowHeightChange = useCallback(
		(isTaller: boolean) => {
			if (!disableAutoScrollRef.current) {
				const now = Date.now()
				if (now - lastRowHeightChangeRef.current < 120) {
					return
				}
				lastRowHeightChangeRef.current = now

				if (isTaller) {
					queueAutoScrollToBottom()
				} else {
					setTimeout(() => {
						queueAutoScrollToBottom()
					}, 0)
				}
			}
		},
		[queueAutoScrollToBottom],
	)

	// When rendered rows arrive, scroll to the bottom if auto-scroll is enabled.
	// totalMessageCount changes alone should not issue a scroll command; the
	// partial-message stream owns row updates during active conversations.
	useEffect(() => {
		if (!disableAutoScrollRef.current) {
			return queueAutoScrollToBottom()
		}
	}, [queueAutoScrollToBottom])

	useEffect(() => {
		if (pendingScrollToMessage !== null) {
			scrollToMessage(pendingScrollToMessage)
		}
	}, [pendingScrollToMessage, scrollToMessage])

	useEffect(() => {
		if (!messages?.length) {
			setShowScrollToBottom(false)
		}
	}, [messages.length])

	const handleWheel = useCallback((event: Event) => {
		const wheelEvent = event as WheelEvent
		if (wheelEvent.deltaY && wheelEvent.deltaY < 0) {
			if (scrollContainerRef.current?.contains(wheelEvent.target as Node)) {
				// user scrolled up
				disableAutoScrollRef.current = true
			}
		}
	}, [])
	useEvent("wheel", handleWheel, window, { passive: true }) // passive improves scrolling performance

	// When webview becomes visible again (user switches back to this tab),
	// scroll to bottom if auto-scroll is enabled. We wait one frame so Virtuoso
	// has a chance to re-layout after being hidden.
	// Both "focus" and "visibilitychange" are monitored to cover all cases
	// (window focus, tab switch, IDE panel toggle).
	useEffect(() => {
		const handleVisibility = () => {
			if (document.visibilityState === "hidden") {
				pendingAutoScrollRef.current = !disableAutoScrollRef.current
				return
			}

			if (!disableAutoScrollRef.current || pendingAutoScrollRef.current) {
				queueAutoScrollToBottom(true)
			}
		}
		window.addEventListener("focus", handleVisibility)
		window.addEventListener("resize", handleVisibility)
		document.addEventListener("visibilitychange", handleVisibility)
		return () => {
			window.removeEventListener("focus", handleVisibility)
			window.removeEventListener("resize", handleVisibility)
			document.removeEventListener("visibilitychange", handleVisibility)
			clearAutoScrollRetryTimers()
		}
	}, [clearAutoScrollRetryTimers, queueAutoScrollToBottom])

	return {
		virtuosoRef,
		scrollContainerRef,
		disableAutoScrollRef,
		isAtBottomRef,
		scrollToBottomSmooth,
		scrollToBottomAuto,
		scrollToMessage,
		toggleRowExpansion,
		handleRowHeightChange,
		showScrollToBottom,
		setShowScrollToBottom,
		isAtBottom,
		setIsAtBottom,
		pendingScrollToMessage,
		setPendingScrollToMessage,
		scrolledPastUserMessage,
		handleRangeChanged,
	}
}
