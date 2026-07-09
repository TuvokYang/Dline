import { strict as assert } from "node:assert"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, it, vi } from "vitest"
import { MessageChannel } from "../MessageChannel"
import type { MessageStateHandler } from "../message-state"
import type { TaskState } from "../TaskState"

function createMessageChannel() {
	const clineMessages: ClineMessage[] = []
	const taskState = {
		abort: false,
		askResponse: undefined,
		askResponseText: undefined,
		askResponseImages: undefined,
		askResponseFiles: undefined,
		lastMessageTs: undefined,
	} as TaskState

	let lastTs = 0
	const channel = new MessageChannel({
		pushMessage: () => {},
		syncState: async () => {},
		messageStateHandler: {
			get clineMessages() {
				return clineMessages
			},
			addToClineMessages: async (message: ClineMessage) => {
				clineMessages.push(message)
			},
			updateClineMessage: async (index: number, updates: Partial<ClineMessage>) => {
				Object.assign(clineMessages[index], updates)
			},
			upsertClineMessageInMemory: async (message: ClineMessage) => {
				const index = clineMessages.findIndex((candidate) => candidate.ts === message.ts)
				if (index >= 0) {
					clineMessages[index] = message
				} else {
					clineMessages.push(message)
				}
				return message
			},
			finalizeClineMessage: async (message: ClineMessage) => {
				const index = clineMessages.findIndex((candidate) => candidate.ts === message.ts)
				if (index >= 0) {
					clineMessages[index] = message
				} else {
					clineMessages.push(message)
				}
				return message
			},
		} as unknown as MessageStateHandler,
		taskState,
		getProviderInfo: () => ({ providerId: "test", modelId: "test-model", mode: "act" }),
		genTs: () => ++lastTs,
	})

	return { channel, clineMessages, taskState }
}

async function flushMicrotasks(iterations = 5) {
	for (let i = 0; i < iterations; i++) {
		await Promise.resolve()
	}
}

describe("MessageChannel.say", () => {
	it("allows lifecycle state snapshots while the task is aborted", async () => {
		const { channel, clineMessages, taskState } = createMessageChannel()
		taskState.abort = true

		await channel.say("state_snapshot", JSON.stringify({ phase: "cancelling", apiIndex: 1, timestamp: Date.now() }))

		assert.equal(clineMessages.length, 1)
		assert.equal(clineMessages[0].say, "state_snapshot")
	})

	it("rejects regular visible messages while the task is aborted", async () => {
		const { channel, taskState } = createMessageChannel()
		taskState.abort = true

		await assert.rejects(channel.say("text", "should not continue after abort"), /Dline instance aborted/)
	})
})

describe("MessageChannel.ask", () => {
	it("does not treat state_snapshot messages as superseding a pending ask", async () => {
		const clock = vi.useFakeTimers()
		const { channel } = createMessageChannel()

		try {
			const askPromise = channel.ask("resume_task")
			let settled = false
			void askPromise.then(
				() => {
					settled = true
				},
				() => {
					settled = true
				},
			)

			await flushMicrotasks()
			await channel.say("state_snapshot", JSON.stringify({ phase: "streaming", apiIndex: -1, timestamp: Date.now() }))
			await clock.advanceTimersByTimeAsync(200)

			assert.equal(settled, false)

			channel.resolve("yesButtonClicked")
			await clock.advanceTimersByTimeAsync(100)

			const result = await askPromise
			assert.equal(result.response, "yesButtonClicked")
		} finally {
			clock.useRealTimers()
		}
	})

	it("allows user_feedback created by the current ask response before the ask settles", async () => {
		const clock = vi.useFakeTimers()
		const { channel, clineMessages } = createMessageChannel()

		try {
			const askPromise = channel.ask("qna_respond")

			await flushMicrotasks()
			channel.resolve("messageResponse", "My lord response")
			await channel.say("user_feedback", "My lord response")
			await clock.advanceTimersByTimeAsync(100)

			const result = await askPromise
			assert.equal(result.response, "messageResponse")
			assert.equal(result.text, "My lord response")
			assert.equal(clineMessages.at(-1)?.say, "user_feedback")
		} finally {
			clock.useRealTimers()
		}
	})

	it("still treats non-internal messages as superseding a pending ask", async () => {
		const clock = vi.useFakeTimers()
		const { channel } = createMessageChannel()

		try {
			const askPromise = channel.ask("resume_task")
			const rejection = assert.rejects(askPromise, /Current ask promise was ignored/)

			await flushMicrotasks()
			await channel.say("text", "new visible message")
			await clock.advanceTimersByTimeAsync(100)

			await rejection
		} finally {
			clock.useRealTimers()
		}
	})
})
