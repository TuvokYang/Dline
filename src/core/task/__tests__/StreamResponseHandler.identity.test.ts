import { describe, expect, it } from "vitest"
import { StreamResponseHandler } from "../StreamResponseHandler"

describe("StreamResponseHandler identity propagation", () => {
	it("preserves canonical identities from stream delta to stored and runtime tool blocks", () => {
		const handler = new StreamResponseHandler(() => 123)
		const toolHandler = handler.getHandlers().toolUseHandler
		const identity = {
			item_id: "fc_item_123",
			function_id: "call_123",
			dline_tid: "dline_tid_123",
		}

		toolHandler.processToolUseDelta(
			{
				type: "tool_use",
				id: "call_123",
				name: "read_file",
				input: '{"path":"README.md"}',
			},
			identity,
		)

		const stored = toolHandler.getFinalizedToolUse("dline_tid_123")
		const runtime = toolHandler.getPartialToolUsesAsContent()[0]

		expect(stored).toMatchObject({
			id: "call_123",
			call_id: "call_123",
			item_id: "fc_item_123",
			function_id: "call_123",
			dline_tid: "dline_tid_123",
		})
		expect(runtime).toMatchObject({
			call_id: "call_123",
			item_id: "fc_item_123",
			function_id: "call_123",
			dline_tid: "dline_tid_123",
		})
	})
})
