import type { ClineTool } from "@shared/tools"

export type SystemPromptRefreshReason = "task_start" | "manual" | "post_compaction" | "capability_change"

/**
 * Stores task-level cached context data for a single task directory.
 */
export interface TaskContextCache {
	readonly schemaVersion: 1
	readonly taskId: string
	readonly createdAt: number
	readonly updatedAt: number
	readonly systemPrompt?: TaskSystemPromptContext
}

/**
 * Groups system-prompt related task context cache entries.
 */
export interface TaskSystemPromptContext {
	readonly frozen?: FrozenSystemPromptCache
}

/**
 * Stores the frozen system prompt used by ordinary API requests in a task.
 */
export interface FrozenSystemPromptCache {
	readonly text: string
	readonly tools: readonly ClineTool[] | null
	readonly capabilitiesHash: string
	readonly createdAt: number
	readonly refreshedAt: number
	readonly refreshReason: SystemPromptRefreshReason
	readonly promptBuilder: FrozenPromptBuilderInfo
}

/**
 * Records the prompt builder inputs that produced the frozen prompt.
 */
export interface FrozenPromptBuilderInfo {
	readonly providerId: string
	readonly modelId: string
	readonly profile: "native" | "lite"
	readonly nativeTools: boolean
}
