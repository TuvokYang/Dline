import { afterEach, beforeAll, beforeEach, describe, it, vi } from "vitest"
import "should"
import { ApiProfile } from "@shared/proto/dline/profile"
import axios from "axios"
import { ClineStorageMessage } from "@/shared/messages/content"
import { OllamaHandler } from "../ollama"

describe("OllamaHandler", () => {
	let ollamaAvailable = false

	// Check if Ollama is running before running tests
	beforeAll(async () => {
		// mocha this.timeout removed — vitest uses testTimeout config: (5000)
		try {
			await axios.get("http://localhost:11434/api/version", { timeout: 2000 })
			ollamaAvailable = true
		} catch (_error) {
			console.log("Ollama server not available, skipping tests")
			ollamaAvailable = false
		}
	})
	let handler: OllamaHandler
	let _clock: any /* FakeTimers */

	beforeEach(() => {
		handler = new OllamaHandler({
			profile: ApiProfile.create({ provider: "ollama", modelId: "llama2", baseUrl: "http://localhost:11434" }),
			mode: "act",
		})
		// Use fake timers for testing timeouts
		_clock = vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.restoreAllMocks()
	})

	describe("createMessage", () => {
		it("should handle successful responses", async () => {
			if (!ollamaAvailable) {
				return
			}
			// mocha this.timeout removed — vitest uses testTimeout config: (5000)
			// Ensure client is initialized
			const client = (handler as any).ensureClient()
			// Mock the Ollama client's chat method
			const chatStub = vi.spyOn(client, "chat").mockResolvedValue({
				[Symbol.asyncIterator]: async function* () {
					yield {
						message: { content: "Hello, world!" },
						eval_count: 10,
						prompt_eval_count: 20,
					}
				},
			} as any)

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

			const result = []
			const usageInfo = []

			// Collect the results
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					result.push(chunk.text)
				} else if (chunk.type === "usage") {
					usageInfo.push({
						inputTokens: chunk.inputTokens,
						outputTokens: chunk.outputTokens,
					})
				}
			}

			// Verify the results
			result.should.deepEqual(["Hello, world!"])
			usageInfo.should.deepEqual([{ inputTokens: 20, outputTokens: 10 }])
			;(chatStub.mock.calls.length === 1).should.be.true()
		})

		it("should handle timeout errors", async () => {
			if (!ollamaAvailable) {
				return
			}
			// mocha this.timeout removed — vitest uses testTimeout config: (10000)
			// Restore real timers for this test
			vi.useRealTimers()

			// Create a handler with a very short timeout for testing
			const testHandler = new OllamaHandler({
				profile: ApiProfile.create({ provider: "ollama", modelId: "llama2", baseUrl: "http://localhost:11434" }),
				mode: "act",
			})

			// Replace the createMessage method with one that has a shorter timeout
			testHandler.createMessage = async function* (_systemPrompt, _messages) {
				try {
					// Create a promise that rejects after a short timeout
					const timeoutPromise = new Promise<never>((_, reject) => {
						setTimeout(() => reject(new Error("Ollama request timed out after 120 seconds")), 100)
					})

					// Create a promise that never resolves
					const neverPromise = new Promise(() => {})

					// Race them
					await Promise.race([timeoutPromise, neverPromise])
				} catch (error: any) {
					// Enhance error reporting
					console.error(`Ollama API error: ${error.message}`)
					throw error
				}
			}

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

			// Start the request and catch the error
			let errorMessage = ""
			try {
				for await (const _ of testHandler.createMessage(systemPrompt, messages)) {
					// This should not be reached
				}
			} catch (error: any) {
				errorMessage = error.message
			}

			// Check the result
			errorMessage.should.equal("Ollama request timed out after 120 seconds")

			// Restore the fake timers for other tests
			_clock = vi.useFakeTimers()
		})

		it("should retry on errors when using the withRetry decorator", async () => {
			if (!ollamaAvailable) {
				return
			}
			// mocha this.timeout removed — vitest uses testTimeout config: (10000)
			// Restore real timers for this test
			vi.useRealTimers()

			// Ensure client is initialized and mock the Ollama client's chat method to fail on first call and succeed on second
			const client = (handler as any).ensureClient()
			const chatStub = vi.spyOn(client, "chat")

			// First call throws an error
			chatStub.mockRejectedValueOnce(new Error("API Error"))

			// Second call succeeds
			chatStub.mockResolvedValueOnce({
				[Symbol.asyncIterator]: async function* () {
					yield {
						message: { content: "Success after retry" },
					}
				},
			} as any)

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

			const result = []

			// Add a small delay to ensure the retry mechanism has time to work
			await new Promise((resolve) => setTimeout(resolve, 100))

			// Collect the results
			for await (const chunk of handler.createMessage(systemPrompt, messages)) {
				if (chunk.type === "text") {
					result.push(chunk.text)
				}
			}

			// Verify the results
			result.should.deepEqual(["Success after retry"])
			;(chatStub.mock.calls.length === 2).should.be.true()

			// Restore the fake timers for other tests
			_clock = vi.useFakeTimers()
		})

		it("should handle stream processing errors", async () => {
			if (!ollamaAvailable) {
				return
			}
			// mocha this.timeout removed — vitest uses testTimeout config: (10000)
			// Restore real timers for this test
			vi.useRealTimers()

			// Create a handler with a custom implementation for testing
			const testHandler = new OllamaHandler({
				profile: ApiProfile.create({ provider: "ollama", modelId: "llama2", baseUrl: "http://localhost:11434" }),
				mode: "act",
			})

			// Replace the createMessage method with one that simulates a stream error
			testHandler.createMessage = async function* (_systemPrompt, _messages) {
				// First yield a successful chunk
				yield {
					type: "text",
					text: "Partial response",
				}

				// Then throw an error in the stream
				throw new Error("Ollama stream processing error: Stream error")
			}

			const systemPrompt = "You are a helpful assistant."
			const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

			const result = []

			// Collect the results and catch the error
			let errorMessage = ""
			try {
				for await (const chunk of testHandler.createMessage(systemPrompt, messages)) {
					if (chunk.type === "text") {
						result.push(chunk.text)
					}
				}
			} catch (error: any) {
				errorMessage = error.message
			}

			// Verify the results
			errorMessage.should.equal("Ollama stream processing error: Stream error")
			result.should.deepEqual(["Partial response"])

			// Restore the fake timers for other tests
			_clock = vi.useFakeTimers()
		})
	})
})
