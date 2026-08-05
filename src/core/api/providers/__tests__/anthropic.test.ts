import { anthropicModels } from "@shared/api"
import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
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
		it("should preserve resolved profile model metadata", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: "claude-sonnet-4-6",
					modelInfo: anthropicModels["claude-sonnet-4-6"],
					anthropic: { reasoning: { enableThinking: true, thinkingBudget: 2_048 } },
				}),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-sonnet-4-6")
			should(result.info.capabilities?.supportsTools).equal(true)
			should(result.info.capabilities?.contextWindow).equal(200_000)
		})

		it("should merge provider overrides into registry model metadata", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: "claude-opus-4-7",
					anthropic: {
						capabilities: {
							maxTokens: 12_345,
							supportsPromptCache: false,
						},
						pricing: {
							inputPrice: 0.5,
						},
					},
				}),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-7")
			result.info.id.should.equal("claude-opus-4-7")
			should(result.info.capabilities?.contextWindow).equal(anthropicModels["claude-opus-4-7"].capabilities?.contextWindow)
			should(result.info.capabilities?.maxTokens).equal(12_345)
			should(result.info.capabilities?.supportsPromptCache).equal(false)
			should(result.info.pricing?.inputPrice).equal(0.5)
		})

		it("should return the fast mode model when configured", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({ provider: "anthropic", apiKey: "test-api-key", modelId: "claude-opus-4-6:fast" }),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-6:fast")
			result.info.should.deepEqual({
				...anthropicModels["claude-opus-4-6:fast"],
				apiFormats: [ApiFormat.ANTHROPIC_CHAT],
			})
		})

		it("should keep the base model id when long context is enabled", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: "claude-sonnet-4-6",
					anthropic: { enableLongContext: true },
				}),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-sonnet-4-6")
			should(result.info.capabilities?.contextWindow).equal(1_000_000)
		})

		it("should return the 4.7 model when configured", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({ provider: "anthropic", apiKey: "test-api-key", modelId: "claude-opus-4-7" }),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal("claude-opus-4-7")
			result.info.should.deepEqual({
				...anthropicModels["claude-opus-4-7"],
				apiFormats: [ApiFormat.ANTHROPIC_CHAT],
			})
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

		it("only reports the known hosted web search tool as supported", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({ provider: "anthropic", modelId: "claude-sonnet-4-6" }),
				mode: "act",
			})

			expect(handler.supportsServerTool(ServerTool.WEB_SEARCH)).to.equal(true)
			expect(handler.supportsServerTool(ServerTool.SERVER_TOOL_UNSPECIFIED)).to.equal(false)
		})

		it("projects the fixed Anthropic transport into custom model metadata", () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					modelId: "custom-anthropic-model",
					anthropic: {
						customModelEnabled: true,
						capabilities: { supportsTools: true, tools: [ServerTool.WEB_SEARCH] },
					},
				}),
				mode: "act",
			})

			expect(handler.getModel().info.apiFormats?.[0]).to.equal(ApiFormat.ANTHROPIC_CHAT)
			expect(handler.getModel().info.capabilities?.tools).to.deep.equal([ServerTool.WEB_SEARCH])
		})
	})

	describe("createMessage", () => {
		it("projects hosted web search exactly once and removes the local Anthropic tool", async () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: "claude-sonnet-4-6",
				}),
				mode: "act",
			})
			const standardCreate = vi.fn().mockResolvedValue(createAsyncIterable())
			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				messages: { create: standardCreate },
				beta: { messages: { _client: {}, create: vi.fn().mockResolvedValue(createAsyncIterable()) } },
			})

			for await (const _chunk of handler.createMessage(
				"system prompt",
				[{ role: "user", content: "Search" }],
				[
					{
						name: "web_search",
						description: "Local search",
						input_schema: { type: "object", properties: {} },
					},
					{
						name: "read_file",
						description: "Read",
						input_schema: { type: "object", properties: {} },
					},
				],
				{ serverTools: [ServerTool.WEB_SEARCH] },
			)) {
			}

			expect(standardCreate.mock.calls[0]?.[0]?.tools).to.deep.equal([
				{
					name: "read_file",
					description: "Read",
					input_schema: { type: "object", properties: {} },
				},
				{ type: "web_search_20250305", name: "web_search" },
			])
			expect(standardCreate.mock.calls[0]?.[0]?.tool_choice).to.deep.equal({ type: "any" })
			expect(handler.supportsServerTool(ServerTool.WEB_SEARCH)).to.equal(true)
		})

		it("does not force hosted Web Search when no local Anthropic functions are present", async () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: "claude-sonnet-4-6",
				}),
				mode: "act",
			})
			const standardCreate = vi.fn().mockResolvedValue(createAsyncIterable())
			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				messages: { create: standardCreate },
				beta: { messages: { _client: {}, create: vi.fn().mockResolvedValue(createAsyncIterable()) } },
			})

			for await (const _chunk of handler.createMessage(
				"system prompt",
				[{ role: "user", content: "Answer without searching unless needed" }],
				undefined,
				{ serverTools: [ServerTool.WEB_SEARCH] },
			)) {
			}

			expect(standardCreate.mock.calls[0]?.[0]?.tools).to.deep.equal([{ type: "web_search_20250305", name: "web_search" }])
			should(standardCreate.mock.calls[0]?.[0]?.tool_choice).equal(undefined)
		})

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

		it("should append the long-context suffix for fast mode API requests", async () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: "claude-opus-4-6:fast",
					anthropic: { enableLongContext: true },
				}),
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
			expect(callArgs?.model).to.equal("claude-opus-4-6:1m")
			expect(callArgs?.betas).to.deep.equal([ANTHROPIC_FAST_MODE_BETA, "context-1m-2025-08-07"])
			expect(callArgs?.speed).to.equal("fast")
			expect(callArgs?.stream).to.equal(true)
		})

		it("should append the long-context suffix and beta header at the API boundary", async () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: "claude-opus-4-7",
					anthropic: { enableLongContext: true, reasoning: { effort: "high" } },
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
			requestBody.model.should.equal("claude-opus-4-7:1m")
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

		it("should use provider overrides for registry model request max tokens", async () => {
			const handler = new AnthropicHandler({
				profile: ApiProfile.create({
					provider: "anthropic",
					apiKey: "test-api-key",
					modelId: "claude-opus-4-7",
					anthropic: {
						capabilities: {
							maxTokens: 12_345,
							supportsPromptCache: false,
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

			const requestBody = standardCreate.mock.calls[0]?.[0] as { max_tokens?: unknown } | undefined
			expect(requestBody?.max_tokens).to.equal(12_345)
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
