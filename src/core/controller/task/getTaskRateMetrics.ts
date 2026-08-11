import type { ApiRateMetricsResolution, ApiRateTokenQuality } from "@core/task/performance/api-rate-metrics-types"
import {
	type GetTaskRateMetricsRequest,
	GetTaskRateMetricsResponse,
	TaskRateMetricsResolution,
	TaskRateTokenQuality,
} from "@shared/proto/dline/task"
import { Logger } from "@shared/services/Logger"
import type { Controller } from ".."

const MILLISECONDS_PER_SECOND = 1_000

/** Return task-local API rate history on demand without projecting it into ExtensionState. */
export async function getTaskRateMetrics(
	controller: Controller,
	request: GetTaskRateMetricsRequest,
): Promise<GetTaskRateMetricsResponse> {
	const startedAt = performance.now()
	const task = controller.task
	if (!task || task.taskId !== request.taskId) {
		throw new Error("Task rate metrics query requires the matching active Task")
	}
	if (!Number.isFinite(request.startMs) || !Number.isFinite(request.endMs) || request.endMs <= request.startMs) {
		throw new Error("Task rate metrics query requires a valid time range")
	}

	const result = await task.queryApiRateMetrics({
		resolution: toDomainResolution(request.resolution),
		startSecond: Math.floor(request.startMs / MILLISECONDS_PER_SECOND),
		endSecond: Math.ceil(request.endMs / MILLISECONDS_PER_SECOND),
		...(request.maxPoints > 0 && { maxPoints: request.maxPoints }),
	})

	const response = GetTaskRateMetricsResponse.create({
		points: result.points.map((point) => ({
			...point,
			tokenQuality: toProtoTokenQuality(point.tokenQuality),
			provisional: point.provisional ?? false,
		})),
		degraded: result.degraded,
		truncated: result.truncated,
		...(result.retentionStartMs !== undefined && { retentionStartMs: result.retentionStartMs }),
	})
	Logger.debug(
		`[Task ${request.taskId}] API rate metrics RPC: durationMs=${Math.round(performance.now() - startedAt)}, resolution=${toDomainResolution(request.resolution)}, points=${response.points.length}, degraded=${response.degraded}, truncated=${response.truncated}`,
	)
	return response
}

function toDomainResolution(resolution: TaskRateMetricsResolution): ApiRateMetricsResolution {
	switch (resolution) {
		case TaskRateMetricsResolution.TASK_RATE_METRICS_RESOLUTION_MINUTE:
			return "minute"
		case TaskRateMetricsResolution.TASK_RATE_METRICS_RESOLUTION_HOUR:
			return "hour"
		case TaskRateMetricsResolution.TASK_RATE_METRICS_RESOLUTION_DAY:
			return "day"
		default:
			throw new Error("Task rate metrics query requires a supported resolution")
	}
}

function toProtoTokenQuality(quality: ApiRateTokenQuality): TaskRateTokenQuality {
	switch (quality) {
		case "mixed":
			return TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_MIXED
		case "exact":
			return TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_EXACT
		default:
			return TaskRateTokenQuality.TASK_RATE_TOKEN_QUALITY_ESTIMATED
	}
}
