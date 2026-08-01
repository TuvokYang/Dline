import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"

import { summarizeTask } from "../../contextManagement"
import { englishTemplateStore } from "../../i18n/en"
import { createPromptGroup } from "../../i18n/helpers/create-pack"
import { definePromptModule } from "../../i18n/helpers/define-module"
import { PromptProfile } from "../../profiles/types"
import type { SystemPromptContext } from "../../system-prompt/context"
import { PromptScanner } from "../../template/PromptScanner"
import { TemplateStore, TemplateStoreError } from "../../template/TemplateStore"
import { REQUEST_SCOPED_TOOL_IDS } from "../../tools/tool-ids"
import { CommandPromptGenerator } from "../CommandPromptGenerator"
import { RuntimePromptGenerator } from "../RuntimePromptGenerator"
import { ToolPromptGenerator } from "../ToolPromptGenerator"

const TEMPLATE_OPEN = "$" + "{"

const TEST_MODULE = definePromptModule({
	name: "generatorTest",
	domain: "commands",
	prompts: {
		command: "Command @VALUE@",
		runtime: `literal=$HOME $content "${TEMPLATE_OPEN}request.params.uri}" value=@VALUE@`,
		missing: "Missing @VALUE@ and @OTHER@",
	},
	contracts: {
		command: {
			variables: {
				VALUE: { stages: ["runtime"], required: true },
			},
		},
		runtime: {
			variables: {
				VALUE: { stages: ["runtime"], required: true },
			},
		},
		missing: {
			variables: {
				VALUE: { stages: ["runtime"], required: true },
				OTHER: { stages: ["runtime"], required: true },
			},
		},
	},
	source: "test/generator-test.ts",
})

/** Creates an isolated static store for generator tests. */
function createStore(): TemplateStore {
	return TemplateStore.create(createPromptGroup("commands", TEST_MODULE))
}

describe("CommandPromptGenerator", () => {
	it("loads an exact template and applies runtime env", () => {
		const output = new CommandPromptGenerator(createStore()).generate("generatorTest.command", { VALUE: "ready" })

		expect(output.text).toBe("Command ready")
		expect(output.warnings).toEqual([])
		expect(output.trace).toEqual([{ key: "VALUE", stage: "runtime", source: "command-generator" }])
	})

	it("performs exactly one final scan for one complete command template", () => {
		const renderSpy = vi.spyOn(PromptScanner.prototype, "render")

		try {
			new CommandPromptGenerator(createStore()).generate("generatorTest.command", { VALUE: "ready" })
			expect(renderSpy).toHaveBeenCalledTimes(1)
		} finally {
			renderSpy.mockRestore()
		}
	})

	it("preserves missing template errors", () => {
		const generator = new CommandPromptGenerator(createStore())

		expect(() => generator.generate("generatorTest.absent", {})).toThrowError(TemplateStoreError)
		expect(() => generator.generate("generatorTest.absent", {})).toThrowError(
			expect.objectContaining({ reason: "missing-template", templateId: "generatorTest.absent" }),
		)
	})
})

describe("ToolPromptGenerator", () => {
	const context = {
		promptProfile: PromptProfile.Standard,
		providerInfo: { providerId: "openai", model: { id: "model", info: {} } },
		enableNativeToolCalls: true,
	} as SystemPromptContext

	it("performs exactly one final scan for the complete native descriptor projection", () => {
		const renderSpy = vi.spyOn(PromptScanner.prototype, "render")

		try {
			new ToolPromptGenerator().generate(PromptProfile.Standard, context)
			expect(renderSpy).toHaveBeenCalledTimes(1)
		} finally {
			renderSpy.mockRestore()
		}
	})

	it("keeps XML descriptor fragments unresolved without prompt generation", () => {
		const renderSpy = vi.spyOn(PromptScanner.prototype, "render")

		try {
			new ToolPromptGenerator().generateXml(PromptProfile.Standard, { ...context, enableNativeToolCalls: false })
			expect(renderSpy).not.toHaveBeenCalled()
		} finally {
			renderSpy.mockRestore()
		}
	})

	it.each([
		PromptProfile.Standard,
		PromptProfile.Lite,
	])("does not leak request-scoped tools into the %s defaults", (profile) => {
		const tools = new ToolPromptGenerator().generate(profile, { ...context, promptProfile: profile }) ?? []
		const names = tools.flatMap((tool) =>
			"function" in tool && tool.function?.name
				? [tool.function.name]
				: "name" in tool && typeof tool.name === "string"
					? [tool.name]
					: [],
		)

		for (const toolId of REQUEST_SCOPED_TOOL_IDS) {
			expect(names).not.toContain(toolId)
		}
	})

	it("rejects ordinary tools from request-only projection", () => {
		expect(
			new ToolPromptGenerator().generateSelectedRequestTools(PromptProfile.Standard, context, [ClineDefaultTool.FILE_READ]),
		).toBeUndefined()
	})

	it.each([
		ClineDefaultTool.NEW_TASK,
		ClineDefaultTool.CONDENSE,
		ClineDefaultTool.NEW_RULE,
		ClineDefaultTool.REPORT_BUG,
		ClineDefaultTool.GENERATE_EXPLANATION,
	])("does not project slash command %s as a request-scoped function", (toolId) => {
		expect(new ToolPromptGenerator().generateSelectedRequestTools(PromptProfile.Standard, context, [toolId])).toBeUndefined()
	})

	it("projects summarize_task only for the active automatic compaction request", () => {
		expect(REQUEST_SCOPED_TOOL_IDS).toEqual([ClineDefaultTool.SUMMARIZE_TASK])
		const generator = new ToolPromptGenerator()
		const defaultTools = generator.generate(PromptProfile.Standard, context) ?? []
		const requestTools =
			generator.generateToolsForRequest(PromptProfile.Standard, context, defaultTools, [ClineDefaultTool.SUMMARIZE_TASK]) ??
			[]

		expect(defaultTools).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: "summarize_task" }) })]),
		)
		expect(requestTools).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ function: expect.objectContaining({ name: "read_file" }) })]),
		)
		expect(requestTools).toEqual([
			expect.objectContaining({
				function: expect.objectContaining({
					name: "summarize_task",
					parameters: expect.objectContaining({ required: ["context"] }),
				}),
			}),
		])
	})
})

describe("RuntimePromptGenerator", () => {
	it("injects auto-condense focus guidance only when focus tracking is enabled", () => {
		const enabled = summarizeTask({ enabled: true })
		const disabled = summarizeTask({ enabled: false })

		expect(enabled).toContain("task_progress")
		expect(disabled).not.toContain("task_progress")
		expect(disabled).toContain("you must call the summarize_task tool")
	})

	it("preserves literal dollar text and does not rescan inserted values", () => {
		const output = new RuntimePromptGenerator(createStore()).generate("generatorTest.runtime", {
			VALUE: `opaque @OTHER@ $HOME ${TEMPLATE_OPEN}request.params.uri}`,
		})

		expect(output.text).toBe(
			`literal=$HOME $content "${TEMPLATE_OPEN}request.params.uri}" value=opaque @OTHER@ $HOME ${TEMPLATE_OPEN}request.params.uri}`,
		)
		expect(output.warnings).toEqual([])
	})

	it("retains missing tokens and returns structured warnings", () => {
		const output = new RuntimePromptGenerator(createStore()).generate("generatorTest.missing", { VALUE: "ready" })

		expect(output.text).toBe("Missing ready and @OTHER@")
		expect(output.warnings).toEqual([
			expect.objectContaining({
				templateId: "generatorTest.missing",
				key: "OTHER",
				loadedStages: ["runtime"],
			}),
		])
	})

	it("preserves MCP URI templates and JavaScript template literals", () => {
		const output = new RuntimePromptGenerator(englishTemplateStore).generate("loadMcpDocumentation.main", {
			MCP_SERVERS_PATH: "C:/mcp",
			MCP_SETTINGS_FILE_PATH: "C:/settings.json",
			CONNECTED_SERVERS: "weather",
		})

		expect(output.text).toContain("C:/mcp")
		expect(output.text).toContain("C:/settings.json")
		expect(output.text).toContain("below: weather")
		expect(output.text).toContain("weather://{city}/current")
		expect(output.text).toContain(`${TEMPLATE_OPEN}request.params.uri}`)
		expect(output.text).toContain(`${TEMPLATE_OPEN}request.params.name}`)
		expect(output.text).toContain(`Weather API error: ${TEMPLATE_OPEN}`)
		expect(output.warnings).toEqual([])
	})
})
