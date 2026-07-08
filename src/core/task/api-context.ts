/**
 * Ensure an API request never uses an empty conversation context.
 * @param managedMessages Messages returned by context management.
 * @param fallbackMessages Full API history used as a safe fallback.
 * @returns Non-empty messages for provider requests.
 * @throws Error when both managed and fallback contexts are empty.
 */
export function ensureApiMessages<T>(managedMessages: T[], fallbackMessages: T[]): T[] {
	if (managedMessages.length > 0) {
		return managedMessages
	}

	if (fallbackMessages.length > 0) {
		return fallbackMessages
	}

	throw new Error("Refusing to send an empty API conversation")
}
