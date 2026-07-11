import { describe, it } from "vitest"
import "should"
import should from "should"
import { MessageStateHandler } from "../core/task/message-state"
import { TaskState } from "../core/task/TaskState"
import { ClineMessage } from "../shared/ExtensionMessage"

/**
 * Unit tests for MessageStateHandler's mutex protection (RC-4)
 * These tests verify that concurrent operations on message state are properly serialized
 * to prevent race conditions, particularly the TOCTOU bug in addToClineMessages
 */
describe("MessageStateHandler Mutex Protection", () => {
	/**
	 * Helper to create a minimal MessageStateHandler for testing
	 */
	function createTestHandler(): MessageStateHandler {
		const taskState = new TaskState()
		const mockStore = (initial: any[] = []) => {
			let data = [...initial]
			return {
				getAll: () => data,
				get count() {
					return data.length
				},
				overwrite: async (msgs: any[]) => {
					data = [...msgs]
				},
				append: async (msg: any) => {
					data.push(msg)
				},
				addMessage: async (msg: any) => {
					data.push(msg)
				},
				updateMessage: async (index: number, update: any) => {
					data[index] = { ...data[index], ...update }
				},
				deleteMessage: async (index: number) => {
					data.splice(index, 1)
				},
				clear: async () => {
					data = []
				},
				upsertMessage: (msg: any) => {
					const index = data.findIndex((item) => item.ts === msg.ts)
					if (index >= 0) {
						data[index] = { ...data[index], ...msg }
						return index
					}
					data.push(msg)
					return data.length - 1
				},
				finalizeMessage: async (msg: any) => {
					const index = data.findIndex((item) => item.ts === msg.ts)
					if (index >= 0) {
						data[index] = { ...data[index], ...msg, partial: false }
					} else {
						data.push({ ...msg, partial: false })
					}
				},
			}
		}
		return new MessageStateHandler({
			taskId: "test-task-id",
			ulid: "test-ulid",
			taskState,
			updateTaskHistory: async () => [],
			apiConversation: mockStore() as any,
			uiMessage: mockStore() as any,
		})
	}

	/**
	 * Helper to create a test ClineMessage
	 */
	function createTestMessage(text: string): ClineMessage {
		return {
			ts: Date.now(),
			type: "say",
			say: "text",
			text,
		}
	}

	it("should initialize with empty message arrays", () => {
		const handler = createTestHandler()
		handler.clineMessages.length.should.equal(0)
		handler.apiConversationHistory.length.should.equal(0)
	})

	it("should set and get API conversation history", async () => {
		const handler = createTestHandler()
		const testHistory = [{ role: "user" as const, content: "test message" }]

		handler.apiConversationHistory = testHistory
		// Setter is async (overwrite returns Promise) — await microtask to let it complete
		await new Promise((r) => setTimeout(r, 0))
		handler.apiConversationHistory.should.deepEqual(testHistory)
	})

	it("should set and get cline messages", async () => {
		const handler = createTestHandler()
		const testMessages = [createTestMessage("test1"), createTestMessage("test2")]

		handler.clineMessages = testMessages
		await new Promise((r) => setTimeout(r, 0))
		handler.clineMessages.should.deepEqual(testMessages)
	})

	/**
	 * CRITICAL TEST: Verify that addToClineMessages is atomic
	 * This test simulates the race condition that can occur when multiple
	 * addToClineMessages calls happen concurrently without proper mutex protection
	 */
	it("should handle concurrent addToClineMessages atomically", async () => {
		// Increase timeout for this test as it involves async operations
		// mocha this.timeout removed — vitest uses testTimeout config: (5000)

		const handler = createTestHandler()

		// Set up initial API conversation history
		const initialHistory = [
			{ role: "user" as const, content: "msg1" },
			{ role: "assistant" as const, content: "response1" },
			{ role: "user" as const, content: "msg2" },
		]
		handler.apiConversationHistory = initialHistory
		await new Promise((r) => setTimeout(r, 0))

		// Add initial message to establish baseline
		const initialMsg = createTestMessage("initial")
		await handler.addToClineMessages(initialMsg)

		// Verify initial state
		const messages = handler.clineMessages
		messages.length.should.equal(1)
		messages[0].conversationHistoryIndex?.should.equal(2) // length - 1 = 3 - 1 = 2

		// Now simulate concurrent additions
		// Without mutex protection, these could race and get the same index
		const msg1 = createTestMessage("concurrent1")
		const msg2 = createTestMessage("concurrent2")
		const msg3 = createTestMessage("concurrent3")

		// Add more messages to API history to simulate ongoing conversation
		handler.apiConversationHistory = [
			...initialHistory,
			{ role: "assistant" as const, content: "response2" },
			{ role: "user" as const, content: "msg3" },
		]
		await new Promise((r) => setTimeout(r, 0))

		// Execute concurrent operations
		const results = await Promise.all([
			handler.addToClineMessages(msg1),
			handler.addToClineMessages(msg2),
			handler.addToClineMessages(msg3),
		])

		// Verify all operations completed
		results.length.should.equal(3)

		// Get final state
		const finalMessages = handler.clineMessages
		finalMessages.length.should.equal(4) // initial + 3 concurrent

		// CRITICAL ASSERTION: Each message should have a valid conversationHistoryIndex
		// With proper mutex protection, these indices should be set correctly
		// even though the operations ran concurrently
		finalMessages.forEach((msg, _idx) => {
			should.exist(msg.conversationHistoryIndex)
			msg.conversationHistoryIndex?.should.be.a.Number()
			msg.conversationHistoryIndex?.should.be.greaterThanOrEqual(0)
		})
	})

	/**
	 * Test that updateClineMessage operations are atomic
	 */
	it("should handle concurrent updateClineMessage atomically", async () => {
		// mocha this.timeout removed — vitest uses testTimeout config: (5000)

		const handler = createTestHandler()

		// Set up initial messages
		const msgs = [createTestMessage("msg1"), createTestMessage("msg2"), createTestMessage("msg3")]
		handler.clineMessages = msgs
		await new Promise((r) => setTimeout(r, 0))

		// Perform concurrent updates to different messages
		await Promise.all([
			handler.updateClineMessage(0, { text: "updated1" }),
			handler.updateClineMessage(1, { text: "updated2" }),
			handler.updateClineMessage(2, { text: "updated3" }),
		])

		const finalMessages = handler.clineMessages
		finalMessages[0]?.text?.should.equal("updated1")
		finalMessages[1]?.text?.should.equal("updated2")
		finalMessages[2]?.text?.should.equal("updated3")
	})

	/**
	 * Test that deleteClineMessage operations are atomic
	 */
	it("should handle deleteClineMessage with proper validation", async () => {
		const handler = createTestHandler()

		// Set up initial messages
		const msgs = [createTestMessage("msg1"), createTestMessage("msg2"), createTestMessage("msg3")]
		handler.clineMessages = msgs

		// Delete middle message
		await handler.deleteClineMessage(1)

		const finalMessages = handler.clineMessages
		finalMessages.length.should.equal(2)
		finalMessages[0]?.text?.should.equal("msg1")
		finalMessages[1]?.text?.should.equal("msg3")
	})

	/**
	 * Test that invalid indices are rejected
	 */
	it("should throw error for invalid message index in updateClineMessage", async () => {
		const handler = createTestHandler()
		handler.clineMessages = [createTestMessage("msg1")]

		try {
			await handler.updateClineMessage(5, { text: "invalid" })
			throw new Error("Should have thrown")
		} catch (error) {
			if (error instanceof Error) {
				error.message.should.match(/Invalid message index/)
			}
		}
	})

	/**
	 * Test that invalid indices are rejected in deleteClineMessage
	 */
	it("should throw error for invalid message index in deleteClineMessage", async () => {
		const handler = createTestHandler()
		handler.clineMessages = [createTestMessage("msg1")]

		try {
			await handler.deleteClineMessage(-1)
			throw new Error("Should have thrown")
		} catch (error) {
			if (error instanceof Error) {
				error.message.should.match(/Invalid message index/)
			}
		}
	})

	/**
	 * Test API conversation history operations
	 */
	it("should handle concurrent API conversation history operations", async () => {
		// mocha this.timeout removed — vitest uses testTimeout config: (5000)

		const handler = createTestHandler()

		// Perform concurrent additions
		await Promise.all([
			handler.addToApiConversationHistory({ role: "user", content: "msg1", ts: Date.now() }),
			handler.addToApiConversationHistory({ role: "assistant", content: "response1", ts: Date.now() }),
			handler.addToApiConversationHistory({ role: "user", content: "msg2", ts: Date.now() }),
		])

		const history = handler.apiConversationHistory
		history.length.should.equal(3)
		history[0].role.should.equal("user")
		history[1].role.should.equal("assistant")
		history[2].role.should.equal("user")
	})

	/**
	 * Test overwrite API conversation history
	 */
	it("should handle overwriteApiConversationHistory atomically", async () => {
		const handler = createTestHandler()

		// Set initial history
		handler.apiConversationHistory = [{ role: "user", content: "old", ts: Date.now() }]

		// Overwrite with new history
		const newHistory = [
			{ role: "user" as const, content: "new1", ts: Date.now() },
			{ role: "assistant" as const, content: "new2", ts: Date.now() },
		]
		await handler.overwriteApiConversationHistory(newHistory)

		const finalHistory = handler.apiConversationHistory
		finalHistory.length.should.equal(2)
		finalHistory[0].content.should.equal("new1")
		finalHistory[1].content.should.equal("new2")
	})

	it("upsertClineMessageInMemory then finalizeClineMessage keeps a single message", async () => {
		const handler = createTestHandler()
		const ts = Date.now()

		// Upsert partial
		const partial = await handler.upsertClineMessageInMemory({
			ts,
			type: "say",
			say: "text",
			text: "partial",
			partial: true,
		} as ClineMessage)
		should.equal(partial.partial, true)

		// MessageChannel.pushMessage stores the returned partial in the runtime message collection.
		await handler.uiMessage?.upsertMessage(partial)

		// Verify single message in memory
		handler.clineMessages.length.should.equal(1)

		// Finalize with same ts
		const finalized = await handler.finalizeClineMessage({
			ts,
			type: "say",
			say: "text",
			text: "final",
		} as ClineMessage)
		should.equal(finalized.partial, false)

		// Still exactly one message — upsert + finalize = same ts single entry
		const messages = handler.clineMessages
		messages.length.should.equal(1)
		messages[0].ts.should.equal(ts)
		should.equal(messages[0].partial, false)
		should.equal(messages[0].text, "final")
	})
})
