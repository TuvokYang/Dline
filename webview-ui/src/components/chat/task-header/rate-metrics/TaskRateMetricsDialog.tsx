import { useState } from "react"
import { Button } from "../../../ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../ui/dialog"
import { TaskRateMetricsChart } from "./TaskRateMetricsChart"
import { type TaskRateMetricsResolution, useTaskRateMetrics } from "./useTaskRateMetrics"

interface TaskRateMetricsDialogProps {
	taskId?: string
	open: boolean
	onOpenChange: (open: boolean) => void
}

const RESOLUTION_OPTIONS: Array<{ value: TaskRateMetricsResolution; label: string }> = [
	{ value: "minute", label: "Minute" },
	{ value: "hour", label: "Hour" },
	{ value: "day", label: "Day" },
]

/** Show Task-local API rate history on demand. */
export function TaskRateMetricsDialog({ taskId, open, onOpenChange }: TaskRateMetricsDialogProps) {
	const [resolution, setResolution] = useState<TaskRateMetricsResolution>("minute")
	const { data, loading, error, refresh } = useTaskRateMetrics({ taskId, resolution, enabled: open })

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="max-w-3xl">
				<DialogHeader>
					<DialogTitle>API rate history</DialogTitle>
					<DialogDescription>
						Rates are calculated from API-active seconds only; idle time is shown as gaps.
					</DialogDescription>
				</DialogHeader>

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
						<TaskRateMetricsChart points={data.points} />
					</>
				)}
			</DialogContent>
		</Dialog>
	)
}
