import type { HistoryItem } from "@shared/HistoryItem"
import { StringRequest } from "@shared/proto/dline/common"
import { GetTaskHistoryRequest } from "@shared/proto/dline/task"
import { ExternalLinkIcon } from "lucide-react"
import { memo, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

type HistoryPreviewProps = {
	showHistoryView: () => void
}

export type HistoryPreviewFilter = "workspace" | "favorite" | "all"

type PreviewTask = Pick<HistoryItem, "id" | "task" | "ts"> & Partial<Pick<HistoryItem, "currency" | "isFavorited" | "totalCost">>

export const HISTORY_PREVIEW_LIMIT = 10

const FILTERS: Array<{ value: HistoryPreviewFilter; label: string }> = [
	{ value: "workspace", label: "Workspace" },
	{ value: "favorite", label: "Favorite" },
	{ value: "all", label: "All" },
]

function normalizeWorkspacePath(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase()
}

/** Format a task's last-edit timestamp using local time. */
export function formatHistoryTimestamp(timestamp: number): string {
	const date = new Date(timestamp)
	if (Number.isNaN(date.getTime())) return ""
	const pad = (value: number) => String(value).padStart(2, "0")
	return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Build an immediate preview while the authoritative filtered request is in flight. */
export function filterHistoryPreview(
	taskHistory: HistoryItem[],
	filter: HistoryPreviewFilter,
	workspacePaths: string[],
): PreviewTask[] {
	const normalizedWorkspacePaths = new Set(workspacePaths.map(normalizeWorkspacePath).filter(Boolean))
	return taskHistory
		.filter((item) => {
			if (!item.ts || !item.task) return false
			if (filter === "favorite") return item.isFavorited === true
			if (filter === "all") return true
			const taskWorkspace = item.cwdOnTaskInitialization ?? item.shadowGitConfigWorkTree
			return taskWorkspace ? normalizedWorkspacePaths.has(normalizeWorkspacePath(taskWorkspace)) : false
		})
		.sort((a, b) => b.ts - a.ts)
		.slice(0, HISTORY_PREVIEW_LIMIT)
}

const HistoryPreview = ({ showHistoryView }: HistoryPreviewProps) => {
	const { taskHistory, workspaceRoots } = useExtensionState()
	const [filter, setFilter] = useState<HistoryPreviewFilter>("workspace")
	const workspacePaths = useMemo(() => workspaceRoots.map((root) => root.path), [workspaceRoots])
	const fallbackTasks = useMemo(
		() => filterHistoryPreview(taskHistory, filter, workspacePaths),
		[filter, taskHistory, workspacePaths],
	)
	const [loadedTasks, setLoadedTasks] = useState<{
		baseline: PreviewTask[]
		filter: HistoryPreviewFilter
		tasks: PreviewTask[]
	}>()
	const tasks = loadedTasks?.filter === filter && loadedTasks.baseline === fallbackTasks ? loadedTasks.tasks : fallbackTasks

	useEffect(() => {
		let cancelled = false
		TaskServiceClient.getTaskHistory(
			GetTaskHistoryRequest.create({
				currentWorkspaceOnly: filter === "workspace",
				favoritesOnly: filter === "favorite",
				sortBy: "newest",
			}),
		)
			.then((response) => {
				if (!cancelled) {
					setLoadedTasks({ baseline: fallbackTasks, filter, tasks: response.tasks.slice(0, HISTORY_PREVIEW_LIMIT) })
				}
			})
			.catch((error) => console.error("Error loading recent tasks:", error))

		return () => {
			cancelled = true
		}
	}, [fallbackTasks, filter])
	const handleHistorySelect = (id: string) => {
		TaskServiceClient.showTaskWithId(StringRequest.create({ value: id })).catch((error) =>
			console.error("Error showing task:", error),
		)
	}

	const getCostSymbol = (currency?: string) => (currency === "CNY" ? "￥" : "$")

	return (
		<div style={{ flexShrink: 0 }}>
			<style>
				{`
					.history-preview-item {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 65%, transparent);
						border-radius: 4px;
						position: relative;
						overflow: hidden;
						cursor: pointer;
						margin-bottom: 8px;
						padding: 10px 12px;
						display: flex;
						align-items: flex-start;
						gap: 12px;
					}
					.history-preview-item:hover {
						background-color: color-mix(in srgb, var(--vscode-toolbar-hoverBackground) 100%, transparent);
						pointer-events: auto;
					}
					.history-task-content {
						flex: 1;
						display: flex;
						align-items: flex-start;
						gap: 8px;
						min-width: 0;
					}
					.history-task-description {
						flex: 1;
						overflow: hidden;
						display: -webkit-box;
						-webkit-line-clamp: 2;
						-webkit-box-orient: vertical;
						color: var(--vscode-foreground);
						font-size: var(--vscode-font-size);
						line-height: 1.4;
					}
					.history-meta-stack {
						display: flex;
						flex-direction: column;
						align-items: center;
						gap: 4px;
						flex-shrink: 0;
					}
					.history-date {
						color: var(--vscode-descriptionForeground);
						font-size: 0.85em;
						white-space: nowrap;
					}
					.history-cost-chip {
						background-color: var(--vscode-badge-background);
						color: var(--vscode-badge-foreground);
						padding: 2px 8px;
						border-radius: 12px;
						font-size: 0.85em;
						font-weight: 500;
						white-space: nowrap;
					}
					.history-view-all-btn {
						background: none;
						border: none;
						padding: 4px 0 4px 8px;
						cursor: pointer;
						font-size: 0.85em;
						font-weight: 500;
						color: var(--vscode-descriptionForeground);
						white-space: nowrap;
						display: flex;
						align-items: center;
						gap: 2px;
					}
					.history-view-all-btn .codicon {
						font-size: 1.2em;
					}
					.history-view-all-btn:hover {
						color: var(--vscode-foreground);
					}
					.history-preview-btns {
						display: flex;
						gap: 4px;
						opacity: 0;
						transition: opacity 0.15s;
					}
					.history-preview-item:hover .history-preview-btns {
						opacity: 1;
					}
					.history-preview-filters {
						display: flex;
						gap: 4px;
						margin-top: 8px;
					}
					.history-preview-filter {
						background: transparent;
						border: 1px solid var(--vscode-widget-border, transparent);
						border-radius: 4px;
						color: var(--vscode-descriptionForeground);
						cursor: pointer;
						font: inherit;
						font-size: 0.82em;
						padding: 3px 8px;
					}
					.history-preview-filter:hover {
						background: var(--vscode-toolbar-hoverBackground);
						color: var(--vscode-foreground);
					}
					.history-preview-filter[aria-pressed="true"] {
						background: var(--vscode-button-secondaryBackground);
						color: var(--vscode-button-secondaryForeground);
					}
				`}
			</style>

			<div
				className="history-header"
				style={{
					color: "var(--vscode-descriptionForeground)",
					margin: "10px 16px 10px 16px",
				}}>
				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
					<div style={{ display: "flex", alignItems: "center" }}>
						<span
							className="codicon codicon-comment-discussion"
							style={{ marginRight: "4px", transform: "scale(0.9)" }}
						/>
						<span style={{ fontWeight: 500, fontSize: "0.85em", textTransform: "uppercase" }}>Recent</span>
					</div>
					{taskHistory.some((item) => item.ts && item.task) && (
						<button className="history-view-all-btn" onClick={() => showHistoryView()} type="button">
							View All
							<span className="codicon codicon-chevron-right" />
						</button>
					)}
				</div>
				<div aria-label="Recent task filter" className="history-preview-filters" role="group">
					{FILTERS.map((option) => (
						<button
							aria-pressed={filter === option.value}
							className="history-preview-filter"
							key={option.value}
							onClick={() => setFilter(option.value)}
							type="button">
							{option.label}
						</button>
					))}
				</div>
			</div>

			<div className="px-4">
				{tasks.length > 0 ? (
					tasks.map((item) => (
						<div
							className="history-preview-item"
							key={item.id}
							onClick={() => handleHistorySelect(item.id)}
							onContextMenu={(e) => e.preventDefault()}>
							<div className="history-task-content">
								{item.isFavorited && (
									<span
										aria-label="Favorited"
										className="codicon codicon-star-full"
										style={{ color: "var(--vscode-button-background)", flexShrink: 0 }}
									/>
								)}
								<div className="history-task-description ph-no-capture">{item.task}</div>
							</div>
							<div className="history-preview-btns">
								<button
									onClick={(e) => {
										e.stopPropagation()
										TaskServiceClient.openTaskInNewWindow(StringRequest.create({ value: item.id })).catch(
											(err) => console.error("Failed to open task in new window:", err),
										)
									}}
									style={{
										background: "none",
										border: "none",
										cursor: "pointer",
										padding: "2px",
										color: "var(--vscode-descriptionForeground)",
										display: "flex",
										alignItems: "center",
									}}
									title="Open in New Window">
									<ExternalLinkIcon size={14} />
								</button>
							</div>
							<div className="history-meta-stack">
								<span className="history-date" title={`Last edited ${formatHistoryTimestamp(item.ts)}`}>
									{formatHistoryTimestamp(item.ts)}
								</span>
								{item.totalCost != null && (
									<span className="history-cost-chip">
										{getCostSymbol(item.currency)}
										{item.totalCost.toFixed(2)}
									</span>
								)}
							</div>
						</div>
					))
				) : (
					<div
						style={{
							textAlign: "center",
							color: "var(--vscode-descriptionForeground)",
							fontSize: "var(--vscode-font-size)",
							padding: "10px 0",
						}}>
						No recent tasks
					</div>
				)}
			</div>
		</div>
	)
}

export default memo(HistoryPreview)
