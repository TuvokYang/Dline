export const MODE_SWITCH_COMPACT_SIGNAL = "__dline_mode_switch_compact__"

/**
 * Identify the private signal used to exit a conversational ask before compaction.
 *
 * @param text Ask response text.
 * @returns True only for the internal mode-switch compact signal.
 */
export function isCompactSignal(text?: string): boolean {
	return text === MODE_SWITCH_COMPACT_SIGNAL
}
