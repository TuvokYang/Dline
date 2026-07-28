import type { ChatInputSendShortcut } from "@shared/ChatInputSendShortcut"

export interface ChatInputKeyEvent {
	key: string
	altKey: boolean
	ctrlKey: boolean
	metaKey: boolean
	shiftKey: boolean
}

export function shouldSendChatInput(event: ChatInputKeyEvent, shortcut: ChatInputSendShortcut, isComposing: boolean): boolean {
	if (event.key !== "Enter" || isComposing || event.altKey || event.metaKey) {
		return false
	}

	switch (shortcut) {
		case "ctrlEnter":
			return event.ctrlKey && !event.shiftKey
		case "shiftEnter":
			return event.shiftKey && !event.ctrlKey
		case "enter":
			return !event.ctrlKey && !event.shiftKey
	}
}
