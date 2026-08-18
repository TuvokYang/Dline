import type {
	ClineAssistantToolUseBlock,
	ClineContent,
	ClineStorageMessage,
	ClineTextContentBlock,
	ClineUserToolResultContentBlock,
} from "@shared/messages/content"
import cloneDeep from "clone-deep"
import { indexLogicalTurns } from "./logical-turns"

export interface ContextCompactionBoundary {
	sourceHistory: ClineStorageMessage[]
	targetContinuationHistory: ClineStorageMessage[]
}

export interface ContextCompactionBoundaryOptions {
	/** Decide whether an unpaired tool use may receive neutral identity-only pairing evidence in the hidden Pass. */
	shouldCompleteUnpairedToolUse?: (toolUse: ClineAssistantToolUseBlock) => boolean
}

/**
 * Project a self-contained compaction source while pending request content remains outside canonical history.
 *
 * Pending tool results participate in logical-turn boundary discovery. Tagged user feedback starts the next
 * user-authored round, so its real text must not enter the hidden Pass. When that feedback is the only evidence
 * that a conversational tool completed, a neutral pairing result keeps the selected source provider-projectable
 * without copying or consuming the user's pending content.
 */
export function projectContextCompactionBoundary(
	activeHistory: readonly ClineStorageMessage[],
	pendingContent: readonly ClineContent[],
	options: ContextCompactionBoundaryOptions = {},
): ContextCompactionBoundary {
	const pendingBlocks = pendingContent.filter(
		(block): block is ClineUserToolResultContentBlock | ClineTextContentBlock =>
			block.type === "tool_result" || block.type === "text",
	)
	const completedUnpairedFunctionIds = options.shouldCompleteUnpairedToolUse
		? collectCompletableUnpairedFunctionIds(activeHistory, options.shouldCompleteUnpairedToolUse)
		: new Set<string>()
	const activeBoundaryHistory = options.shouldCompleteUnpairedToolUse
		? completePendingPairings(activeHistory, [], options.shouldCompleteUnpairedToolUse)
		: cloneDeep([...activeHistory])
	const pendingMessage: ClineStorageMessage | undefined =
		pendingBlocks.length > 0 ? { role: "user", content: cloneDeep(pendingBlocks), ts: Date.now() } : undefined
	const activeIndex = indexLogicalTurns(activeBoundaryHistory)
	const boundaryHistory = pendingMessage ? [...activeBoundaryHistory, pendingMessage] : activeBoundaryHistory
	const boundaryIndex = indexLogicalTurns(boundaryHistory)
	const pendingResultFunctionIds = new Set(
		pendingBlocks
			.filter((block): block is ClineUserToolResultContentBlock => block.type === "tool_result")
			.map((block) => block.function_id),
	)
	const pendingCompletesProtectedTurn =
		activeIndex.turns.length > 0 &&
		activeIndex.protectedStartIndex < activeBoundaryHistory.length &&
		activeIndex.issues.some((issue) => issue.kind === "unpaired_tool_use" && pendingResultFunctionIds.has(issue.functionId))
	// Once earlier complete turns exist, a request-local result may close the latest
	// canonical turn for target projection without making that turn eligible for a hidden Pass.
	const sourceEndIndex = pendingCompletesProtectedTurn
		? activeIndex.protectedStartIndex
		: Math.min(boundaryIndex.protectedStartIndex, boundaryHistory.length)
	const sourceHistory = boundaryHistory.slice(0, sourceEndIndex)
	const sourcePairingEvidence = pendingCompletesProtectedTurn
		? [...collectToolResults(activeBoundaryHistory.slice(sourceEndIndex)), ...pendingBlocks]
		: pendingBlocks

	const naturalContinuationStart = Math.min(sourceEndIndex, activeHistory.length)
	const targetContinuationHistory = activeHistory.filter(
		(message, messageIndex) =>
			messageIndex >= naturalContinuationStart || messageContainsToolUse(message, completedUnpairedFunctionIds),
	)

	return {
		sourceHistory: completePendingPairings(sourceHistory, sourcePairingEvidence, options.shouldCompleteUnpairedToolUse),
		targetContinuationHistory: cloneDeep(targetContinuationHistory),
	}
}

function collectCompletableUnpairedFunctionIds(
	history: readonly ClineStorageMessage[],
	shouldComplete: (toolUse: ClineAssistantToolUseBlock) => boolean,
): Set<string> {
	const toolUses = collectToolUses(history)
	return new Set(
		indexLogicalTurns(cloneDeep([...history])).issues.flatMap((issue) => {
			if (issue.kind !== "unpaired_tool_use") return []
			const toolUse = toolUses.get(issue.functionId)
			return toolUse && shouldComplete(toolUse) ? [issue.functionId] : []
		}),
	)
}

function messageContainsToolUse(message: ClineStorageMessage, functionIds: ReadonlySet<string>): boolean {
	return (
		message.role === "assistant" &&
		Array.isArray(message.content) &&
		message.content.some((block) => block.type === "tool_use" && functionIds.has(block.function_id))
	)
}

/** Materialize only the identity-level pairing evidence required by the selected hidden-Pass source. */
function completePendingPairings(
	sourceHistory: readonly ClineStorageMessage[],
	pendingBlocks: readonly (ClineUserToolResultContentBlock | ClineTextContentBlock)[],
	shouldCompleteUnpairedToolUse?: (toolUse: ClineAssistantToolUseBlock) => boolean,
): ClineStorageMessage[] {
	const source: ClineStorageMessage[] = cloneDeep([...sourceHistory])
	const sourceIndex = indexLogicalTurns(source)
	const pendingResults = new Map(
		pendingBlocks
			.filter((block): block is ClineUserToolResultContentBlock => block.type === "tool_result")
			.map((block) => [block.function_id, block] as const),
	)
	const sourceToolUses = collectToolUses(source)

	const pairingResults = sourceIndex.issues.flatMap((issue): ClineUserToolResultContentBlock[] => {
		if (issue.kind !== "unpaired_tool_use") return []
		const pendingResult = pendingResults.get(issue.functionId)
		const toolUse = sourceToolUses.get(issue.functionId)
		if (!toolUse || (!pendingResult && !shouldCompleteUnpairedToolUse?.(toolUse))) return []
		return [
			{
				type: "tool_result",
				function_id: pendingResult?.function_id ?? toolUse.function_id,
				dline_tid: pendingResult?.dline_tid ?? toolUse.dline_tid,
				content: [{ type: "text", text: `Tool ${toolUse.name} executed successfully.` }],
			},
		]
	})
	if (pairingResults.length === 0) return source

	return [...source, { role: "user", content: pairingResults }]
}

function collectToolResults(history: readonly ClineStorageMessage[]): ClineUserToolResultContentBlock[] {
	return history.flatMap((message) => {
		if (message.role !== "user" || !Array.isArray(message.content)) return []
		return message.content.filter((block): block is ClineUserToolResultContentBlock => block.type === "tool_result")
	})
}

function collectToolUses(history: readonly ClineStorageMessage[]): Map<string, ClineAssistantToolUseBlock> {
	const toolUses = new Map<string, ClineAssistantToolUseBlock>()
	for (const message of history) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue
		for (const block of message.content) {
			if (block.type === "tool_use") toolUses.set(block.function_id, block)
		}
	}
	return toolUses
}
