import { anthropicModels } from "@shared/api"
import { ApiProfile } from "@shared/proto/dline/profile"
import { expect } from "chai"
import should from "should"
import { afterEach, describe, it, vi } from "vitest"
import { ANTHROPIC_FAST_MODE_BETA, AnthropicHandler } from "../anthropic"

describe("AnthropicHandler", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	const createAsyncIterable = (data: readonly unknown[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	describe("getModel", () => {
		it("should return the fast mode model when configured", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({ provider: "anthropic", apiKey: "test-api-key", modelId: "claude-opus-4-6:fast" }),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-6:fast")
			result.info.should.deepEqual(anthropicModels["claude-opus-4-6:fast"])
		})

		it("should return the 1m fast mode model when configured", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({ provider: "anthropic", apiKey: "test-api-key", modelId: "claude-opus-4-6:1m:fast" }),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-6:1m:fast")
			result.info.should.deepEqual(anthropicModels["claude-opus-4-6:1m:fast"])
		})

		it("should return the 4.7 model when configured", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({ provider: "anthropic", apiKey: "test-api-key", modelId: "claude-opus-4-7" }),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-7")
			result.info.should.deepEqual(anthropicModels["claude-opus-4-7"])
		})

		it("should return the 4.7 1m model when configured", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({ provider: "anthropic", apiKey: "test-api-key", modelId: "claude-opus-4-7:1m" }),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-7:1m")
			result.info.should.deepEqual(anthropicModels["claude-opus-4-7:1m"])
		})

		it("should preserve a custom model id when profile modelInfo is missing", () => {
			const customModelId = "custom-claude-compatible-model"
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: customModelId,
					anthropic: {
						customModelEnabled: true,
						capabilities: {
							maxTokens: 12_345,
							contextWindow: 67_890,
							supportsImages: false,
							supportsPromptCache: false,
							supportsReasoning: false,
						},
						pricing: {
							inputPrice: 0.5,
							outputPrice: 1.5,
						},
					},
				}),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal(customModelId)
			result.info.id.should.equal(customModelId)
			should(result.info.capabilities?.maxTokens).equal(12_345)
			should(result.info.capabilities?.supportsPromptCache).equal(false)
		})
	})

	describe("createMessage", () => {
		it("should route fast mode requests through the beta messages API", async () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({ provider: "anthropic", apiKey: "test-api-key", modelId: "claude-opus-4-6:fast" }),
				mode: "act",
			})

			const standardCreate = vi.fn().mockResolvedValue(createAsyncIterable())
			const betaCreate = vi.fn().mockImplementation(function (this: { _client?: object }, _params: unknown) {
				should.exist(this._client)
				return Promise.resolve(createAsyncIterable())
			})

			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				messages: {
					create: standardCreate,
				},
				beta: {
					messages: {
						_client: {},
						create: betaCreate,
					},
				},
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			expect(standardCreate)
			expect(betaCreate)
			const callArgs = betaCreate.mock.calls[0]?.[0] as Record<string, unknown> | undefined
			expect(callArgs?.model).to.equal("claude-opus-4-6")
			expect(callArgs?.betas).to.deep.equal([ANTHROPIC_FAST_MODE_BETA])
			expect(callArgs?.speed).to.equal("fast")
			expect(callArgs?.stream).to.equal(true)
		})

		it("should include the 1m beta when routing 1m fast mode requests through the beta messages API", async () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({ provider: "anthropic", apiKey: "test-api-key", modelId: "claude-opus-4-6:1m:fast" }),
				mode: "act",
			})

			const standardCreate = vi.fn().mockResolvedValue(createAsyncIterable())
			const betaCreate = vi.fn().mockImplementation(function (this: { _client?: object }, _params: unknown) {
				should.exist(this._client)
				return Promise.resolve(createAsyncIterable())
			})

			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				messages: {
					create: standardCreate,
				},
				beta: {
					messages: {
						_client: {},
						create: betaCreate,
					},
				},
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			expect(standardCreate)
			expect(betaCreate)
			const callArgs = betaCreate.mock.calls[0]?.[0] as Record<string, unknown> | undefined
			expect(callArgs?.model).to.equal("claude-opus-4-6")
			expect(callArgs?.betas).to.deep.equal([ANTHROPIC_FAST_MODE_BETA, "context-1m-2025-08-07"])
			expect(callArgs?.speed).to.equal("fast")
			expect(callArgs?.stream).to.equal(true)
		})

		it("should include the 1m beta header for Claude Opus 4.7 1m requests", async () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: "claude-opus-4-7:1m",
					anthropic: { reasoning: { effort: "high" } },
				}),
				mode: "act",
			})

			const standardCreate = vi.fn().mockResolvedValue(createAsyncIterable())

			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				messages: {
					create: standardCreate,
				},
				beta: {
					messages: {
						_client: {},
						create: vi.fn().mockResolvedValue(createAsyncIterable()),
					},
				},
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			expect(standardCreate)
			const requestBody = standardCreate.mock.calls[0][0] as Record<string, any>
			const requestOptions = standardCreate.mock.calls[0][1] as Record<string, any>
			requestBody.model.should.equal("claude-opus-4-7")
			requestBody.thinking.should.deepEqual({ type: "adaptive" })
			requestOptions.should.deepEqual({
				headers: {
					"anthropic-beta": "context-1m-2025-08-07",
				},
			})
		})

		it("should use adaptive thinking and output_config for Claude Opus adaptive models", async () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: "claude-opus-4-7",
					anthropic: { reasoning: { effort: "xhigh" } },
				}),
				mode: "act",
			})

			const standardCreate = vi.fn().mockResolvedValue(createAsyncIterable())

			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				messages: {
					create: standardCreate,
				},
				beta: {
					messages: {
						_client: {},
						create: vi.fn().mockResolvedValue(createAsyncIterable()),
					},
				},
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			expect(standardCreate)
			const requestBody = standardCreate.mock.calls[0][0] as Record<string, any>
			requestBody.should.have.property("thinking")
			requestBody.thinking.should.deepEqual({ type: "adaptive" })
			requestBody.should.have.property("output_config")
			requestBody.output_config.should.deepEqual({ effort: "xhigh" })
			should(requestBody.temperature).equal(undefined)
		})

		it("should send the custom model id in Anthropic requests", async () => {
			const customModelId = "custom-claude-compatible-model"
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: customModelId,
					anthropic: {
						customModelEnabled: true,
						capabilities: {
							maxTokens: 12_345,
							contextWindow: 67_890,
							supportsImages: false,
							supportsPromptCache: false,
							supportsReasoning: false,
						},
						pricing: {
							inputPrice: 0.5,
							outputPrice: 1.5,
						},
					},
				}),
				mode: "act",
			})

			const standardCreate = vi.fn().mockResolvedValue(createAsyncIterable())

			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				messages: {
					create: standardCreate,
				},
				beta: {
					messages: {
						_client: {},
						create: vi.fn().mockResolvedValue(createAsyncIterable()),
					},
				},
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			const requestBody = standardCreate.mock.calls[0]?.[0] as { model?: unknown; max_tokens?: unknown } | undefined
			expect(requestBody?.model).to.equal(customModelId)
			expect(requestBody?.max_tokens).to.equal(12_345)
		})
	})
})
