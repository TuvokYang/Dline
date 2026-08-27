import {
	GetTaskRateMetricsRequest,
	type GetTaskRateMetricsResponse,
	TaskRateMetricsResolution as ProtoResolution,
} from "@shared/proto/dline/task"
import { useCallback, useEffect, useRef, useState } from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import {
	createTaskRateMetricsQueryWindow,
	fillTaskRateMetricsTimeline,
	type TaskRateMetricsResolution,
} from "./TaskRateMetricsTimeline"

export type { TaskRateMetricsResolution } from "./TaskRateMetricsTimeline"

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

const PROTO_RESOLUTIONS: Record<TaskRateMetricsResolution, ProtoResolution> = {
	minute: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_MINUTE,
	hour: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_HOUR,
	day: ProtoResolution.TASK_RATE_METRICS_RESOLUTION_DAY,
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

		const queryWindow = createTaskRateMetricsQueryWindow(resolution, Date.now())
		setState({ loading: true })
		void TaskServiceClient.getTaskRateMetrics(
			GetTaskRateMetricsRequest.create({
				taskId,
				resolution: PROTO_RESOLUTIONS[resolution],
				startMs: queryWindow.startMs,
				endMs: queryWindow.endMs,
				maxPoints: queryWindow.maxPoints,
			}),
		)
			.then((data) => {
				if (requestGeneration.current === generation) {
					setState({ data: { ...data, points: fillTaskRateMetricsTimeline(data.points, queryWindow) }, loading: false })
				}
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
