import { ApiFormat } from "@shared/proto/dline/models/metadata"
import { ApiProfile } from "@shared/proto/dline/profile"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { expect } from "chai"
import type OpenAI from "openai"
import { afterEach, describe, it, vi } from "vitest"
import { OpenAiHandler } from "../openai"

const createAsyncIterable = () => ({
	[Symbol.asyncIterator]: async function* () {},
})

describe("OpenAI Task-scoped prompt cache keys", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("isolates automatic Chat cache keys by Task while preserving appended-turn stability", async () => {
		const handler = new OpenAiHandler({
			profile: ApiProfile.create({
				provider: "openai",
				apiKey: "test-api-key",
				modelId: "gpt-5.6-sol",
				openai: OpenAiProviderConfig.create({ apiFormat: ApiFormat.OPENAI_CHAT }),
			}),
			mode: "act",
		})
		const create = vi.fn().mockResolvedValue(createAsyncIterable())
		vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
			chat: { completions: { create } },
		})

		for await (const _chunk of handler.createMessage("frozen system", [{ role: "user", content: "first turn" }], undefined, {
			taskNamespace: "task-a",
		})) {
		}
		for await (const _chunk of handler.createMessage(
			"frozen system",
			[
				{ role: "user", content: "first turn" },
				{ role: "assistant", content: "response" },
				{ role: "user", content: "second turn" },
			],
			undefined,
			{ taskNamespace: "task-a" },
		)) {
		}
		for await (const _chunk of handler.createMessage("frozen system", [{ role: "user", content: "first turn" }], undefined, {
			taskNamespace: "task-b",
		})) {
		}

		const first = create.mock.calls[0]?.[0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
		const appended = create.mock.calls[1]?.[0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
		const otherTask = create.mock.calls[2]?.[0] as OpenAI.Chat.ChatCompletionCreateParamsStreaming
		expect(first.prompt_cache_key).to.match(/^dline_cache_[0-9a-f]{32}$/)
		expect(appended.prompt_cache_key).to.equal(first.prompt_cache_key)
		expect(otherTask.prompt_cache_key).not.to.equal(first.prompt_cache_key)
		expect(first.prompt_cache_options).to.equal(undefined)
		expect(JSON.stringify(first.messages)).not.to.contain("prompt_cache_breakpoint")
	})

	it("isolates automatic Responses cache keys by Task without adding breakpoint controls", async () => {
		const handler = new OpenAiHandler({
			profile: ApiProfile.create({
				provider: "openai",
				apiKey: "test-api-key",
				modelId: "gpt-5.6-sol",
				openai: OpenAiProviderConfig.create({ apiFormat: ApiFormat.OPENAI_RESPONSES }),
			}),
			mode: "act",
		})
		const create = vi.fn().mockResolvedValue(createAsyncIterable())
		vi.spyOn(handler as unknown as { ensureClient: () => unknown }, "ensureClient").mockReturnValue({
			responses: { create },
		})

		for await (const _chunk of handler.createMessage("frozen system", [{ role: "user", content: "first turn" }], undefined, {
			taskNamespace: "task-a",
		})) {
		}
		for await (const _chunk of handler.createMessage("frozen system", [{ role: "user", content: "first turn" }], undefined, {
			taskNamespace: "task-b",
		})) {
		}

		const first = create.mock.calls[0]?.[0] as OpenAI.Responses.ResponseCreateParamsStreaming
		const otherTask = create.mock.calls[1]?.[0] as OpenAI.Responses.ResponseCreateParamsStreaming
		expect(first.prompt_cache_key).to.match(/^dline_cache_[0-9a-f]{32}$/)
		expect(otherTask.prompt_cache_key).not.to.equal(first.prompt_cache_key)
		expect(first.prompt_cache_options).to.equal(undefined)
		expect(JSON.stringify(first.input)).not.to.contain("prompt_cache_breakpoint")
	})
})
