import type { TaskActivity, TaskActivityEvent, TaskActivityMetrics } from "@shared/proto/dline/task"
import {
	AlarmClockIcon,
	BotIcon,
	BringToFrontIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleSlashIcon,
	CircleXIcon,
	LoaderCircleIcon,
	SendToBackIcon,
	TerminalIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { CopyButton } from "@/components/common/CopyButton"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { CommandOutputContent } from "../CommandOutputRow"
import { getCommandEnvironmentLabel, getCommandOutputSummary } from "../command-output"
import { cancelTaskActivities, useTaskActivities } from "./useTaskActivities"

export type StatusFilter = "active" | "all"
export type KindFilter = "all" | "subagent" | "command"

export interface TaskActivityFilters {
	status: StatusFilter
	kind: KindFilter
}

export const DEFAULT_TASK_ACTIVITY_FILTERS: TaskActivityFilters = {
	status: "active",
	kind: "all",
}

const ACTIVE_STATUSES = new Set(["awaiting_approval", "running", "cancelling"])

export function formatCommandTimeout(timeoutSeconds: number): string {
	return timeoutSeconds >= 3600 ? `${(timeoutSeconds / 3600).toFixed(1)} h` : `${timeoutSeconds} s`
}

function formatDuration(activity: TaskActivity): string {
	const end = activity.finishedAt ?? Date.now()
	const seconds = Math.max(0, Math.floor((end - activity.createdAt) / 1000))
	const minutes = Math.floor(seconds / 60)
	return minutes > 0 ? `${minutes}:${String(seconds % 60).padStart(2, "0")}` : `${seconds}s`
}

function StatusIcon({ status }: { status: string }) {
	if (status === "running" || status === "cancelling") return <LoaderCircleIcon className="size-3.5 animate-spin text-link" />
	if (status === "completed") return <CheckIcon className="size-3.5 text-success" />
	if (status === "cancelled" || status === "interrupted" || status === "skipped") {
		return <CircleSlashIcon className="size-3.5 text-description" />
	}
	if (status === "failed" || status === "timeout") return <CircleXIcon className="size-3.5 text-error" />
	return <BotIcon className="size-3.5 text-description" />
}

function statusAccentClass(status: string): string {
	if (status === "running" || status === "cancelling") return "bg-link"
	if (status === "completed") return "bg-success"
	if (status === "failed" || status === "timeout") return "bg-error"
	if (status === "awaiting_approval") return "bg-editor-warning-foreground"
	return "bg-description"
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

function CommandActivityOutput({ activity }: { activity: TaskActivity }) {
	const [isOutputFullyExpanded, setIsOutputFullyExpanded] = useState(false)
	if (!activity.output && !activity.logPath) return null
	return (
		<CommandOutputContent
			isCommandActive={ACTIVE_STATUSES.has(activity.status)}
			isContainerExpanded={true}
			isOutputFullyExpanded={isOutputFullyExpanded}
			logPath={activity.logPath}
			onToggle={() => setIsOutputFullyExpanded((value) => !value)}
			output={activity.output ?? ""}
			presentation="activity"
		/>
	)
}

export function TaskActivityPanel({
	taskId,
	focusActivityId,
	filters,
	onFiltersChange,
}: {
	taskId: string
	focusActivityId?: string
	filters?: TaskActivityFilters
	onFiltersChange?: (filters: TaskActivityFilters) => void
}) {
	const { activities } = useTaskActivities(taskId)
	const [internalFilters, setInternalFilters] = useState<TaskActivityFilters>(DEFAULT_TASK_ACTIVITY_FILTERS)
	const selectedFilters = filters ?? internalFilters
	const [expanded, setExpanded] = useState<Record<string, boolean>>({})
	const itemRefs = useRef(new Map<string, HTMLDivElement>())
	const handledFocusId = useRef<string>()
	const updateFilters = (nextFilters: TaskActivityFilters) => {
		if (!filters) setInternalFilters(nextFilters)
		onFiltersChange?.(nextFilters)
	}
	useEffect(() => {
		if (!focusActivityId) return
		setExpanded((value) => ({ ...value, [focusActivityId]: true }))
		handledFocusId.current = undefined
	}, [focusActivityId])
	const filtered = useMemo(
		() =>
			focusActivityId
				? activities.filter((activity) => activity.activityId === focusActivityId)
				: activities.filter(
						(activity) =>
							(selectedFilters.status === "all" || ACTIVE_STATUSES.has(activity.status)) &&
							(selectedFilters.kind === "all" || activity.kind === selectedFilters.kind),
					),
		[selectedFilters, activities, focusActivityId],
	)
	useEffect(() => {
		if (!focusActivityId || handledFocusId.current === focusActivityId) return
		if (!filtered.some((activity) => activity.activityId === focusActivityId)) return
		const frame = requestAnimationFrame(() => {
			itemRefs.current.get(focusActivityId)?.scrollIntoView({ block: "center" })
			handledFocusId.current = focusActivityId
		})
		return () => cancelAnimationFrame(frame)
	}, [filtered, focusActivityId])

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<div className="space-y-2 border-b border-editor-group-border px-4 py-2">
				<div className="flex gap-1" data-testid="activity-status-filters">
					{(["active", "all"] as const).map((filter) => (
						<button
							className={cn("rounded-xs border px-2 py-1 text-xs cursor-pointer", {
								"border-link bg-link/10 text-foreground": selectedFilters.status === filter,
								"border-editor-group-border bg-transparent text-description": selectedFilters.status !== filter,
							})}
							data-testid={`activity-status-filter-${filter}`}
							key={filter}
							onClick={() => updateFilters({ ...selectedFilters, status: filter })}
							type="button">
							{filter === "active" ? "Active" : "All"}
						</button>
					))}
				</div>
				<div className="flex gap-1" data-testid="activity-kind-filters">
					{(["all", "subagent", "command"] as const).map((filter) => (
						<button
							className={cn("rounded-xs border px-2 py-1 text-[11px] cursor-pointer", {
								"border-link bg-link/10 text-foreground": selectedFilters.kind === filter,
								"border-editor-group-border bg-transparent text-description": selectedFilters.kind !== filter,
							})}
							data-testid={`activity-kind-filter-${filter}`}
							key={filter}
							onClick={() => updateFilters({ ...selectedFilters, kind: filter })}
							type="button">
							{filter === "all" ? "All" : filter === "subagent" ? "Subagents" : "Commands"}
						</button>
					))}
				</div>
			</div>

			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="activity-list">
				{filtered.length === 0 && (
					<div className="py-8 text-center text-xs text-description">No matching activities.</div>
				)}
				{filtered.map((activity) => {
					const isExpanded = expanded[activity.activityId] === true
					const isActive = ACTIVE_STATUSES.has(activity.status)
					const KindIcon = activity.kind === "command" ? TerminalIcon : BotIcon
					const ExecutionModeIcon = activity.executionMode === "background" ? SendToBackIcon : BringToFrontIcon
					const environmentLabel = activity.kind === "command" ? getCommandEnvironmentLabel(activity.output) : undefined
					const activitySummary =
						activity.kind === "command"
							? (getCommandOutputSummary(activity.output) ?? getCommandOutputSummary(activity.latestEvent))
							: activity.latestEvent
					return (
						<div
							className="relative overflow-hidden rounded-sm border border-editor-widget-border/60 bg-editor-background [box-shadow:0_1px_2px_var(--vscode-widget-shadow,transparent)]"
							data-activity-id={activity.activityId}
							data-activity-status={activity.status}
							data-testid="activity-item"
							key={activity.activityId}
							ref={(element) => {
								if (element) itemRefs.current.set(activity.activityId, element)
								else itemRefs.current.delete(activity.activityId)
							}}>
							<div
								aria-hidden="true"
								className={cn("absolute inset-y-0 left-0 z-10 w-[3px]", statusAccentClass(activity.status))}
								data-testid="activity-status-accent"
							/>
							<div
								className="flex items-start gap-2 bg-toolbar-hover/30 py-2.5 pr-2.5 pl-3"
								data-testid="activity-header">
								<button
									className="flex min-w-0 flex-1 items-start gap-2 border-0 bg-transparent p-0 text-left cursor-pointer"
									data-testid="activity-toggle"
									onClick={() => setExpanded((value) => ({ ...value, [activity.activityId]: !isExpanded }))}
									type="button">
									<StatusIcon status={activity.status} />
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5">
											<KindIcon className="size-3 shrink-0 opacity-70" data-testid="activity-kind-icon" />
											<span
												className={cn("truncate text-xs font-semibold text-foreground", {
													"font-mono": activity.kind === "command",
												})}>
												{activity.title}
											</span>
										</div>
										<div
											className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-description"
											data-testid="activity-metadata">
											<span
												className="inline-flex w-fit max-w-full min-w-0 flex-nowrap items-center gap-1.5"
												data-testid="activity-environment-mode">
												{environmentLabel && (
													<span
														className="inline-block min-w-0 max-w-[60%] flex-auto truncate rounded-xs bg-code/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground"
														data-testid="activity-environment-label"
														title={`Environment: ${environmentLabel}`}>
														({environmentLabel})
													</span>
												)}
												<span
													className={cn(
														"inline-flex shrink-0 items-center gap-1 rounded-xs px-1.5 py-0.5",
														{
															"bg-editor-warning-foreground/10 text-editor-warning-foreground":
																activity.executionMode === "background",
															"bg-info/10 text-info": activity.executionMode !== "background",
														},
													)}
													data-testid="activity-execution-mode">
													<ExecutionModeIcon aria-hidden="true" className="size-2.5 shrink-0" />
													{activity.executionMode === "background" ? "Background" : "Foreground"}
												</span>
											</span>
											<span className="capitalize">{activity.status.replaceAll("_", " ")}</span>
											<span>{formatDuration(activity)}</span>
											{activity.kind === "command" &&
												activity.timeoutSeconds !== undefined &&
												activity.timeoutSeconds > 0 && (
													<span
														aria-label={`Command timeout: ${formatCommandTimeout(activity.timeoutSeconds)}`}
														className="inline-flex items-center gap-0.5 leading-none"
														role="img"
														title="Command timeout">
														<AlarmClockIcon aria-hidden="true" className="size-[11px] shrink-0" />
														<span className="leading-none">
															{formatCommandTimeout(activity.timeoutSeconds)}
														</span>
													</span>
												)}
										</div>
										{!isExpanded && activitySummary && (
											<div
												className="mt-1.5 truncate rounded-xs bg-code/70 px-2 py-1 font-mono text-[10px] text-description"
												data-testid={activity.kind === "command" ? "activity-output-summary" : undefined}>
												{activitySummary}
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
										className="h-5 self-center bg-button-background px-2 py-0 text-[11px] leading-none text-button-foreground hover:bg-button-hover"
										disabled={activity.status === "cancelling"}
										onClick={() => void cancelTaskActivities(taskId, [activity.activityId])}
										size="xs">
										Cancel
									</Button>
								)}
							</div>
							{isExpanded && (
								<div
									className="max-h-[60vh] overflow-y-auto border-t border-editor-widget-border/25 text-xs"
									data-testid="activity-body">
									{activity.kind === "command" ? (
										<>
											{activity.detail && (
												<div
													className="flex items-start gap-2 bg-code px-3 py-2.5"
													data-testid="activity-command-line">
													<TerminalIcon
														aria-hidden="true"
														className="mt-0.5 size-3 shrink-0 text-description"
													/>
													<code className="min-w-0 whitespace-pre-wrap break-words font-mono text-[11px] text-code-foreground">
														{activity.detail}
													</code>
												</div>
											)}
											<CommandActivityOutput activity={activity} />
											{activity.result && (
												<div className="border-t border-editor-widget-border/25 px-3 py-2.5 whitespace-pre-wrap break-words">
													{activity.result}
												</div>
											)}
											{activity.error && (
												<div className="border-t border-editor-widget-border/25 px-3 py-2.5 whitespace-pre-wrap break-words text-error">
													{activity.error}
												</div>
											)}
										</>
									) : (
										<div className="p-2.5">
											{activity.detail && (
												<div className="whitespace-pre-wrap text-description">{activity.detail}</div>
											)}
											{activity.result && (
												<div className="mt-2 whitespace-pre-wrap break-words">{activity.result}</div>
											)}
											{activity.error && (
												<div className="mt-2 whitespace-pre-wrap break-words text-error">
													{activity.error}
												</div>
											)}
											{activity.events.length > 0 && (
												<div className="mt-2">
													<ActivityTimeline events={activity.events} />
												</div>
											)}
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
