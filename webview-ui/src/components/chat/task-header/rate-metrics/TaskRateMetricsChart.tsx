import { type TaskRateMetricPoint, TaskRateTokenQuality } from "@shared/proto/dline/task"
import { useMemo, useState } from "react"
import { MetricIcon } from "../../../common/metrics/MetricIcon"
import {
	createTaskRateChartLayout,
	formatTaskRateMetricValue,
	getTaskRateMetricLabel,
	type TaskRateMetric,
} from "./TaskRateMetricsChartModel"

export type TaskRateChartType = "bar" | "line"

interface TaskRateMetricsChartProps {
	points: TaskRateMetricPoint[]
	metric?: TaskRateMetric
	chartType?: TaskRateChartType
}

/** Render one selected Task API metric as a sparse bar or line chart. */
export function TaskRateMetricsChart({ chartType = "bar", metric = "tpm", points }: TaskRateMetricsChartProps) {
	const [activePointIndex, setActivePointIndex] = useState<number>()
	const chart = useMemo(() => createTaskRateChartLayout(points, metric), [metric, points])
	const activePoint = activePointIndex === undefined ? undefined : chart.points[activePointIndex]
	const metricLabel = getTaskRateMetricLabel(metric)

	return (
		<div className="relative" data-testid="task-rate-metrics-chart">
			<div className="mb-1 flex items-center gap-2 text-xs text-description">
				<MetricIcon kind={metric} />
				<span data-testid="task-rate-selected-metric">{metricLabel}</span>
				<span className="text-description/70">{chartType === "bar" ? "Bar" : "Line"}</span>
			</div>
			<svg
				aria-label="API rate history chart"
				className="h-auto w-full overflow-visible rounded-sm border border-input-placeholder/10 bg-(--vscode-editor-background)"
				data-chart-type={chartType}
				data-metric={metric}
				role="img"
				viewBox={`0 0 ${chart.dimensions.width} ${chart.dimensions.height}`}>
				{chart.ticks.map((tick) => (
					<g data-testid={`task-rate-y-tick-${tick.value}`} key={tick.value}>
						<line
							data-testid="task-rate-grid-line"
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
				<line
					stroke="var(--vscode-widget-border, currentColor)"
					strokeOpacity="0.5"
					x1={chart.plotLeft}
					x2={chart.plotRight}
					y1={chart.plotBottom}
					y2={chart.plotBottom}
				/>
				{chartType === "bar"
					? chart.points.map((item, index) => (
							<rect
								aria-label={`${metricLabel} ${formatTaskRateMetricValue(item.value)} at ${new Date(item.point.bucketStartMs).toLocaleString()}`}
								data-testid={`task-rate-bar-${index}`}
								fill="var(--vscode-charts-green, #22c55e)"
								height={item.barHeight}
								key={item.point.bucketStartMs}
								onBlur={() => setActivePointIndex(undefined)}
								onFocus={() => setActivePointIndex(index)}
								onMouseEnter={() => setActivePointIndex(index)}
								onMouseLeave={() => setActivePointIndex(undefined)}
								opacity="0.8"
								role="button"
								rx="1"
								tabIndex={0}
								width={item.barWidth}
								x={item.barX}
								y={item.barY}
							/>
						))
					: chart.segments.map((segment, index) => (
							<path
								aria-label={`${metricLabel} segment ${index + 1}`}
								d={toPath(segment)}
								data-testid="task-rate-series-line"
								fill="none"
								key={`segment-${segment[0]?.point.bucketStartMs ?? index}`}
								stroke="var(--vscode-charts-green, #22c55e)"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
							/>
						))}
				{chartType === "line" &&
					chart.points.map((item, index) => (
						<circle
							aria-label={`${metricLabel} ${formatTaskRateMetricValue(item.value)} at ${new Date(item.point.bucketStartMs).toLocaleString()}`}
							cx={item.x}
							cy={item.y}
							data-testid={`task-rate-point-${index}`}
							fill="var(--vscode-charts-green, #22c55e)"
							key={item.point.bucketStartMs}
							onBlur={() => setActivePointIndex(undefined)}
							onFocus={() => setActivePointIndex(index)}
							onMouseEnter={() => setActivePointIndex(index)}
							onMouseLeave={() => setActivePointIndex(undefined)}
							r="4"
							role="button"
							tabIndex={0}
						/>
					))}
				<text fill="currentColor" fontSize="10" opacity="0.7" x={chart.plotLeft} y={chart.dimensions.height - 10}>
					{new Date(chart.points[0]?.point.bucketStartMs ?? 0).toLocaleString()}
				</text>
				<text
					fill="currentColor"
					fontSize="10"
					opacity="0.7"
					textAnchor="end"
					x={chart.plotRight}
					y={chart.dimensions.height - 10}>
					{new Date(chart.points.at(-1)?.point.bucketEndMs ?? 0).toLocaleString()}
				</text>
			</svg>
			{activePoint && (
				<div
					className="absolute right-2 top-6 rounded-sm border border-input-placeholder/20 bg-background p-2 text-xs shadow-lg"
					role="tooltip">
					<div>Time: {new Date(activePoint.point.bucketStartMs).toLocaleString()}</div>
					<div>
						Selected {metricLabel}: {formatTaskRateMetricValue(activePoint.value)}
					</div>
					<div>TPM: {formatOptionalValue(activePoint.point.tokensPerMinute)}</div>
					<div>RPM: {formatOptionalValue(activePoint.point.requestsPerMinute)}</div>
					<div>Tokens: {formatOptionalValue(activePoint.point.tokenCount)}</div>
					<div>Active seconds: {formatOptionalValue(activePoint.point.activeSeconds)}</div>
					<div>Quality: {formatQuality(activePoint.point.tokenQuality)}</div>
				</div>
			)}
		</div>
	)
}

function toPath(segment: Array<{ x: number; y: number }>): string {
	return segment.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ")
}

function formatOptionalValue(value: number | undefined): string {
	return value === undefined ? "Unavailable" : value.toLocaleString()
}

function formatQuality(quality: TaskRateTokenQuality | undefined): string {
	if (quality === undefined) return "Unavailable"
	switch (quality) {
		case TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_MIXED:
			return "Mixed"
		case TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_EXACT:
			return "Exact"
		default:
			return "Estimated"
	}
}
