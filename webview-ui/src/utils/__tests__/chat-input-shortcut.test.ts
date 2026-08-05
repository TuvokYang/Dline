import { type ChatInputSendShortcut, getChatInputSendShortcutLabel } from "@shared/ChatInputSendShortcut"
import { describe, expect, it } from "vitest"
import { type ChatInputKeyEvent, shouldSendChatInput } from "../chat-input-shortcut"

const enterEvent = (overrides: Partial<ChatInputKeyEvent> = {}): ChatInputKeyEvent => ({
	key: "Enter",
	altKey: false,
	ctrlKey: false,
	metaKey: false,
	shiftKey: false,
	...overrides,
})

describe("shouldSendChatInput", () => {
	it.each([
		["enter", enterEvent()],
		["ctrlEnter", enterEvent({ ctrlKey: true })],
		["shiftEnter", enterEvent({ shiftKey: true })],
	] satisfies Array<[ChatInputSendShortcut, ChatInputKeyEvent]>)("sends for %s", (shortcut, event) => {
		expect(shouldSendChatInput(event, shortcut, false)).toBe(true)
	})

	it.each([
		["enter", enterEvent({ ctrlKey: true })],
		["enter", enterEvent({ shiftKey: true })],
		["ctrlEnter", enterEvent()],
		["ctrlEnter", enterEvent({ ctrlKey: true, shiftKey: true })],
		["shiftEnter", enterEvent()],
		["shiftEnter", enterEvent({ ctrlKey: true, shiftKey: true })],
	] satisfies Array<
		[ChatInputSendShortcut, ChatInputKeyEvent]
	>)("does not send unmatched Enter combination for %s", (shortcut, event) => {
		expect(shouldSendChatInput(event, shortcut, false)).toBe(false)
	})

	it("does not send while composing", () => {
		expect(shouldSendChatInput(enterEvent(), "enter", true)).toBe(false)
	})

	it("does not send for other keys or Alt/Meta combinations", () => {
		expect(shouldSendChatInput(enterEvent({ key: "a" }), "enter", false)).toBe(false)
		expect(shouldSendChatInput(enterEvent({ altKey: true }), "enter", false)).toBe(false)
		expect(shouldSendChatInput(enterEvent({ metaKey: true }), "enter", false)).toBe(false)
	})
})

describe("chat input send shortcut labels", () => {
	it.each([
		["enter", "Enter"],
		["ctrlEnter", "Ctrl + Enter"],
		["shiftEnter", "Shift + Enter"],
	] as const)("renders the %s label", (shortcut, label) => {
		expect(getChatInputSendShortcutLabel(shortcut)).toBe(label)
	})

	it("defaults to Enter when the setting is missing", () => {
		expect(getChatInputSendShortcutLabel()).toBe("Enter")
	})
})
