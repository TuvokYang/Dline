import { expect } from "chai"
import { describe, it } from "vitest"
import { ServerTool } from "@/shared/proto/dline/models/metadata"
import { handleResponsesApiStreamResponse } from "../responses_api_support"

const createAsyncIterable = (events: any[]) =>
	({
		async *[Symbol.asyncIterator]() {
			for (const event of events) {
				yield event
			}
		},
	}) as any

async function collectChunks(events: any[]) {
	const chunks: any[] = []
	for await (const chunk of handleResponsesApiStreamResponse(
		createAsyncIterable(events),
		{ id: "test-model" },
		async () => 0,
	)) {
		chunks.push(chunk)
	}
	return chunks
}

describe("responses_api_support hosted tools", () => {
	it("emits the complete web_search_call lifecycle without local tool_calls", async () => {
		const startedAction = { type: "search", query: "Dline" }
		const completedAction = {
			type: "search",
			query: "Dline",
			sources: [{ type: "url", url: "https://example.com/result" }],
		}
		const chunks = await collectChunks([
			{
				type: "response.output_item.added",
				output_index: 0,
				sequence_number: 1,
				item: { type: "web_search_call", id: "ws_1", status: "in_progress", action: startedAction },
			},
			{ type: "response.web_search_call.in_progress", item_id: "ws_1", output_index: 0, sequence_number: 2 },
			{ type: "response.web_search_call.searching", item_id: "ws_1", output_index: 0, sequence_number: 3 },
			{ type: "response.web_search_call.completed", item_id: "ws_1", output_index: 0, sequence_number: 4 },
			{
				type: "response.output_item.done",
				output_index: 0,
				sequence_number: 5,
				item: { type: "web_search_call", id: "ws_1", status: "completed", action: completedAction },
			},
		])

		expect(chunks).to.deep.equal([
			{
				type: "server_tool",
				function_id: "ws_1",
				provider_metadata: { item_id: "ws_1" },
				tool: ServerTool.WEB_SEARCH,
				phase: "started",
				input: startedAction,
			},
			{
				type: "server_tool",
				function_id: "ws_1",
				provider_metadata: { item_id: "ws_1" },
				tool: ServerTool.WEB_SEARCH,
				phase: "in_progress",
			},
			{
				type: "server_tool",
				function_id: "ws_1",
				provider_metadata: { item_id: "ws_1" },
				tool: ServerTool.WEB_SEARCH,
				phase: "searching",
			},
			{
				type: "server_tool",
				function_id: "ws_1",
				provider_metadata: { item_id: "ws_1" },
				tool: ServerTool.WEB_SEARCH,
				phase: "completed",
			},
			{
				type: "server_tool",
				function_id: "ws_1",
				provider_metadata: { item_id: "ws_1" },
				tool: ServerTool.WEB_SEARCH,
				phase: "completed",
				result: completedAction,
			},
		])
		expect(chunks.some((chunk) => chunk.type === "tool_calls")).to.equal(false)
	})

	it("emits a failed server_tool event for a failed web_search_call item", async () => {
		const action = { type: "search", query: "Dline" }
		const chunks = await collectChunks([
			{
				type: "response.output_item.done",
				output_index: 0,
				sequence_number: 1,
				item: { type: "web_search_call", id: "ws_error", status: "failed", action },
			},
		])

		expect(chunks).to.deep.equal([
			{
				type: "server_tool",
				function_id: "ws_error",
				provider_metadata: { item_id: "ws_error" },
				tool: ServerTool.WEB_SEARCH,
				phase: "failed",
				error: action,
			},
		])
	})
})
