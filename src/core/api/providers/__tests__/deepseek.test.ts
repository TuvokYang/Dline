import { ApiProfile } from "@shared/proto/dline/profile"
import { expect } from "chai"
import { afterEach, describe, it, vi } from "vitest"
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
	})
})
