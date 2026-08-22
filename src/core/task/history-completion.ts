import type { ClineMessage } from "@shared/ExtensionMessage"

const CONVERSATION_SAY_TYPES: ReadonlySet<NonNullable<ClineMessage["say"]>> = new Set([
	"completion_result",
	"error",
	"qna_respond",
	"task",
	"text",
	"user_feedback",
	"user_feedback_diff",
])

function isConversationMessage(message: ClineMessage): boolean {
	if (message.partial) return false
	if (message.ask) return message.ask !== "resume_task" && message.ask !== "resume_completed_task"
	return message.say !== undefined && CONVERSATION_SAY_TYPES.has(message.say)
}

/** Return whether the latest user-visible conversation ended through attempt_completion. */
export function isTaskHistoryCompleted(messages: readonly ClineMessage[]): boolean {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index]
		if (!message || !isConversationMessage(message)) continue
		const isCompletion = message.ask === "completion_result" || message.say === "completion_result"
		return isCompletion && Boolean(message.text?.trim())
	}
	return false
}
