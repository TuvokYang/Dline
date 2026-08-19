import React from "react"
import { formatLargeNumber as formatTokenNumber } from "@/utils/format"
import type { ContextWindowIndicatorViewModel } from "./ContextWindowIndicatorViewModel"

interface TokenUsageInfoProps {
	tokensIn?: number
	tokensOut?: number
	cacheWrites?: number
	cacheReads?: number
}

interface TaskContextWindowButtonsProps extends TokenUsageInfoProps {
	percentage: number
	tokenUsed: number
	contextWindow: number
	autoCompactThreshold?: number
	isThresholdChanged?: boolean
	isThresholdFadingOut?: boolean
	indicatorViewModel?: ContextWindowIndicatorViewModel
}

const SEGMENT_COLORS = {
	durable: "var(--vscode-charts-green, #3fb950)",
	active: "var(--vscode-charts-blue, #58a6ff)",
	staged: "var(--vscode-charts-orange, #d18616)",
	environment: "var(--vscode-charts-purple, #bc8cff)",
} as const

function getSegmentColor(segment: ContextWindowIndicatorViewModel["segments"][number]): string {
	if (segment.kind === "active" && segment.label === "Receiving") return "var(--vscode-charts-yellow, #d29922)"
	return SEGMENT_COLORS[segment.kind]
}

export const ContextWindowSummary: React.FC<TaskContextWindowButtonsProps> = ({
	contextWindow,
	tokenUsed,
	percentage,
	indicatorViewModel,
}) => (
	<div className="context-window-tooltip-content flex w-60 flex-col gap-2 rounded bg-menu p-2 shadow-sm z-100">
		<div className="flex items-center justify-between gap-3">
			<span className="font-semibold">Context Window</span>
			<span className="font-mono text-muted-foreground">{percentage.toFixed(1)}%</span>
		</div>
		<div className="grid grid-cols-3 gap-2 text-xs">
			<div className="min-w-0 text-center" data-context-summary-metric="used">
				<div className="text-muted-foreground">Used</div>
				<div className="font-mono">{formatTokenNumber(tokenUsed)}</div>
			</div>
			<div className="min-w-0 text-center" data-context-summary-metric="remaining">
				<div className="text-muted-foreground">Remaining</div>
				<div className="font-mono">
					{formatTokenNumber(indicatorViewModel?.remainingTokens ?? Math.max(0, contextWindow - tokenUsed))}
				</div>
			</div>
			<div className="min-w-0 text-center" data-context-summary-metric="total">
				<div className="text-muted-foreground">Total</div>
				<div className="font-mono">{formatTokenNumber(contextWindow)}</div>
			</div>
		</div>
		{indicatorViewModel && (
			<div
				className="grid grid-cols-2 gap-1.5 border-t border-foreground/10 pt-2"
				data-testid="context-window-segment-details">
				{indicatorViewModel.segments.map((segment) => (
					<div
						className="flex items-center justify-between gap-2 rounded px-2 py-1 text-[11px] text-white"
						data-segment-detail={segment.kind}
						key={segment.kind}
						style={{ backgroundColor: getSegmentColor(segment) }}>
						<span className="font-semibold">{segment.label}</span>
						<span className="font-mono">{formatTokenNumber(segment.authoritativeTokens)}</span>
					</div>
				))}
			</div>
		)}
	</div>
)
