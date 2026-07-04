import { ApiProfile } from "@shared/proto/dline/profile"
import { expect } from "chai"
import { afterEach, describe, it, vi } from "vitest"
import { ClineStorageMessage } from "@/shared/messages/content"
import { ApiFormat } from "@/shared/proto/dline"
import { OcaHandler } from "../oca"

const messages: ClineStorageMessage[] = [{ role: "user", content: "Hello" }]

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
			profile: ApiProfile.create({ provider: "oca", modelInfo: { apiFormat: ApiFormat.OPENAI_RESPONSES } as any }),
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

		const chunks = await collectChunks(handler.createMessage("system", messages))

		expect(chunks).to.deep.equal([{ type: "text", text: "responses" }])
		expect(chatStub)
		expect(responsesStub)
		expect(messagesStub)
	})

	it("routes ANTHROPIC_CHAT models to createMessageMessagesApi", async () => {
		const handler = new OcaHandler({
			profile: ApiProfile.create({ provider: "oca", modelInfo: { apiFormat: ApiFormat.ANTHROPIC_CHAT } as any }),
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

		const chunks = await collectChunks(handler.createMessage("system", messages))

		expect(chunks).to.deep.equal([{ type: "text", text: "messages" }])
		expect(chatStub)
		expect(responsesStub)
		expect(messagesStub)
	})

	it("defaults to createMessageChatApi for OPENAI_CHAT and undefined apiFormat", async () => {
		for (const apiFormat of [ApiFormat.OPENAI_CHAT, undefined]) {
			const handler = new OcaHandler({
				profile: ApiProfile.create({ provider: "oca", modelInfo: { apiFormat } as any }),
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

			const chunks = await collectChunks(handler.createMessage("system", messages))

			expect(chunks).to.deep.equal([{ type: "text", text: "chat" }])
			expect(chatStub)
			expect(responsesStub)
			expect(messagesStub)
		}
	})
})
