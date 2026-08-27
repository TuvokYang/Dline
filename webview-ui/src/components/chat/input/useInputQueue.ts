import { MutateInputQueueRequest } from "@shared/proto/dline/task"
import { useCallback, useMemo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"
import type { InputQueuePanelEntry } from "./InputQueuePanel"

export interface InputQueueDraft {
	text: string
	images: string[]
	files: string[]
	activeQuote?: string
}

export interface InputQueueController {
	entries: readonly InputQueuePanelEntry[]
	enqueue: (draft: InputQueueDraft) => void
	toggleMode: (id: string) => void
	beginEdit: (id: string) => void
	commitEdit: (id: string, draft: InputQueueDraft) => void
	cancelEdit: (id: string) => void
	remove: (id: string) => void
	reorder: (id: string, targetIndex: number) => void
}

/**
 * Bind the composer to the backend-owned input queue.
 *
 * Every operation is sent to the task and the rendered list comes back through
 * ExtensionState. The Webview deliberately keeps no local copy: the queue is
 * persisted per task, so a second authority here could show entries that were
 * never stored, or hide entries that were.
 */
export function useInputQueue(taskId: string | undefined): InputQueueController {
	const { inputQueue } = useExtensionState()

	const mutate = useCallback(
		(operation: Partial<MutateInputQueueRequest>) => {
			if (!taskId) {
				return
			}
			TaskServiceClient.mutateInputQueue(MutateInputQueueRequest.create({ taskId, ...operation }))
				.then((response) => {
					if (response.accepted) {
						return
					}
					// A refused change is not an error on the wire, so it would
					// otherwise pass silently. The queue itself stays correct:
					// the task rolls back and republishes, and this projection
					// follows. What must not happen is the user believing a
					// change landed when the reason is only visible here.
					console.warn(`Input queue change refused: ${response.result || "unknown"}`)
				})
				.catch((error) => {
					console.error("Failed to update the input queue:", error)
				})
		},
		[taskId],
	)

	const entries = useMemo<readonly InputQueuePanelEntry[]>(
		() =>
			(inputQueue ?? []).map((entry) => ({
				id: entry.id,
				text: entry.text,
				images: entry.images,
				files: entry.files,
				activeQuote: entry.activeQuote,
				mode: entry.mode,
				editing: entry.editing,
			})),
		[inputQueue],
	)

	return {
		entries,
		enqueue: useCallback((draft: InputQueueDraft) => mutate({ enqueue: { draft } }), [mutate]),
		toggleMode: useCallback((entryId: string) => mutate({ toggleMode: { entryId } }), [mutate]),
		beginEdit: useCallback((entryId: string) => mutate({ beginEdit: { entryId } }), [mutate]),
		commitEdit: useCallback(
			(entryId: string, draft: InputQueueDraft) => mutate({ commitEdit: { entryId, draft } }),
			[mutate],
		),
		cancelEdit: useCallback((entryId: string) => mutate({ cancelEdit: { entryId } }), [mutate]),
		remove: useCallback((entryId: string) => mutate({ remove: { entryId } }), [mutate]),
		reorder: useCallback((entryId: string, targetIndex: number) => mutate({ reorder: { entryId, targetIndex } }), [mutate]),
	}
}
