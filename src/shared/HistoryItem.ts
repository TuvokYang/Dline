import type { Mode } from "./storage/types"

export type HistoryItem = {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number
	cacheHitRate?: number // Cache hit rate percentage (0-100)
	currency?: string // Billing currency code

	size?: number
	shadowGitConfigWorkTree?: string
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean
	checkpointManagerErrorMessage?: string

	modelId?: string
	/** The API provider used for this task (e.g., "anthropic", "openrouter"). */
	providerId?: string
	/** The mode this task was last running in ("plan" | "act"). */
	mode?: Mode
	/** IDs of tasks spawned from this task (parent → child). */
	spawnedTaskIds?: string[]
	/** The parent task ID if this task was spawned from another. */
	parentTaskId?: string
}
