import { RetryTaskActivitiesRequest, RetryTaskActivitiesResponse } from "@shared/proto/dline/task"
import type { Controller } from ".."

/** Retry selected retained subagent activities. */
export async function retryTaskActivities(
	controller: Controller,
	request: RetryTaskActivitiesRequest,
): Promise<RetryTaskActivitiesResponse> {
	const task = controller.task
	if (!task || task.taskId !== request.taskId) {
		return RetryTaskActivitiesResponse.create({ retriedActivityIds: [] })
	}
	for (const activityId of request.activityIds) {
		if (!task.activityStore.hasLiveRetryControl(activityId) && task.activityStore.isRetryable(activityId)) {
			await task.restoreSubagentActivityRetry(activityId)
		}
	}
	const retriedActivityIds = await task.activityStore.retry(request.activityIds)
	return RetryTaskActivitiesResponse.create({ retriedActivityIds })
}
