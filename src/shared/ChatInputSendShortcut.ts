export const CHAT_INPUT_SEND_SHORTCUTS = ["enter", "ctrlEnter", "shiftEnter"] as const

export type ChatInputSendShortcut = (typeof CHAT_INPUT_SEND_SHORTCUTS)[number]

export const DEFAULT_CHAT_INPUT_SEND_SHORTCUT: ChatInputSendShortcut = "enter"

export function isChatInputSendShortcut(value: unknown): value is ChatInputSendShortcut {
	return CHAT_INPUT_SEND_SHORTCUTS.some((shortcut) => shortcut === value)
}
