import type { ClineContent, ClineStorageMessage } from "@shared/messages/content"
import { describe, expect, it } from "vitest"
import { indexLogicalTurns } from "../logical-turns"

function textMessage(role: "user" | "assistant", text: string): ClineStorageMessage {
	return { role, content: [{ type: "text", text }] }
}

function toolUse(functionId: string, name = "qna_respond"): ClineStorageMessage {
	return {
		role: "assistant",
		content: [
			{
				type: "tool_use",
				function_id: functionId,
				dline_tid: `tid-${functionId}`,
				name,
				input: {},
			},
		],
	}
}

function toolResult(functionId: string, text: string): ClineStorageMessage {
	return {
		role: "user",
		content: [
			{
				type: "tool_result",
				function_id: functionId,
				dline_tid: `tid-${functionId}`,
				content: [{ type: "text", text }],
			},
		],
	}
}

function serialized(messages: readonly ClineStorageMessage[]): string {
	return JSON.stringify(messages)
}

describe("logical turn indexing", () => {
	it("indexes ordinary user and assistant exchanges as stable complete turns", () => {
		const history = [
			textMessage("user", "<task>Turn A</task>"),
			textMessage("assistant", "Response A"),
			textMessage("user", "<user_message>Turn B</user_message>"),
			textMessage("assistant", "Response B"),
		]

		const result = indexLogicalTurns(history)

		expect(result.turns.map(({ startIndex, endIndex }) => [startIndex, endIndex])).toEqual([
			[0, 1],
			[2, 3],
		])
		expect(result.protectedTail).toEqual([])
		expect(result.issues).toEqual([])
	})

	it("keeps each assistant tool use and matching result in one atomic turn", () => {
		const history = [
			textMessage("user", "<task>Read the file</task>"),
			toolUse("call-read", "read_file"),
			toolResult("call-read", "File contents"),
			textMessage("assistant", "The file has been read."),
		]

		const result = indexLogicalTurns(history)

		expect(result.turns).toHaveLength(1)
		expect(result.turns[0]).toMatchObject({ startIndex: 0, endIndex: 3, functionIds: ["call-read"] })
		expect(serialized(result.turns[0].messages)).toContain("File contents")
		expect(result.protectedTail).toEqual([])
	})

	it("starts tagged Q&A feedback as the protected next round", () => {
		const history = [
			textMessage("user", "<task>Turn A</task>"),
			toolUse("call-a"),
			toolResult("call-a", "[qna_respond] Result:\n<feedback>Turn B request</feedback>"),
			toolUse("call-b"),
			toolResult("call-b", "[qna_respond] Result:\n<feedback>Turn C request</feedback>"),
		]

		const result = indexLogicalTurns(history)

		expect(result.turns.map(({ startIndex, endIndex, functionIds }) => ({ startIndex, endIndex, functionIds }))).toEqual([
			{ startIndex: 0, endIndex: 1, functionIds: ["call-a"] },
			{ startIndex: 2, endIndex: 3, functionIds: ["call-a", "call-b"] },
		])
		expect(result.protectedStartIndex).toBe(4)
		expect(result.protectedTail).toEqual([history[4]])
		expect(serialized(result.turns[0].messages)).not.toContain("Turn B request")
		expect(serialized(result.turns[1].messages)).toContain("Turn B request")
		expect(serialized(result.protectedTail)).toContain("Turn C request")
	})

	it("protects an incomplete tool-use tail instead of exposing it as a compressible turn", () => {
		const completeTurn = [textMessage("user", "<task>Complete</task>"), textMessage("assistant", "Complete response")]
		const incompleteTail = [
			textMessage("user", "<user_message>Pending</user_message>"),
			toolUse("call-pending", "write_to_file"),
		]

		const result = indexLogicalTurns([...completeTurn, ...incompleteTail])

		expect(result.turns).toHaveLength(1)
		expect(result.protectedStartIndex).toBe(2)
		expect(result.protectedTail).toEqual(incompleteTail)
		expect(result.issues).toEqual([{ kind: "unpaired_tool_use", messageIndex: 3, functionId: "call-pending" }])
	})

	it("closes a turn whose paired tool result is the final message", () => {
		const history = [
			textMessage("user", "<task>Ask a question</task>"),
			toolUse("call-a"),
			toolResult("call-a", "plain tool output without feedback tags"),
		]

		const result = indexLogicalTurns(history)

		expect(result.turns.map(({ startIndex, endIndex }) => [startIndex, endIndex])).toEqual([[0, 2]])
		expect(result.turns[0]).toMatchObject({ functionIds: ["call-a"] })
		expect(result.protectedTail).toEqual([])
		expect(result.issues).toEqual([])
	})

	it("protects an orphan result and reports its canonical function identity", () => {
		const orphan = toolResult("call-orphan", "orphan")
		const history: ClineStorageMessage[] = [
			textMessage("user", "<task>Complete</task>"),
			textMessage("assistant", "Complete response"),
			orphan,
		]

		const result = indexLogicalTurns(history)

		expect(result.turns).toHaveLength(1)
		expect(result.protectedTail).toEqual([orphan])
		expect(result.issues).toEqual([{ kind: "orphan_tool_result", messageIndex: 2, functionId: "call-orphan" }])
	})

	it("does not treat dynamic environment metadata as a user-authored turn", () => {
		const metadataOnly: ClineStorageMessage = {
			role: "user",
			content: [{ type: "text", text: "<environment_details>dynamic state</environment_details>" } satisfies ClineContent],
		}

		const result = indexLogicalTurns([metadataOnly])

		expect(result.turns).toEqual([])
		expect(result.protectedTail).toEqual([metadataOnly])
	})
})
