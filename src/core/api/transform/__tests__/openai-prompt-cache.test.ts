import { expect } from "chai"
import type OpenAI from "openai"
import { describe, it } from "vitest"
import { projectOpenAIChatPromptCache, projectOpenAIResponsesPromptCache } from "../openai-prompt-cache"

describe("OpenAI prompt cache projection", () => {
	it("uses automatic prompt caching by default without inferring explicit support from the model ID", () => {
		const projection = projectOpenAIChatPromptCache({
			modelId: "gpt-6",
			systemPrompt: "stable system",
			messages: [{ role: "developer", content: "stable system" }],
			tools: [],
		})

		expect(projection.promptCacheOptions).to.equal(undefined)
		expect(JSON.stringify(projection.messages)).not.to.contain("prompt_cache_breakpoint")
	})

	it("keeps prompt cache keys within the upstream 64-character limit", () => {
		const chat = projectOpenAIChatPromptCache({
			modelId: "gpt-5.6-sol",
			systemPrompt: "stable system",
			messages: [{ role: "developer", content: "stable system" }],
			tools: [],
		})
		const responses = projectOpenAIResponsesPromptCache({
			modelId: "gpt-5.6-sol",
			systemPrompt: "stable system",
			input: [],
			tools: [],
		})

		expect(chat.promptCacheKey.length).to.be.at.most(64)
		expect(responses.promptCacheKey.length).to.be.at.most(64)
		// Raw SHA-256 hex digest: exactly 64 chars, no algorithm prefix.
		expect(chat.promptCacheKey).to.match(/^[0-9a-f]{64}$/)
		expect(responses.promptCacheKey).to.match(/^[0-9a-f]{64}$/)
	})

	it("keeps Chat keys stable across dynamic messages and changes them with tools", () => {
		const first = projectOpenAIChatPromptCache({
			modelId: "gpt-5.6-sol",
			systemPrompt: "stable system",
			messages: [
				{ role: "developer", content: "stable system" },
				{ role: "user", content: "dynamic A" },
			],
			tools: [],
		})
		const second = projectOpenAIChatPromptCache({
			modelId: "gpt-5.6-sol",
			systemPrompt: "stable system",
			messages: [
				{ role: "developer", content: "stable system" },
				{ role: "user", content: "dynamic B" },
			],
			tools: [],
		})
		const withTool = projectOpenAIChatPromptCache({
			modelId: "gpt-5.6-sol",
			systemPrompt: "stable system",
			messages: [{ role: "developer", content: "stable system" }],
			tools: [
				{
					type: "function",
					function: { name: "read_file", parameters: { type: "object" } },
				},
			],
		})

		expect(second.promptCacheKey).to.equal(first.promptCacheKey)
		expect(withTool.promptCacheKey).not.to.equal(first.promptCacheKey)
		expect(second.messages.at(-1)).to.deep.include({ role: "user" })
	})

	it("projects explicit Chat controls only when the caller opts in", () => {
		const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "developer", content: "stable system" },
			{ role: "user", content: "one" },
			{ role: "assistant", content: "two" },
			{ role: "user", content: "three" },
			{ role: "assistant", content: "four" },
			{ role: "user", content: "five" },
		]
		const original = structuredClone(messages)

		const projection = projectOpenAIChatPromptCache({
			modelId: "gpt-5.6-sol",
			systemPrompt: "stable system",
			messages,
			tools: [],
			mode: "explicit",
		})

		expect(messages).to.deep.equal(original)
		expect(projection.promptCacheOptions).to.deep.equal({ mode: "explicit" })
		expect(projection.promptCacheKey).to.be.a("string").and.not.equal("")
		expect(JSON.stringify(projection.messages[0])).to.contain("prompt_cache_breakpoint")
		for (const message of projection.messages.slice(1)) {
			expect(JSON.stringify(message)).not.to.contain("prompt_cache_breakpoint")
		}
	})

	it("keeps old Responses request semantics while adding a stable key", () => {
		const input: OpenAI.Responses.ResponseInput = [{ role: "user", content: [{ type: "input_text", text: "dynamic" }] }]
		const projection = projectOpenAIResponsesPromptCache({
			modelId: "gpt-5.5",
			systemPrompt: "stable system",
			input,
			tools: [],
		})

		expect(projection.instructions).to.equal("stable system")
		expect(projection.input).to.equal(input)
		expect(projection.promptCacheKey).to.be.a("string").and.not.equal("")
		expect(projection.promptCacheOptions).to.equal(undefined)
	})

	it("projects explicit Responses controls only when the caller opts in", () => {
		const input: OpenAI.Responses.ResponseInput = [{ role: "user", content: [{ type: "input_text", text: "dynamic" }] }]
		const original = structuredClone(input)
		const projection = projectOpenAIResponsesPromptCache({
			modelId: "gpt-5.6-sol",
			systemPrompt: "stable system",
			input,
			tools: [],
			mode: "explicit",
		})

		expect(input).to.deep.equal(original)
		expect(projection.instructions).to.equal(undefined)
		expect(projection.promptCacheOptions).to.deep.equal({ mode: "explicit" })
		expect(projection.promptCacheKey).to.be.a("string").and.not.equal("")
		expect(JSON.stringify(projection.input[0])).to.contain("prompt_cache_breakpoint")
		expect(JSON.stringify(projection.input[1])).to.contain("dynamic")
	})

	it("separates Chat and Responses cache routing keys", () => {
		const chat = projectOpenAIChatPromptCache({
			modelId: "gpt-5.6-sol",
			systemPrompt: "stable system",
			messages: [{ role: "developer", content: "stable system" }],
			tools: [],
		})
		const responses = projectOpenAIResponsesPromptCache({
			modelId: "gpt-5.6-sol",
			systemPrompt: "stable system",
			input: [],
			tools: [],
		})

		expect(chat.promptCacheKey).not.to.equal(responses.promptCacheKey)
	})
})
