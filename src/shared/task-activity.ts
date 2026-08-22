export type TaskActivityKind = "subagent" | "command"

export type TaskActivityExecutionMode = "foreground" | "background"

export type TaskActivityCancellationOwner = "task" | "explicit"

export type TaskActivityStatus =
	| "awaiting_approval"
	| "running"
	| "cancelling"
	| "completed"
	| "failed"
	| "timeout"
	| "cancelled"
	| "interrupted"

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

export type TaskActivityEventPhase = "delta" | "final"

export type TaskActivityToolStatus = "started" | "completed" | "failed"

interface TaskActivityEventBase {
	sequence: number
	timestamp: number
}

export type TaskActivityEvent =
	| (TaskActivityEventBase & {
			kind: "thinking" | "assistant_message"
			phase: TaskActivityEventPhase
			text: string
	  })
	| (TaskActivityEventBase & {
			kind: "tool_call"
			toolCallId: string
			toolName: string
			toolStatus: TaskActivityToolStatus
			summary?: string
			durationMs?: number
			error?: string
	  })
	| (TaskActivityEventBase & {
			kind: "tool_result"
			toolCallId: string
			toolName: string
			text?: string
			error?: string
	  })
	| (TaskActivityEventBase & {
			kind: "status"
			status: TaskActivityStatus
			text?: string
	  })
	| (TaskActivityEventBase & {
			kind: "metrics"
			metrics: TaskActivityMetrics
	  })
	| (TaskActivityEventBase & {
			kind: "output"
			text: string
	  })
	| (TaskActivityEventBase & {
			kind: "retry"
			retryAttempt: number
			maxRetries: number
			delayMs: number
			cumulativeDelayMs: number
	  })

export type TaskActivityEventInput = TaskActivityEvent extends infer Event
	? Event extends TaskActivityEventBase
		? Omit<Event, keyof TaskActivityEventBase>
		: never
	: never

export interface TaskActivityRecord {
	schemaVersion: 1
	activityId: string
	taskId: string
	kind: TaskActivityKind
	executionMode: TaskActivityExecutionMode
	cancellationOwner: TaskActivityCancellationOwner
	status: TaskActivityStatus
	createdAt: number
	updatedAt: number
	finishedAt?: number
	title: string
	detail?: string
	latestEvent?: string
	timeoutSeconds?: number
	output?: string
	result?: string
	error?: string
	logPath?: string
	parentActivityId?: string
	metrics?: TaskActivityMetrics
	events: TaskActivityEvent[]
}

export interface TaskActivityUpdate {
	sequence: number
	snapshot: boolean
	activities: TaskActivityRecord[]
}
