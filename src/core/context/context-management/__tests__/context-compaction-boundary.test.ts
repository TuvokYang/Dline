import type { ClineContent, ClineStorageMessage } from "@shared/messages/content"
import { describe, expect, it } from "vitest"
import { projectContextCompactionBoundary } from "../context-compaction-boundary"
import { indexLogicalTurns } from "../logical-turns"

function textMessage(role: "user" | "assistant", text: string): ClineStorageMessage {
	return { role, content: [{ type: "text", text }] }
}

function qnaToolUse(functionId: string): ClineStorageMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				function_id: functionId,
				dline_tid: `tid-${functionId}`,
				name: "qna_respond",
				input: {},
			},
		],
	}
}

function qnaToolResult(functionId: string, feedback: string): ClineStorageMessage {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				function_id: functionId,
				dline_tid: `tid-${functionId}`,
				content: [{ type: "text", text: `[qna_respond] Result:\n<feedback>${feedback}</feedback>` }],
			},
		],
	}
}

describe("context compaction boundary", () => {
	it("uses protected-tail tool-result identity to keep an earlier turn compressible during explicit retry", () => {
		const activeHistory: ClineStorageMessage[] = [
			textMessage("user", "<task>Turn A</task>"),
			qnaToolUse("call-a"),
			qnaToolResult("call-a", "Turn B request"),
			qnaToolUse("call-b"),
		]
		const pendingContent: ClineContent[] = [{ type: "text", text: "EXPLICIT_RETRY_DRAFT" }]

		const boundary = projectContextCompactionBoundary(activeHistory, pendingContent)
		const sourceText = JSON.stringify(boundary.sourceHistory)
		const continuationText = JSON.stringify(boundary.targetContinuationHistory)

		expect(indexLogicalTurns(boundary.sourceHistory).turns).toHaveLength(1)
		expect(sourceText).toContain("Tool qna_respond executed successfully.")
		expect(sourceText).not.toContain("Turn B request")
		expect(sourceText).not.toContain("EXPLICIT_RETRY_DRAFT")
		expect(continuationText).toContain("Turn B request")
		expect(continuationText).toContain("call-b")
	})
})
