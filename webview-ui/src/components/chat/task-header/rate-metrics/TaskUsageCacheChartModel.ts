import type { TaskRateMetricPoint } from "@shared/proto/dline/task"
import {
	createTaskRateChartTicks,
	DEFAULT_TASK_RATE_CHART_DIMENSIONS,
	formatTaskRateMetricValue,
	type TaskRateChartDimensions,
	type TaskRateChartTick,
} from "./TaskRateMetricsChartModel"

export type TaskUsageCacheSeriesKey = "input" | "output" | "cacheWrite" | "cacheRead" | "cacheHit"
export type TaskUsageCacheAxis = "tokens" | "percentage"

export interface TaskUsageCacheSeriesDescriptor {
	key: TaskUsageCacheSeriesKey
	label: string
	axis: TaskUsageCacheAxis
	color: string
	dashed: boolean
}

export interface TaskUsageCacheChartPoint {
	point: TaskRateMetricPoint
	value: number
	x: number
	y: number
}

export interface TaskUsageCacheChartSeries {
	descriptor: TaskUsageCacheSeriesDescriptor
	points: TaskUsageCacheChartPoint[]
	segments: TaskUsageCacheChartPoint[][]
}

export interface TaskUsageCacheHitArea {
	point: TaskRateMetricPoint
	pointIndex: number
	x: number
}

export interface TaskUsageCacheChartLayout {
	dimensions: TaskRateChartDimensions
	plotLeft: number
	plotRight: number
	plotTop: number
	plotBottom: number
	tokenAxisMax: number
	tokenTicks: TaskRateChartTick[]
	percentageTicks: TaskRateChartTick[]
	series: TaskUsageCacheChartSeries[]
	hitAreas: TaskUsageCacheHitArea[]
}

export const TASK_USAGE_CACHE_SERIES: readonly TaskUsageCacheSeriesDescriptor[] = [
	{
		key: "input",
		label: "Input",
		axis: "tokens",
		color: "var(--vscode-charts-blue, #58a6ff)",
		dashed: false,
	},
	{
		key: "output",
		label: "Output",
		axis: "tokens",
		color: "var(--vscode-charts-green, #3fb950)",
		dashed: false,
	},
	{
		key: "cacheWrite",
		label: "Cache Creation",
		axis: "tokens",
		color: "var(--vscode-charts-orange, #d18616)",
		dashed: false,
	},
	{
		key: "cacheRead",
		label: "Cache Read",
		axis: "tokens",
		color: "var(--vscode-charts-cyan, #39c5cf)",
		dashed: false,
	},
	{
		key: "cacheHit",
		label: "Cache Hit Rate",
		axis: "percentage",
		color: "var(--vscode-charts-purple, #bc8cff)",
		dashed: true,
	},
] as const

const PERCENTAGE_TICK_VALUES = [0, 0.2, 0.4, 0.6, 0.8, 1] as const

/** Build shared dual-axis geometry for Task usage and cache history. */
export function createTaskUsageCacheChartLayout(
	points: readonly TaskRateMetricPoint[],
	dimensions: TaskRateChartDimensions = DEFAULT_TASK_RATE_CHART_DIMENSIONS,
): TaskUsageCacheChartLayout {
	const sortedPoints = [...points].sort((left, right) => left.bucketStartMs - right.bucketStartMs)
	const plotLeft = dimensions.paddingLeft
	const plotRight = dimensions.width - dimensions.paddingRight
	const plotTop = dimensions.paddingTop
	const plotBottom = dimensions.height - dimensions.paddingBottom
	const plotWidth = Math.max(1, plotRight - plotLeft)
	const plotHeight = Math.max(1, plotBottom - plotTop)
	const startMs = sortedPoints[0]?.bucketStartMs ?? 0
	const endMs = sortedPoints.at(-1)?.bucketEndMs ?? startMs + 1
	const durationMs = Math.max(1, endMs - startMs)
	const tokenValues = sortedPoints.flatMap((point) =>
		TASK_USAGE_CACHE_SERIES.filter(({ axis }) => axis === "tokens")
			.map((descriptor) => readSeriesValue(point, descriptor.key))
			.filter((value): value is number => value !== undefined),
	)
	const tokenAxisMax = getAxisMax(Math.max(0, ...tokenValues))
	const tokenTicks = createTaskRateChartTicks(tokenAxisMax).map((value) => ({
		value,
		y: plotBottom - (value / tokenAxisMax) * plotHeight,
		label: formatTaskRateMetricValue(value),
	}))
	const percentageTicks = PERCENTAGE_TICK_VALUES.map((value) => ({
		value,
		y: plotBottom - value * plotHeight,
		label: `${Math.round(value * 100)}%`,
	}))
	const xForPoint = (point: TaskRateMetricPoint): number => {
		const midpointMs = point.bucketStartMs + (point.bucketEndMs - point.bucketStartMs) / 2
		return plotLeft + ((midpointMs - startMs) / durationMs) * plotWidth
	}

	return {
		dimensions,
		plotLeft,
		plotRight,
		plotTop,
		plotBottom,
		tokenAxisMax,
		tokenTicks,
		percentageTicks,
		series: TASK_USAGE_CACHE_SERIES.map((descriptor) =>
			createSeries(sortedPoints, descriptor, xForPoint, plotTop, plotBottom, tokenAxisMax),
		),
		hitAreas: sortedPoints.map((point, pointIndex) => ({ point, pointIndex, x: xForPoint(point) })),
	}
}

function createSeries(
	points: readonly TaskRateMetricPoint[],
	descriptor: TaskUsageCacheSeriesDescriptor,
	xForPoint: (point: TaskRateMetricPoint) => number,
	plotTop: number,
	plotBottom: number,
	tokenAxisMax: number,
): TaskUsageCacheChartSeries {
	const plotHeight = Math.max(1, plotBottom - plotTop)
	const chartPoints: TaskUsageCacheChartPoint[] = []
	const segments: TaskUsageCacheChartPoint[][] = []
	let currentSegment: TaskUsageCacheChartPoint[] | undefined

	for (const point of points) {
		const value = readSeriesValue(point, descriptor.key)
		if (value === undefined) {
			currentSegment = undefined
			continue
		}
		const normalized = descriptor.axis === "percentage" ? clamp(value, 0, 1) : value / tokenAxisMax
		const chartPoint = {
			point,
			value,
			x: xForPoint(point),
			y: plotBottom - normalized * plotHeight,
		}
		chartPoints.push(chartPoint)

		const previousPoint = currentSegment?.at(-1)
		if (!currentSegment || !previousPoint || !areAdjacent(previousPoint.point, point)) {
			currentSegment = [chartPoint]
			segments.push(currentSegment)
		} else {
			currentSegment.push(chartPoint)
		}
	}

	return { descriptor, points: chartPoints, segments }
}

function readSeriesValue(point: TaskRateMetricPoint, key: TaskUsageCacheSeriesKey): number | undefined {
	switch (key) {
		case "input":
			return point.inputTokens
		case "output":
			return point.outputTokens
		case "cacheWrite":
			return point.cacheWriteTokens
		case "cacheRead":
			return point.cacheReadTokens
		case "cacheHit":
			return point.cacheUsageAvailable ? point.cacheHitRate : undefined
	}
}

function areAdjacent(previous: TaskRateMetricPoint, current: TaskRateMetricPoint): boolean {
	const roundPoints = previous.bucketEndMs - previous.bucketStartMs === 1 && current.bucketEndMs - current.bucketStartMs === 1
	return roundPoints || current.bucketStartMs <= previous.bucketEndMs
}

function getAxisMax(maxValue: number): number {
	if (maxValue <= 0) return 1
	return createTaskRateChartTicks(maxValue).at(-1) ?? 1
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value))
}
