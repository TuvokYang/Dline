import { Anthropic } from "@anthropic-ai/sdk"
import { AssistantMessageContent } from "@core/assistant-message"
import { ClineAskResponse } from "@shared/WebviewMessage"
import type { ClineContent, ClineStorageMessage } from "@/shared/messages"
import type { PartialToolLifecycle } from "./partial-tool-lifecycle"
import type { HookExecution } from "./types/HookExecution"

export class TaskState {
	// Task-level timing
	taskStartTimeMs = Date.now()
	taskFirstTokenTimeMs?: number

	// Streaming flags
	isStreaming = false
	isWaitingForFirstChunk = false
	didCompleteReadingStream = false

	// Content processing
	currentStreamingContentIndex = 0
	assistantMessageContent: AssistantMessageContent[] = []
	userMessageContent: ClineContent[] = []
	userMessageContentReady = false

	// Presentation locks
	presentAssistantMessageLocked = false
	presentAssistantMessageHasPendingUpdates = false

	// Ask/Response handling
	askResponse?: ClineAskResponse
	askResponseText?: string
	askResponseImages?: string[]
	askResponseFiles?: string[]
	ackedFeedback?: {
		response: ClineAskResponse
		text?: string
		images?: string[]
		files?: string[]
	}
	lastMessageTs?: number

	// Plan mode specific state
	isAwaitingPlanResponse = false
	didRespondToPlanAskBySwitchingMode = false

	// Context and history
	conversationHistoryDeletedRange?: [number, number]

	// Tool execution flags
	didAlreadyUseTool = false
	didEditFile = false
	lastToolName = "" // Track last tool used for consecutive call detection
	lastToolParams = "" // Canonical signature of last tool's params (via toolCallSignature)
	consecutiveIdenticalToolCount = 0 // Consecutive calls with identical tool name + params

	// File read deduplication cache - prevents the model from endlessly reading the same files
	// Maps absolute file path → { readCount: times read in this task, mtime: last modified timestamp, imageBlock: optional image data for multimodal models }
	fileReadCache: Map<string, { readCount: number; mtime: number; imageBlock?: Anthropic.ImageBlockParam }> = new Map()

	// Error tracking
	consecutiveMistakeCount = 0
	doubleCheckCompletionPending = false
	didAutomaticallyRetryFailedApiRequest = false
	checkpointManagerErrorMessage?: string

	// Retry tracking for auto-retry feature
	autoRetryAttempts = 0

	// Task Initialization
	isInitialized = false

	// Focus Chain / Todo List Management
	apiRequestCount = 0
	apiRequestsSinceLastTodoUpdate = 0
	currentFocusChainChecklist: string | null = null
	focusChainHistory: string | null = null
	focusChainRejectionMessage: string | null = null
	/** Index of the current in-progress item in the checklist (0-based), used to render <- CURRENT marker in environment_details. null when no active item. */
	currentInProgressItemIndex: number | null = null
	todoListWasUpdatedByUser = false
	hasWarnedSkipOrder = false
	/** Block the next round of tool calls when - [x] fabrication is detected */
	blockNextToolCalls = false

	// Task Abort / Cancellation
	abort = false
	didFinishAbortingStream = false
	abandoned = false

	// Subagent execution tracking for cancel detection
	isExecutingSubagent = false

	// Hook execution tracking for cancellation
	activeHookExecution?: HookExecution

	// Auto-context summarization
	currentlySummarizing = false
	lastAutoCompactTriggerIndex?: number
	isInternalContextCompactionRequest = false
	deferredCurrentTurn?: {
		assistantMessage: ClineStorageMessage
		userContent: ClineContent[]
	}

	// Block identity: maps source-offset keys to stable UI ts values.
	// Key format: "text:<startOffset>" or "tool:<openTagStart>".
	// Cleared at the start of each API turn to prevent cross-turn ts reuse.
	parseBlockTsByKey: Map<string, number> = new Map()
	/** Stable canonical identities for non-native tool blocks during one API turn. */
	parseToolIdentityByKey: Map<string, { function_id: string; dline_tid: string }> = new Map()

	// Content dedup: tracks the last rendered signature per ts to avoid
	// re-sending identical partial events to the frontend.
	lastRenderedPartialByTs: Map<number, string> = new Map()

	// Tool block lifecycle state machine. When a partial tool block advances
	// past the presentation index and later becomes non-partial (stream end),
	// the complete execution path must be replayed.  This map drives that
	// deferred execution so that every partial-shown tool eventually reaches
	// its handleCompleteBlock handler exactly once.
	//
	// States:
	//   partial-shown    – handlePartialBlock ran, awaiting final
	//   complete-running – final execution in progress (CAS guard)
	//   complete-done    – final execution completed
	// Cleared at stream reset to keep state turn-scoped.
	partialToolLifecycleByTs: Map<number, PartialToolLifecycle> = new Map()

	// Reasoning block ts — assigned once at the first reasoning delta
	// and reused for all partial/final reasoning messages in the turn.
	reasoningTs?: number
}
