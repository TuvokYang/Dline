import type { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import type { ClineTool } from "@shared/tools"
import type { WebSearchRoute } from "@/core/api/server-tools"

export type SystemPromptRefreshReason = "task_start" | "manual" | "post_compaction" | "capability_change" | "mode_switch"

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
	/** Optional so task caches written before prompt contract versioning remain readable. */
	readonly contractVersion?: number
	readonly providerId: string
	readonly modelId: string
	readonly profile: "standard" | "lite"
	readonly nativeTools: boolean
	/** Optional for backward compatibility with caches written before focus-aware prompts. */
	readonly focusChainEnabled?: boolean
	/** Whether the Standard subagent tool projection was enabled. */
	readonly subagentsEnabled?: boolean
	/** Selected wire protocol used to resolve provider-hosted tools. */
	readonly apiFormat?: ApiFormat
	/** Active provider-hosted tools included in the prompt contract. */
	readonly serverTools?: readonly ServerTool[]
	/** Global Web Tools setting used to build the frozen prompt. */
	readonly webToolsEnabled?: boolean
	/** Effective request route used to project local or hosted Web Search. */
	readonly webSearchRoute?: WebSearchRoute
}
