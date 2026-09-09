import { mockFetchForTesting } from "@shared/net"
import { ServerTool } from "@shared/proto/dline/models/metadata"
import { ApiProfile } from "@shared/proto/dline/profile"
import { expect } from "chai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { afterEach, describe, it, vi } from "vitest"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { OutputLimitExceededError } from "../../stream/OutputLimitExceededError"
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
		profile: ApiProfile.create({ id: "profile-a", provider: "openai-codex", modelId: "gpt-5.6-sol" }),
		mode: "act",
		workspaceId: "workspace-a",
		ulid: "task-a",
	})
}

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
	const chunks: unknown[] = []
	for await (const chunk of stream) chunks.push(chunk)
	return chunks
}

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
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
		vi.spyOn(openAiCodexOAuthManager, "getCredentialContext").mockResolvedValue({
			accessToken: "access-token",
			expires: 1_900_000_000_000,
			accountId: "account-a",
		})
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

	it("uses stable workspace and task identity for every Codex transport", () => {
		const handler = createHandler()
		const headers = (handler as any).buildCodexHeaders({
			accessToken: "access-token",
			expires: 1_900_000_000_000,
			accountId: "account-a",
		}) as Record<string, string>

		expect(headers).to.deep.include({
			"session-id": "workspace-a",
			"thread-id": "task-a",
			"x-client-request-id": "task-a",
			"ChatGPT-Account-Id": "account-a",
		})
		expect(headers).not.to.have.property("session_id")
		expect(headers).not.to.have.property("conversation_id")
	})

	it("projects one automatic prompt cache key without explicit cache controls", () => {
		const handler = createHandler()
		const model = handler.getModel()
		const first = (handler as any).buildRequestBody(model, [], "stable system", localTools, undefined, {
			taskNamespace: "task-a",
		}) as Record<string, unknown>
		const appended = (handler as any).buildRequestBody(
			model,
			[{ role: "user", content: [] }],
			"stable system",
			localTools,
			undefined,
			{
				taskNamespace: "task-a",
			},
		) as Record<string, unknown>
		const otherTask = (handler as any).buildRequestBody(model, [], "stable system", localTools, undefined, {
			taskNamespace: "task-b",
		}) as Record<string, unknown>

		expect(first.prompt_cache_key).to.match(/^dline_cache_[0-9a-f]{32}$/)
		expect(appended.prompt_cache_key).to.equal(first.prompt_cache_key)
		expect(otherTask.prompt_cache_key).not.to.equal(first.prompt_cache_key)
		expect(first.prompt_cache_options).to.equal(undefined)
		expect(JSON.stringify(first)).not.to.contain("prompt_cache_breakpoint")
	})

	it("keeps a remotely discovered Codex model id instead of falling back to the bundled default", () => {
		const handler = new OpenAiCodexHandler({
			profile: ApiProfile.create({ id: "profile-remote", provider: "openai-codex", modelId: "gpt-codex-remote" }),
			mode: "act",
			workspaceId: "workspace-a",
			ulid: "task-a",
		})

		expect(handler.getModel()).to.deep.include({ id: "gpt-codex-remote" })
		expect(handler.getModel().info).to.deep.include({ id: "gpt-codex-remote" })
		expect(handler.getModel().info.capabilities?.supportsPromptCache).to.equal(true)
	})

	it("projects the request-scoped compaction cap into primary and fallback Responses bodies", () => {
		const handler = createHandler()
		const options = { generation: { purpose: "compaction", maxOutputTokens: 30_000 } } as any
		const body = (handler as any).buildRequestBody(
			handler.getModel(),
			[],
			"system",
			undefined,
			"response-id",
			options,
		) as Record<string, unknown>
		const fallback = (handler as any).buildRequestBody(
			handler.getModel(),
			[],
			"system",
			undefined,
			undefined,
			options,
		) as Record<string, unknown>

		expect(body.max_output_tokens).to.equal(30_000)
		expect(fallback.max_output_tokens).to.equal(30_000)
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

	it("surfaces Codex max_output_tokens as typed termination without HTTP fallback", async () => {
		const handler = createHandler()
		const responseStream = {
			async *[Symbol.asyncIterator]() {
				yield {
					type: "response.incomplete",
					response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
				}
			},
		}
		;(handler as any).client = { responses: { create: vi.fn().mockResolvedValue(responseStream) } }
		const fallback = vi.spyOn(handler as any, "makeCodexRequest").mockImplementation(async function* () {
			yield { type: "text", text: "unexpected fallback" }
		})

		let caught: unknown
		try {
			await collect(
				(handler as any).executeRequest(
					{},
					{},
					handler.getModel(),
					{ accessToken: "access-token", expires: 1_900_000_000_000 },
					false,
				),
			)
		} catch (error) {
			caught = error
		}

		expect(caught).to.be.instanceOf(OutputLimitExceededError)
		expect(caught).to.deep.include({ protocol: "openai_responses", reason: "max_output_tokens" })
		expect(fallback.mock.calls).to.have.length(0)
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

	it("cancels the HTTP response body when the consumer stops early", async () => {
		const handler = createHandler()
		const cancelBody = vi.fn()
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"hello"}\n\n'))
			},
			cancel: cancelBody,
		})

		for await (const _chunk of (handler as any).handleStreamResponse(body, handler.getModel())) break

		expect(cancelBody.mock.calls).to.have.length(1)
		expect(cancelBody.mock.calls[0]?.[0]).to.equal(undefined)
	})

	it("rejects a Codex handler without a stable Profile ID", () => {
		expect(
			() =>
				new OpenAiCodexHandler({
					profile: ApiProfile.create({ provider: "openai-codex", modelId: "gpt-5.6-sol" }),
					mode: "act",
				}),
		).to.throw("Profile ID")
	})

	it("passes one atomic credential context through the request transport", async () => {
		const handler = createHandler()
		const credential = { accessToken: "access-a", expires: 1_900_000_000_000, accountId: "account-a" }
		const getCredential = vi.spyOn(openAiCodexOAuthManager, "getCredentialContext").mockResolvedValue(credential)
		const execute = vi.spyOn(handler as any, "executeRequest").mockImplementation(async function* () {})

		await collect(handler.createMessage("system", [{ role: "user", content: "hello" }]))

		expect(getCredential.mock.calls).to.deep.equal([["profile-a"]])
		expect(execute.mock.calls[0]?.[3]).to.equal(credential)
	})

	it("replaces token and account ID together when retrying a 401", async () => {
		const handler = createHandler()
		const first = { accessToken: "access-a", expires: 1_900_000_000_000, accountId: "account-a" }
		const refreshed = { accessToken: "access-b", expires: 1_900_000_100_000, accountId: "account-b" }
		vi.spyOn(openAiCodexOAuthManager, "getCredentialContext").mockResolvedValue(first)
		const refresh = vi.spyOn(openAiCodexOAuthManager, "forceRefreshCredentialContext").mockResolvedValue(refreshed)
		const contexts: unknown[] = []
		vi.spyOn(handler as any, "executeRequest").mockImplementation(async function* (...args: unknown[]) {
			contexts.push(args[3])
			if (contexts.length === 1) throw Object.assign(new Error("request rejected"), { status: 401 })
		})

		await collect(handler.createMessage("system", [{ role: "user", content: "hello" }]))

		expect(refresh.mock.calls).to.deep.equal([["profile-a"]])
		expect(contexts).to.deep.equal([first, refreshed])
	})

	it("uses matching token and account ID snapshots for usage before and after a 401", async () => {
		const handler = createHandler()
		const first = { accessToken: "access-a", expires: 1_900_000_000_000, accountId: "account-a" }
		const refreshed = { accessToken: "access-b", expires: 1_900_000_100_000, accountId: "account-b" }
		vi.spyOn(openAiCodexOAuthManager, "getCredentialContext").mockResolvedValue(first)
		vi.spyOn(openAiCodexOAuthManager, "forceRefreshCredentialContext").mockResolvedValue(refreshed)
		const headers: Array<{ authorization: string | null; accountId: string | null }> = []
		const transport = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
			const requestHeaders = new Headers(init?.headers)
			headers.push({
				authorization: requestHeaders.get("Authorization"),
				accountId: requestHeaders.get("ChatGPT-Account-Id"),
			})
			return headers.length === 1
				? new Response(undefined, { status: 401 })
				: new Response(JSON.stringify({ credits: { balance: "9" } }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					})
		})

		const usage = await mockFetchForTesting(transport, () => handler.getAccountUsage())

		expect(usage?.remainingBalance).to.equal(9)
		expect(headers).to.deep.equal([
			{ authorization: "Bearer access-a", accountId: "account-a" },
			{ authorization: "Bearer access-b", accountId: "account-b" },
		])
	})

	it("aborts only when the active handler receives a mutation for its own Profile", async () => {
		const handler = createHandler()
		const gate = deferred<void>()
		const started = deferred<void>()
		vi.spyOn(openAiCodexOAuthManager, "getCredentialContext").mockResolvedValue({
			accessToken: "access-a",
			expires: 1_900_000_000_000,
			accountId: "account-a",
		})
		vi.spyOn(handler as any, "executeRequest").mockImplementation(async function* () {
			started.resolve()
			await gate.promise
		})
		const abort = vi.spyOn(handler, "abort")
		const request = collect(handler.createMessage("system", [{ role: "user", content: "hello" }]))
		await started.promise

		await (openAiCodexOAuthManager as any).publishRuntimeMutation("profile-b", "credential-cleared")
		expect(abort.mock.calls).to.have.length(0)
		await (openAiCodexOAuthManager as any).publishRuntimeMutation("profile-a", "credential-cleared")
		expect(abort.mock.calls).to.have.length(1)

		gate.resolve()
		await request
	})

	it("matches WebSocket reuse against both token and account ID", () => {
		const handler = createHandler()
		const first = { accessToken: "access-a", expires: 1_900_000_000_000, accountId: "account-a" }

		expect((handler as any).isSameCredentialContext(first, { ...first })).to.equal(true)
		expect((handler as any).isSameCredentialContext(first, { ...first, accessToken: "access-b" })).to.equal(false)
		expect((handler as any).isSameCredentialContext(first, { ...first, accountId: "account-b" })).to.equal(false)
	})

	it("does not expose raw provider errors from the request boundary", async () => {
		const handler = createHandler()
		const secret = "access_token=secret-token&account_payload=secret-account"
		vi.spyOn(openAiCodexOAuthManager, "getCredentialContext").mockResolvedValue({
			accessToken: "access-a",
			expires: 1_900_000_000_000,
			accountId: "account-a",
		})
		vi.spyOn(handler as any, "executeRequest").mockImplementation(async function* () {
			throw Object.assign(new Error(secret), { status: 500, code: "provider_failure" })
		})

		const error = await collect(handler.createMessage("system", [{ role: "user", content: "hello" }])).catch(
			(caught: unknown) => caught,
		)

		expect(String(error)).not.to.contain(secret)
		expect(error).to.deep.include({ status: 500, code: "provider_failure" })
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
				{ accessToken: "access-token", expires: 1_900_000_000_000 },
				{},
			),
		)

		expect(sent).to.deep.include({ type: "response.create", model: "gpt-5.6-sol" })
		expect(sent?.tools).to.deep.equal([{ type: "web_search" }])
		expect(sent).not.to.have.property("stream")
	})
})
