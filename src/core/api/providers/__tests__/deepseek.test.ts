import { ApiFormat } from "@shared/proto/dline/models/metadata"
import { ApiProfile } from "@shared/proto/dline/profile"
import { BaseProviderConfig } from "@shared/proto/dline/provider/common"
import { expect } from "chai"
import { afterEach, describe, it, vi } from "vitest"
import type { ClineStorageMessage } from "@/shared/messages/content"
import { DeepSeekHandler } from "../deepseek"

interface StreamChunk {
	choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>
	usage?: {
		prompt_tokens?: number
		completion_tokens?: number
		prompt_cache_hit_tokens?: number
		prompt_cache_miss_tokens?: number
	}
}

interface FakeClient {
	chat: {
		completions: {
			create: ReturnType<typeof vi.fn>
		}
	}
}

/**
 * Create an async iterable for mocked streaming responses.
 *
 * @param data Stream chunks to yield.
 * @returns Async iterable yielding provided chunks.
 */
function createStream(data: readonly StreamChunk[] = []): AsyncIterable<StreamChunk> {
	return {
		// Yield mocked OpenAI stream chunks in call order.
		[Symbol.asyncIterator]: async function* streamChunks() {
			yield* data
		},
	}
}

/**
 * Collect all chunks emitted by a DeepSeek handler request.
 *
 * @param handler DeepSeek handler under test.
 * @returns Stream chunks emitted by createMessage.
 */
async function collectChunks(handler: DeepSeekHandler): Promise<unknown[]> {
	const chunks: unknown[] = []
	for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
		chunks.push(chunk)
	}
	return chunks
}

describe("DeepSeekHandler", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("createMessage", () => {
		it("routes a profile-selected Responses request through the DeepSeek Responses client", async () => {
			const profile = ApiProfile.create({
				provider: "deepseek",
				apiKey: "test-api-key",
				modelId: "deepseek-v4-flash",
				deepseek: BaseProviderConfig.create({ apiFormat: ApiFormat.OPENAI_RESPONSES }),
			})
			const handler = new DeepSeekHandler({ profile, mode: "act" })
			const chatCreate = vi.fn().mockResolvedValue(createStream())
			const responsesCreate = vi.fn().mockResolvedValue(createStream())
			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				chat: { completions: { create: chatCreate } },
				responses: { create: responsesCreate },
			})

			await collectChunks(handler)

			expect(responsesCreate.mock.calls).to.have.length(1)
			expect(chatCreate.mock.calls).to.have.length(0)
			const request = responsesCreate.mock.calls[0]?.[0]
			expect(request).to.deep.include({ model: "deepseek-v4-flash", stream: true, instructions: "system" })
			expect(request).not.to.have.property("previous_response_id")
			expect(request).not.to.have.property("store")
		})

		it("projects canonical function identities into DeepSeek Responses history without provider IDs", async () => {
			const profile = ApiProfile.create({
				provider: "deepseek",
				apiKey: "test-api-key",
				modelId: "deepseek-v4-flash",
				deepseek: BaseProviderConfig.create({ apiFormat: ApiFormat.OPENAI_RESPONSES }),
			})
			const handler = new DeepSeekHandler({ profile, mode: "act" })
			const responsesCreate = vi.fn().mockResolvedValue(createStream())
			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				responses: { create: responsesCreate },
			})
			const history: ClineStorageMessage[] = [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							function_id: "call_read_1",
							dline_tid: "dline_tid_read_1",
							name: "read_file",
							input: { path: "README.md" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							function_id: "call_read_1",
							dline_tid: "dline_tid_read_1",
							content: "file contents",
						},
					],
				},
			]

			for await (const _chunk of handler.createMessage("system", history)) {
				// Empty mocked stream.
			}

			const input = responsesCreate.mock.calls[0]?.[0]?.input
			expect(input).to.deep.equal([
				{
					type: "function_call",
					call_id: "call_read_1",
					name: "read_file",
					arguments: '{"path":"README.md"}',
				},
				{ type: "function_call_output", call_id: "call_read_1", output: "file contents" },
			])
			expect(JSON.stringify(input)).not.to.match(/dline_tid|item_id|tool_use_id/)
		})

		it("routes a profile-selected Anthropic request through /anthropic with effort output_config", async () => {
			const profile = ApiProfile.create({
				provider: "deepseek",
				apiKey: "test-api-key",
				baseUrl: "https://api.deepseek.com/",
				modelId: "deepseek-v4-pro",
				deepseek: BaseProviderConfig.create({
					apiFormat: ApiFormat.ANTHROPIC_CHAT,
					reasoning: { effort: "max" },
				}),
			})
			const handler = new DeepSeekHandler({ profile, mode: "act" })
			const messagesCreate = vi.fn().mockResolvedValue(createStream())
			;(handler as unknown as { anthropicClient?: unknown }).anthropicClient = {
				messages: { create: messagesCreate },
			}
			vi.spyOn(handler as unknown as { ensureClient: () => FakeClient }, "ensureClient").mockReturnValue({
				chat: { completions: { create: vi.fn().mockResolvedValue(createStream()) } },
			})

			await collectChunks(handler)

			expect(messagesCreate.mock.calls).to.have.length(1)
			expect(messagesCreate.mock.calls[0]?.[0]).to.deep.include({
				model: "deepseek-v4-pro",
				stream: true,
				output_config: { effort: "max" },
			})
			expect((handler as unknown as { getAnthropicBaseUrl: () => string }).getAnthropicBaseUrl()).to.equal(
				"https://api.deepseek.com/anthropic",
			)
		})

		for (const [configuredEffort, expectedEffort] of [
			["high", "high"],
			["max", "max"],
			["xhigh", "max"],
		] as const) {
			it(`normalizes ${configuredEffort} thinking effort to ${expectedEffort}`, async () => {
				const handler = new DeepSeekHandler({
					profile: ApiProfile.create({
						provider: "deepseek",
						apiKey: "test-api-key",
						modelId: "deepseek-v4-pro",
						deepseek: BaseProviderConfig.create({ reasoning: { effort: configuredEffort } }),
					}),
					mode: "act",
				})
				const create = vi.fn().mockResolvedValue(createStream())
				vi.spyOn(handler as unknown as { ensureClient: () => FakeClient }, "ensureClient").mockReturnValue({
					chat: { completions: { create } },
				})

				await collectChunks(handler)

				expect(create.mock.calls[0]?.[0]?.reasoning_effort).to.equal(expectedEffort)
			})
		}

		it("reports non-cached input tokens separately from DeepSeek cache tokens", async () => {
			const handler = new DeepSeekHandler({
				profile: ApiProfile.create({
					provider: "deepseek",
					apiKey: "test-api-key",
					modelId: "deepseek-v4-pro",
				}),
				mode: "act",
			})
			const fakeClient: FakeClient = {
				chat: {
					completions: {
						create: vi.fn().mockResolvedValue(
							createStream([
								{
									choices: [{}],
									usage: {
										prompt_tokens: 1_000,
										completion_tokens: 25,
										prompt_cache_hit_tokens: 900,
										prompt_cache_miss_tokens: 50,
									},
								},
							]),
						),
					},
				},
			}
			vi.spyOn(handler as unknown as { ensureClient: () => FakeClient }, "ensureClient").mockReturnValue(fakeClient)

			const chunks = await collectChunks(handler)

			expect(chunks).to.deep.equal([
				{
					type: "usage",
					inputTokens: 50,
					outputTokens: 25,
					cacheWriteTokens: 50,
					cacheReadTokens: 900,
					totalCost: 0.00047250000000000005,
				},
			])
		})

		it("passes an AbortSignal to the SDK and aborts an in-flight request", async () => {
			const handler = new DeepSeekHandler({
				profile: ApiProfile.create({ provider: "deepseek", apiKey: "test-api-key", modelId: "deepseek-v4-pro" }),
				mode: "act",
			})
			let requestSignal: AbortSignal | undefined
			const create = vi.fn().mockImplementation((_body, options) => {
				requestSignal = options.signal
				return new Promise((_resolve, reject) => {
					requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason), { once: true })
				})
			})
			const fakeClient: FakeClient = { chat: { completions: { create } } }
			vi.spyOn(handler as unknown as { ensureClient: () => FakeClient }, "ensureClient").mockReturnValue(fakeClient)

			const request = collectChunks(handler)
			await vi.waitFor(() => expect(create.mock.calls).to.have.length(1))
			handler.abort()

			let rejected = false
			try {
				await request
			} catch {
				rejected = true
			}
			expect(rejected).to.equal(true)
			expect(requestSignal?.aborted).to.equal(true)
		})
	})

	it("uses model metadata supplied by the profile registry", () => {
		const modelInfo = {
			id: "deepseek-dynamic",
			name: "DeepSeek Dynamic",
			capabilities: { maxTokens: 12_345, supportsReasoning: true },
		}
		const handler = new DeepSeekHandler({
			profile: ApiProfile.create({
				provider: "deepseek",
				modelId: "deepseek-dynamic",
				modelInfo: modelInfo as NonNullable<ApiProfile["modelInfo"]>,
			}),
			mode: "act",
		})

		const resolved = handler.getModel()
		expect(resolved.id).to.equal("deepseek-dynamic")
		expect(resolved.info.id).to.equal("deepseek-dynamic")
		expect(resolved.info.name).to.equal("DeepSeek Dynamic")
		expect(resolved.info.capabilities?.maxTokens).to.equal(12_345)
		expect(resolved.info.capabilities?.supportsReasoning).to.equal(true)
	})
})
