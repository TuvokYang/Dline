import { strict as assert } from "node:assert"
import { describe, it } from "vitest"
import { parseUseSubagentRequest, parseUseSubagentsRequest } from "../SubagentRequestParser"

describe("SubagentRequestParser", () => {
	it("defaults use_subagent to the built-in default profile when no name is provided", () => {
		const request = parseUseSubagentRequest({
			task: "review code",
			context: "check quality",
		})

		assert.equal(request.agentName, "default")
		assert.equal(request.context, "check quality")
	})

	it("parses stable use_subagent defaults", () => {
		const request = parseUseSubagentRequest({
			agent_name: "reviewer",
			task: "review code",
			context: "check quality",
		})

		assert.equal(request.kind, "single")
		assert.equal(request.agentName, "reviewer")
		assert.equal(request.context, "check quality")
		assert.equal(request.options.background, false)
		assert.equal(request.options.timeoutSeconds, 600)
		assert.match(request.prompt, /<task>\s*review code\s*<\/task>/)
	})

	it("parses background and timeout in seconds", () => {
		const request = parseUseSubagentRequest({
			agent_name: "reviewer",
			task: "review code",
			context: "check quality",
			background: "true",
			timeout: "30",
		})

		assert.equal(request.options.background, true)
		assert.equal(request.options.timeoutSeconds, 30)
	})

	it("rejects the removed use_subagent parameter names", () => {
		assert.throws(
			() =>
				parseUseSubagentRequest({
					subagent_name: "reviewer",
					task: "review code",
					content: "legacy context",
				}),
			/Missing required parameter: context/,
		)
	})

	it("requires batch prompts to contain task and context", () => {
		assert.throws(
			() => parseUseSubagentsRequest({ prompt_1: "<task>one</task>" }),
			/Each prompt must include a non-empty <context> section/,
		)
	})

	it("parses up to five batch prompts", () => {
		const request = parseUseSubagentsRequest({
			prompt_1: "<task>one</task><context>ctx one</context>",
			prompt_2: "<task>two</task><context>ctx two</context>",
			prompt_3: "<task>three</task><context>ctx three</context>",
			prompt_4: "<task>four</task><context>ctx four</context>",
			prompt_5: "<task>five</task><context>ctx five</context>",
		})

		assert.equal(request.kind, "batch")
		assert.equal(request.items.length, 5)
		assert.equal(request.items[0].task, "one")
		assert.equal(request.items[4].context, "ctx five")
	})
})
