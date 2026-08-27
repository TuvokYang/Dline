import { ChevronDownIcon, ChevronRightIcon, GripVerticalIcon, PencilIcon, RotateCcwIcon, SendIcon, XIcon } from "lucide-react"
import { useState } from "react"

function classes(...values: Array<string | false | undefined>): string {
	return values.filter(Boolean).join(" ")
}

/** Delivery state of a retained entry, mirrored from the backend queue. */
export type InputQueuePanelMode = "queued" | "steering"

/** Presentation-only projection of one retained input. */
export interface InputQueuePanelEntry {
	readonly id: string
	readonly text: string
	readonly images: readonly string[]
	readonly files: readonly string[]
	readonly activeQuote?: string
	readonly mode: InputQueuePanelMode
	readonly editing?: boolean
}

export interface InputQueuePanelProps {
	entries: readonly InputQueuePanelEntry[]
	/** Promote to steering or demote back to queued. Never delivers. */
	onToggleMode: (id: string) => void
	/** Pull the entry back into the composer for editing. */
	onEdit: (id: string) => void
	/** Release an edit without changing the entry, making it deliverable again. */
	onCancelEdit: (id: string) => void
	onRemove: (id: string) => void
	onReorder: (id: string, targetIndex: number) => void
}

function attachmentSummary(entry: InputQueuePanelEntry): string | undefined {
	const parts: string[] = []
	if (entry.images.length > 0) parts.push(`${entry.images.length} image${entry.images.length > 1 ? "s" : ""}`)
	if (entry.files.length > 0) parts.push(`${entry.files.length} file${entry.files.length > 1 ? "s" : ""}`)
	return parts.length > 0 ? parts.join(", ") : undefined
}

/**
 * Collapsed summary plus an expandable overlay of retained input.
 *
 * The expanded list is an overlay rather than an inline block: growing the
 * footer would displace Cancel and the other task actions, and a destructive
 * action must not move while the user interacts with the queue.
 */
export function InputQueuePanel({ entries, onToggleMode, onEdit, onCancelEdit, onRemove, onReorder }: InputQueuePanelProps) {
	const [expanded, setExpanded] = useState(false)
	const [draggingId, setDraggingId] = useState<string>()

	if (entries.length === 0) {
		return null
	}

	const steeringCount = entries.filter((entry) => entry.mode === "steering").length

	return (
		<div className="relative mx-3.5">
			{expanded ? (
				<div
					aria-label="Queued input"
					className="absolute bottom-full left-0 right-0 z-10 mb-1 max-h-64 overflow-y-auto rounded border border-(--vscode-panel-border) bg-(--vscode-sidebar-background) p-1"
					data-testid="input-queue-overlay"
					// The overlay is a reorderable list of entries; the drag handlers below
					// belong to the option rows, which need an interactive role to carry them.
					role="listbox">
					{entries.map((entry, index) => {
						const attachments = attachmentSummary(entry)
						return (
							<div
								aria-selected={entry.mode === "steering"}
								className={classes(
									"group flex items-center gap-1 rounded px-1 py-1 text-xs",
									entry.mode === "steering"
										? "text-(--vscode-charts-orange)"
										: "text-(--vscode-descriptionForeground)",
									entry.editing && "opacity-60 italic",
									draggingId === entry.id && "opacity-40",
								)}
								data-editing={entry.editing ? "true" : "false"}
								data-mode={entry.mode}
								data-testid={`input-queue-entry-${entry.id}`}
								draggable={true}
								key={entry.id}
								onDragEnd={() => setDraggingId(undefined)}
								onDragOver={(event) => event.preventDefault()}
								onDragStart={() => setDraggingId(entry.id)}
								onDrop={() => {
									if (draggingId && draggingId !== entry.id) {
										onReorder(draggingId, index)
									}
									setDraggingId(undefined)
								}}
								role="option"
								// Roving tabindex: the row is programmatically focusable for
								// assistive tech without adding a tab stop per queue entry.
								tabIndex={-1}>
								<GripVerticalIcon className="size-3 shrink-0 cursor-grab opacity-60" />
								<span className="min-w-0 flex-1 truncate">{entry.text}</span>
								{attachments ? <span className="shrink-0 opacity-70">{attachments}</span> : null}
								<button
									aria-label={entry.mode === "steering" ? "Return to queue" : "Send with next round"}
									className="input-icon-button shrink-0 appearance-none border-0 bg-transparent p-0"
									data-testid={`input-queue-send-${entry.id}`}
									onClick={() => onToggleMode(entry.id)}
									type="button">
									<SendIcon className="size-3" />
								</button>
								{/* An entry under edit is held back from delivery, so it needs a
								    way out that does not require sending or deleting it. */}
								{entry.editing ? (
									<button
										aria-label="Cancel editing"
										className="input-icon-button shrink-0 appearance-none border-0 bg-transparent p-0"
										data-testid={`input-queue-cancel-edit-${entry.id}`}
										onClick={() => onCancelEdit(entry.id)}
										type="button">
										<RotateCcwIcon className="size-3" />
									</button>
								) : (
									<button
										aria-label="Edit queued input"
										className="input-icon-button shrink-0 appearance-none border-0 bg-transparent p-0"
										data-testid={`input-queue-edit-${entry.id}`}
										onClick={() => onEdit(entry.id)}
										type="button">
										<PencilIcon className="size-3" />
									</button>
								)}
								<button
									aria-label="Remove queued input"
									className="input-icon-button shrink-0 appearance-none border-0 bg-transparent p-0"
									data-testid={`input-queue-remove-${entry.id}`}
									onClick={() => onRemove(entry.id)}
									type="button">
									<XIcon className="size-3" />
								</button>
							</div>
						)
					})}
				</div>
			) : null}
			<button
				className="flex w-full items-center gap-1 appearance-none border-0 bg-transparent px-0 py-0.5 text-left text-xs text-(--vscode-descriptionForeground)"
				data-testid="input-queue-toggle"
				onClick={() => setExpanded((current) => !current)}
				type="button">
				{expanded ? <ChevronDownIcon className="size-3" /> : <ChevronRightIcon className="size-3" />}
				<span>Queue {entries.length}</span>
				{steeringCount > 0 ? <span className="text-(--vscode-charts-orange)"> {steeringCount} steering</span> : null}
			</button>
		</div>
	)
}
