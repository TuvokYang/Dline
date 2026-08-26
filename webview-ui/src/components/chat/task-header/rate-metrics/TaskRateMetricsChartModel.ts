import type { TaskRateMetricPoint } from "@shared/proto/dline/task"
import { formatTokenMetric } from "../util"

export type TaskRateMetric = "tpm" | "rpm" | "tokens"

export interface TaskRateChartDimensions {
	width: number
	height: number
	paddingLeft: number
	paddingRight: number
	paddingTop: number
	paddingBottom: number
}

export interface TaskRateChartTick {
	value: number
	y: number
	label: string
}

export interface TaskRateChartPoint {
	point: TaskRateMetricPoint
	value: number
	x: number
	y: number
	barX: number
	barWidth: number
	barY: number
	barHeight: number
}

export interface TaskRateChartLayout {
	metric: TaskRateMetric
	dimensions: TaskRateChartDimensions
	plotLeft: number
	plotRight: number
	plotTop: number
	plotBottom: number
	maxValue: number
	ticks: TaskRateChartTick[]
	points: TaskRateChartPoint[]
	segments: TaskRateChartPoint[][]
}

export const DEFAULT_TASK_RATE_CHART_DIMENSIONS: TaskRateChartDimensions = {
	width: 720,
	height: 320,
	paddingLeft: 62,
	paddingRight: 24,
	paddingTop: 28,
	paddingBottom: 38,
}

const DEFAULT_TICK_COUNT = 5
const MIN_BAR_WIDTH = 4
const MAX_BAR_WIDTH = 36

/** Return the value represented by one Task rate history point. */
export function getTaskRateMetricValue(point: TaskRateMetricPoint, metric: TaskRateMetric): number | undefined {
	switch (metric) {
		case "rpm":
			return point.requestsPerMinute
		case "tokens":
			return point.tokenCount
		case "tpm":
			return point.tokensPerMinute
	}
}

/** Return the user-facing label for a Task rate history metric. */
export function getTaskRateMetricLabel(metric: TaskRateMetric): string {
	switch (metric) {
		case "rpm":
			return "RPM"
		case "tokens":
			return "Tokens"
		case "tpm":
			return "TPM"
	}
}

/** Format a metric value using the compact token/rate notation used by TaskHeader. */
export function formatTaskRateMetricValue(value: number): string {
	return formatTokenMetric(Math.max(0, Math.round(value)))
}

/** Build a sparse chart layout for one selected metric. */
export function createTaskRateChartLayout(
	points: readonly TaskRateMetricPoint[],
	metric: TaskRateMetric,
	dimensions: TaskRateChartDimensions = DEFAULT_TASK_RATE_CHART_DIMENSIONS,
): TaskRateChartLayout {
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
	const availableValues = sortedPoints
		.map((point) => getTaskRateMetricValue(point, metric))
		.filter((value): value is number => value !== undefined)
	const maxValue = Math.max(0, ...availableValues)
	const axisMax = getAxisMax(maxValue)
	const ticks = createTaskRateChartTicks(axisMax, DEFAULT_TICK_COUNT).map((value) => ({
		value,
		y: plotBottom - (value / axisMax) * plotHeight,
		label: formatTaskRateMetricValue(value),
	}))

	const chartPoints: TaskRateChartPoint[] = []
	const segments: TaskRateChartPoint[][] = []
	let currentSegment: TaskRateChartPoint[] | undefined
	for (const point of sortedPoints) {
		const value = getTaskRateMetricValue(point, metric)
		if (value === undefined) {
			currentSegment = undefined
			continue
		}
		const midpointMs = point.bucketStartMs + (point.bucketEndMs - point.bucketStartMs) / 2
		const x = plotLeft + ((midpointMs - startMs) / durationMs) * plotWidth
		const y = plotBottom - (value / axisMax) * plotHeight
		const bucketWidth = ((point.bucketEndMs - point.bucketStartMs) / durationMs) * plotWidth
		const barWidth = clamp(bucketWidth * 0.72, MIN_BAR_WIDTH, MAX_BAR_WIDTH)
		const chartPoint = {
			point,
			value,
			x,
			y,
			barX: x - barWidth / 2,
			barWidth,
			barY: y,
			barHeight: Math.max(0, plotBottom - y),
		}
		chartPoints.push(chartPoint)

		const previousPoint = currentSegment?.at(-1)
		const roundPointsAreAdjacent =
			previousPoint !== undefined &&
			previousPoint.point.bucketEndMs - previousPoint.point.bucketStartMs === 1 &&
			point.bucketEndMs - point.bucketStartMs === 1
		if (
			!currentSegment ||
			!previousPoint ||
			(!roundPointsAreAdjacent && point.bucketStartMs > previousPoint.point.bucketEndMs)
		) {
			currentSegment = [chartPoint]
			segments.push(currentSegment)
		} else {
			currentSegment.push(chartPoint)
		}
	}

	return {
		metric,
		dimensions,
		plotLeft,
		plotRight,
		plotTop,
		plotBottom,
		maxValue: axisMax,
		ticks,
		points: chartPoints,
		segments,
	}
}

/** Generate zero-based, human-readable axis ticks using a 1/2/5 step. */
export function createTaskRateChartTicks(maxValue: number, targetCount = DEFAULT_TICK_COUNT): number[] {
	const safeMax = Math.max(0, maxValue)
	if (safeMax === 0) return [0]

	const safeTargetCount = Math.max(2, Math.trunc(targetCount))
	const rawStep = safeMax / (safeTargetCount - 1)
	const magnitude = 10 ** Math.floor(Math.log10(rawStep))
	const normalized = rawStep / magnitude
	const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
	const step = niceFactor * magnitude
	const tickMax = Math.ceil(safeMax / step) * step
	const ticks: number[] = []
	for (let value = 0; value <= tickMax + step * 0.000001; value += step) {
		ticks.push(Number(value.toFixed(12)))
	}
	return ticks
}

function getAxisMax(maxValue: number): number {
	if (maxValue <= 0) return 1
	const ticks = createTaskRateChartTicks(maxValue)
	return ticks.at(-1) ?? 1
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(maximum, Math.max(minimum, value))
}
