import type { TaskRateMetricPoint } from "@shared/proto/dline/task"
import { curveMonotoneX, line } from "d3-shape"
import { useMemo, useState } from "react"
import {
	createDefaultEnabledTaskMetricsSeries,
	createTaskMetricsChartLayout,
	formatTaskMetricsSeriesValue,
	getVisibleTaskMetricsSeries,
	readTaskMetricsSeriesValue,
	type TaskMetricsChartPoint,
	type TaskMetricsChartType,
	type TaskMetricsSeriesKey,
	type TaskMetricsView,
} from "./TaskMetricsChartModel"

interface TaskMetricsChartProps {
	readonly points: TaskRateMetricPoint[]
	readonly view: TaskMetricsView
	readonly chartType: TaskMetricsChartType
	readonly degraded?: boolean
}

/** Render the selected compact Task metrics view with locally toggleable series. */
export function TaskMetricsChart({ points, view, chartType, degraded = false }: TaskMetricsChartProps) {
	const [enabledSeries, setEnabledSeries] = useState<Set<TaskMetricsSeriesKey>>(createDefaultEnabledTaskMetricsSeries)
	const [activePointIndex, setActivePointIndex] = useState<number>()
	const chart = useMemo(() => createTaskMetricsChartLayout(points, view, enabledSeries), [enabledSeries, points, view])
	const descriptors = useMemo(() => getVisibleTaskMetricsSeries(points, view), [points, view])
	const activePoint = activePointIndex === undefined ? undefined : chart.hitAreas[activePointIndex]?.point
	const toggleSeries = (key: TaskMetricsSeriesKey) => {
		setEnabledSeries((current) => {
			const next = new Set(current)
			if (next.has(key)) next.delete(key)
			else next.add(key)
			return next
		})
	}

	return (
		<div className="relative min-w-0" data-testid="task-metrics-chart">
			<div aria-label="Chart series" className="mb-1.5 flex flex-wrap gap-1" role="group">
				{descriptors.map((descriptor) => {
					const enabled = enabledSeries.has(descriptor.key)
					return (
						<button
							aria-pressed={enabled}
							className={`inline-flex items-center gap-1 rounded-sm border px-1 py-0.5 text-[9px] ${
								enabled
									? "border-input-placeholder/30 text-foreground"
									: "border-transparent text-description opacity-55"
							}`}
							key={descriptor.key}
							onClick={() => toggleSeries(descriptor.key)}
							onKeyDown={(event) => {
								if (event.key !== "Enter" && event.key !== " ") return
								event.preventDefault()
								toggleSeries(descriptor.key)
							}}
							type="button">
							<span
								aria-hidden="true"
								className="inline-block h-0.5 w-3"
								style={{
									backgroundColor: descriptor.color,
									opacity: enabled ? 1 : 0.45,
								}}
							/>
							{descriptor.label}
						</button>
					)
				})}
			</div>
			<svg
				aria-label="Task metrics history chart"
				className="h-auto w-full rounded-sm border border-input-placeholder/10 bg-(--vscode-editor-background)"
				data-chart-type={chartType}
				data-view={view}
				role="img"
				viewBox={`0 0 ${chart.dimensions.width} ${chart.dimensions.height}`}>
				{chart.primaryTicks.map((tick) => (
					<g data-testid="task-metrics-primary-tick" key={tick.value}>
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
					<text
						data-testid="task-metrics-percentage-tick"
						fill="currentColor"
						fontSize="10"
						key={tick.value}
						textAnchor="start"
						x={chart.plotRight + 8}
						y={tick.y + 3}>
						{tick.label}
					</text>
				))}
				<text fill="currentColor" fontSize="10" fontWeight="600" x={chart.plotLeft} y={16}>
					{view === "tokenCache" ? "Tokens" : "Rate"}
				</text>
				{chart.percentageTicks.length > 0 && (
					<text fill="currentColor" fontSize="10" fontWeight="600" textAnchor="end" x={chart.plotRight} y={16}>
						Cache Hit Rate
					</text>
				)}
				<line
					stroke="var(--vscode-widget-border, currentColor)"
					strokeOpacity="0.5"
					x1={chart.plotLeft}
					x2={chart.plotRight}
					y1={chart.plotBottom}
					y2={chart.plotBottom}
				/>
				{chartType === "bar"
					? chart.series.flatMap(({ descriptor, points: seriesPoints }) =>
							seriesPoints.map((item, index) => (
								<rect
									data-testid={`task-metrics-bar-${descriptor.key}-${index}`}
									fill={descriptor.color}
									height={item.barHeight}
									key={`${descriptor.key}-${item.point.bucketStartMs}`}
									opacity="0.82"
									rx="1"
									width={item.barWidth}
									x={item.barX}
									y={item.barY}
								/>
							)),
						)
					: chart.series.flatMap(({ descriptor, segments }) =>
							segments.map((segment, index) => (
								<path
									d={createSmoothPath(segment)}
									data-testid={`task-metrics-line-${descriptor.key}-${index}`}
									fill="none"
									key={`${descriptor.key}-${segment[0]?.point.bucketStartMs ?? index}`}
									stroke={descriptor.color}
									strokeDasharray={descriptor.dashed ? "6 4" : undefined}
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth="2"
								/>
							)),
						)}
				{chartType === "line" &&
					chart.series.flatMap(({ descriptor, points: seriesPoints }) =>
						seriesPoints.map((item, index) => (
							<circle
								cx={item.x}
								cy={item.y}
								data-testid={`task-metrics-point-${descriptor.key}-${index}`}
								data-value={item.value}
								fill={descriptor.color}
								key={`${descriptor.key}-${item.point.bucketStartMs}`}
								r="3"
							/>
						)),
					)}
				{chart.hitAreas.map((hitArea) => (
					<rect
						aria-label={`Show metrics at ${new Date(hitArea.point.bucketStartMs).toLocaleString()}`}
						data-testid={`task-metrics-hit-area-${hitArea.pointIndex}`}
						fill="transparent"
						height={chart.plotBottom - chart.plotTop}
						key={`${hitArea.point.bucketStartMs}-${hitArea.pointIndex}`}
						onBlur={() => setActivePointIndex(undefined)}
						onFocus={() => setActivePointIndex(hitArea.pointIndex)}
						onMouseEnter={() => setActivePointIndex(hitArea.pointIndex)}
						onMouseLeave={() => setActivePointIndex(undefined)}
						pointerEvents="all"
						role="button"
						tabIndex={0}
						width="20"
						x={hitArea.x - 10}
						y={chart.plotTop}
					/>
				))}
				<text fill="currentColor" fontSize="10" opacity="0.7" x={chart.plotLeft} y={chart.dimensions.height - 10}>
					{new Date(points[0]?.bucketStartMs ?? 0).toLocaleString()}
				</text>
				<text
					fill="currentColor"
					fontSize="10"
					opacity="0.7"
					textAnchor="end"
					x={chart.plotRight}
					y={chart.dimensions.height - 10}>
					{new Date(points.at(-1)?.bucketEndMs ?? 0).toLocaleString()}
				</text>
			</svg>
			{activePoint && (
				<div
					className="pointer-events-none absolute inset-x-2 bottom-2 z-10 max-h-[45%] overflow-auto rounded-sm border border-input-placeholder/20 bg-background p-2 text-xs shadow-lg"
					role="tooltip">
					<div className="mb-1 font-medium">{new Date(activePoint.bucketStartMs).toLocaleString()}</div>
					<div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
						{descriptors
							.filter(({ key }) => enabledSeries.has(key))
							.map((descriptor) => {
								const value = readTaskMetricsSeriesValue(activePoint, descriptor.key)
								return (
									<div key={descriptor.key}>
										{descriptor.label}:{" "}
										{value === undefined ? "Unavailable" : formatTaskMetricsSeriesValue(descriptor, value)}
									</div>
								)
							})}
						<div>History: {degraded ? "Degraded" : "Complete"}</div>
					</div>
				</div>
			)}
		</div>
	)
}

export function createSmoothPath(segment: readonly TaskMetricsChartPoint[]): string {
	return (
		line<TaskMetricsChartPoint>()
			.x(({ x }) => x)
			.y(({ y }) => y)
			.curve(curveMonotoneX)(segment) ?? ""
	)
}
