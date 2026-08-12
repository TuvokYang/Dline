import { ServerTool } from "@shared/proto/dline/models/metadata"
import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it } from "vitest"
import { CompactionRequestReplay } from "./CompactionRequestReplay"

const declaration = {
	type: "summarize_task" as const,
	source: "auto_compaction" as const,
	targetTool: ClineDefaultTool.SUMMARIZE_TASK,
}

function createProviderInput(summaryMarker: string) {
	return {
		systemPrompt: "system prompt",
		messages: [{ role: "user" as const, content: [{ type: "text" as const, text: summaryMarker }] }],
		tools: [
			{
				type: "function" as const,
				function: {
					name: "attempt_completion",
					description: "Complete the task",
					parameters: { type: "object", properties: {} },
				},
			},
		],
		serverTools: [ServerTool.WEB_SEARCH],
	}
}

describe("CompactionRequestReplay", () => {
	it("locks the first provider input and returns detached copies", () => {
		const replay = new CompactionRequestReplay()
		replay.begin(4, 3, declaration)
		const first = createProviderInput("original compaction request")
		const captured = replay.captureProviderInput(4, first)

		first.systemPrompt = "mutated source"
		const firstContent = first.messages[0]?.content
		const capturedContent = captured.messages[0]?.content
		const firstText = Array.isArray(firstContent) ? firstContent[0] : undefined
		const capturedText = Array.isArray(capturedContent) ? capturedContent[0] : undefined
		if (firstText?.type !== "text" || capturedText?.type !== "text") {
			throw new Error("Expected text-backed compaction messages")
		}
		firstText.text = "mutated source message"
		capturedText.text = "mutated returned message"

		const replacement = createProviderInput("later dynamic request")
		replay.captureProviderInput(4, replacement)

		expect(replay.getProviderInput(4)).toEqual(createProviderInput("original compaction request"))
	})

	it("isolates replay state by API index and preserves the physical history boundary", () => {
		const replay = new CompactionRequestReplay()
		replay.begin(7, 5, declaration)
		replay.captureProviderInput(7, createProviderInput("request seven"))

		expect(replay.getProviderInput(6)).toBeUndefined()
		expect(replay.getDeclaration(6)).toBeUndefined()
		expect(replay.getHistoryIndex(6)).toBeUndefined()
		expect(replay.getHistoryIndex(7)).toBe(5)
		replay.clear(6)
		expect(replay.getProviderInput(7)).toBeDefined()
		replay.clear(7)
		expect(replay.getProviderInput(7)).toBeUndefined()
		expect(replay.getHistoryIndex(7)).toBeUndefined()
	})

	it("returns a detached authorization declaration for persisted request replay", () => {
		const replay = new CompactionRequestReplay()
		replay.begin(9, 4, { ...declaration, metadata: { origin: "pressure" } })

		const first = replay.getDeclaration(9)
		expect(first).toEqual({ ...declaration, metadata: { origin: "pressure" } })
		if (first?.metadata) {
			;(first.metadata as Record<string, string>).origin = "mutated"
		}
		expect(replay.getDeclaration(9)).toEqual({ ...declaration, metadata: { origin: "pressure" } })
	})

	it("rejects provider input capture outside the active request", () => {
		const replay = new CompactionRequestReplay()
		replay.begin(2, 1, declaration)

		expect(() => replay.captureProviderInput(3, createProviderInput("wrong request"))).toThrow(
			"Compaction replay is not active for apiIndex=3",
		)
	})
})
