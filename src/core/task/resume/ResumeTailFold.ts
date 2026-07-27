import type { ClineMessage } from "@shared/ExtensionMessage"
import type { ClineAssistantToolUseBlock, ClineStorageMessage, ClineUserToolResultContentBlock } from "@shared/messages"
import { type BlockLifecycle, BlockPhase } from "../BlockPhaseMachine"
import { parseDurableToolResult } from "../DurableToolResult"
import type { TaskSnapshot } from "../TaskSnapshot"
import type { ResumeDiagnostic } from "./ResumeInput"

export interface ResumeTailFoldInput {
	snapshot: TaskSnapshot
	apiTail: readonly ClineStorageMessage[]
	uiTail?: readonly ClineMessage[]
	apiTailStartIndex: number
}

export interface ResumeTailFoldResult {
	snapshot: TaskSnapshot
	answeredDlineTids: Set<string>
	diagnostics: ResumeDiagnostic[]
}

function assistantTools(message: ClineStorageMessage): ClineAssistantToolUseBlock[] {
	if (message.role !== "assistant" || !Array.isArray(message.content)) return []
	return message.content.filter((block): block is ClineAssistantToolUseBlock => block.type === "tool_use")
}

function toolResults(message: ClineStorageMessage): ClineUserToolResultContentBlock[] {
	if (message.role !== "user" || !Array.isArray(message.content)) return []
	return message.content.filter((block): block is ClineUserToolResultContentBlock => block.type === "tool_result")
}

function partialToolResults(messages: readonly ClineMessage[]): Map<string, ClineUserToolResultContentBlock> {
	const results = new Map<string, ClineUserToolResultContentBlock>()
	for (const message of messages) {
		if (message.type !== "say" || message.say !== "partial_tool_result" || !message.text) continue
		const parsed = parseDurableToolResult(message.text)
		if (parsed) results.set(parsed.dline_tid, parsed)
	}
	return results
}

function createBlock(block: ClineAssistantToolUseBlock, apiIndex: number, ts: number): BlockLifecycle {
	return {
		dlineTid: block.dline_tid,
		functionId: block.function_id,
		toolName: block.name,
		phase: BlockPhase.STREAMING,
		ts,
		requiresApproval: true,
		conversationHistoryIndex: apiIndex,
	}
}

/** Fold persisted API/UI suffixes after the snapshot anchor without executing side effects. */
export function foldResumeTail(input: ResumeTailFoldInput): ResumeTailFoldResult {
	const snapshot = input.snapshot
	const answeredDlineTids = new Set<string>()
	const diagnostics: ResumeDiagnostic[] = []
	const knownBlocks = new Map<string, BlockLifecycle>()
	const partialResults = partialToolResults(input.uiTail ?? [])
	for (const block of snapshot.turn?.blocks ?? []) knownBlocks.set(block.dlineTid, block)

	const markAnswered = (dlineTid: string, functionId: string): void => {
		const block = knownBlocks.get(dlineTid)
		if (!block) {
			diagnostics.push({ code: "unmatched_tool_result", dlineTid })
			return
		}
		if (block.functionId !== functionId) {
			diagnostics.push({
				code: "tool_result_identity_mismatch",
				dlineTid,
				expectedFunctionId: block.functionId,
				actualFunctionId: functionId,
			})
			return
		}
		block.phase = BlockPhase.COMPLETED
		answeredDlineTids.add(block.dlineTid)
		if (snapshot.interaction?.interactionId === block.dlineTid) {
			snapshot.interaction = undefined
			snapshot.completion = undefined
			if (snapshot.anchor) {
				snapshot.anchor = { ...snapshot.anchor, interactionId: undefined, uiMessageTs: undefined }
			}
		}
	}

	const applyPartialResults = (): void => {
		for (const result of partialResults.values()) {
			if (knownBlocks.has(result.dline_tid)) markAnswered(result.dline_tid, result.function_id)
		}
	}

	applyPartialResults()
	for (const [offset, message] of input.apiTail.entries()) {
		const apiIndex = input.apiTailStartIndex + offset
		const tools = assistantTools(message)
		if (tools.length > 0) {
			const firstTool = tools[0]
			if (!firstTool) continue
			const matchesCurrentTurn =
				snapshot.turn !== undefined &&
				tools.every((tool) => knownBlocks.get(tool.dline_tid)?.functionId === tool.function_id)
			if (matchesCurrentTurn && snapshot.turn) {
				snapshot.turn.assistantApiIndex = apiIndex
			} else {
				const baseTs = message.ts ?? snapshot.timestamp
				const blocks = tools.map((block, index) => createBlock(block, apiIndex, baseTs + index))
				snapshot.turn = {
					turnId: `turn:${firstTool.dline_tid}`,
					assistantApiIndex: apiIndex,
					mode: "serial",
					blocks,
				}
				knownBlocks.clear()
				answeredDlineTids.clear()
				for (const block of blocks) knownBlocks.set(block.dlineTid, block)
			}
			applyPartialResults()
		}

		for (const result of toolResults(message)) {
			markAnswered(result.dline_tid, result.function_id)
		}

		const turnId = snapshot.turn?.turnId ?? snapshot.anchor?.turnId
		snapshot.anchor = { apiIndex, ...(turnId ? { turnId } : {}) }
		snapshot.apiIndex = apiIndex
	}

	return { snapshot, answeredDlineTids, diagnostics }
}
