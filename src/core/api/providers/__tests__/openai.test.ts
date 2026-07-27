import { ApiProfile } from "@shared/proto/dline/profile"
import { BaseProviderConfig } from "@shared/proto/dline/provider/common"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { OpenAiCodexProviderConfig } from "@shared/proto/dline/provider/openai_codex"
import { expect } from "chai"
import should from "should"
import { afterEach, describe, it, vi } from "vitest"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { mockFetchForTesting } from "@/shared/net"
import { OpenAiHandler } from "../openai"
import { OpenAiCodexHandler } from "../openai-codex"
import { OpenAiNativeHandler } from "../openai-native"

/**
 * Create an async iterable for mocked streaming responses.
 *
 * @param data Stream chunks to yield.
 * @returns Async iterable yielding provided chunks.
 */
const createAsyncIterable = (data: readonly unknown[] = []) => ({
	[Symbol.asyncIterator]: async function* () {
		yield* data
	},
})

describe("OpenAiHandler", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("getModel", () => {
		it("should build model info from provider capability and pricing overrides", () => {
			const handler = new OpenAiHandler({
				profile: ApiProfile.create({
					provider: "openai",
					apiKey: "test-api-key",
					modelId: "custom-openai-compatible-model",
					openai: OpenAiProviderConfig.create({
						capabilities: {
							maxTokens: 12_345,
							supportsPromptCache: true,
							temperature: 0.7,
						},
						pricing: {
							inputPrice: 0.5,
							outputPrice: 1.5,
						},
					}),
				}),
				mode: "act",
			})

			const result = handler.getModel()

			result.id.should.equal("custom-openai-compatible-model")
			result.info.id.should.equal("custom-openai-compatible-model")
			should(result.info.capabilities?.maxTokens).equal(12_345)
			should(result.info.capabilities?.supportsPromptCache).equal(true)
			should(result.info.capabilities?.temperature).equal(0.7)
			should(result.info.pricing?.inputPrice).equal(0.5)
		})
	})

	describe("createMessage", () => {
		it("should use provider capabilities for request max tokens and temperature", async () => {
			const handler = new OpenAiHandler({
				profile: ApiProfile.create({
					provider: "openai",
					apiKey: "test-api-key",
					modelId: "custom-openai-compatible-model",
					openai: OpenAiProviderConfig.create({
						capabilities: {
							maxTokens: 12_345,
							temperature: 0.7,
						},
					}),
				}),
				mode: "act",
			})
			const create = vi.fn().mockResolvedValue(createAsyncIterable())

			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				chat: {
					completions: {
						create,
					},
				},
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			const requestBody = create.mock.calls[0]?.[0] as Record<string, unknown> | undefined
			should(requestBody?.max_tokens).equal(12_345)
			should(requestBody?.temperature).equal(0.7)
		})

		it("passes configured service tier and ultra effort to an OpenAI-compatible endpoint", async () => {
			const handler = new OpenAiHandler({
				profile: ApiProfile.create({
					provider: "openai",
					apiKey: "test-api-key",
					modelId: "gpt-5.6-compatible",
					openai: OpenAiProviderConfig.create({
						serviceTier: "priority",
						reasoning: { enableThinking: true, effort: "ultra" },
					}),
				}),
				mode: "act",
			})
			const create = vi.fn().mockResolvedValue(createAsyncIterable())
			vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
				chat: { completions: { create } },
			})

			for await (const _chunk of handler.createMessage("system prompt", [{ role: "user", content: "Hello" }])) {
			}

			const requestBody = create.mock.calls[0]?.[0] as Record<string, unknown>
			expect(requestBody.service_tier).to.equal("priority")
			expect(requestBody.reasoning_effort).to.equal("ultra")
		})
	})
})

describe("OpenAiNativeHandler", () => {
	it("adds service tier to Responses request parameters", () => {
		const handler = new OpenAiNativeHandler({
			profile: ApiProfile.create({
				provider: "openai-native",
				modelId: "gpt-5.6-sol",
				openaiNative: BaseProviderConfig.create({ serviceTier: "flex" }),
			}),
			mode: "act",
		})

		const params = (
			handler as unknown as {
				buildResponseCreateParams: (args: Record<string, unknown>) => Record<string, unknown>
			}
		).buildResponseCreateParams({ modelId: "gpt-5.6-sol", systemPrompt: "system", input: [], tools: [] })

		expect(params.service_tier).to.equal("flex")
	})
})

describe("OpenAiCodexHandler request configuration", () => {
	it("adds service tier to the shared SDK and fallback request body", () => {
		const handler = new OpenAiCodexHandler({
			profile: ApiProfile.create({
				provider: "openai-codex",
				modelId: "gpt-5.6-sol",
				openaiCodex: OpenAiCodexProviderConfig.create({ serviceTier: "scale" }),
			}),
			mode: "act",
		})

		const body = (
			handler as unknown as {
				buildRequestBody: (...args: unknown[]) => Record<string, unknown>
			}
		).buildRequestBody({ id: "gpt-5.6-sol", info: {} }, [], "system")

		expect(body.service_tier).to.equal("scale")
	})
})

describe("OpenAiCodexHandler account usage", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("maps the short and weekly Codex quota windows", async () => {
		vi.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("access-token")
		vi.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("account-123")
		const request = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				rate_limit: {
					primary_window: {
						used_percent: 25,
						limit_window_seconds: 18_000,
						reset_at: 1_800_000_000,
					},
					secondary_window: {
						used_percent: 60,
						limit_window_seconds: 604_800,
						reset_at: 1_800_500_000,
					},
				},
				credits: { balance: "7.50" },
			}),
		})
		const handler = new OpenAiCodexHandler({
			profile: ApiProfile.create({ provider: "openai-codex", modelId: "gpt-5.6-sol" }),
			mode: "act",
		})

		const usage = await mockFetchForTesting(request, () => handler.getAccountUsage())

		expect(request.mock.calls).to.have.length(1)
		expect(request.mock.calls[0][0]).to.equal("https://chatgpt.com/backend-api/wham/usage")
		expect(request.mock.calls[0][1].headers).to.include({
			Authorization: "Bearer access-token",
			"ChatGPT-Account-Id": "account-123",
		})
		expect(usage).to.deep.equal({
			currency: "USD",
			remainingBalance: 7.5,
			quotas: [
				{
					type: "5hour",
					label: "5 hour",
					used: 25,
					limit: 100,
					resetAt: new Date(1_800_000_000 * 1_000).toISOString(),
				},
				{
					type: "weekly",
					label: "Weekly",
					used: 60,
					limit: 100,
					resetAt: new Date(1_800_500_000 * 1_000).toISOString(),
				},
			],
			isAvailable: true,
		})
	})
})
