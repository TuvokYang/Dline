import { type ClineStorageMessage, imageSourceMediaType } from "@/shared/messages/content"

/**
 * Filters out image blocks from messages since Claude Code doesn't support images.
 * Replaces image blocks with text placeholders similar to how VSCode LM provider handles it.
 */
export function filterMessagesForClaudeCode(messages: ClineStorageMessage[]): ClineStorageMessage[] {
	return messages.map((message) => {
		// Handle simple string messages
		if (typeof message.content === "string") {
			return message
		}

		// Handle complex message structures
		const filteredContent = message.content.map((block) => {
			if (block.type === "image") {
				// Replace image blocks with text placeholders
				const sourceType = block.source.type
				const mediaType = imageSourceMediaType(block.source)
				return {
					type: "text" as const,
					text: `[Image (${sourceType}): ${mediaType} not supported by Claude Code]`,
				}
			}
			return block
		})

		return {
			...message,
			content: filteredContent,
		}
	})
}
