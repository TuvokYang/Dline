import {
	TaskActivity as ProtoTaskActivity,
	TaskActivityMetrics as ProtoTaskActivityMetrics,
	TaskActivityUpdate as ProtoTaskActivityUpdate,
	TaskActivitySubscriptionRequest,
} from "@shared/proto/dline/task"
import type { TaskActivityRecord, TaskActivityUpdate } from "@shared/task-activity"
import type { Controller } from ".."
import { getRequestRegistry, type StreamingResponseHandler } from "../grpc-handler"

function toProtoActivity(activity: TaskActivityRecord): ProtoTaskActivity {
	return ProtoTaskActivity.create({
		activityId: activity.activityId,
		taskId: activity.taskId,
		kind: activity.kind,
		executionMode: activity.executionMode,
		status: activity.status,
		createdAt: activity.createdAt,
		updatedAt: activity.updatedAt,
		finishedAt: activity.finishedAt,
		title: activity.title,
		detail: activity.detail,
		latestEvent: activity.latestEvent,
		output: activity.output,
		result: activity.result,
		error: activity.error,
		parentActivityId: activity.parentActivityId,
		metrics: activity.metrics
			? ProtoTaskActivityMetrics.create({
					toolCalls: activity.metrics.toolCalls ?? 0,
					inputTokens: activity.metrics.inputTokens ?? 0,
					outputTokens: activity.metrics.outputTokens ?? 0,
					totalCost: activity.metrics.totalCost ?? 0,
					currency: activity.metrics.currency ?? "",
					contextTokens: activity.metrics.contextTokens ?? 0,
					contextWindow: activity.metrics.contextWindow ?? 0,
					lineCount: activity.metrics.lineCount ?? 0,
				})
			: undefined,
	})
}

function toProtoUpdate(update: TaskActivityUpdate): ProtoTaskActivityUpdate {
	return ProtoTaskActivityUpdate.create({
		sequence: update.sequence,
		snapshot: update.snapshot,
		activities: update.activities.map(toProtoActivity),
	})
}

/** Subscribe to the active task's lightweight activity stream. */
export async function subscribeToTaskActivities(
	controller: Controller,
	request: TaskActivitySubscriptionRequest,
	responseStream: StreamingResponseHandler<ProtoTaskActivityUpdate>,
	requestId?: string,
): Promise<void> {
	const task = controller.task
	if (!task || task.taskId !== request.taskId) {
		await responseStream(ProtoTaskActivityUpdate.create({ sequence: 0, snapshot: true, activities: [] }), false)
		return
	}

	const unsubscribe = task.activityStore.subscribe(async (update) => {
		await responseStream(toProtoUpdate(update), false, update.sequence)
	})
	if (requestId) {
		getRequestRegistry().registerRequest(
			requestId,
			unsubscribe,
			{ type: "task_activity_subscription", taskId: request.taskId },
			responseStream,
		)
	}
}
