import { describe, expect, it } from "vitest"
import { FocusChainPrompts } from "../prompts"

describe("FocusChainPrompts", () => {
	it("exports localized prompt strings", () => {
		expect(FocusChainPrompts.initial).toEqual(expect.any(String))
		expect(FocusChainPrompts.completed).toEqual(expect.any(String))
	})
})
