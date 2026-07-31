import type { ClineMessage, TaskViewState } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { groupLowStakesTools, isToolGroup, resolveApiErrorMessage } from "./messageUtils"

const createTextMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "text",
	text,
	ts,
})

const createToolMessage = (ts: number, tool: string): ClineMessage => ({
	type: "say",
	say: "tool",
	text: JSON.stringify({ tool, path: "src/file.ts" }),
	ts,
})

const createReasoningMessage = (ts: number, text: string): ClineMessage => ({
	type: "say",
	say: "reasoning",
	text,
	ts,
})

/**
 * Create an error-recovery task UI state for message resolution tests.
 */
const createErrorTaskViewState = (): TaskViewState => ({
	taskId: "task-1",
	phase: "paused",
	stateRevision: 2,
	activeInteraction: {
		taskId: "task-1",
		turnId: "turn-1",
		interactionId: "interaction-1",
		kind: "error_retry",
		status: "awaiting",
		stateRevision: 2,
		taskAsk: "api_req_failed",
		presentationKind: "api_req_failed",
		askMessageTs: 2,
	},
	input: { enabled: false, acceptsText: false, acceptsImages: false, acceptsFiles: false },
	footer: { actions: [] },
})

describe("resolveApiErrorMessage", () => {
	it("uses the projected error interaction with the current presentation message", () => {
		const resolved = resolveApiErrorMessage({
			isLast: true,
			lastModifiedMessage: { type: "ask", ask: "api_req_failed", text: "API request failed", ts: 2 },
			taskViewState: createErrorTaskViewState(),
		})

		expect(resolved).toBe("API request failed")
	})

	it("does not attach the projected error interaction to an earlier request row", () => {
		const resolved = resolveApiErrorMessage({
			isLast: false,
			lastModifiedMessage: { type: "ask", ask: "api_req_failed", text: "API request failed", ts: 2 },
			taskViewState: createErrorTaskViewState(),
		})

		expect(resolved).toBeUndefined()
	})

	it("does not attach a projected error before its presentation message is synchronized", () => {
		const resolved = resolveApiErrorMessage({
			isLast: true,
			lastModifiedMessage: { type: "ask", ask: "api_req_failed", text: "Previous API error", ts: 1 },
			taskViewState: createErrorTaskViewState(),
		})

		expect(resolved).toBeUndefined()
	})

	it("keeps legacy api_req_failed message when snapshot-first message is unavailable", () => {
		const resolved = resolveApiErrorMessage({
			isLast: true,
			lastModifiedMessage: { type: "ask", ask: "api_req_failed", text: "Legacy API error", ts: 1 },
		})

		expect(resolved).toBe("Legacy API error")
	})

	it("does not show stale legacy api_req_failed message on non-last rows", () => {
		const resolved = resolveApiErrorMessage({
			isLast: false,
			lastModifiedMessage: { type: "ask", ask: "api_req_failed", text: "Legacy API error", ts: 1 },
		})

		expect(resolved).toBeUndefined()
	})
})

describe("groupLowStakesTools", () => {
	it("ignores text that arrives after a low-stakes tool group has started", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "readFile"),
			createTextMessage(3, "Late text that should be ignored"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(isToolGroup(grouped[1])).toBe(true)

		if (isToolGroup(grouped[1])) {
			expect(grouped[1].every((message) => message.say !== "text")).toBe(true)
		}
	})

	it("keeps text when no low-stakes tool group is active", () => {
		const grouped = groupLowStakesTools([
			createTextMessage(1, "Initial text"),
			createToolMessage(2, "editedExistingFile"),
			createTextMessage(3, "Follow-up text"),
		])

		expect(grouped).toHaveLength(3)
		expect(grouped[0]).toMatchObject({ type: "say", say: "text", text: "Initial text" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" })
		expect(grouped[2]).toMatchObject({ type: "say", say: "text", text: "Follow-up text" })
	})

	it("keeps standalone reasoning when no low-stakes tool group follows", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createTextMessage(2, "Answer text"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Thinking through options" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "text", text: "Answer text" })
	})

	it("keeps standalone reasoning before a non-low-stakes tool", () => {
		const grouped = groupLowStakesTools([
			createReasoningMessage(1, "Thinking through options"),
			createToolMessage(2, "editedExistingFile"),
		])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Thinking through options" })
		expect(grouped[1]).toMatchObject({ type: "say", say: "tool" })
	})

	it("keeps reasoning visible when low-stakes tool group starts immediately after", () => {
		const grouped = groupLowStakesTools([createReasoningMessage(1, "Planning next read"), createToolMessage(2, "readFile")])

		expect(grouped).toHaveLength(2)
		expect(grouped[0]).toMatchObject({ type: "say", say: "reasoning", text: "Planning next read" })
		expect(isToolGroup(grouped[1])).toBe(true)
	})
})
