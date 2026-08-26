import { useState } from "react"
import { MetricIcon } from "../../../common/metrics/MetricIcon"
import { Button } from "../../../ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../ui/dialog"
import { type TaskRateChartType, TaskRateMetricsChart } from "./TaskRateMetricsChart"
import { getTaskRateMetricLabel, type TaskRateMetric } from "./TaskRateMetricsChartModel"
import { TaskUsageCacheChart } from "./TaskUsageCacheChart"
import { type TaskRateMetricsResolution, useTaskRateMetrics } from "./useTaskRateMetrics"

interface TaskRateMetricsDialogProps {
	taskId?: string
	open: boolean
	onOpenChange: (open: boolean) => void
}

const RESOLUTION_OPTIONS: Array<{ value: TaskRateMetricsResolution; label: string }> = [
	{ value: "round", label: "Round" },
	{ value: "minute", label: "Minute" },
	{ value: "hour", label: "Hour" },
	{ value: "day", label: "Day" },
]

type TaskRateMetricsView = "usageCache" | TaskRateMetric

const VIEW_OPTIONS: Array<{ value: TaskRateMetricsView; icon: "history" | "tpm" | "rpm" | "tokens"; label: string }> = [
	{ value: "usageCache", icon: "history", label: "Usage & Cache" },
	{ value: "tpm", icon: "tpm", label: getTaskRateMetricLabel("tpm") },
	{ value: "rpm", icon: "rpm", label: getTaskRateMetricLabel("rpm") },
	{ value: "tokens", icon: "tokens", label: "Total Tokens" },
]

const CHART_TYPE_OPTIONS: Array<{ value: TaskRateChartType; icon: "bar" | "line"; label: string }> = [
	{ value: "bar", icon: "bar", label: "Bar" },
	{ value: "line", icon: "line", label: "Line" },
]

/** Show Task-local API rate history on demand. */
export function TaskRateMetricsDialog({ taskId, open, onOpenChange }: TaskRateMetricsDialogProps) {
	const [resolution, setResolution] = useState<TaskRateMetricsResolution>("round")
	const [view, setView] = useState<TaskRateMetricsView>("usageCache")
	const [chartType, setChartType] = useState<TaskRateChartType>("line")
	const { data, loading, error, refresh } = useTaskRateMetrics({ taskId, resolution, enabled: open })

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-3xl">
				<DialogHeader>
					<DialogTitle>API rate history</DialogTitle>
					<DialogDescription>
						Provider rounds show Token usage and cache hit rate; TPM keeps the provider-active-second basis.
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-wrap items-center gap-3">
					<div aria-label="History resolution" className="flex items-center gap-1" role="tablist">
						{RESOLUTION_OPTIONS.map((option) => (
							<button
								aria-selected={resolution === option.value}
								className={`rounded-sm px-2 py-1 text-xs ${
									resolution === option.value
										? "bg-button-background text-button-foreground"
										: "bg-transparent text-description hover:bg-toolbar-hover"
								}`}
								key={option.value}
								onClick={() => setResolution(option.value)}
								role="tab"
								type="button">
								{option.label}
							</button>
						))}
					</div>

					<div aria-label="History view" className="flex items-center gap-1" role="radiogroup">
						{VIEW_OPTIONS.map((option) => {
							const selected = view === option.value
							return (
								<button
									aria-checked={selected}
									className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs ${
										selected
											? "bg-button-background text-button-foreground"
											: "bg-transparent text-description hover:bg-toolbar-hover"
									}`}
									key={option.value}
									onClick={() => setView(option.value)}
									role="radio"
									type="button">
									<MetricIcon kind={option.icon} />
									{option.label}
								</button>
							)
						})}
					</div>

					{view !== "usageCache" && (
						<div aria-label="Chart type" className="flex items-center gap-1" role="radiogroup">
							{CHART_TYPE_OPTIONS.map((option) => {
								const selected = chartType === option.value
								return (
									<button
										aria-checked={selected}
										className={`inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs ${
											selected
												? "bg-button-background text-button-foreground"
												: "bg-transparent text-description hover:bg-toolbar-hover"
										}`}
										key={option.value}
										onClick={() => setChartType(option.value)}
										role="radio"
										type="button">
										<MetricIcon kind={option.icon} />
										{option.label}
									</button>
								)
							})}
						</div>
					)}

					<Button className="ml-auto" onClick={refresh} size="xs" variant="outline">
						Refresh
					</Button>
				</div>

				{loading && (
					<div className="py-12 text-center text-description" role="status">
						Loading API rate history…
					</div>
				)}
				{!loading && error && (
					<div className="rounded-sm border border-error/40 bg-error/10 p-3" role="alert">
						<p>{error}</p>
						<Button className="mt-2" onClick={refresh} size="xs" variant="outline">
							Retry
						</Button>
					</div>
				)}
				{!loading && !error && data && data.points.length === 0 && (
					<div className="py-12 text-center text-description">No API activity in this range.</div>
				)}
				{!loading && !error && data && data.points.length > 0 && (
					<>
						<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-description">
							{data.degraded && <span>History may be incomplete.</span>}
							{data.truncated && <span>Showing the most recent available points.</span>}
							{data.retentionStartMs !== undefined && (
								<span>History retained from {new Date(data.retentionStartMs).toLocaleString()}.</span>
							)}
						</div>
						{view === "usageCache" ? (
							<TaskUsageCacheChart degraded={data.degraded} points={data.points} />
						) : (
							<TaskRateMetricsChart chartType={chartType} metric={view} points={data.points} />
						)}
					</>
				)}
			</DialogContent>
		</Dialog>
	)
}
