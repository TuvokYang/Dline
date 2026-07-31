import {
	ClineAskUseSubagents,
	ClineMessage,
	ClineSaySubagentStatus,
	SubagentExecutionStatus,
	SubagentStatusItem,
} from "@shared/ExtensionMessage"
import {
	BotIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	CircleSlashIcon,
	CircleXIcon,
	LoaderCircleIcon,
	NetworkIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useExtensionState } from "@/context/ExtensionStateContext"
import MarkdownBlock from "../common/MarkdownBlock"
import { cancelTaskActivities, useTaskActivities } from "./activity/useTaskActivities"

interface SubagentStatusRowProps {
	message: ClineMessage
	isLast: boolean
	lastModifiedMessage?: ClineMessage
}

type DisplayStatus = SubagentExecutionStatus
type SubagentRowStatus = SubagentExecutionStatus

interface SubagentRowData {
	status: SubagentRowStatus
	items: SubagentStatusItem[]
}

interface SubagentPromptTextProps {
	prompt: string
	isExpanded: boolean
	onShowMore: () => void
}

const statusIcon = (status: DisplayStatus) => {
	switch (status) {
		case "running":
			return <LoaderCircleIcon className="size-2 animate-spin text-link shrink-0 mt-[1px]" />
		case "completed":
			return <CheckIcon className="size-2 text-success shrink-0 mt-[1px]" />
		case "failed":
			return <CircleXIcon className="size-2 text-error shrink-0 mt-[1px]" />
		case "timeout":
			return <CircleXIcon className="size-2 text-warning shrink-0 mt-[1px]" />
		case "cancelled":
			return <CircleSlashIcon className="size-2 text-foreground shrink-0 mt-[1px]" />
		default:
			return <BotIcon className="size-2 text-foreground/70 shrink-0 mt-[1px]" />
	}
}

const formatCount = (value: number | undefined): string => {
	if (!Number.isFinite(value)) {
		return "0"
	}

	return Intl.NumberFormat("en-US").format(value || 0)
}

const formatCost = (value: number | undefined, currency: string): string => {
	const normalized = Number.isFinite(value) ? Math.max(0, value || 0) : 0
	const maximumFractionDigits = normalized >= 0.01 ? 2 : 4
	const currencyCode = currency || "USD"
	return Intl.NumberFormat("en-US", {
		style: "currency",
		currency: currencyCode,
		minimumFractionDigits: 2,
		maximumFractionDigits,
	}).format(normalized)
}

function parseSubagentRowData(message: ClineMessage): SubagentRowData | null {
	if (!message.text) {
		return null
	}

	try {
		if (message.ask === "use_subagents" || message.say === "use_subagents") {
			const parsed = JSON.parse(message.text) as ClineAskUseSubagents
			if (!Array.isArray(parsed.prompts)) {
				return null
			}
			const prompts = parsed.prompts.map((prompt) => prompt?.trim()).filter((prompt): prompt is string => !!prompt)
			const structuredItems = parsed.items?.filter((item) => item.task.trim() && item.context.trim())
			// Error payload with message: show failed row with error text
			if (parsed.error && parsed.message) {
				return {
					status: "failed",
					items: [
						{
							index: 1,
							prompt: parsed.message,
							status: "failed",
							error: parsed.message,
							toolCalls: 0,
							inputTokens: 0,
							outputTokens: 0,
							totalCost: 0,
							currency: "",
							contextTokens: 0,
							contextWindow: 0,
							contextUsagePercentage: 0,
						},
					],
				}
			}
			if (prompts.length === 0) {
				return null
			}

			// When the final payload carries an error, mark all items as failed
			// so the frontend does not show a stale pending state.
			const rowStatus = parsed.error ? "failed" : "pending"
			const errorText = parsed.message || parsed.error
			return {
				status: rowStatus,
				items: prompts.map((prompt, index) => ({
					index: index + 1,
					prompt,
					subagentName: parsed.subagentName ?? structuredItems?.[index]?.subagentName,
					task: parsed.task ?? structuredItems?.[index]?.task,
					context: parsed.context ?? parsed.content ?? structuredItems?.[index]?.context,
					status: rowStatus,
					error: errorText,
					toolCalls: 0,
					inputTokens: 0,
					outputTokens: 0,
					totalCost: 0,
					currency: "",
					contextTokens: 0,
					contextWindow: 0,
					contextUsagePercentage: 0,
				})),
			}
		}

		const parsed = JSON.parse(message.text) as ClineSaySubagentStatus
		if (!Array.isArray(parsed.items)) {
			return null
		}

		return {
			status: parsed.status,
			items: parsed.items,
		}
	} catch {
		return null
	}
}

function SubagentPromptText({ prompt, isExpanded, onShowMore }: SubagentPromptTextProps) {
	const promptRef = useRef<HTMLDivElement | null>(null)
	const [showMoreVisible, setShowMoreVisible] = useState(false)

	useEffect(() => {
		if (isExpanded) {
			setShowMoreVisible(false)
			return
		}

		const element = promptRef.current
		if (!element) {
			setShowMoreVisible(false)
			return
		}

		const checkOverflow = () => {
			setShowMoreVisible(element.scrollHeight - element.clientHeight > 1)
		}

		checkOverflow()

		if (typeof ResizeObserver === "undefined") {
			return
		}

		const observer = new ResizeObserver(() => checkOverflow())
		observer.observe(element)

		return () => observer.disconnect()
	}, [isExpanded])

	return (
		<div className="relative">
			<div
				className={`text-xs font-medium text-foreground whitespace-pre-wrap break-words ${!isExpanded ? "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]" : ""}`}
				ref={promptRef}>
				"{prompt}"
			</div>
			{!isExpanded && showMoreVisible && (
				<button
					aria-label="Show full subagent prompt"
					className="absolute right-0 bottom-0 z-10 text-[11px] text-link border-0 px-1 py-[1px] cursor-pointer leading-none rounded-[2px]"
					onClick={onShowMore}
					style={{ backgroundColor: "var(--vscode-editor-background)" }}
					type="button">
					<span
						aria-hidden="true"
						className="pointer-events-none absolute inset-y-0 -left-[6px] w-[6px]"
						style={{ background: "linear-gradient(to left, var(--vscode-editor-background), transparent)" }}
					/>
					Show more
				</button>
			)}
		</div>
	)
}

export default function SubagentStatusRow({ message }: SubagentStatusRowProps) {
	const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({})
	const [expandedPrompts, setExpandedPrompts] = useState<Record<number, boolean>>({})
	const [collapsed, setCollapsed] = useState(false)
	const { currentTaskItem } = useExtensionState()
	const taskId = currentTaskItem?.id
	const { activities, getById } = useTaskActivities(taskId)
	const parsedData = useMemo(() => parseSubagentRowData(message), [message])
	const data = useMemo(() => {
		if (!parsedData) return null
		const items = parsedData.items.map((entry) => {
			const activity = entry.jobId ? getById(entry.jobId) : undefined
			if (!activity) return entry
			return {
				...entry,
				status: activity.status === "cancelling" ? "running" : (activity.status as SubagentExecutionStatus),
				latestToolCall: activity.latestEvent || entry.latestToolCall,
				result: activity.result || entry.result,
				error: activity.error || entry.error,
				startedAt: activity.createdAt,
				finishedAt: activity.finishedAt,
				background: activity.executionMode === "background",
				toolCalls: activity.metrics?.toolCalls ?? entry.toolCalls,
				inputTokens: activity.metrics?.inputTokens ?? entry.inputTokens,
				outputTokens: activity.metrics?.outputTokens ?? entry.outputTokens,
				totalCost: activity.metrics?.totalCost ?? entry.totalCost,
				currency: activity.metrics?.currency ?? entry.currency,
				contextTokens: activity.metrics?.contextTokens ?? entry.contextTokens,
				contextWindow: activity.metrics?.contextWindow ?? entry.contextWindow,
			}
		})
		const statuses = items.map((entry) => entry.status)
		const status = statuses.some((status) => status === "running")
			? "running"
			: statuses.some((status) => status === "failed")
				? "failed"
				: statuses.some((status) => status === "timeout")
					? "timeout"
					: statuses.some((status) => status === "cancelled")
						? "cancelled"
						: statuses.every((status) => status === "completed")
							? "completed"
							: parsedData.status
		return { ...parsedData, status, items }
	}, [getById, parsedData])

	if (!data) {
		return <div className="text-foreground opacity-80">Subagent status update unavailable.</div>
	}

	const liveCancellableIds = new Set(
		activities
			.filter((activity) => activity.kind === "subagent" && activity.status === "running" && activity.cancellable)
			.map((activity) => activity.activityId),
	)
	const cancellableIds = data.items
		.filter((entry) => entry.jobId && liveCancellableIds.has(entry.jobId))
		.map((entry) => entry.jobId as string)
	const showCancelButton = Boolean(taskId && cancellableIds.length > 1)

	const singular = data.items.length === 1
	const title = singular ? "Dline wants to use a subagent:" : "Dline wants to use subagents:"
	const isPromptConstructionRow = message.ask === "use_subagents" || message.say === "use_subagents"
	const statusSummary =
		data.status === "timeout"
			? "Timed out"
			: data.status === "cancelled"
				? "Cancelled"
				: data.status === "running" && data.items.some((entry) => entry.background)
					? "Running in background"
					: undefined
	const toggleItem = (index: number) => {
		setExpandedItems((prev) => ({
			...prev,
			[index]: !prev[index],
		}))
	}
	const expandPrompt = (index: number) => {
		setExpandedPrompts((prev) => ({
			...prev,
			[index]: true,
		}))
	}

	return (
		<div className="mb-2">
			<div className="flex items-center gap-2.5 mb-3">
				<button
					aria-label={collapsed ? "Expand subagent status" : "Collapse subagent status"}
					className="flex min-w-0 items-center gap-2.5 border-0 bg-transparent p-0 text-left cursor-pointer"
					onClick={() => setCollapsed((value) => !value)}
					type="button">
					{collapsed ? <ChevronRightIcon className="size-3" /> : <ChevronDownIcon className="size-3" />}
					<NetworkIcon className="size-2 text-foreground" />
					<span className="font-bold text-foreground">{title}</span>
				</button>
				{statusSummary && <span className="text-[11px] opacity-70">{statusSummary}</span>}
				{showCancelButton && (
					<Button
						className="ml-auto border"
						onClick={(e) => {
							e.stopPropagation()
							if (taskId) void cancelTaskActivities(taskId, cancellableIds)
						}}
						size="sm"
						variant="danger">
						Cancel all
					</Button>
				)}
			</div>
			{!collapsed && (
				<div className="max-h-[40vh] space-y-2 overflow-y-auto pr-0.5">
					{data.items.map((entry, index) => {
						const displayStatus: DisplayStatus = entry.status
						const hasDetails = Boolean(
							(entry.result && entry.status === "completed") ||
								(entry.error &&
									(entry.status === "failed" || entry.status === "timeout" || entry.status === "cancelled")),
						)
						const isExpanded = expandedItems[entry.index] === true
						const hasStructuredPrompt = Boolean(entry.task || entry.context || entry.subagentName)
						const isStreamingPromptUnderConstruction =
							isPromptConstructionRow && message.partial === true && index === data.items.length - 1
						const shouldShowStats = !isStreamingPromptUnderConstruction
						const statsText = `${formatCount(entry.toolCalls)} tools called · ${formatCount(entry.contextTokens)} tokens · ${formatCost(entry.totalCost, entry.currency)}`
						const metadataText = [
							entry.background ? "Background" : "Foreground",
							entry.jobId ? `job ${entry.jobId}` : undefined,
							entry.timeoutSeconds ? `timeout ${entry.timeoutSeconds}s` : undefined,
							entry.injectionState ? `result ${entry.injectionState}` : undefined,
						]
							.filter((part): part is string => Boolean(part))
							.join(" · ")
						const latestToolCallText = entry.latestToolCall?.trim() || ""
						return (
							<div
								className="rounded-xs border border-editor-group-border px-2 py-1.5"
								key={entry.index}
								style={{ backgroundColor: "var(--vscode-editor-background)" }}>
								<div className="flex items-start gap-2">
									{statusIcon(displayStatus)}
									<div className="min-w-0 flex-1 space-y-1.5">
										{hasStructuredPrompt ? (
											<>
												{entry.subagentName && (
													<div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">
														{entry.subagentName}
													</div>
												)}
												{entry.task && (
													<div className="text-xs font-medium text-foreground wrap-anywhere">
														<MarkdownBlock markdown={entry.task} />
													</div>
												)}
												{entry.context && (
													<div className="rounded-xs border border-editor-group-border px-2 py-1 text-[11px] opacity-80 wrap-anywhere">
														<div className="mb-0.5 font-semibold">Context</div>
														<MarkdownBlock markdown={entry.context} />
													</div>
												)}
											</>
										) : (
											<SubagentPromptText
												isExpanded={expandedPrompts[entry.index] === true}
												onShowMore={() => expandPrompt(entry.index)}
												prompt={entry.prompt}
											/>
										)}
									</div>
									{taskId && entry.jobId && liveCancellableIds.has(entry.jobId) && (
										<Button
											className="border"
											onClick={() => void cancelTaskActivities(taskId, [entry.jobId as string])}
											size="sm"
											variant="danger">
											Cancel
										</Button>
									)}
								</div>
								{shouldShowStats && (
									<div className="mt-1 text-[11px] opacity-70 min-w-0 whitespace-pre-wrap break-words">
										<span>{metadataText ? `${metadataText} · ${statsText}` : statsText}</span>
									</div>
								)}
								{shouldShowStats && hasDetails && (
									<button
										aria-label={isExpanded ? "Hide subagent output" : "Show subagent output"}
										className="mt-1 text-[11px] opacity-80 flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer text-left text-foreground w-full"
										onClick={() => toggleItem(entry.index)}
										type="button">
										{isExpanded ? (
											<ChevronDownIcon className="size-2 shrink-0" />
										) : (
											<ChevronRightIcon className="size-2 shrink-0" />
										)}
										<span className="shrink-0">{isExpanded ? "Hide output" : "Show output"}</span>
									</button>
								)}
								{shouldShowStats && !hasDetails && latestToolCallText && (
									<div className="mt-1 text-[10px] opacity-70 min-w-0 truncate font-mono">
										{latestToolCallText}
									</div>
								)}
								{isExpanded && entry.result && entry.status === "completed" && (
									<div className="mt-2 text-xs opacity-80 wrap-anywhere overflow-hidden">
										<MarkdownBlock markdown={entry.result} />
									</div>
								)}
								{isExpanded &&
									entry.error &&
									(entry.status === "failed" || entry.status === "timeout" || entry.status === "cancelled") && (
										<div className="mt-2 text-xs text-error whitespace-pre-wrap break-words">
											{entry.error}
										</div>
									)}
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}
