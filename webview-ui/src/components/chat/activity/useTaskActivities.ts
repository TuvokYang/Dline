import {
	CancelTaskActivitiesRequest,
	FinishTaskActivitiesRequest,
	MoveCommandToBackgroundRequest,
	RetryTaskActivitiesRequest,
	type TaskActivity,
	TaskActivitySubscriptionRequest,
} from "@shared/proto/dline/task"
import { useEffect, useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"

let subscribedTaskId: string | undefined
let unsubscribe: (() => void) | undefined
let referenceCount = 0
const activities = new Map<string, TaskActivity>()
const listeners = new Set<() => void>()

function notify(): void {
	for (const listener of listeners) listener()
}

function stopSubscription(): void {
	unsubscribe?.()
	unsubscribe = undefined
	subscribedTaskId = undefined
	activities.clear()
}

function ensureSubscription(taskId: string): void {
	if (subscribedTaskId === taskId && unsubscribe) return
	stopSubscription()
	subscribedTaskId = taskId
	unsubscribe = TaskServiceClient.subscribeToTaskActivities(TaskActivitySubscriptionRequest.create({ taskId }), {
		onResponse: (update) => {
			if (update.snapshot) activities.clear()
			for (const activity of update.activities) activities.set(activity.activityId, activity)
			notify()
		},
		onError: (error) => console.error("Task activity subscription failed", error),
		onComplete: () => {
			unsubscribe = undefined
		},
	})
}

export async function cancelTaskActivities(taskId: string, activityIds: string[]): Promise<string[]> {
	if (activityIds.length === 0) return []
	const response = await TaskServiceClient.cancelTaskActivities(CancelTaskActivitiesRequest.create({ taskId, activityIds }))
	return response.cancelledActivityIds
}

/** Request soft completion for running subagents. */
export async function finishTaskActivities(taskId: string, activityIds: string[]): Promise<string[]> {
	if (activityIds.length === 0) return []
	const response = await TaskServiceClient.finishTaskActivities(FinishTaskActivitiesRequest.create({ taskId, activityIds }))
	return response.finishedActivityIds
}

/** Retry retained retryable subagents. */
export async function retryTaskActivities(taskId: string, activityIds: string[]): Promise<string[]> {
	if (activityIds.length === 0) return []
	const response = await TaskServiceClient.retryTaskActivities(RetryTaskActivitiesRequest.create({ taskId, activityIds }))
	return response.retriedActivityIds
}

/** Move one synchronous foreground command to background tracking. */
export async function moveCommandToBackground(taskId: string, activityId: string): Promise<boolean> {
	const response = await TaskServiceClient.moveCommandToBackground(
		MoveCommandToBackgroundRequest.create({ taskId, activityId }),
	)
	return response.moved
}

/** Move one foreground subagent to task-local background execution. */
export async function moveSubagentToBackground(taskId: string, activityId: string): Promise<boolean> {
	return moveCommandToBackground(taskId, activityId)
}

/** Shared per-webview task activity subscription. */
export function useTaskActivities(taskId: string | undefined): {
	activities: TaskActivity[]
	activeCount: number
	getById: (activityId: string) => TaskActivity | undefined
} {
	const [, setLocalRevision] = useState(0)
	useEffect(() => {
		if (!taskId) return
		referenceCount++
		const listener = () => setLocalRevision((value) => value + 1)
		listeners.add(listener)
		ensureSubscription(taskId)
		return () => {
			listeners.delete(listener)
			referenceCount--
			if (referenceCount <= 0) {
				referenceCount = 0
				stopSubscription()
			}
		}
	}, [taskId])

	const list = Array.from(activities.values()).sort(
		(a, b) => b.createdAt - a.createdAt || a.activityId.localeCompare(b.activityId),
	)
	return {
		activities: list,
		activeCount: list.filter((activity) => ["awaiting_approval", "running", "cancelling"].includes(activity.status)).length,
		getById: (activityId: string) => activities.get(activityId),
	}
}
