import type { ApiHandler } from "@core/api"
import type { ApiStream } from "@core/api/transform/stream"
import { ExplicitInstructionRegistry } from "@core/task/explicit-instructions/ExplicitInstructionRegistry"
import { ExplicitInstructionRequestScope } from "@core/task/explicit-instructions/ExplicitInstructionRequestScope"
import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it } from "vitest"
import { runInternalCompactionPass } from "../internal-compaction-pass"

function createApi(stream: ApiStream): ApiHandler {
	return {
		createMessage: () => stream,
		getModel: () => ({ id: "test-model", info: { id: "test-model" } }),
	}
}

describe("internal compaction Pass", () => {
	it("parses a chat-family tool_calls chunk that carries complete arguments without a completion phase", async () => {
		async function* stream(): ApiStream {
			yield {
				type: "tool_calls",
				function_id: "call-chat-summary",
				tool_index: 0,
				tool_call: {
					function: {
						name: ClineDefaultTool.SUMMARIZE_TASK,
						arguments: JSON.stringify({ context: "Chat-family cumulative summary" }),
					},
				},
			}
			yield { type: "usage", inputTokens: 100, outputTokens: 0 }
			yield { type: "usage", usageMode: "delta", inputTokens: 0, outputTokens: 8 }
			yield { type: "usage", usageMode: "delta", inputTokens: 0, outputTokens: 12 }
			yield { type: "usage", inputTokens: 100, outputTokens: 20 }
		}

		const registry = new ExplicitInstructionRegistry()
		const instructions = new ExplicitInstructionRequestScope(registry, {
			requestId: "request-chat",
			attemptId: "attempt-0",
		})
		instructions.register({
			type: "summarize_task",
			source: "auto_compaction",
			targetTool: ClineDefaultTool.SUMMARIZE_TASK,
			operationId: "operation-chat",
		})

		const result = await runInternalCompactionPass({
			api: createApi(stream()),
			providerInput: {
				systemPrompt: "system",
				messages: [{ role: "user", content: [{ type: "text", text: "history" }] }],
				tools: [],
				serverTools: [],
				providerOutputCap: 1_000,
			},
			explicitInstructions: instructions,
		})

		expect(result.summary).toBe("Chat-family cumulative summary")
		expect(result.usage).toEqual({
			inputTokens: 100,
			outputTokens: 20,
			cacheWriteTokens: 0,
			cacheReadTokens: 0,
			totalTokens: 120,
		})
		expect(instructions.getPendingToolAuthorization(ClineDefaultTool.SUMMARIZE_TASK)).toBeUndefined()
	})

	it("returns one authorized summary and reliable usage without UI or canonical-history ports", async () => {
		async function* stream(): ApiStream {
			yield {
				type: "tool_calls",
				function_id: "call-summary",
				phase: "completed",
				tool_index: 0,
				tool_call: {
					function: {
						name: ClineDefaultTool.SUMMARIZE_TASK,
						arguments: JSON.stringify({ context: "Cumulative summary" }),
					},
				},
			}
			yield { type: "usage", inputTokens: 100, outputTokens: 20 }
		}

		const registry = new ExplicitInstructionRegistry()
		const instructions = new ExplicitInstructionRequestScope(registry, {
			requestId: "request-1",
			attemptId: "attempt-0",
		})
		instructions.register({
			type: "summarize_task",
			source: "auto_compaction",
			targetTool: ClineDefaultTool.SUMMARIZE_TASK,
			operationId: "operation-1",
		})

		const result = await runInternalCompactionPass({
			api: createApi(stream()),
			providerInput: {
				systemPrompt: "system",
				messages: [{ role: "user", content: [{ type: "text", text: "history" }] }],
				tools: [],
				serverTools: [],
				providerOutputCap: 1_000,
			},
			explicitInstructions: instructions,
		})

		expect(result).toEqual({
			summary: "Cumulative summary",
			usage: {
				inputTokens: 100,
				outputTokens: 20,
				cacheWriteTokens: 0,
				cacheReadTokens: 0,
				totalTokens: 120,
			},
		})
		expect(instructions.getPendingToolAuthorization(ClineDefaultTool.SUMMARIZE_TASK)).toBeUndefined()
	})
})
