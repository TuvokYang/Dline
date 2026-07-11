const MISSING_PROMPT_MARKER = "[MISSING:"

/**
 * Reject unresolved i18n markers before prompt content is compared or persisted.
 *
 * @param snapshotName Snapshot file name used for diagnostic context.
 * @param content Generated prompt or tool schema content.
 * @throws Error when the generated content contains an unresolved prompt marker.
 */
export function assertPromptContent(snapshotName: string, content: string): void {
	if (content.includes(MISSING_PROMPT_MARKER)) {
		throw new Error(`Refusing to use unresolved prompt content for snapshot: ${snapshotName}`)
	}
}
