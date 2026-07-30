import type { TaskActivity, TaskActivityEvent, TaskActivityMetrics } from "@shared/proto/dline/task"
import {
	BotIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleSlashIcon,
	CircleXIcon,
	LoaderCircleIcon,
	TerminalIcon,
} from "lucide-react"
import { useMemo, useState } from "react"
import { CopyButton } from "@/components/common/CopyButton"
import { OpenFilePathLink } from "@/components/common/OpenFilePathLink"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { cancelTaskActivities, useTaskActivities } from "./useTaskActivities"

type StatusFilter = "active" | "all"
type KindFilter = "all" | "subagent" | "command"

const ACTIVE_STATUSES = new Set(["awaiting_approval", "running", "cancelling"])

function formatDuration(activity: TaskActivity): string {
	const end = activity.finishedAt ?? Date.now()
	const seconds = Math.max(0, Math.floor((end - activity.createdAt) / 1000))
	const minutes = Math.floor(seconds / 60)
	return minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, "0")}` : `${seconds}s`
}

function StatusIcon({ status }: { status: string }) {
	if (status === "running" || status === "cancelling") return <LoaderCircleIcon className="size-3.5 animate-spin text-link" />
	if (status === "completed") return <CheckIcon className="size-3.5 text-success" />
	if (status === "cancelled") return <CircleSlashIcon className="size-3.5 text-description" />
	if (status === "failed" || status === "timeout") return <CircleXIcon className="size-3.5 text-error" />
	return <BotIcon className="size-3.5 text-description" />
}

function formatMetrics(metrics: TaskActivityMetrics | undefined): string {
	if (!metrics) return "Metrics unavailable"
	const tokens = metrics.inputTokens + metrics.outputTokens
	const cost = metrics.currency && metrics.totalCost > 0 ? ` · ${metrics.totalCost.toFixed(4)} ${metrics.currency}` : ""
	return `${metrics.toolCalls} tools · ${tokens} tokens${cost}`
}

function eventLabel(event: TaskActivityEvent): string {
	if (event.kind === "thinking") return "Thinking"
	if (event.kind === "assistant_message") return "Assistant"
	if (event.kind === "tool_call") return event.toolStatus ? `Tool ${event.toolStatus}` : "Tool call"
	if (event.kind === "tool_result") return "Tool result"
	if (event.kind === "metrics") return "Metrics"
	if (event.kind === "status") return "Status"
	return "Output"
}

function eventBody(event: TaskActivityEvent): string {
	if (event.kind === "tool_call") {
		const duration = event.durationMs !== undefined ? ` · ${event.durationMs}ms` : ""
		return `${event.toolName ?? "tool"}${duration}${event.summary ? `\n${event.summary}` : ""}`
	}
	if (event.kind === "tool_result") return `${event.toolName ?? "tool"}\n${event.text ?? event.error ?? ""}`
	if (event.kind === "metrics") return formatMetrics(event.metrics)
	if (event.kind === "status") return event.text ?? event.status ?? ""
	return event.text ?? event.error ?? ""
}

function ActivityTimeline({ events }: { events: TaskActivityEvent[] }) {
	const ordered = [...events].sort((left, right) => left.sequence - right.sequence || left.timestamp - right.timestamp)
	if (ordered.length === 0) return null
	return (
		<div className="space-y-1.5" data-testid="activity-timeline">
			{ordered.map((event) => (
				<div
					className="rounded-xs border border-editor-group-border px-2 py-1.5"
					data-testid="activity-event"
					key={`${event.sequence}:${event.kind}`}>
					<div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-description">
						<span>{eventLabel(event)}</span>
						<span className="ml-auto font-normal normal-case">#{event.sequence}</span>
					</div>
					<div className="mt-1 whitespace-pre-wrap break-words text-[11px] text-foreground">{eventBody(event)}</div>
				</div>
			))}
		</div>
	)
}

export function TaskActivityPanel({ taskId }: { taskId: string }) {
	const { activities } = useTaskActivities(taskId)
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("active")
	const [kindFilter, setKindFilter] = useState<KindFilter>("all")
	const [expanded, setExpanded] = useState<Record<string, boolean>>({})
	const filtered = useMemo(
		() =>
			activities.filter(
				(activity) =>
					(statusFilter === "all" || ACTIVE_STATUSES.has(activity.status)) &&
					(kindFilter === "all" || activity.kind === kindFilter),
			),
		[activities, kindFilter, statusFilter],
	)

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="space-y-2 border-b border-editor-group-border px-4 py-2">
				<div className="flex gap-1">
					{(["active", "all"] as const).map((filter) => (
						<button
							className={cn("rounded-xs border px-2 py-1 text-xs cursor-pointer", {
								"border-link bg-link/10 text-foreground": statusFilter === filter,
								"border-editor-group-border bg-transparent text-description": statusFilter !== filter,
							})}
							key={filter}
							onClick={() => setStatusFilter(filter)}
							type="button">
							{filter === "active" ? "Active" : "All"}
						</button>
					))}
				</div>
				<div className="flex gap-1">
					{(["all", "subagent", "command"] as const).map((filter) => (
						<button
							className={cn("rounded-xs border px-2 py-1 text-[11px] cursor-pointer", {
								"border-link bg-link/10 text-foreground": kindFilter === filter,
								"border-editor-group-border bg-transparent text-description": kindFilter !== filter,
							})}
							key={filter}
							onClick={() => setKindFilter(filter)}
							type="button">
							{filter === "all" ? "All" : filter === "subagent" ? "Subagents" : "Commands"}
						</button>
					))}
				</div>
			</div>

			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
				{filtered.length === 0 && (
					<div className="py-8 text-center text-xs text-description">No matching activities.</div>
				)}
				{filtered.map((activity) => {
					const isExpanded = expanded[activity.activityId] === true
					const isActive = ACTIVE_STATUSES.has(activity.status)
					const KindIcon = activity.kind === "command" ? TerminalIcon : BotIcon
					return (
						<div
							className="rounded-sm border border-editor-group-border bg-editor-background"
							data-testid="activity-item"
							key={activity.activityId}>
							<div className="flex items-start gap-2 p-2.5">
								<button
									className="flex min-w-0 flex-1 items-start gap-2 border-0 bg-transparent p-0 text-left cursor-pointer"
									onClick={() => setExpanded((value) => ({ ...value, [activity.activityId]: !isExpanded }))}
									type="button">
									<StatusIcon status={activity.status} />
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5">
											<KindIcon className="size-3 shrink-0 opacity-70" />
											<span className="truncate text-xs font-medium text-foreground">{activity.title}</span>
										</div>
										<div className="mt-1 text-[11px] text-description">
											{activity.executionMode === "background" ? "Background" : "Foreground"}{" "}
											{activity.kind === "command" ? "Command" : "Subagent"}
											{" · "}
											{activity.status.replaceAll("_", " ")}
											{" · "}
											{formatDuration(activity)}
										</div>
										{activity.latestEvent && (
											<div className="mt-1 truncate font-mono text-[10px] text-description">
												{activity.latestEvent}
											</div>
										)}
									</div>
									{isExpanded ? (
										<ChevronDownIcon className="size-3.5" />
									) : (
										<ChevronRightIcon className="size-3.5" />
									)}
								</button>
								{activity.kind === "command" && (
									<CopyButton ariaLabel="Copy command" textToCopy={activity.detail ?? activity.title} />
								)}
								{activity.cancellable && isActive && activity.status !== "awaiting_approval" && (
									<Button
										disabled={activity.status === "cancelling"}
										onClick={() => void cancelTaskActivities(taskId, [activity.activityId])}
										size="sm"
										variant="secondary">
										Cancel
									</Button>
								)}
							</div>
							{isExpanded && (
								<div className="max-h-[60vh] overflow-y-auto border-t border-editor-group-border p-2.5 text-xs">
									{activity.detail && (
										<div className="mb-2 whitespace-pre-wrap text-description">{activity.detail}</div>
									)}
									{activity.logPath && (
										<div className="mb-2 rounded-sm bg-banner-background px-2 py-1.5">
											<OpenFilePathLink filePath={activity.logPath} label="📋 Output log:" />
										</div>
									)}
									{activity.output && (
										<pre className="m-0 whitespace-pre-wrap break-words bg-code p-2 font-mono text-[11px]">
											{activity.output}
										</pre>
									)}
									{activity.result && (
										<div className="mt-2 whitespace-pre-wrap break-words">{activity.result}</div>
									)}
									{activity.error && (
										<div className="mt-2 whitespace-pre-wrap break-words text-error">{activity.error}</div>
									)}
									{activity.kind === "subagent" && activity.events.length > 0 && (
										<div className="mt-2">
											<ActivityTimeline events={activity.events} />
										</div>
									)}
								</div>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}
