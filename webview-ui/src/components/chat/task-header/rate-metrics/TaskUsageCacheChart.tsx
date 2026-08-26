import { type TaskRateMetricPoint, TaskRateRoundStatus, TaskRateUsageQuality } from "@shared/proto/dline/task"
import { useMemo, useState } from "react"
import {
	createTaskUsageCacheChartLayout,
	TASK_USAGE_CACHE_SERIES,
	type TaskUsageCacheChartPoint,
} from "./TaskUsageCacheChartModel"

interface TaskUsageCacheChartProps {
	points: TaskRateMetricPoint[]
	degraded?: boolean
}

/** Render Task token usage and cache hit rate on independent Y axes. */
export function TaskUsageCacheChart({ degraded = false, points }: TaskUsageCacheChartProps) {
	const [activePointIndex, setActivePointIndex] = useState<number>()
	const chart = useMemo(() => createTaskUsageCacheChartLayout(points), [points])
	const activePoint = activePointIndex === undefined ? undefined : chart.hitAreas[activePointIndex]?.point

	return (
		<div className="relative" data-testid="task-usage-cache-chart">
			<ul
				aria-label="Usage and cache series legend"
				className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-description">
				{TASK_USAGE_CACHE_SERIES.map((descriptor) => (
					<li
						className="inline-flex items-center gap-1.5"
						data-testid="task-usage-cache-legend-item"
						key={descriptor.key}>
						<svg aria-hidden="true" height="8" viewBox="0 0 22 8" width="22">
							<line
								stroke={descriptor.color}
								strokeDasharray={descriptor.dashed ? "6 4" : undefined}
								strokeWidth="2"
								x1="1"
								x2="21"
								y1="4"
								y2="4"
							/>
						</svg>
						<span>{descriptor.label}</span>
					</li>
				))}
			</ul>
			<svg
				aria-label="Task usage and cache hit history chart"
				className="h-auto w-full overflow-visible rounded-sm border border-input-placeholder/10 bg-(--vscode-editor-background)"
				data-left-axis="tokens"
				data-right-axis="cache-hit-rate"
				role="img"
				viewBox={`0 0 ${chart.dimensions.width} ${chart.dimensions.height}`}>
				{chart.tokenTicks.map((tick) => (
					<g data-testid="task-usage-cache-token-tick" key={`token-${tick.value}`}>
						<line
							stroke="var(--vscode-widget-border, currentColor)"
							strokeOpacity="0.28"
							x1={chart.plotLeft}
							x2={chart.plotRight}
							y1={tick.y}
							y2={tick.y}
						/>
						<text fill="currentColor" fontSize="10" textAnchor="end" x={chart.plotLeft - 8} y={tick.y + 3}>
							{tick.label}
						</text>
					</g>
				))}
				{chart.percentageTicks.map((tick) => (
					<g data-testid="task-usage-cache-percentage-tick" key={`percentage-${tick.value}`}>
						<text fill="currentColor" fontSize="10" textAnchor="start" x={chart.plotRight + 8} y={tick.y + 3}>
							{tick.label}
						</text>
					</g>
				))}
				<text fill="currentColor" fontSize="10" fontWeight="600" x={chart.plotLeft} y={16}>
					Tokens
				</text>
				<text fill="currentColor" fontSize="10" fontWeight="600" textAnchor="end" x={chart.plotRight} y={16}>
					Cache Hit Rate
				</text>
				<line
					stroke="var(--vscode-widget-border, currentColor)"
					strokeOpacity="0.5"
					x1={chart.plotLeft}
					x2={chart.plotRight}
					y1={chart.plotBottom}
					y2={chart.plotBottom}
				/>
				{chart.series.flatMap(({ descriptor, segments }) =>
					segments.map((segment, segmentIndex) => (
						<path
							d={toPath(segment)}
							data-testid={`task-usage-cache-line-${descriptor.key}-${segmentIndex}`}
							fill="none"
							key={`${descriptor.key}-${segment[0]?.point.bucketStartMs ?? "empty"}-${segment.at(-1)?.point.bucketStartMs ?? "empty"}`}
							stroke={descriptor.color}
							strokeDasharray={descriptor.dashed ? "6 4" : undefined}
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
						/>
					)),
				)}
				{chart.series.flatMap(({ descriptor, points: seriesPoints }) =>
					seriesPoints.map((item, pointIndex) => (
						<circle
							cx={item.x}
							cy={item.y}
							data-testid={`task-usage-cache-point-${descriptor.key}-${pointIndex}`}
							data-value={item.value}
							fill={descriptor.color}
							key={`${descriptor.key}-${item.point.bucketStartMs}`}
							r="3"
						/>
					)),
				)}
				{chart.hitAreas.map((hitArea) => (
					<circle
						aria-label={`Show metrics at ${new Date(hitArea.point.completedAtMs ?? hitArea.point.bucketStartMs).toLocaleString()}`}
						cx={hitArea.x}
						cy={(chart.plotTop + chart.plotBottom) / 2}
						data-testid={`task-usage-cache-hit-area-${hitArea.pointIndex}`}
						fill="transparent"
						key={`hit-${hitArea.point.bucketStartMs}-${hitArea.pointIndex}`}
						onBlur={() => setActivePointIndex(undefined)}
						onFocus={() => setActivePointIndex(hitArea.pointIndex)}
						onMouseEnter={() => setActivePointIndex(hitArea.pointIndex)}
						onMouseLeave={() => setActivePointIndex(undefined)}
						r="11"
						role="button"
						tabIndex={0}
					/>
				))}
				<text fill="currentColor" fontSize="10" opacity="0.7" x={chart.plotLeft} y={chart.dimensions.height - 10}>
					{new Date(points[0]?.completedAtMs ?? points[0]?.bucketStartMs ?? 0).toLocaleString()}
				</text>
				<text
					fill="currentColor"
					fontSize="10"
					opacity="0.7"
					textAnchor="end"
					x={chart.plotRight}
					y={chart.dimensions.height - 10}>
					{new Date(points.at(-1)?.completedAtMs ?? points.at(-1)?.bucketEndMs ?? 0).toLocaleString()}
				</text>
			</svg>
			{activePoint && <TaskUsageCacheTooltip degraded={degraded} point={activePoint} />}
		</div>
	)
}

function TaskUsageCacheTooltip({ degraded, point }: { degraded: boolean; point: TaskRateMetricPoint }) {
	return (
		<div
			className="pointer-events-none absolute inset-x-2 bottom-2 z-10 grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-sm border border-input-placeholder/20 bg-background p-2 text-xs shadow-lg"
			role="tooltip">
			<div className="col-span-2">Completed: {new Date(point.completedAtMs ?? point.bucketStartMs).toLocaleString()}</div>
			{point.roundId !== undefined && <div className="col-span-2 break-all">Round: {point.roundId}</div>}
			{point.logicalRequestId !== undefined && (
				<div className="col-span-2 break-all">Logical request: {point.logicalRequestId}</div>
			)}
			{point.apiIndex !== undefined && <div>API index: {point.apiIndex}</div>}
			{point.taskAttempt !== undefined && <div>Task attempt: {point.taskAttempt}</div>}
			{point.providerAttempt !== undefined && <div>Provider attempt: {point.providerAttempt}</div>}
			<div>Status: {formatStatus(point.status)}</div>
			<div>Input: {formatOptionalMetric(point.inputTokens)}</div>
			<div>Output: {formatOptionalMetric(point.outputTokens)}</div>
			<div>Cache Creation: {formatOptionalMetric(point.cacheWriteTokens)}</div>
			<div>Cache Read: {formatOptionalMetric(point.cacheReadTokens)}</div>
			<div>Cache Hit Rate: {formatCacheHit(point)}</div>
			<div>Provider duration: {formatDuration(point.providerDurationMs)}</div>
			<div>RPM: {formatOptionalMetric(point.requestsPerMinute)}</div>
			<div>TPM: {formatOptionalMetric(point.tokensPerMinute)}</div>
			<div>Total Tokens: {formatOptionalMetric(point.tokenCount)}</div>
			<div>Quality: {formatQuality(point.usageQuality)}</div>
			<div>Provisional: {point.provisional ? "Yes" : "No"}</div>
			<div>History: {degraded ? "Degraded" : "Complete"}</div>
		</div>
	)
}

function toPath(segment: TaskUsageCacheChartPoint[]): string {
	return segment.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")
}

function formatOptionalMetric(value: number | undefined): string {
	return value === undefined ? "Unavailable" : value.toLocaleString()
}

function formatCacheHit(point: TaskRateMetricPoint): string {
	return point.cacheUsageAvailable && point.cacheHitRate !== undefined
		? `${(point.cacheHitRate * 100).toFixed(1)}%`
		: "Unavailable"
}

function formatDuration(value: number | undefined): string {
	return value === undefined ? "Unavailable" : `${value.toLocaleString()} ms`
}

function formatStatus(status: TaskRateRoundStatus | undefined): string {
	switch (status) {
		case TaskRateRoundStatus.TASK_RATE_ROUND_STATUS_COMPLETED:
			return "Completed"
		case TaskRateRoundStatus.TASK_RATE_ROUND_STATUS_FAILED:
			return "Failed"
		case TaskRateRoundStatus.TASK_RATE_ROUND_STATUS_CANCELLED:
			return "Cancelled"
		case TaskRateRoundStatus.TASK_RATE_ROUND_STATUS_ABORTED:
			return "Aborted"
		default:
			return "Unavailable"
	}
}

function formatQuality(quality: TaskRateUsageQuality): string {
	switch (quality) {
		case TaskRateUsageQuality.TASK_RATE_USAGE_QUALITY_ESTIMATED:
			return "Estimated"
		case TaskRateUsageQuality.TASK_RATE_USAGE_QUALITY_EXACT:
			return "Exact"
		case TaskRateUsageQuality.TASK_RATE_USAGE_QUALITY_MIXED:
			return "Mixed"
		case TaskRateUsageQuality.TASK_RATE_USAGE_QUALITY_LEGACY:
			return "Legacy"
		default:
			return "Unavailable"
	}
}
