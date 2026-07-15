import { describe, expect, it } from "vitest"
import type { PromptEnv } from "../template/types"
import { getPrompt, renderPrompt } from "./index"

describe("prompt i18n registry", () => {
	it("loads core English prompt modules during initialization", () => {
		const prompts = [
			getPrompt("agentRole", "main"),
			getPrompt("toolHandlers", "toolDenied"),
			getPrompt("focusChain", "recommended"),
			getPrompt("toolUseIndex", "main"),
		]

		for (const prompt of prompts) {
			expect(prompt).not.toContain("[MISSING:")
			expect(prompt.length).toBeGreaterThan(20)
		}
	})

	it("renders declared parameters through the immutable environment chain", () => {
		const prompt = renderPrompt("toolHandlers", "missingToolParameterError", {
			PARAM_NAME: "command",
			TOOL_REMINDER: "Use the tool schema.",
		})

		expect(prompt).toContain("command")
		expect(prompt).toContain("Use the tool schema.")
		expect(prompt).not.toContain("[MISSING:")
	})

	it("keeps relocated tool response prompts in tool namespaces", () => {
		const relocatedPrompts: readonly {
			readonly legacyKey: string
			readonly module: string
			readonly key: string
			readonly env?: PromptEnv
			readonly expectedText: string
		}[] = [
			{
				legacyKey: "toolDenied",
				module: "toolHandlers",
				key: "toolDenied",
				expectedText: "The user denied this operation.",
			},
			{
				legacyKey: "askFollowupNotificationSubtitle",
				module: "toolHandlers",
				key: "askFollowupNotificationSubtitle",
				expectedText: "Dline has a question...",
			},
			{
				legacyKey: "permissionDeniedError",
				module: "executeCommand",
				key: "permissionDeniedError",
				env: { REASON: "policy" },
				expectedText: "Command execution blocked by DLINE_COMMAND_PERMISSIONS: policy.",
			},
			{
				legacyKey: "invalidMcpToolArgumentError",
				module: "useMcpTool",
				key: "invalidMcpToolArgumentError",
				env: { SERVER_NAME: "filesystem", TOOL_NAME: "read_file" },
				expectedText: "Invalid JSON argument used with filesystem for read_file.",
			},
			{
				legacyKey: "replaceInFileMissingDiffError",
				module: "replaceInFile",
				key: "replaceInFileMissingDiffError",
				env: { REL_PATH: "src/example.ts" },
				expectedText: "Failed to edit 'src/example.ts': The 'diff' parameter was empty.",
			},
			{
				legacyKey: "writeToFileBaseError",
				module: "writeToFile",
				key: "writeToFileBaseError",
				env: { REL_PATH: "src/example.ts" },
				expectedText: "Failed to write to 'src/example.ts': The 'content' parameter was empty.",
			},
		]

		for (const { legacyKey, module, key, env, expectedText } of relocatedPrompts) {
			expect(renderPrompt(module, key, env)).toContain(expectedText)
			expect(getPrompt("responses", legacyKey)).toBe(`[MISSING: responses.${legacyKey}]`)
		}
	})

	it("keeps diff diagnostics out of the legacy system response namespace", () => {
		const prompt = renderPrompt("replaceInFile", "diffDelimiterTooShort", { COUNT: "6" })

		expect(prompt).toContain("Delimiter count 6 is below the minimum of 7.")
		expect(getPrompt("responses", "diffDelimiterTooShort")).toBe("[MISSING: responses.diffDelimiterTooShort]")
	})
})
