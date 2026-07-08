import { strict as assert } from "node:assert"
import { describe, it } from "vitest"
import type { ClineStorageMessage } from "@/shared/messages"
import { ensureApiMessages } from "../api-context"

/**
 * Build a minimal user message for API context tests.
 * @param text Text content for the message.
 * @returns A storage message with user role.
 */
function userMessage(text: string): ClineStorageMessage {
	return { role: "user", content: [{ type: "text", text }] } as ClineStorageMessage
}

describe("ensureApiMessages", () => {
	it("uses fallback history when context manager returns empty messages", () => {
		const fallback = [userMessage("recover from process anyway")]

		const result = ensureApiMessages([], fallback)

		assert.deepEqual(result, fallback)
	})

	it("throws a clear error when both managed and fallback histories are empty", () => {
		assert.throws(() => ensureApiMessages([], []), /Refusing to send an empty API conversation/)
	})
})
