import { expect } from "chai"
import type OpenAI from "openai"
import { describe, it } from "vitest"
import {
	projectOpenAIChatPromptCache,
	projectOpenAIResponsesPromptCache,
	supportsExplicitOpenAIPromptCache,
} from "../openai-prompt-cache"

describe("OpenAI prompt cache projection", () => {
	it("recognizes only GPT-5.6 and later model families for explicit controls", () => {
		expect(supportsExplicitOpenAIPromptCache("gpt-5.5")).to.equal(false)
		expect(supportsExplicitOpenAIPromptCache("gpt-5.6-sol")).to.equal(true)
		expect(supportsExplicitOpenAIPromptCache("gpt-6")).to.equal(true)
		expect(supportsExplicitOpenAIPromptCache("compatible-model")).to.equal(false)
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

	it("marks only the stable system prefix and never the dynamic tail", () => {
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
		})

		expect(messages).to.deep.equal(original)
		expect(projection.promptCacheOptions).to.deep.equal({ mode: "explicit" })
		// The stable system/developer prefix carries the explicit breakpoint.
		expect(JSON.stringify(projection.messages[0])).to.contain("prompt_cache_breakpoint")
		// Dynamic tail messages must stay outside the cached prefix.
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

	it("projects a GPT-5.6 Responses system prefix without mutating dynamic input", () => {
		const input: OpenAI.Responses.ResponseInput = [{ role: "user", content: [{ type: "input_text", text: "dynamic" }] }]
		const original = structuredClone(input)
		const projection = projectOpenAIResponsesPromptCache({
			modelId: "gpt-5.6-sol",
			systemPrompt: "stable system",
			input,
			tools: [],
		})

		expect(input).to.deep.equal(original)
		expect(projection.instructions).to.equal(undefined)
		expect(projection.promptCacheOptions).to.deep.equal({ mode: "explicit" })
		expect(projection.input[0]).to.deep.equal({
			type: "message",
			role: "system",
			content: [
				{
					type: "input_text",
					text: "stable system",
					prompt_cache_breakpoint: { mode: "explicit" },
				},
			],
		})
		expect(JSON.stringify(projection.input[1])).to.contain("dynamic")
		// Dynamic input items must stay outside the cached prefix.
		expect(JSON.stringify(projection.input[1])).not.to.contain("prompt_cache_breakpoint")
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
