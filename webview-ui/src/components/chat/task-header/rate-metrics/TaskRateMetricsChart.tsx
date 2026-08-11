import { type TaskRateMetricPoint, TaskRateTokenQuality } from "@shared/proto/dline/task"
import React, { useMemo, useState } from "react"

interface TaskRateMetricsChartProps {
	points: TaskRateMetricPoint[]
}

interface ChartPoint {
	point: TaskRateMetricPoint
	x: number
	yRpm: number
	yTpm: number
}

const WIDTH = 720
const HEIGHT = 280
const PADDING_X = 44
const PADDING_Y = 28

/** Render sparse Task API rate points without connecting across idle gaps. */
export function TaskRateMetricsChart({ points }: TaskRateMetricsChartProps) {
	const [activePointIndex, setActivePointIndex] = useState<number>()
	const chart = useMemo(() => createChart(points), [points])
	const activePoint = activePointIndex === undefined ? undefined : points[activePointIndex]

	return (
		<div className="relative" data-testid="task-rate-metrics-chart">
			<div className="mb-1 flex gap-4 text-xs text-description">
				<span className="text-success">TPM</span>
				<span className="text-link">RPM</span>
			</div>
			<svg
				aria-label="API rate history chart"
				className="h-auto w-full overflow-visible rounded-sm border border-input-placeholder/10 bg-(--vscode-editor-background)"
				role="img"
				viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
				<line
					stroke="var(--vscode-widget-border, currentColor)"
					strokeOpacity="0.5"
					x1={PADDING_X}
					x2={WIDTH - PADDING_X}
					y1={HEIGHT - PADDING_Y}
					y2={HEIGHT - PADDING_Y}
				/>
				{chart.segments.map((segment, index) => (
					<React.Fragment key={`segment-${segment[0]?.point.bucketStartMs ?? index}`}>
						<path
							d={toPath(segment, "yTpm")}
							data-testid="task-rate-series-tpm"
							fill="none"
							stroke="var(--vscode-testing-iconPassed, #22c55e)"
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
						/>
						<path
							d={toPath(segment, "yRpm")}
							data-testid="task-rate-series-rpm"
							fill="none"
							stroke="var(--vscode-textLink-foreground, #3794ff)"
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
						/>
					</React.Fragment>
				))}
				{chart.points.map((item, index) => (
					<circle
						aria-label={`Rate point ${new Date(item.point.bucketStartMs).toLocaleString()}`}
						cx={item.x}
						cy={item.yTpm}
						data-testid={`task-rate-point-${index}`}
						fill="var(--vscode-testing-iconPassed, #22c55e)"
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
				<text fill="currentColor" fontSize="10" opacity="0.7" x={PADDING_X} y={HEIGHT - 8}>
					{new Date(points[0]?.bucketStartMs ?? 0).toLocaleString()}
				</text>
				<text fill="currentColor" fontSize="10" opacity="0.7" textAnchor="end" x={WIDTH - PADDING_X} y={HEIGHT - 8}>
					{new Date(points.at(-1)?.bucketEndMs ?? 0).toLocaleString()}
				</text>
			</svg>
			{activePoint && (
				<div
					className="absolute right-2 top-6 rounded-sm border border-input-placeholder/20 bg-background p-2 text-xs shadow-lg"
					role="tooltip">
					<div>Time: {new Date(activePoint.bucketStartMs).toLocaleString()}</div>
					<div>TPM: {activePoint.tokensPerMinute.toLocaleString()}</div>
					<div>RPM: {activePoint.requestsPerMinute.toLocaleString()}</div>
					<div>Active seconds: {activePoint.activeSeconds}</div>
					<div>Quality: {formatQuality(activePoint.tokenQuality)}</div>
				</div>
			)}
		</div>
	)
}

function createChart(points: TaskRateMetricPoint[]): { points: ChartPoint[]; segments: ChartPoint[][] } {
	const startMs = points[0]?.bucketStartMs ?? 0
	const endMs = points.at(-1)?.bucketEndMs ?? startMs + 1
	const durationMs = Math.max(1, endMs - startMs)
	const maxRpm = Math.max(1, ...points.map((point) => point.requestsPerMinute))
	const maxTpm = Math.max(1, ...points.map((point) => point.tokensPerMinute))
	const plotWidth = WIDTH - PADDING_X * 2
	const plotHeight = HEIGHT - PADDING_Y * 2
	const chartPoints = points.map((point) => {
		const midpointMs = point.bucketStartMs + (point.bucketEndMs - point.bucketStartMs) / 2
		return {
			point,
			x: PADDING_X + ((midpointMs - startMs) / durationMs) * plotWidth,
			yRpm: PADDING_Y + (1 - point.requestsPerMinute / maxRpm) * plotHeight,
			yTpm: PADDING_Y + (1 - point.tokensPerMinute / maxTpm) * plotHeight,
		}
	})
	const segments: ChartPoint[][] = []
	for (const point of chartPoints) {
		const current = segments.at(-1)
		const previous = current?.at(-1)
		if (!current || !previous || point.point.bucketStartMs > previous.point.bucketEndMs) segments.push([point])
		else current.push(point)
	}
	return { points: chartPoints, segments }
}

function toPath(segment: ChartPoint[], key: "yRpm" | "yTpm"): string {
	return segment.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point[key].toFixed(2)}`).join(" ")
}

function formatQuality(quality: TaskRateTokenQuality): string {
	switch (quality) {
		case TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_MIXED:
			return "Mixed"
		case TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_EXACT:
			return "Exact"
		default:
			return "Estimated"
	}
}
