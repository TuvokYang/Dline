import { type TaskRateMetricPoint, TaskRateRpmBasis, TaskRateUsageQuality } from "@shared/proto/dline/task"
import { describe, expect, it } from "vitest"
import { createTaskUsageCacheChartLayout, TASK_USAGE_CACHE_SERIES } from "./TaskUsageCacheChartModel"

function point(startMs: number, overrides: Partial<TaskRateMetricPoint> = {}): TaskRateMetricPoint {
	return {
		bucketStartMs: startMs,
		bucketEndMs: startMs + 1,
		provisional: false,
		cacheUsageAvailable: true,
		usageAvailable: true,
		providerRoundCount: 1,
		completedRoundCount: 1,
		failedRoundCount: 0,
		cancelledRoundCount: 0,
		abortedRoundCount: 0,
		rpmBasis: TaskRateRpmBasis.TASK_RATE_RPM_BASIS_PROVIDER_DURATION,
		usageQuality: TaskRateUsageQuality.TASK_RATE_USAGE_QUALITY_EXACT,
		inputTokens: 100,
		outputTokens: 20,
		cacheWriteTokens: 10,
		cacheReadTokens: 5,
		cacheHitRate: 5 / 115,
		...overrides,
	}
}

describe("TaskUsageCacheChartModel", () => {
	it("defines four solid Token series and one dashed percentage series", () => {
		expect(TASK_USAGE_CACHE_SERIES.map(({ key, label, axis, dashed }) => ({ key, label, axis, dashed }))).toEqual([
			{ key: "input", label: "Input", axis: "tokens", dashed: false },
			{ key: "output", label: "Output", axis: "tokens", dashed: false },
			{ key: "cacheWrite", label: "Cache Creation", axis: "tokens", dashed: false },
			{ key: "cacheRead", label: "Cache Read", axis: "tokens", dashed: false },
			{ key: "cacheHit", label: "Cache Hit Rate", axis: "percentage", dashed: true },
		])
		expect(TASK_USAGE_CACHE_SERIES.map(({ color }) => color)).toEqual([
			"var(--vscode-charts-blue, #58a6ff)",
			"var(--vscode-charts-green, #3fb950)",
			"var(--vscode-charts-orange, #d18616)",
			"var(--vscode-charts-cyan, #39c5cf)",
			"var(--vscode-charts-purple, #bc8cff)",
		])
	})

	it("uses a fixed percentage axis and preserves explicit zero while breaking unavailable gaps", () => {
		const layout = createTaskUsageCacheChartLayout([
			point(0, { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, cacheHitRate: 0 }),
			point(1_000, {
				usageAvailable: false,
				cacheUsageAvailable: false,
				inputTokens: undefined,
				outputTokens: undefined,
				cacheWriteTokens: undefined,
				cacheReadTokens: undefined,
				cacheHitRate: undefined,
			}),
			point(2_000, { cacheHitRate: 0.5 }),
		])

		expect(layout.percentageTicks.map(({ label, value }) => ({ label, value }))).toEqual([
			{ label: "0%", value: 0 },
			{ label: "20%", value: 0.2 },
			{ label: "40%", value: 0.4 },
			{ label: "60%", value: 0.6 },
			{ label: "80%", value: 0.8 },
			{ label: "100%", value: 1 },
		])
		const hitSeries = layout.series.find(({ descriptor }) => descriptor.key === "cacheHit")
		expect(hitSeries?.points.map(({ value }) => value)).toEqual([0, 0.5])
		expect(hitSeries?.segments.map((segment) => segment.length)).toEqual([1, 1])
		expect(hitSeries?.points[0]?.y).toBe(layout.plotBottom)
		expect(layout.hitAreas).toHaveLength(3)
	})

	it("builds one shared Token axis across all four usage series", () => {
		const layout = createTaskUsageCacheChartLayout([
			point(0, { inputTokens: 4_500, outputTokens: 123, cacheWriteTokens: 2_100, cacheReadTokens: 800 }),
		])

		expect(layout.tokenAxisMax).toBe(6_000)
		expect(layout.tokenTicks.map(({ value }) => value)).toEqual([0, 2_000, 4_000, 6_000])
		expect(layout.series.every(({ points }) => points.length === 1)).toBe(true)
	})

	it("connects sequential Round points but keeps minute/hour/day idle gaps sparse", () => {
		const roundLayout = createTaskUsageCacheChartLayout([point(1_000), point(9_000)])
		expect(roundLayout.series[0]?.segments.map((segment) => segment.length)).toEqual([2])

		const bucketLayout = createTaskUsageCacheChartLayout([
			point(0, { bucketEndMs: 60_000 }),
			point(120_000, { bucketEndMs: 180_000 }),
		])
		expect(bucketLayout.series[0]?.segments.map((segment) => segment.length)).toEqual([1, 1])
	})
})
