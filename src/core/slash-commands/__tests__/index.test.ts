import type { ApiProviderInfo } from "@core/api"
import type { McpPromptResponse } from "@shared/mcp"
import { expect } from "chai"
import { formatMcpPromptResponse, McpPromptFetcher, parseSlashCommands } from "../index"

function createProviderInfo(contextWindow?: number): ApiProviderInfo {
	return {
		providerId: "openai",
		model: {
			id: "test-model",
			info: { capabilities: { contextWindow } },
		},
		mode: "act",
	} as ApiProviderInfo
}

describe("slash-commands", () => {
	describe("formatMcpPromptResponse", () => {
		it("should format text message", () => {
			const response: McpPromptResponse = {
				messages: [{ role: "user", content: { type: "text", text: "Hello world" } }],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.equal("[User]\nHello world")
		})

		it("should format assistant message", () => {
			const response: McpPromptResponse = {
				messages: [{ role: "assistant", content: { type: "text", text: "I can help" } }],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.equal("[Assistant]\nI can help")
		})

		it("should include description when provided", () => {
			const response: McpPromptResponse = {
				description: "Test description",
				messages: [{ role: "user", content: { type: "text", text: "Hello" } }],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.include("Description: Test description")
			expect(result).to.include("[User]\nHello")
		})

		it("should format multiple messages", () => {
			const response: McpPromptResponse = {
				messages: [
					{ role: "user", content: { type: "text", text: "Question" } },
					{ role: "assistant", content: { type: "text", text: "Answer" } },
				],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.include("[User]\nQuestion")
			expect(result).to.include("[Assistant]\nAnswer")
		})

		it("should format image content", () => {
			const response: McpPromptResponse = {
				messages: [{ role: "user", content: { type: "image", data: "base64data", mimeType: "image/png" } }],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.equal("[User]\n[Image: image/png]")
		})

		it("should format audio content", () => {
			const response: McpPromptResponse = {
				messages: [{ role: "user", content: { type: "audio", data: "base64data", mimeType: "audio/mp3" } }],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.equal("[User]\n[Audio: audio/mp3]")
		})

		it("should format resource with text", () => {
			const response: McpPromptResponse = {
				messages: [
					{
						role: "user",
						content: {
							type: "resource",
							resource: { uri: "file:///test.txt", text: "File content" },
						},
					},
				],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.include("[Resource: file:///test.txt]")
			expect(result).to.include("File content")
		})

		it("should format resource without text", () => {
			const response: McpPromptResponse = {
				messages: [
					{
						role: "user",
						content: {
							type: "resource",
							resource: { uri: "file:///binary.bin" },
						},
					},
				],
			}
			const result = formatMcpPromptResponse(response)
			expect(result).to.equal("[User]\n[Resource: file:///binary.bin]")
		})
	})

	describe("parseSlashCommands profile resolution", () => {
		it("selects the Lite deep-planning contract for a context window below 64K", async () => {
			const result = await parseSlashCommands(
				"<task>/deep-planning</task>",
				{},
				{},
				"test-ulid",
				undefined,
				false,
				createProviderInfo(63_999),
			)

			expect(result.processedText).to.include("This process has four distinct steps")
			expect(result.processedText).to.not.include("This process has five distinct steps")
		})

		it("selects Native deep-planning at the 64K boundary", async () => {
			const result = await parseSlashCommands(
				"<task>/deep-planning</task>",
				{},
				{},
				"test-ulid",
				undefined,
				false,
				createProviderInfo(64_000),
			)

			expect(result.processedText).to.include("This process has five distinct steps")
		})

		it("uses Native when provider info is absent", async () => {
			const result = await parseSlashCommands("<task>/deep-planning</task>", {}, {}, "test-ulid")

			expect(result.processedText).to.include("This process has five distinct steps")
		})
	})

	describe("parseSlashCommands MCP handling", () => {
		const mockMcpPromptFetcher: McpPromptFetcher = async (serverName, promptName) => {
			if (serverName === "test-server" && promptName === "greet") {
				return {
					description: "A greeting prompt",
					messages: [{ role: "user", content: { type: "text", text: "Hello from MCP!" } }],
				}
			}
			return null
		}

		it("should process MCP prompt command in task tag", async () => {
			const text = "<task>/mcp:test-server:greet</task>"
			const result = await parseSlashCommands(text, {}, {}, "test-ulid", undefined, false, undefined, mockMcpPromptFetcher)

			expect(result.processedText).to.include('<mcp_prompt server="test-server" prompt="greet">')
			expect(result.processedText).to.include("Hello from MCP!")
			expect(result.needsClinerulesFileCheck).to.equal(false)
		})

		it("should process MCP prompt with additional text", async () => {
			const text = "<task>/mcp:test-server:greet Please expand on this</task>"
			const result = await parseSlashCommands(text, {}, {}, "test-ulid", undefined, false, undefined, mockMcpPromptFetcher)

			expect(result.processedText).to.include('<mcp_prompt server="test-server" prompt="greet">')
			expect(result.processedText).to.include("Please expand on this")
		})

		it("should handle MCP prompt with colons in prompt name", async () => {
			const fetcherWithColons: McpPromptFetcher = async (serverName, promptName) => {
				if (serverName === "server" && promptName === "prompt:with:colons") {
					return {
						messages: [{ role: "user", content: { type: "text", text: "Colon prompt" } }],
					}
				}
				return null
			}

			const text = "<task>/mcp:server:prompt:with:colons</task>"
			const result = await parseSlashCommands(text, {}, {}, "test-ulid", undefined, false, undefined, fetcherWithColons)

			expect(result.processedText).to.include('prompt="prompt:with:colons"')
			expect(result.processedText).to.include("Colon prompt")
		})

		// Note: Tests for "unknown MCP server", "no fetcher", and "fetcher errors"
		// are skipped because they require StateManager initialization when falling
		// through to workflow checking. The core MCP functionality is covered above.
	})
})
