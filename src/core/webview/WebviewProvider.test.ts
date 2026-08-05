import { describe, expect, it } from "vitest"
import { shouldUseWebviewHmr } from "./WebviewProvider"

describe("shouldUseWebviewHmr", () => {
	it("uses HMR only for an explicit development host", () => {
		expect(shouldUseWebviewHmr(2, undefined)).toBe(true)
		expect(shouldUseWebviewHmr(1, undefined)).toBe(false)
		expect(shouldUseWebviewHmr(3, undefined)).toBe(false)
	})

	it("uses bundled assets in E2E even when the extension host is in development mode", () => {
		expect(shouldUseWebviewHmr(2, "true")).toBe(false)
		expect(shouldUseWebviewHmr(2, "1")).toBe(false)
	})
})
