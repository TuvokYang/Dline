import {
	TaskActivity as ProtoTaskActivity,
	TaskActivityEvent as ProtoTaskActivityEvent,
	TaskActivityMetrics as ProtoTaskActivityMetrics,
	TaskActivityUpdate as ProtoTaskActivityUpdate,
	TaskActivitySubscriptionRequest,
} from "@shared/proto/dline/task"
import type { TaskActivityRecord, TaskActivityUpdate } from "@shared/task-activity"
import type { Controller } from ".."
import { getRequestRegistry, type StreamingResponseHandler } from "../grpc-handler"

function toProtoMetrics(metrics: TaskActivityRecord["metrics"]): ProtoTaskActivityMetrics | undefined {
	return metrics
		? ProtoTaskActivityMetrics.create({
				toolCalls: metrics.toolCalls ?? 0,
				inputTokens: metrics.inputTokens ?? 0,
				outputTokens: metrics.outputTokens ?? 0,
				totalCost: metrics.totalCost ?? 0,
				currency: metrics.currency ?? "",
				contextTokens: metrics.contextTokens ?? 0,
				contextWindow: metrics.contextWindow ?? 0,
				lineCount: metrics.lineCount ?? 0,
			})
		: undefined
}

function toProtoActivity(activity: TaskActivityRecord, cancellable: boolean): ProtoTaskActivity {
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
		logPath: activity.logPath,
		parentActivityId: activity.parentActivityId,
		cancellable,
		schemaVersion: activity.schemaVersion,
		metrics: toProtoMetrics(activity.metrics),
		events: activity.events.map((event) =>
			ProtoTaskActivityEvent.create({
				sequence: event.sequence,
				timestamp: event.timestamp,
				kind: event.kind,
				phase: "phase" in event ? event.phase : undefined,
				text: "text" in event ? event.text : undefined,
				toolCallId: "toolCallId" in event ? event.toolCallId : undefined,
				toolName: "toolName" in event ? event.toolName : undefined,
				toolStatus: "toolStatus" in event ? event.toolStatus : undefined,
				summary: "summary" in event ? event.summary : undefined,
				durationMs: "durationMs" in event ? event.durationMs : undefined,
				error: "error" in event ? event.error : undefined,
				status: "status" in event ? event.status : undefined,
				metrics: "metrics" in event ? toProtoMetrics(event.metrics) : undefined,
			}),
		),
	})
}

function toProtoUpdate(update: TaskActivityUpdate, isCancellable: (activityId: string) => boolean): ProtoTaskActivityUpdate {
	return ProtoTaskActivityUpdate.create({
		sequence: update.sequence,
		snapshot: update.snapshot,
		activities: update.activities.map((activity) => toProtoActivity(activity, isCancellable(activity.activityId))),
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
		await responseStream(
			toProtoUpdate(update, (activityId) => task.activityStore.isCancellable(activityId)),
			false,
			update.sequence,
		)
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
