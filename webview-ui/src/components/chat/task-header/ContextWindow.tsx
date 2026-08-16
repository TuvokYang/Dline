import type { ContextWindowIndicatorSnapshot } from "@shared/context-window-indicator"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import debounce from "debounce"
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Progress } from "@/components/ui/progress"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"
import CompactTaskButton from "./buttons/CompactTaskButton"
import { createContextWindowIndicatorViewModel } from "./ContextWindowIndicatorViewModel"
import { ContextWindowSummary } from "./ContextWindowSummary"
import ContextWindowSegmentedProgress from "./ContextWindowSegmentedProgress"

// Type definitions
interface ContextWindowInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
	size?: number
}

interface ContextWindowProgressProps extends ContextWindowInfoProps {
	useAutoCondense: boolean
	lastApiReqTotalTokens?: number
	contextWindow?: number
	contextWindowIndicator?: ContextWindowIndicatorSnapshot
	compactTaskDisabled?: boolean
	onCompactTask?: () => Promise<boolean>
}

const ConfirmationDialog = memo<{
	onConfirm: (event: React.MouseEvent) => void
	onCancel: (event: React.MouseEvent) => void
}>(({ onConfirm, onCancel }) => (
	<div className="text-sm my-2 flex items-center gap-0 justify-between">
		<span className="font-semibold text-sm">Compact the current task?</span>
		<span className="flex gap-1">
			<VSCodeButton
				appearance="secondary"
				className="text-sm"
				onClick={onCancel}
				title="No, keep the task as is"
				type="button">
				Cancel
			</VSCodeButton>
			<VSCodeButton
				appearance="primary"
				autoFocus
				className="text-sm"
				onClick={onConfirm}
				title="Yes, compact the task"
				type="button">
				Yes
			</VSCodeButton>
		</span>
	</div>
))
ConfirmationDialog.displayName = "ConfirmationDialog"

const ContextWindow: React.FC<ContextWindowProgressProps> = ({
	contextWindow = 0,
	lastApiReqTotalTokens = 0,
	tokensIn,
	tokensOut,
	cacheWrites,
	cacheReads,
	contextWindowIndicator,
	compactTaskDisabled,
	onCompactTask,
}) => {
	const [isOpened, setIsOpened] = useState(false)
	const [confirmationNeeded, setConfirmationNeeded] = useState(false)
	const progressBarRef = useRef<HTMLDivElement>(null)

	const indicatorViewModel = useMemo(
		() => (contextWindowIndicator ? createContextWindowIndicatorViewModel(contextWindowIndicator) : undefined),
		[contextWindowIndicator],
	)
	const tokenData = useMemo(() => {
		const max = indicatorViewModel?.contextWindow ?? contextWindow
		if (!max) return null
		const used = indicatorViewModel?.totalTokens ?? lastApiReqTotalTokens
		return {
			percentage: indicatorViewModel?.percentage ?? (used / max) * 100,
			max,
			used,
		}
	}, [contextWindow, indicatorViewModel, lastApiReqTotalTokens])

	const debounceCloseHover = useCallback((e: React.MouseEvent) => {
		e.preventDefault()
		e.stopPropagation()
		const showHover = debounce((open: boolean) => setIsOpened(open), 100)

		return showHover(false)
	}, [])

	const handleFocus = useCallback(() => {
		setIsOpened(true)
	}, [])

	const handleCompactClick = useCallback(
		(event: React.MouseEvent) => {
			event.preventDefault()
			event.stopPropagation()
			if (compactTaskDisabled) return
			setConfirmationNeeded((needed) => !needed)
		},
		[compactTaskDisabled],
	)

	const handleConfirm = useCallback(
		async (event: React.MouseEvent) => {
			event.preventDefault()
			event.stopPropagation()
			if (await onCompactTask?.()) setConfirmationNeeded(false)
		},
		[onCompactTask],
	)

	const handleCancel = useCallback((event: React.MouseEvent) => {
		event.preventDefault()
		event.stopPropagation()
		setConfirmationNeeded(false)
	}, [])

	useEffect(() => {
		if (!onCompactTask) setConfirmationNeeded(false)
	}, [onCompactTask])

	// Close tooltip when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Element
			const isInsideProgressBar = progressBarRef.current?.contains(target as Node)

			// Check if click is inside any tooltip content by looking for our custom class
			const isInsideTooltipContent = target.closest(".context-window-tooltip-content") !== null

			if (!isInsideProgressBar && !isInsideTooltipContent) {
				setIsOpened(false)
			}
		}

		if (isOpened) {
			document.addEventListener("mousedown", handleClickOutside)
			return () => document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [isOpened])

	if (!tokenData) {
		return null
	}

	return (
		<div className="flex flex-col my-1.5" data-testid="context-window-indicator" onMouseLeave={debounceCloseHover}>
			<div className="flex gap-1 flex-row @max-xs:flex-col @max-xs:items-start items-center text-sm">
				<div className="flex items-center gap-1.5 flex-1 whitespace-nowrap">
					<span className="cursor-pointer text-sm" title="Current tokens used in this request">
						{formatTokenNumber(tokenData.used)}
					</span>
					<div className="flex relative items-center gap-1 flex-1 w-full h-full" onMouseEnter={() => setIsOpened(true)}>
						<HoverCard>
							<HoverCardContent className="bg-menu rounded-xs shadow-sm">
								<ContextWindowSummary
									cacheReads={cacheReads}
									cacheWrites={cacheWrites}
									contextWindow={tokenData.max}
									indicatorViewModel={indicatorViewModel}
									percentage={tokenData.percentage}
									tokensIn={tokensIn}
									tokensOut={tokensOut}
									tokenUsed={tokenData.used}
								/>
							</HoverCardContent>
							<HoverCardTrigger asChild>
								{/* TODO: Re-add role="slider", aria-value*, onKeyDown, onClick, and tabIndex
								    when click-to-set-threshold is implemented. See PR #9348 for context. */}
								<div
									className="relative w-full text-foreground context-window-progress brightness-100"
									onFocus={handleFocus}
									ref={progressBarRef}>
									{contextWindowIndicator ? (
										<ContextWindowSegmentedProgress snapshot={contextWindowIndicator} />
									) : (
										<Progress aria-label="Context window usage progress" value={tokenData.percentage} />
									)}
									</div>
							</HoverCardTrigger>
						</HoverCard>
					</div>
					<span className="cursor-pointer text-sm" title="Maximum context window size for this model">
						{formatTokenNumber(tokenData.max)}
					</span>
				</div>
				{onCompactTask && <CompactTaskButton disabled={compactTaskDisabled} onClick={handleCompactClick} />}
			</div>
			{confirmationNeeded && <ConfirmationDialog onCancel={handleCancel} onConfirm={handleConfirm} />}
		</div>
	)
}

export default memo(ContextWindow)
