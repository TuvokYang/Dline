import { strict as assert } from "node:assert"
import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, it } from "vitest"
import { TaskPhase } from "../TaskPhase"
import type { TaskSnapshot } from "../TaskSnapshot"
import { findAnchoredAsk } from "../TaskSnapshotReplayer"

/**
 * Creates an ask message for snapshot replay tests.
 * @param ts Message timestamp.
 * @param ask Ask type.
 * @param apiIndex API conversation history index.
 * @returns A ClineMessage ask object.
 */
function askMessage(ts: number, ask: ClineMessage["ask"], apiIndex: number): ClineMessage {
	return {
		ts,
		type: "ask",
		ask,
		text: "{}",
		partial: false,
		conversationHistoryIndex: apiIndex,
	} as ClineMessage
}

/**
 * Creates a say message for snapshot replay tests.
 * @param ts Message timestamp.
 * @param say Say type.
 * @param apiIndex API conversation history index.
 * @returns A ClineMessage say object.
 */
function sayMessage(ts: number, say: ClineMessage["say"], apiIndex: number): ClineMessage {
	return {
		ts,
		type: "say",
		say,
		text: "{}",
		conversationHistoryIndex: apiIndex,
	} as ClineMessage
}

/**
 * Creates an awaiting-conversation snapshot anchored to an ask message.
 * @param messageTs Ask message timestamp.
 * @returns A TaskSnapshot object.
 */
function conversationSnapshot(messageTs: number): TaskSnapshot {
	return {
		phase: TaskPhase.AWAITING_APPROVAL,
		apiIndex: 3,
		timestamp: 110,
		awaiting: {
			kind: "conversation",
			taskAsk: "qna_respond",
			messageTs,
		},
	}
}

describe("TaskSnapshotReplayer", () => {
	it("does not keep a turn-ending ask active after tail user feedback and a later request", () => {
		const qnaAsk = askMessage(100, "qna_respond", 3)
		const messages: ClineMessage[] = [qnaAsk, sayMessage(120, "user_feedback", 3), sayMessage(130, "api_req_started", 4)]

		const result = findAnchoredAsk(conversationSnapshot(qnaAsk.ts), messages)

		assert.equal(result, undefined)
	})

	it("keeps a turn-ending ask active when no tail event consumes it", () => {
		const qnaAsk = askMessage(100, "qna_respond", 3)
		const messages: ClineMessage[] = [qnaAsk]

		const result = findAnchoredAsk(conversationSnapshot(qnaAsk.ts), messages)

		assert.equal(result, qnaAsk)
	})
})
