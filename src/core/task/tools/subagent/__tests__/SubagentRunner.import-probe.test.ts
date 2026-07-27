import { describe, expect, it } from "vitest"

describe("SubagentRunner import probe", () => {
	it("verifies SubagentRunner import graph resolves", async () => {
		const module = await import("../SubagentRunner")

		expect(module.SubagentRunner).toBeTypeOf("function")
	})
})
