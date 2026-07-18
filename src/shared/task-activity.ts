export type TaskActivityKind = "subagent" | "command"

export type TaskActivityExecutionMode = "foreground" | "background"

export type TaskActivityStatus = "awaiting_approval" | "running" | "cancelling" | "completed" | "failed" | "timeout" | "cancelled"

export interface TaskActivityMetrics {
	toolCalls?: number
	inputTokens?: number
	outputTokens?: number
	totalCost?: number
	currency?: string
	contextTokens?: number
	contextWindow?: number
	lineCount?: number
}

export interface TaskActivityRecord {
	activityId: string
	taskId: string
	kind: TaskActivityKind
	executionMode: TaskActivityExecutionMode
	status: TaskActivityStatus
	createdAt: number
	updatedAt: number
	finishedAt?: number
	title: string
	detail?: string
	latestEvent?: string
	output?: string
	result?: string
	error?: string
	parentActivityId?: string
	metrics?: TaskActivityMetrics
}

export interface TaskActivityUpdate {
	sequence: number
	snapshot: boolean
	activities: TaskActivityRecord[]
}
