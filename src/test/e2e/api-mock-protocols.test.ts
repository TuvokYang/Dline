import { expect } from "@playwright/test"
import OpenAI from "openai"
import { ToolCallProcessor } from "../../core/api/transform/tool-call-processor"
import type { MockApiConsumption, MockTokenUsage } from "./fixtures/server"
import { getE2EMockProviderBaseUrl, getE2EMockProviderUrl } from "./fixtures/server/api"
import { e2e } from "./utils/helpers"

function usageOf(consumption: MockApiConsumption): MockTokenUsage {
	if (!consumption.usage) throw new Error(`Missing usage for ${consumption.target}`)
	return consumption.usage
}

function totalInputTokens(usage: MockTokenUsage): number {
	return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

function expectDerivedUsage(consumption: MockApiConsumption, responseText: string, reasoning: string): MockTokenUsage {
	const usage = usageOf(consumption)
	const inputBytes = Buffer.byteLength(JSON.stringify(consumption.requestBody), "utf8")
	const outputBytes = Buffer.byteLength(`${reasoning}\n${responseText}`, "utf8")
	const measuredInput = totalInputTokens(usage)
	expect(measuredInput).toBeGreaterThanOrEqual(Math.ceil(inputBytes / 5))
	expect(measuredInput).toBeLessThanOrEqual(Math.ceil(inputBytes / 3))
	expect(usage.outputTokens).toBeGreaterThanOrEqual(Math.ceil(outputBytes / 5))
	expect(usage.outputTokens).toBeLessThanOrEqual(Math.ceil(outputBytes / 3))
	expect(usage.inputTokens).toBeGreaterThan(0)
	expect(usage.cacheWriteTokens ?? 0).toBeGreaterThan(0)
	expect(usage.cacheReadTokens).toBe(0)
	return usage
}

async function post(url: string, body: unknown, anthropic = false): Promise<Response> {
	return fetch(url, {
		method: "POST",
		headers: anthropic
			? { "content-type": "application/json", "x-api-key": "dline-e2e-api-key", "anthropic-version": "2023-06-01" }
			: { authorization: "Bearer dline-e2e-api-key", "content-type": "application/json" },
		body: JSON.stringify(body),
	})
}

e2e("Mock API - OpenAI SDK and Dline parser preserve standard streamed function calls", async ({ server }) => {
	server.resetOpenAiMock()
	server.enqueueResponses("openai-compatible-chat", {
		type: "tool",
		name: "read_file",
		arguments: { path: "README.md" },
	})
	const client = new OpenAI({
		apiKey: "dline-e2e-api-key",
		baseURL: getE2EMockProviderBaseUrl(server.baseUrl, "openai-compatible-chat"),
	})
	const stream = await client.chat.completions.create({
		model: "dline-e2e-model",
		stream: true,
		messages: [{ role: "user", content: "Read README.md" }],
		tools: [
			{
				type: "function",
				function: {
					name: "read_file",
					description: "Read a project file",
					parameters: {
						type: "object",
						properties: { path: { type: "string" } },
						required: ["path"],
					},
				},
			},
		],
	})

	const processor = new ToolCallProcessor()
	const parsedTools = []
	for await (const chunk of stream) {
		const delta = chunk.choices[0]?.delta
		parsedTools.push(...processor.processToolCallDeltas(delta?.tool_calls))
	}

	expect(parsedTools).toHaveLength(1)
	expect(parsedTools[0]).toMatchObject({
		type: "tool_calls",
		tool_call: {
			function: { name: "read_file", arguments: JSON.stringify({ path: "README.md" }) },
		},
	})
})

e2e("Mock API - emits parallel tool calls with stable identities for every protocol", async ({ server }) => {
	const tools = [
		{ id: "call_parallel_read", name: "read_file", arguments: { path: "README.md" } },
		{
			id: "call_parallel_write",
			name: "write_to_file",
			arguments: { path: "parallel-write.txt", content: "parallel write\n" },
		},
		{
			id: "call_parallel_replace",
			name: "replace_in_file",
			arguments: {
				path: "parallel-replace.txt",
				diff: "------- SEARCH\nbefore\n=======\nafter\n+++++++ REPLACE",
			},
		},
		{
			id: "call_parallel_command",
			name: "execute_command",
			arguments: { command: "echo parallel", workdirectory: ".", requires_approval: false },
		},
	] as const
	const targets = [
		"openai-compatible-chat",
		"openai-compatible-responses",
		"openai-official-responses",
		"deepseek-chat",
		"anthropic-messages",
	] as const
	server.resetOpenAiMock()
	for (const target of targets) server.enqueueResponses(target, { type: "tools", tools })

	const requests = [
		post(getE2EMockProviderUrl(server.baseUrl, "openai-compatible-chat"), {
			model: "dline-e2e-model",
			stream: true,
			messages: [{ role: "user", content: "parallel tools" }],
		}),
		post(getE2EMockProviderUrl(server.baseUrl, "openai-compatible-responses"), {
			model: "dline-e2e-model",
			stream: true,
			input: "parallel tools",
		}),
		post(getE2EMockProviderUrl(server.baseUrl, "openai-official-responses"), {
			model: "gpt-5.4-mini",
			stream: true,
			input: "parallel tools",
		}),
		post(getE2EMockProviderUrl(server.baseUrl, "deepseek-chat"), {
			model: "deepseek-v4-flash",
			stream: true,
			messages: [{ role: "user", content: "parallel tools" }],
		}),
		post(
			getE2EMockProviderUrl(server.baseUrl, "anthropic-messages"),
			{
				model: "claude-sonnet-4-6",
				max_tokens: 8192,
				stream: true,
				messages: [{ role: "user", content: "parallel tools" }],
			},
			true,
		),
	]
	const responses = await Promise.all(requests)

	for (const response of responses) {
		expect(response.status).toBe(200)
		const body = await response.text()
		for (const tool of tools) {
			expect(body).toContain(tool.id)
			expect(body).toContain(tool.name)
		}
	}
	for (const target of targets) {
		const [consumption] = server.getMockConsumptions(target)
		expect(consumption).toMatchObject({ responseType: "tools", responseToolCalls: tools })
	}
})

e2e("Mock API - isolates provider endpoints and emits protocol-native usage", async ({ server }) => {
	const responses = {
		chat: { text: "chat protocol response", hiddenReasoning: "chat protocol hidden reasoning" },
		compatible: {
			text: "compatible responses protocol response",
			reasoning: "compatible responses protocol thinking",
		},
		native: { text: "native responses protocol response", reasoning: "native responses protocol thinking" },
		deepseek: { text: "deepseek protocol response", reasoning: "deepseek reasoning content" },
		anthropic: { text: "anthropic protocol response", reasoning: "anthropic protocol thinking" },
	}
	server.resetOpenAiMock()
	server.enqueueResponses("openai-compatible-chat", {
		type: "message",
		text: responses.chat.text,
		hiddenReasoning: responses.chat.hiddenReasoning,
	})
	server.enqueueResponses("openai-compatible-responses", {
		type: "message",
		...responses.compatible,
	})
	server.enqueueResponses("openai-official-responses", {
		type: "message",
		...responses.native,
	})
	server.enqueueResponses("deepseek-chat", {
		type: "message",
		...responses.deepseek,
	})
	server.enqueueResponses("anthropic-messages", {
		type: "message",
		...responses.anthropic,
	})

	const chat = await post(getE2EMockProviderUrl(server.baseUrl, "openai-compatible-chat"), {
		model: "dline-e2e-model",
		stream: true,
		enable_thinking: true,
		reasoning_effort: "high",
		messages: [{ role: "user", content: "chat" }],
	})
	expect(chat.status).toBe(200)
	const chatBody = await chat.text()
	expect(chatBody).toContain(responses.chat.text)
	expect(chatBody).not.toContain(responses.chat.hiddenReasoning)

	const compatibleResponses = await post(getE2EMockProviderUrl(server.baseUrl, "openai-compatible-responses"), {
		model: "gpt-5.4-mini",
		stream: true,
		reasoning: { effort: "high", summary: "auto" },
		input: "responses",
	})
	expect(compatibleResponses.status).toBe(200)
	const compatibleResponsesBody = await compatibleResponses.text()
	expect(compatibleResponsesBody).toContain("response.output_text.delta")
	expect(compatibleResponsesBody).toContain(responses.compatible.text)
	expect(compatibleResponsesBody).toContain(responses.compatible.reasoning)

	const officialResponses = await post(getE2EMockProviderUrl(server.baseUrl, "openai-official-responses"), {
		model: "gpt-5.4-mini",
		stream: true,
		reasoning: { effort: "high", summary: "auto" },
		input: "responses",
	})
	expect(officialResponses.status).toBe(200)
	const officialResponsesBody = await officialResponses.text()
	expect(officialResponsesBody).toContain(responses.native.text)
	expect(officialResponsesBody).toContain(responses.native.reasoning)

	const deepseek = await post(getE2EMockProviderUrl(server.baseUrl, "deepseek-chat"), {
		model: "deepseek-v4-flash",
		stream: true,
		thinking: { type: "enabled" },
		reasoning_effort: "high",
		messages: [{ role: "user", content: "deepseek" }],
	})
	expect(deepseek.status).toBe(200)
	const deepseekBody = await deepseek.text()
	expect(deepseekBody).toContain(responses.deepseek.text)
	expect(deepseekBody).toContain(`"reasoning_content":"${responses.deepseek.reasoning}"`)

	const anthropic = await post(
		getE2EMockProviderUrl(server.baseUrl, "anthropic-messages"),
		{
			model: "claude-sonnet-4-6",
			max_tokens: 8192,
			stream: true,
			thinking: { type: "enabled", budget_tokens: 2048 },
			messages: [{ role: "user", content: "anthropic" }],
		},
		true,
	)
	expect(anthropic.status).toBe(200)
	const anthropicBody = await anthropic.text()
	expect(anthropicBody).toContain("content_block_delta")
	expect(anthropicBody).toContain(responses.anthropic.text)
	expect(anthropicBody).toContain(responses.anthropic.reasoning)

	expect(server.getRequestCount("openai-compatible-chat")).toBe(1)
	expect(server.getRequestCount("openai-compatible-responses")).toBe(1)
	expect(server.getRequestCount("openai-official-responses")).toBe(1)
	expect(server.getRequestCount("deepseek-chat")).toBe(1)
	expect(server.getRequestCount("anthropic-messages")).toBe(1)
	const consumptions = server.getMockConsumptions()
	expect(consumptions.map(({ target, thinking }) => ({ target, thinking }))).toEqual([
		{ target: "openai-compatible-chat", thinking: { mode: "effort", effort: "high" } },
		{ target: "openai-compatible-responses", thinking: { mode: "effort", effort: "high" } },
		{ target: "openai-official-responses", thinking: { mode: "effort", effort: "high" } },
		{ target: "deepseek-chat", thinking: { mode: "effort", effort: "high" } },
		{ target: "anthropic-messages", thinking: { mode: "budget", budget: 2048 } },
	])
	const chatUsage = expectDerivedUsage(consumptions[0], responses.chat.text, responses.chat.hiddenReasoning)
	const compatibleUsage = expectDerivedUsage(consumptions[1], responses.compatible.text, responses.compatible.reasoning)
	const nativeUsage = expectDerivedUsage(consumptions[2], responses.native.text, responses.native.reasoning)
	const deepseekUsage = expectDerivedUsage(consumptions[3], responses.deepseek.text, responses.deepseek.reasoning)
	const anthropicUsage = expectDerivedUsage(consumptions[4], responses.anthropic.text, responses.anthropic.reasoning)

	for (const [body, usage, inputKey] of [
		[chatBody, chatUsage, "prompt_tokens"],
		[compatibleResponsesBody, compatibleUsage, "input_tokens"],
		[officialResponsesBody, nativeUsage, "input_tokens"],
		[deepseekBody, deepseekUsage, "prompt_tokens"],
	] as const) {
		expect(body).toContain(`"${inputKey}":${totalInputTokens(usage)}`)
		expect(body).toContain(`"cached_tokens":${usage.cacheReadTokens ?? 0}`)
		expect(body).toContain(`"cache_miss_tokens":${usage.cacheWriteTokens ?? 0}`)
	}
	expect(chatBody).toContain(`"completion_tokens":${chatUsage.outputTokens}`)
	expect(chatBody).toContain(`"reasoning_tokens":${chatUsage.reasoningTokens}`)
	expect(compatibleResponsesBody).toContain(`"output_tokens":${compatibleUsage.outputTokens}`)
	expect(officialResponsesBody).toContain(`"output_tokens":${nativeUsage.outputTokens}`)
	expect(deepseekBody).toContain(`"completion_tokens":${deepseekUsage.outputTokens}`)
	expect(deepseekBody).toContain(`"prompt_cache_hit_tokens":${deepseekUsage.cacheReadTokens ?? 0}`)
	expect(deepseekBody).toContain(`"prompt_cache_miss_tokens":${deepseekUsage.cacheWriteTokens ?? 0}`)
	expect(anthropicBody).toContain(`"input_tokens":${anthropicUsage.inputTokens}`)
	expect(anthropicBody).toContain(`"output_tokens":${anthropicUsage.outputTokens}`)
	expect(anthropicBody).toContain(`"cache_creation_input_tokens":${anthropicUsage.cacheWriteTokens ?? 0}`)
	expect(anthropicBody).toContain(`"cache_read_input_tokens":${anthropicUsage.cacheReadTokens ?? 0}`)
})

e2e("Mock API - scripts 403, 429, and 502 responses and records their consumption", async ({ server }) => {
	server.resetOpenAiMock()
	server.enqueueResponses(
		"openai-compatible-chat",
		{ type: "error", status: 403, code: "forbidden", message: "E2E_HTTP_403" },
		{ type: "error", status: 429, code: "rate_limit", message: "E2E_HTTP_429" },
		{ type: "error", status: 502, code: "bad_gateway", message: "E2E_HTTP_502" },
	)

	for (const status of [403, 429, 502]) {
		const response = await post(getE2EMockProviderUrl(server.baseUrl, "openai-compatible-chat"), {
			model: "dline-e2e-model",
			stream: true,
			messages: [{ role: "user", content: "error" }],
		})
		expect(response.status).toBe(status)
		expect(await response.text()).toContain(`E2E_HTTP_${status}`)
	}

	expect(server.getMockConsumptions("openai-compatible-chat").map((entry) => entry.status)).toEqual([403, 429, 502])
})

e2e("Mock API - rejects a scripted response when the required tool result contract is not met", async ({ server }) => {
	server.resetOpenAiMock()
	server.enqueueResponses("openai-compatible-chat", {
		type: "message",
		text: "This response must not be emitted",
		expectedToolResults: [{ callId: "call_required", contentIncludes: "EXPECTED_RESULT_MARKER" }],
	})

	const response = await post(getE2EMockProviderUrl(server.baseUrl, "openai-compatible-chat"), {
		model: "dline-e2e-model",
		stream: true,
		messages: [
			{ role: "assistant", tool_calls: [{ id: "call_required", type: "function" }] },
			{ role: "tool", tool_call_id: "call_required", content: "WRONG_RESULT_MARKER" },
		],
	})

	expect(response.status).toBe(500)
	const body = await response.text()
	expect(body).toContain("e2e_tool_result_contract_failed")
	expect(body).toContain("EXPECTED_RESULT_MARKER")
	const consumptions = server.getMockConsumptions("openai-compatible-chat")
	expect(consumptions).toHaveLength(1)
	expect(consumptions[0].requestToolResults).toEqual([{ callId: "call_required", content: "WRONG_RESULT_MARKER" }])
	expect(consumptions[0].contractError).toContain("EXPECTED_RESULT_MARKER")
})

e2e("Mock API - rejects provider-incompatible authentication and request shapes", async ({ server }) => {
	server.resetOpenAiMock()

	const anthropicWithBearer = await post(getE2EMockProviderUrl(server.baseUrl, "anthropic-messages"), {
		model: "claude-sonnet-4-6",
		max_tokens: 128,
		messages: [{ role: "user", content: "test" }],
	})
	expect(anthropicWithBearer.status).toBe(401)

	const openAiWithAnthropicHeaders = await post(
		getE2EMockProviderUrl(server.baseUrl, "openai-compatible-chat"),
		{ model: "dline-e2e-model", messages: [{ role: "user", content: "test" }] },
		true,
	)
	expect(openAiWithAnthropicHeaders.status).toBe(401)

	const chatBodyOnResponsesEndpoint = await post(getE2EMockProviderUrl(server.baseUrl, "openai-compatible-responses"), {
		model: "dline-e2e-model",
		messages: [{ role: "user", content: "test" }],
	})
	expect(chatBodyOnResponsesEndpoint.status).toBe(400)
	expect(server.getMockConsumptions()).toHaveLength(0)
})
