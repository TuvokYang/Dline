import {
	GetTaskRateMetricsRequest,
	type GetTaskRateMetricsResponse,
	TaskRateMetricsResolution as ProtoResolution,
} from "@shared/proto/dline/task"
import { useCallback, useEffect, useRef, useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"

export type TaskRateMetricsResolution = "round" | "minute" | "hour" | "day"

export interface UseTaskRateMetricsOptions {
	taskId?: string
	resolution: TaskRateMetricsResolution
	enabled: boolean
}

export interface TaskRateMetricsQueryState {
	data?: GetTaskRateMetricsResponse
	loading: boolean
	error?: string
	refresh: () => void
}

interface QueryWindow {
	resolution: ProtoResolution
	getStartMs: (endMs: number) => number
	maxPoints: number
}

const QUERY_WINDOWS: Record<TaskRateMetricsResolution, QueryWindow> = {
	round: {
		resolution: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_ROUND,
		getStartMs: () => 0,
		maxPoints: 60,
	},
	minute: {
		resolution: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_MINUTE,
		getStartMs: (endMs) => endMs - 60 * 60 * 1_000,
		maxPoints: 60,
	},
	hour: {
		resolution: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_HOUR,
		getStartMs: (endMs) => endMs - 24 * 60 * 60 * 1_000,
		maxPoints: 24,
	},
	day: {
		resolution: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_DAY,
		getStartMs: (endMs) => endMs - 30 * 24 * 60 * 60 * 1_000,
		maxPoints: 30,
	},
}

/** Load bounded Task-local rate history only while its dialog is open. */
export function useTaskRateMetrics({ taskId, resolution, enabled }: UseTaskRateMetricsOptions): TaskRateMetricsQueryState {
	const requestGeneration = useRef(0)
	const [refreshVersion, setRefreshVersion] = useState(0)
	const [state, setState] = useState<Omit<TaskRateMetricsQueryState, "refresh">>({ loading: false })
	const refresh = useCallback(() => setRefreshVersion((version) => version + 1), [])

	useEffect(() => {
		void refreshVersion
		const generation = ++requestGeneration.current
		if (!enabled || !taskId) {
			setState({ loading: false })
			return
		}

		const queryWindow = QUERY_WINDOWS[resolution]
		const endMs = Date.now()
		setState({ loading: true })
		void TaskServiceClient.getTaskRateMetrics(
			GetTaskRateMetricsRequest.create({
				taskId,
				resolution: queryWindow.resolution,
				startMs: queryWindow.getStartMs(endMs),
				endMs,
				maxPoints: queryWindow.maxPoints,
			}),
		)
			.then((data) => {
				if (requestGeneration.current === generation) setState({ data, loading: false })
			})
			.catch((error: unknown) => {
				if (requestGeneration.current !== generation) return
				setState({
					loading: false,
					error: error instanceof Error ? error.message : "Failed to load API rate history",
				})
			})
	}, [enabled, refreshVersion, resolution, taskId])

	return { ...state, refresh }
}
