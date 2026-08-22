import type { TaskActivityEvent } from "@shared/proto/dline/task"
import { useMemo } from "react"
import { buildSubagentRetryAttempts } from "./subagent-activity-model"

function formatRetryDuration(milliseconds: number): string {
	const seconds = Math.max(0, Math.round(milliseconds / 1000))
	if (seconds < 60) return `${seconds}s`
	const minutes = Math.floor(seconds / 60)
	const remainingSeconds = seconds % 60
	return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
}

export function SubagentRetryTimeline({ events }: { events: TaskActivityEvent[] | undefined }) {
	const attempts = useMemo(() => buildSubagentRetryAttempts(events), [events])
	if (attempts.length === 0) return null

	return (
		<div className="min-w-0 text-[11px] text-description" data-testid="subagent-retry-timeline">
			<div className="mb-1 font-semibold uppercase tracking-wide">Automatic retries ({attempts.length})</div>
			<ol className="m-0 space-y-0.5 p-0 list-none">
				{attempts.map((attempt) => (
					<li
						className="flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono"
						data-testid="subagent-retry-attempt"
						key={attempt.sequence}>
						<span>{`Retry ${attempt.retryAttempt}/${attempt.maxRetries}`}</span>
						<span aria-hidden="true">·</span>
						<span>{`wait ${formatRetryDuration(attempt.delayMs)}`}</span>
						<span aria-hidden="true">·</span>
						<span>{`total ${formatRetryDuration(attempt.cumulativeDelayMs)}`}</span>
					</li>
				))}
			</ol>
		</div>
	)
}
