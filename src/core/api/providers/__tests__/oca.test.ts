import { ApiProfile } from "@shared/proto/dline/profile"
import { expect } from "chai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { afterEach, describe, it, vi } from "vitest"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ApiFormat, ServerTool } from "@/shared/proto/dline/models/metadata"
import { OutputLimitExceededError } from "../../stream/OutputLimitExceededError"
import { OcaHandler } from "../oca"

const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]
const tools: ChatCompletionTool[] = [
	{
		type: "function",
		function: { name: "web_search", description: "Local search", parameters: { type: "object" } },
	},
	{
		type: "function",
		function: { name: "read_file", description: "Read a file", parameters: { type: "object" } },
	},
]

function createStream(events: readonly unknown[] = []) {
	return {
		async *[Symbol.asyncIterator]() {
			yield* events
		},
	}
}

const emptyStream = createStream()

async function collectChunks(stream: AsyncGenerator<any>) {
	const chunks: any[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}
	return chunks
}

describe("OcaHandler.createMessage", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("routes OPENAI_RESPONSES models to createMessageResponsesApi", async () => {
		const handler = new OcaHandler({
			profile: ApiProfile.create({ provider: "oca", modelInfo: { apiFormats: [ApiFormat.OPENAI_RESPONSES] } as any }),
			mode: "act",
		})

		const chatStub = vi.spyOn(handler as any, "createMessageChatApi").mockImplementation(async function* () {
			yield { type: "text", text: "chat" }
		})
		const responsesStub = vi.spyOn(handler as any, "createMessageResponsesApi").mockImplementation(async function* () {
			yield { type: "text", text: "responses" }
		})
		const messagesStub = vi.spyOn(handler as any, "createMessageMessagesApi").mockImplementation(async function* () {
			yield { type: "text", text: "messages" }
		})

		const options = { serverTools: [ServerTool.WEB_SEARCH] as const }
		const chunks = await collectChunks(handler.createMessage("system", messages, tools, options))

		expect(chunks).to.deep.equal([{ type: "text", text: "responses" }])
		expect(chatStub.mock.calls).to.have.length(0)
		expect(responsesStub.mock.calls).to.have.length(1)
		expect(responsesStub.mock.calls[0]?.[3]).to.deep.equal(options)
		expect(messagesStub.mock.calls).to.have.length(0)
	})

	it("routes ANTHROPIC_CHAT models to createMessageMessagesApi", async () => {
		const handler = new OcaHandler({
			profile: ApiProfile.create({ provider: "oca", modelInfo: { apiFormats: [ApiFormat.ANTHROPIC_CHAT] } as any }),
			mode: "act",
		})

		const chatStub = vi.spyOn(handler as any, "createMessageChatApi").mockImplementation(async function* () {
			yield { type: "text", text: "chat" }
		})
		const responsesStub = vi.spyOn(handler as any, "createMessageResponsesApi").mockImplementation(async function* () {
			yield { type: "text", text: "responses" }
		})
		const messagesStub = vi.spyOn(handler as any, "createMessageMessagesApi").mockImplementation(async function* () {
			yield { type: "text", text: "messages" }
		})

		const options = { serverTools: [ServerTool.WEB_SEARCH] as const }
		const chunks = await collectChunks(handler.createMessage("system", messages, tools, options))

		expect(chunks).to.deep.equal([{ type: "text", text: "messages" }])
		expect(chatStub.mock.calls).to.have.length(0)
		expect(responsesStub.mock.calls).to.have.length(0)
		expect(messagesStub.mock.calls).to.have.length(1)
		expect(messagesStub.mock.calls[0]?.[3]).to.deep.equal(options)
	})

	it("defaults to createMessageChatApi for OPENAI_CHAT and undefined apiFormat", async () => {
		for (const apiFormat of [ApiFormat.OPENAI_CHAT, undefined]) {
			const handler = new OcaHandler({
				profile: ApiProfile.create({
					provider: "oca",
					modelInfo: { apiFormats: apiFormat === undefined ? undefined : [apiFormat] } as any,
				}),
				mode: "act",
			})

			const chatStub = vi.spyOn(handler as any, "createMessageChatApi").mockImplementation(async function* () {
				yield { type: "text", text: "chat" }
			})
			const responsesStub = vi.spyOn(handler as any, "createMessageResponsesApi").mockImplementation(async function* () {
				yield { type: "text", text: "responses" }
			})
			const messagesStub = vi.spyOn(handler as any, "createMessageMessagesApi").mockImplementation(async function* () {
				yield { type: "text", text: "messages" }
			})

			const chunks = await collectChunks(
				handler.createMessage("system", messages, tools, { serverTools: [ServerTool.WEB_SEARCH] }),
			)

			expect(chunks).to.deep.equal([{ type: "text", text: "chat" }])
			expect(chatStub.mock.calls).to.have.length(1)
			expect(chatStub.mock.calls[0]).to.have.length(4)
			expect(chatStub.mock.calls[0]?.[3]).to.deep.equal({ serverTools: [ServerTool.WEB_SEARCH] })
			expect(responsesStub.mock.calls).to.have.length(0)
			expect(messagesStub.mock.calls).to.have.length(0)
		}
	})

	it.each([
		[ApiFormat.OPENAI_RESPONSES, true],
		[ApiFormat.ANTHROPIC_CHAT, true],
		[ApiFormat.OPENAI_CHAT, false],
		[undefined, false],
	] as const)("reports adapter support for API format %s", (apiFormat, expected) => {
		const handler = new OcaHandler({
			profile: ApiProfile.create({
				provider: "oca",
				modelInfo: { apiFormats: apiFormat === undefined ? undefined : [apiFormat] } as any,
			}),
			mode: "act",
		})

		expect(handler.supportsServerTool(ServerTool.WEB_SEARCH)).to.equal(expected)
		expect(handler.supportsServerTool(ServerTool.SERVER_TOOL_UNSPECIFIED)).to.equal(false)
	})

	it("projects one hosted Responses Web Search declaration and removes the local duplicate", async () => {
		const handler = new OcaHandler({
			profile: ApiProfile.create({
				provider: "oca",
				modelId: "oca-responses-model",
				modelInfo: { apiFormats: [ApiFormat.OPENAI_RESPONSES], capabilities: { maxTokens: 8_192 } } as any,
			}),
			mode: "act",
		})
		const create = vi.fn().mockResolvedValue(emptyStream)
		vi.spyOn(handler as any, "ensureOpenAIClient").mockReturnValue({ responses: { create } })

		await collectChunks(handler.createMessage("system", messages, tools, { serverTools: [ServerTool.WEB_SEARCH] }))

		const request = create.mock.calls[0]?.[0] as { tools?: unknown[]; include?: unknown[] }
		expect(request.tools).to.deep.equal([
			{ type: "function", name: "read_file", description: "Read a file", parameters: { type: "object" }, strict: true },
			{ type: "web_search" },
		])
		expect(request.include).to.deep.equal(["web_search_call.results", "web_search_call.action.sources"])
	})

	it("uses the request-scoped compaction cap for every OCA protocol", async () => {
		const cases = [
			{ apiFormat: ApiFormat.OPENAI_CHAT, field: "max_completion_tokens", client: "openai-chat" },
			{ apiFormat: ApiFormat.OPENAI_RESPONSES, field: "max_output_tokens", client: "openai-responses" },
			{ apiFormat: ApiFormat.ANTHROPIC_CHAT, field: "max_tokens", client: "anthropic" },
		] as const

		for (const testCase of cases) {
			const handler = new OcaHandler({
				profile: ApiProfile.create({
					provider: "oca",
					modelId: "oca-model",
					modelInfo: { apiFormats: [testCase.apiFormat], capabilities: { maxTokens: 8_192 } } as any,
				}),
				mode: "act",
			})
			const create = vi.fn().mockResolvedValue(emptyStream)
			if (testCase.client === "openai-chat") {
				vi.spyOn(handler as any, "ensureOpenAIClient").mockReturnValue({ chat: { completions: { create } } })
			} else if (testCase.client === "openai-responses") {
				vi.spyOn(handler as any, "ensureOpenAIClient").mockReturnValue({ responses: { create } })
			} else {
				vi.spyOn(handler as any, "ensureAnthropicClient").mockReturnValue({ messages: { create } })
			}

			await collectChunks(
				handler.createMessage("system", messages, undefined, {
					generation: { purpose: "compaction", maxOutputTokens: 30_000 },
				} as any),
			)

			expect(create.mock.calls[0]?.[0]?.[testCase.field]).to.equal(30_000)
			vi.restoreAllMocks()
		}
	})

	it("throws a typed output-limit error for OCA Chat finish_reason length", async () => {
		const handler = new OcaHandler({
			profile: ApiProfile.create({
				provider: "oca",
				modelId: "oca-chat-model",
				modelInfo: { apiFormats: [ApiFormat.OPENAI_CHAT], capabilities: { maxTokens: 8_192 } } as any,
			}),
			mode: "act",
		})
		const create = vi.fn().mockResolvedValue(createStream([{ choices: [{ delta: {}, finish_reason: "length" }] }]))
		vi.spyOn(handler as any, "ensureOpenAIClient").mockReturnValue({ chat: { completions: { create } } })

		let caught: unknown
		try {
			await collectChunks(handler.createMessage("system", messages))
		} catch (error) {
			caught = error
		}

		expect(caught).to.be.instanceOf(OutputLimitExceededError)
		expect(caught).to.deep.include({ protocol: "openai_chat", reason: "length" })
	})

	it("keeps local Responses Web Search when hosted search was not selected", async () => {
		const handler = new OcaHandler({
			profile: ApiProfile.create({
				provider: "oca",
				modelId: "oca-responses-model",
				modelInfo: { apiFormats: [ApiFormat.OPENAI_RESPONSES], capabilities: { maxTokens: 8_192 } } as any,
			}),
			mode: "act",
		})
		const create = vi.fn().mockResolvedValue(emptyStream)
		vi.spyOn(handler as any, "ensureOpenAIClient").mockReturnValue({ responses: { create } })

		await collectChunks(handler.createMessage("system", messages, tools))

		const request = create.mock.calls[0]?.[0] as { tools?: Array<{ type?: string; name?: string }> }
		expect(request.tools?.filter((tool) => tool.name === "web_search")).to.have.length(1)
		expect(request.tools?.filter((tool) => tool.type === "web_search")).to.have.length(0)
	})

	it("projects one hosted Anthropic Web Search declaration and removes the local duplicate", async () => {
		const handler = new OcaHandler({
			profile: ApiProfile.create({
				provider: "oca",
				modelId: "oca-anthropic-model",
				modelInfo: { apiFormats: [ApiFormat.ANTHROPIC_CHAT], capabilities: { maxTokens: 8_192 } } as any,
			}),
			mode: "act",
		})
		const create = vi.fn().mockResolvedValue(emptyStream)
		vi.spyOn(handler as any, "ensureAnthropicClient").mockReturnValue({ messages: { create } })

		await collectChunks(handler.createMessage("system", messages, tools, { serverTools: [ServerTool.WEB_SEARCH] }))

		const request = create.mock.calls[0]?.[0] as { tools?: unknown[] }
		expect(request.tools).to.deep.equal([
			{ name: "read_file", description: "Read a file", input_schema: { type: "object" } },
			{ type: "web_search_20250305", name: "web_search" },
		])
	})
})
