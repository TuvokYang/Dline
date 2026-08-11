import { useState } from "react"
import { formatTokenMetric } from "../util"
import { TaskRateMetricsDialog } from "./TaskRateMetricsDialog"

interface TaskRateMetricsProps {
	taskId?: string
	activeSeconds: number
	requestsPerMinute: number
	tokensPerMinute: number
}

/** Display the current active-second rate summary and open its history view. */
export function TaskRateMetrics({ taskId, activeSeconds, requestsPerMinute, tokensPerMinute }: TaskRateMetricsProps) {
	const [open, setOpen] = useState(false)
	const accessibleLabel = `View API rate history. Active seconds: ${activeSeconds}; requests per minute: ${requestsPerMinute}; tokens per minute: ${tokensPerMinute}`

	return (
		<>
			<button
				aria-label={accessibleLabel}
				className="ml-auto mr-1 inline-flex min-w-0 items-center justify-end gap-1.5 whitespace-nowrap rounded-full border-0 bg-success/80 px-1.5 py-0.25 text-xs font-medium text-background hover:bg-success focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring @max-sm:hidden"
				data-testid="task-rate-metrics"
				onClick={(event) => {
					event.stopPropagation()
					setOpen(true)
				}}
				onKeyDown={(event) => event.stopPropagation()}
				title={accessibleLabel}
				type="button">
				<span>Active:{activeSeconds}s</span>
				<span>RPM:{formatTokenMetric(requestsPerMinute)}</span>
				<span>TPM:{formatTokenMetric(tokensPerMinute)}</span>
			</button>
			<TaskRateMetricsDialog onOpenChange={setOpen} open={open} taskId={taskId} />
		</>
	)
}
