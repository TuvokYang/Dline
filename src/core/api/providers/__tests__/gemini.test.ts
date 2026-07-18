import "should"
import { ApiProfile } from "@shared/proto/dline/profile"
import { afterEach, describe, it, vi } from "vitest"
import { GeminiHandler } from "../gemini"

describe("GeminiHandler", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	const createAsyncIterable = (data: any[] = []) => ({
		[Symbol.asyncIterator]: async function* () {
			yield* data
		},
	})

	it("caps maxOutputTokens to 8192 for Flash models", async () => {
		const handler = new GeminiHandler({
			profile: ApiProfile.create({ provider: "gemini", apiKey: "test-api-key", modelId: "gemini-2.5-flash" }),
			mode: "act",
		})

		const generateContentStream = vi.fn().mockResolvedValue(
			createAsyncIterable([
				{
					responseId: "resp-1",
					usageMetadata: {
						promptTokenCount: 10,
						candidatesTokenCount: 20,
						cachedContentTokenCount: 0,
						thoughtsTokenCount: 0,
					},
				},
			]),
		)
		vi.spyOn(handler as any, "ensureClient").mockReturnValue({
			models: { generateContentStream },
		} as any)

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }] as any)) {
			// Consume stream to trigger request execution.
		}

		const requestArgs = generateContentStream.mock.calls[0][0] as Record<string, any>
		requestArgs.config.should.have.property("maxOutputTokens", 8_192)
	})

	it("does not set maxOutputTokens for non-Flash models", async () => {
		const handler = new GeminiHandler({
			profile: ApiProfile.create({ provider: "gemini", apiKey: "test-api-key", modelId: "gemini-2.5-pro" }),
			mode: "act",
		})

		const generateContentStream = vi.fn().mockResolvedValue(
			createAsyncIterable([
				{
					responseId: "resp-2",
					usageMetadata: {
						promptTokenCount: 10,
						candidatesTokenCount: 20,
						cachedContentTokenCount: 0,
						thoughtsTokenCount: 0,
					},
				},
			]),
		)
		vi.spyOn(handler as any, "ensureClient").mockReturnValue({
			models: { generateContentStream },
		} as any)

		for await (const _chunk of handler.createMessage("system", [{ role: "user", content: "hi" }] as any)) {
			// Consume stream to trigger request execution.
		}

		const requestArgs = generateContentStream.mock.calls[0][0] as Record<string, any>
		requestArgs.config.should.not.have.property("maxOutputTokens")
	})

	it("should emit unique tool call IDs when multiple function calls share one responseId", async () => {
		const handler = new GeminiHandler({
			profile: ApiProfile.create({ provider: "gemini", apiKey: "test-api-key" }),
			mode: "act",
		})

		const fakeClient = {
			models: {
				generateContentStream: vi.fn().mockResolvedValue(
					createAsyncIterable([
						{
							responseId: "resp_1",
							candidates: [
								{
									content: {
										parts: [
											{
												functionCall: {
													name: "read_file",
													args: { path: ".nvmrc" },
												},
											},
										],
									},
								},
							],
						},
						{
							responseId: "resp_1",
							candidates: [
								{
									content: {
										parts: [
											{
												functionCall: {
													name: "read_file",
													args: { path: ".gitattributes" },
												},
											},
										],
									},
								},
							],
						},
					]),
				),
			},
		}
		vi.spyOn(handler as any, "ensureClient").mockReturnValue(fakeClient as any)

		const tools = [{ name: "read_file", description: "read file", parameters: { type: "OBJECT" } }] as any
		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			if (chunk.type === "tool_calls") {
				chunks.push(chunk)
			}
		}

		chunks.should.have.length(2)
		chunks[0].function_id.should.equal("resp_1-tool-0")
		chunks[1].function_id.should.equal("resp_1-tool-1")
		chunks[0].provider_metadata.response_id.should.equal("resp_1")
		chunks[0].tool_call.should.not.have.property("call_id")
		chunks[0].tool_call.function.should.not.have.property("id")
		JSON.parse(chunks[0].tool_call.function.arguments).path.should.equal(".nvmrc")
		JSON.parse(chunks[1].tool_call.function.arguments).path.should.equal(".gitattributes")
	})

	it("should preserve Gemini-provided functionCall.id when present", async () => {
		const handler = new GeminiHandler({
			profile: ApiProfile.create({ provider: "gemini", apiKey: "test-api-key" }),
			mode: "act",
		})

		const fakeClient = {
			models: {
				generateContentStream: vi.fn().mockResolvedValue(
					createAsyncIterable([
						{
							responseId: "resp_2",
							candidates: [
								{
									content: {
										parts: [
											{
												functionCall: {
													id: "call_alpha",
													name: "read_file",
													args: { path: ".nvmrc" },
												},
											},
										],
									},
								},
							],
						},
					]),
				),
			},
		}
		vi.spyOn(handler as any, "ensureClient").mockReturnValue(fakeClient as any)

		const tools = [{ name: "read_file", description: "read file", parameters: { type: "OBJECT" } }] as any
		const chunks: any[] = []
		for await (const chunk of handler.createMessage("system", [{ role: "user", content: "hi" }], tools)) {
			if (chunk.type === "tool_calls") {
				chunks.push(chunk)
			}
		}

		chunks.should.have.length(1)
		chunks[0].function_id.should.equal("call_alpha")
		chunks[0].provider_metadata.response_id.should.equal("resp_2")
		chunks[0].tool_call.should.not.have.property("call_id")
		chunks[0].tool_call.function.should.not.have.property("id")
		JSON.parse(chunks[0].tool_call.function.arguments).path.should.equal(".nvmrc")
	})
})
