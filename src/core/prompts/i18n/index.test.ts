import { describe, expect, it } from "vitest"
import { getPrompt } from "./index"

describe("prompt i18n registry", () => {
	it("loads core English prompt modules during initialization", () => {
		const prompts = [
			getPrompt("agentRole", "main"),
			getPrompt("responses", "toolDenied"),
			getPrompt("focusChain", "recommended"),
			getPrompt("toolUseIndex", "main"),
		]

		for (const prompt of prompts) {
			expect(prompt).not.toContain("[MISSING:")
			expect(prompt.length).toBeGreaterThan(20)
		}
	})

	it("keeps parameter interpolation for statically registered prompts", () => {
		const prompt = getPrompt("responses", "missingToolParameterError", {
			paramName: "command",
			toolReminder: "Use the tool schema.",
		})

		expect(prompt).toContain("command")
		expect(prompt).toContain("Use the tool schema.")
		expect(prompt).not.toContain("[MISSING:")
	})
})
