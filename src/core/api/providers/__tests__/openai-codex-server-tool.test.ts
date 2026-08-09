import { ServerTool } from "@shared/proto/dline/models/metadata"
import { ApiProfile } from "@shared/proto/dline/profile"
import { expect } from "chai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { afterEach, describe, it, vi } from "vitest"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { OpenAiCodexHandler } from "../openai-codex"

const localTools: ChatCompletionTool[] = [
	{
		type: "function",
		function: { name: "web_search", description: "Local search", parameters: { type: "object" } },
	},
	{
		type: "function",
		function: { name: "read_file", description: "Read a file", parameters: { type: "object" } },
	},
]

function createHandler(): OpenAiCodexHandler {
	return new OpenAiCodexHandler({
		profile: ApiProfile.create({ provider: "openai-codex", modelId: "gpt-5.6-sol" }),
		mode: "act",
	})
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
	const chunks: unknown[] = []
	for await (const chunk of stream) chunks.push(chunk)
	return chunks
}

describe("OpenAiCodexHandler hosted Web Search", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("declares hosted Web Search support for Responses models", () => {
		const handler = createHandler()

		expect(handler.supportsServerTool(ServerTool.WEB_SEARCH)).to.equal(true)
		expect(handler.supportsServerTool(ServerTool.SERVER_TOOL_UNSPECIFIED)).to.equal(false)
	})

	it("projects hosted Web Search through the public request boundary", async () => {
		const handler = createHandler()
		vi.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("access-token")
		let requestBody: Record<string, unknown> | undefined
		let fallbackRequestBody: Record<string, unknown> | undefined
		vi.spyOn(handler as any, "executeRequest").mockImplementation(async function* (...args: unknown[]) {
			requestBody = args[0] as Record<string, unknown>
			fallbackRequestBody = args[1] as Record<string, unknown>
		})

		await collect(
			handler.createMessage("system prompt", [{ role: "user", content: "Search" }], localTools, {
				serverTools: [ServerTool.WEB_SEARCH],
			}),
		)

		expect(requestBody?.tools).to.deep.equal([
			{ type: "function", name: "read_file", description: "Read a file", parameters: { type: "object" }, strict: true },
			{ type: "web_search" },
		])
		expect(requestBody?.include).to.deep.equal([
			"reasoning.encrypted_content",
			"web_search_call.results",
			"web_search_call.action.sources",
		])
		expect(fallbackRequestBody?.tools).to.deep.equal(requestBody?.tools)
		expect(fallbackRequestBody?.include).to.deep.equal(requestBody?.include)
	})

	it("projects hosted Web Search when no local functions are present", () => {
		const handler = createHandler()
		const body = (handler as any).buildRequestBody(handler.getModel(), [], "system", undefined, undefined, {
			serverTools: [ServerTool.WEB_SEARCH],
		}) as Record<string, unknown>

		expect(body.tools).to.deep.equal([{ type: "web_search" }])
	})

	it("keeps local Web Search when the hosted route was not selected", () => {
		const handler = createHandler()
		const body = (handler as any).buildRequestBody(handler.getModel(), [], "system", localTools) as {
			tools: Array<{ type: string; name?: string }>
		}

		expect(body.tools.filter((tool) => tool.type === "web_search")).to.have.length(0)
		expect(body.tools.filter((tool) => tool.name === "web_search")).to.have.length(1)
	})

	it("normalizes hosted lifecycle events from Codex Responses", async () => {
		const handler = createHandler()
		const processEvent = (handler as any).processEvent.bind(handler)
		const events = [
			{
				type: "response.output_item.added",
				item: { type: "web_search_call", id: "ws_1", action: { query: "Dline" } },
			},
			{ type: "response.web_search_call.in_progress", item_id: "ws_1" },
			{ type: "response.web_search_call.searching", item_id: "ws_1" },
			{ type: "response.web_search_call.completed", item_id: "ws_1" },
			{
				type: "response.output_item.done",
				item: {
					type: "web_search_call",
					id: "ws_1",
					status: "completed",
					action: { query: "Dline" },
					results: [{ title: "Dline result", url: "https://example.com/dline" }],
				},
			},
		]
		const chunks: unknown[] = []
		for (const event of events) {
			chunks.push(...((await collect(processEvent(event, handler.getModel()))) as unknown[]))
		}

		expect(chunks.filter((chunk: any) => chunk.type === "server_tool")).to.deep.include.members([
			{
				type: "server_tool",
				function_id: "ws_1",
				provider_metadata: { item_id: "ws_1" },
				tool: ServerTool.WEB_SEARCH,
				phase: "started",
				input: { query: "Dline" },
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
				result: {
					action: { query: "Dline" },
					results: [{ title: "Dline result", url: "https://example.com/dline" }],
				},
			},
		])
	})

	it("maps a failed output item to one failed hosted lifecycle event", async () => {
		const handler = createHandler()
		const chunks = await collect(
			(handler as any).processEvent(
				{
					type: "response.output_item.done",
					item: { type: "web_search_call", id: "ws_failed", status: "failed", action: { code: "search_failed" } },
				},
				handler.getModel(),
			),
		)

		expect(chunks).to.deep.equal([
			{
				type: "server_tool",
				function_id: "ws_failed",
				provider_metadata: { item_id: "ws_failed" },
				tool: ServerTool.WEB_SEARCH,
				phase: "failed",
				error: { code: "search_failed" },
			},
		])
	})

	it("sends hosted Web Search over WebSocket without the HTTP-only stream field", async () => {
		const handler = createHandler()
		const listeners = new Map<string, Set<(event: any) => void>>()
		let sent: Record<string, unknown> | undefined
		const socket = {
			addEventListener(type: string, listener: (event: any) => void) {
				const entries = listeners.get(type) ?? new Set()
				entries.add(listener)
				listeners.set(type, entries)
			},
			removeEventListener(type: string, listener: (event: any) => void) {
				listeners.get(type)?.delete(listener)
			},
			send(payload: string) {
				sent = JSON.parse(payload) as Record<string, unknown>
				queueMicrotask(() => {
					for (const listener of listeners.get("message") ?? []) {
						listener({ data: JSON.stringify({ type: "response.completed", response: {} }) })
					}
				})
			},
		}
		vi.spyOn(handler as any, "ensureResponsesWebsocket").mockResolvedValue(socket)

		await collect(
			(handler as any).createResponseEventsViaWebsocket(
				{ model: "gpt-5.6-sol", input: [], stream: true, tools: [{ type: "web_search" }] },
				"access-token",
				{},
			),
		)

		expect(sent).to.deep.include({ type: "response.create", model: "gpt-5.6-sol" })
		expect(sent?.tools).to.deep.equal([{ type: "web_search" }])
		expect(sent).not.to.have.property("stream")
	})
})
