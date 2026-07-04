import "should"
import { openRouterDefaultModelInfo } from "@shared/api"
import { ApiProfile } from "@shared/proto/dline/profile"
import { afterEach, describe, it, vi } from "vitest"
import { OpenRouterHandler } from "../openrouter"

describe("OpenRouterHandler", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	const tools = [{ type: "function", function: { name: "read_file", description: "", parameters: { type: "object" } } }] as any

	it("should handle usage-only chunks when delta is missing", async () => {
		const handler = new OpenRouterHandler({
			profile: ApiProfile.create({ provider: "openrouter", apiKey: "test-api-key" }),
			mode: "act",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: vi.fn().mockResolvedValue(
						createAsyncIterable([
							{
								choices: [{}],
								usage: {
									prompt_tokens: 13,
									completion_tokens: 5,
								},
							},
						]),
					),
				},
			},
		}
		vi.spyOn(handler as any, "ensureClient").mockReturnValue(fakeClient as any)
		vi.spyOn(handler, "getModel").mockReturnValue({
			id: "openai/gpt-4o-mini",
			info: openRouterDefaultModelInfo,
		})

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{
				type: "usage",
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				inputTokens: 13,
				outputTokens: 5,
				totalCost: 0,
			},
		])
	})

	it("should read cache_write_tokens from prompt_tokens_details", async () => {
		const handler = new OpenRouterHandler({
			profile: ApiProfile.create({ provider: "openrouter", apiKey: "test-api-key" }),
			mode: "act",
		})
		const fakeClient = {
			chat: {
				completions: {
					create: vi.fn().mockResolvedValue(
						createAsyncIterable([
							{
								choices: [{}],
								usage: {
									prompt_tokens: 1000,
									completion_tokens: 200,
									prompt_tokens_details: {
										cached_tokens: 500,
										cache_write_tokens: 300,
									},
								},
							},
						]),
					),
				},
			},
		}
		vi.spyOn(handler as any, "ensureClient").mockReturnValue(fakeClient as any)
		vi.spyOn(handler, "getModel").mockReturnValue({
			id: "anthropic/claude-sonnet-4.6",
			info: openRouterDefaultModelInfo,
		})

		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }])) {
			chunks.push(chunk)
		}

		chunks.should.deepEqual([
			{
				type: "usage",
				cacheWriteTokens: 300,
				cacheReadTokens: 500,
				inputTokens: 200,
				outputTokens: 200,
				totalCost: 0,
			},
		])
	})

	type ParallelToolCallsTestCase = {
		modelId: string
		enableParallelToolCalling: boolean
		expectedParallelToolCalls: boolean
	}

	const parallelToolCallsTestCases: ParallelToolCallsTestCase[] = [
		{
			modelId: "openai/gpt-4o-mini",
			enableParallelToolCalling: true,
			expectedParallelToolCalls: true,
		},
		{
			modelId: "openai/gpt-4o-mini",
			enableParallelToolCalling: false,
			expectedParallelToolCalls: false,
		},
		{
			modelId: "google/gemini-3-flash-preview",
			enableParallelToolCalling: true,
			expectedParallelToolCalls: true,
		},
	]

	for (const testCase of parallelToolCallsTestCases) {
		const settingLabel = testCase.enableParallelToolCalling ? "enabled" : "disabled"
		it(`should set parallel_tool_calls=${testCase.expectedParallelToolCalls} for ${testCase.modelId} when setting is ${settingLabel}`, async () => {
			const handler = new OpenRouterHandler({
				profile: ApiProfile.create({ provider: "openrouter", apiKey: "test-api-key" }),
				mode: "act",
				enableParallelToolCalling: testCase.enableParallelToolCalling,
			})
			const createStub = vi.fn().mockResolvedValue(createAsyncIterable([]))
			const fakeClient = {
				chat: {
					completions: {
						create: createStub,
					},
				},
			}
			vi.spyOn(handler as any, "ensureClient").mockReturnValue(fakeClient as any)
			vi.spyOn(handler, "getModel").mockReturnValue({
				id: testCase.modelId,
				info: openRouterDefaultModelInfo,
			})

			for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
				// drain stream
			}

			const payload = createStub.mock.calls[0][0]
			payload.parallel_tool_calls.should.equal(testCase.expectedParallelToolCalls)
		})
	}
})
