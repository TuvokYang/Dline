import { type TaskRateMetricPoint, TaskRateTokenQuality } from "@shared/proto/dline/task"
import { describe, expect, it } from "vitest"
import {
	createTaskRateChartLayout,
	createTaskRateChartTicks,
	getTaskRateMetricLabel,
	getTaskRateMetricValue,
} from "./TaskRateMetricsChartModel"

function point(start: number, overrides: Partial<TaskRateMetricPoint> = {}): TaskRateMetricPoint {
	return {
		bucketStartMs: start,
		bucketEndMs: start + 60_000,
		activeSeconds: 1,
		requestCount: 1,
		tokenCount: 100,
		requestsPerMinute: 30,
		tokensPerMinute: 600,
		tokenQuality: TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_EXACT,
		provisional: false,
		...overrides,
	}
}

describe("TaskRateMetricsChartModel", () => {
	it("maps each selectable metric to its corresponding point value", () => {
		const sample = point(0, { requestCount: 2, requestsPerMinute: 42, tokenCount: 321, tokensPerMinute: 654 })

		expect(getTaskRateMetricValue(sample, "tpm")).toBe(654)
		expect(getTaskRateMetricValue(sample, "rpm")).toBe(42)
		expect(getTaskRateMetricValue(sample, "tokens")).toBe(321)
		expect(getTaskRateMetricLabel("tpm")).toBe("TPM")
		expect(getTaskRateMetricLabel("rpm")).toBe("RPM")
		expect(getTaskRateMetricLabel("tokens")).toBe("Tokens")
	})

	it("creates zero-based nice ticks that cover the largest value", () => {
		expect(createTaskRateChartTicks(4_500)).toEqual([0, 2_000, 4_000, 6_000])
		expect(createTaskRateChartTicks(123)).toEqual([0, 50, 100, 150])
		expect(createTaskRateChartTicks(0)).toEqual([0])
	})

	it("creates sparse segments and bar geometry without connecting idle gaps", () => {
		const layout = createTaskRateChartLayout([point(120_000), point(0), point(180_000)], "tokens")

		expect(layout.points.map(({ point: item }) => item.bucketStartMs)).toEqual([0, 120_000, 180_000])
		expect(layout.segments).toHaveLength(2)
		expect(layout.segments.map((segment) => segment.length)).toEqual([1, 2])
		expect(layout.ticks[0]).toMatchObject({ label: "0", value: 0, y: layout.plotBottom })
		expect(layout.points.every((item) => item.barWidth > 0 && item.barHeight >= 0)).toBe(true)
	})

	it("keeps an all-zero series inside a valid one-unit axis", () => {
		const layout = createTaskRateChartLayout([point(0, { tokenCount: 0 })], "tokens")

		expect(layout.maxValue).toBe(1)
		expect(layout.ticks.map((tick) => tick.value)).toEqual([0, 0.5, 1])
		expect(layout.points[0]).toMatchObject({ value: 0, barHeight: 0 })
	})
})
