import { describe, expect, it } from "vitest"
import { PromptProfile } from "../types"

describe("typed PromptProfile contract", () => {
	it("exposes exactly the stable Native and Lite profile values", () => {
		expect(Object.values(PromptProfile)).toEqual(["native", "lite"])
	})
})
