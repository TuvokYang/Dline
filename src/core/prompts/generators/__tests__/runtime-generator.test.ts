import { describe, expect, it, vi } from "vitest"

import { englishTemplateStore } from "../../i18n/en"
import { createPromptGroup } from "../../i18n/helpers/create-pack"
import { definePromptModule } from "../../i18n/helpers/define-module"
import { PromptProfile } from "../../profiles/types"
import type { SystemPromptContext } from "../../system-prompt/context"
import { PromptScanner } from "../../template/PromptScanner"
import { TemplateStore, TemplateStoreError } from "../../template/TemplateStore"
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
		promptProfile: PromptProfile.Native,
		providerInfo: { providerId: "openai", model: { id: "model", info: {} } },
		enableNativeToolCalls: true,
	} as SystemPromptContext

	it("performs exactly one final scan for the complete native descriptor projection", () => {
		const renderSpy = vi.spyOn(PromptScanner.prototype, "render")

		try {
			new ToolPromptGenerator().generate(PromptProfile.Native, context)
			expect(renderSpy).toHaveBeenCalledTimes(1)
		} finally {
			renderSpy.mockRestore()
		}
	})

	it("keeps XML descriptor fragments unresolved without prompt generation", () => {
		const renderSpy = vi.spyOn(PromptScanner.prototype, "render")

		try {
			new ToolPromptGenerator().generateXml(PromptProfile.Native, { ...context, enableNativeToolCalls: false })
			expect(renderSpy).not.toHaveBeenCalled()
		} finally {
			renderSpy.mockRestore()
		}
	})
})

describe("RuntimePromptGenerator", () => {
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
