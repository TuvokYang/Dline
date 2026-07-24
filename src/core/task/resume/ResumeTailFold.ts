import type { ClineAssistantToolUseBlock, ClineStorageMessage, ClineUserToolResultContentBlock } from "@shared/messages"
import { type BlockLifecycle, BlockPhase } from "../BlockPhaseMachine"
import type { TaskSnapshot } from "../TaskSnapshot"
import type { ResumeDiagnostic } from "./ResumeInput"

export interface ResumeTailFoldInput {
	snapshot: TaskSnapshot
	apiTail: readonly ClineStorageMessage[]
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

/** Fold persisted API messages after the snapshot anchor without executing side effects. */
export function foldResumeTail(input: ResumeTailFoldInput): ResumeTailFoldResult {
	const snapshot = input.snapshot
	const answeredDlineTids = new Set<string>()
	const knownBlocks = new Map<string, BlockLifecycle>()
	for (const block of snapshot.turn?.blocks ?? []) knownBlocks.set(block.dlineTid, block)

	for (const [offset, message] of input.apiTail.entries()) {
		const apiIndex = input.apiTailStartIndex + offset
		const tools = assistantTools(message)
		if (tools.length > 0) {
			const turnId = `turn:${tools[0]?.dline_tid}`
			const matchesCurrentTurn =
				snapshot.turn !== undefined &&
				tools.every((tool) => {
					const current = knownBlocks.get(tool.dline_tid)
					return current?.functionId === tool.function_id
				})
			if (matchesCurrentTurn && snapshot.turn) {
				snapshot.turn.assistantApiIndex = apiIndex
			} else {
				const baseTs = message.ts ?? snapshot.timestamp
				const blocks = tools.map((block, index) => createBlock(block, apiIndex, baseTs + index))
				snapshot.turn = {
					turnId,
					assistantApiIndex: apiIndex,
					mode: "serial",
					blocks,
				}
				knownBlocks.clear()
				answeredDlineTids.clear()
				for (const block of blocks) knownBlocks.set(block.dlineTid, block)
			}
			snapshot.anchor = { apiIndex, turnId: snapshot.turn.turnId }
			snapshot.apiIndex = apiIndex
		}

		for (const result of toolResults(message)) {
			const block = knownBlocks.get(result.dline_tid)
			if (!block) {
				return {
					snapshot,
					answeredDlineTids,
					diagnostics: [{ code: "unmatched_tool_result", dlineTid: result.dline_tid }],
				}
			}
			if (block.functionId !== result.function_id) {
				return {
					snapshot,
					answeredDlineTids,
					diagnostics: [
						{
							code: "tool_result_identity_mismatch",
							dlineTid: result.dline_tid,
							expectedFunctionId: block.functionId,
							actualFunctionId: result.function_id,
						},
					],
				}
			}
			block.phase = BlockPhase.COMPLETED
			answeredDlineTids.add(block.dlineTid)
		}

		if (tools.length === 0 && toolResults(message).length > 0) {
			snapshot.anchor = { ...snapshot.anchor, apiIndex }
			snapshot.apiIndex = apiIndex
		}
	}

	return { snapshot, answeredDlineTids, diagnostics: [] }
}
