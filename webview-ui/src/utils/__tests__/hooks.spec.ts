// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { vi } from "vitest"
import { useMetaKeyDetection, useShortcut } from "../hooks"

describe("useShortcut", () => {
	it("should call the callback when the shortcut is pressed", () => {
		const callback = vi.fn()
		const removeEventListener = vi.fn()
		document.addEventListener = vi.fn((_event, _handler) => {
			// Simulate adding event listener
		}) as any

		renderHook(() => useShortcut({ key: "k", metaKey: true, callback }))

		// Simulate keydown event
		const event = new KeyboardEvent("keydown", { key: "k", metaKey: true })
		document.dispatchEvent(event as any)

		expect(callback).toHaveBeenCalled()
	})

	it("should not call the callback when the shortcut is not pressed", () => {
		const callback = vi.fn()
		renderHook(() => useShortcut({ key: "k", metaKey: true, callback }))

		// Simulate different key
		const event = new KeyboardEvent("keydown", { key: "j", metaKey: true })
		document.dispatchEvent(event as any)

		expect(callback).not.toHaveBeenCalled()
	})

	it("should not call the callback when typing in a text input when disableTextInputs is true", () => {
		const callback = vi.fn()
		renderHook(() => useShortcut({ key: "k", metaKey: true, callback, disableTextInputs: true }))

		// Simulate typing in input
		const input = document.createElement("input")
		const event = new KeyboardEvent("keydown", { key: "k", metaKey: true }) as any
		Object.defineProperty(event, "target", { value: input, writable: false })
		document.dispatchEvent(event as any)

		expect(callback).not.toHaveBeenCalled()
	})
})

describe("useMetaKeyDetection", () => {
	it("should detect Windows OS and metaKey from platform", () => {
		// Mock platform
		const originalPlatform = window.navigator.platform
		Object.defineProperty(window.navigator, "platform", { value: "Win32", configurable: true })

		const { result } = renderHook(() => useMetaKeyDetection())
		expect(result.current.platform).toBe("windows")
		expect(result.current.metaKey).toBe("Ctrl")

		// Restore platform
		Object.defineProperty(window.navigator, "platform", { value: originalPlatform, configurable: true })
	})

	it("should detect Mac OS and metaKey from platform", () => {
		const originalPlatform = window.navigator.platform
		Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true })

		const { result } = renderHook(() => useMetaKeyDetection())
		expect(result.current.platform).toBe("mac")
		expect(result.current.metaKey).toBe("⌘")

		Object.defineProperty(window.navigator, "platform", { value: originalPlatform, configurable: true })
	})

	it("should detect Linux OS and metaKey from platform", () => {
		const originalPlatform = window.navigator.platform
		Object.defineProperty(window.navigator, "platform", { value: "Linux x86_64", configurable: true })

		const { result } = renderHook(() => useMetaKeyDetection())
		expect(result.current.platform).toBe("linux")
		expect(result.current.metaKey).toBe("Ctrl")

		Object.defineProperty(window.navigator, "platform", { value: originalPlatform, configurable: true })
	})
})
