import * as fs from "node:fs/promises"
import * as path from "node:path"

import { describe, expect, it } from "vitest"

const SOURCE_ROOT = path.resolve(process.cwd(), "src/core/prompts")

async function read(relativePath: string): Promise<string> {
	return fs.readFile(path.join(SOURCE_ROOT, relativePath), "utf8")
}

async function exists(relativePath: string): Promise<boolean> {
	return fs
		.access(path.join(SOURCE_ROOT, relativePath))
		.then(() => true)
		.catch(() => false)
}

describe("Prompt prose ownership", () => {
	it("keeps model-facing prose out of production assembly and projector modules", async () => {
		const [
			pipeline,
			runtimeEnv,
			systemEnv,
			commandPrompt,
			contextManagement,
			mcpDocumentation,
			responses,
			systemGenerator,
			toolSpecs,
			xmlProjector,
			capabilitySection,
		] = await Promise.all([
			read("system-prompt/pipeline.ts"),
			read("system-prompt/env/runtime-env.ts"),
			read("system-prompt/env/system-env.ts"),
			read("commands/deep-planning/index.ts"),
			read("contextManagement.ts"),
			read("loadMcpDocumentation.ts"),
			read("responses.ts"),
			read("generators/SystemPromptGenerator.ts"),
			read("tools/tool-specs.ts"),
			read("tools/xml-tool-projector.ts"),
			read("capabilities/CapabilitiesSection.ts"),
		])

		expect(pipeline).not.toContain("You can use the browser_action tool")
		expect(pipeline).not.toContain("When the task requires or could benefit from getting up to date information")
		expect(pipeline).not.toContain("You may use multiple tools in a single response")
		expect(pipeline).not.toContain("ask a focused clarifying question rather than making risky assumptions")
		expect(runtimeEnv).not.toContain("Connected MCP servers:")
		expect(runtimeEnv).not.toContain('`- "${skill.name}": ${skill.description}`')
		expect(systemEnv).not.toContain('from "../constants"')
		expect(contextManagement).not.toContain("Use @workspace:path syntax")
		expect(mcpDocumentation).not.toContain('|| "(None running currently)"')
		expect(responses).not.toContain("`[TASK RESUMPTION] ${resumeTemplate}${recentNote}`")
		expect(responses).not.toContain("`${prefix}:\\n<user_message>\\n${responseText}\\n</user_message>`")
		expect(responses).not.toContain("`${(info.size / 1000).toFixed(1)} KB`")
		expect(responses).not.toContain("`${info.lineCount} lines`")
		expect(responses).not.toContain('consecutiveFailures === 2 ? "nd" : "rd"')
		expect(responses).not.toContain('fileCount === 1 ? "file has" : "files have"')
		expect(responses).not.toContain('fileCount === 1 ? "this file" : "these files"')
		expect(responses).not.toContain('fileCount === 1 ? "it" : "they"')
		expect(commandPrompt).not.toContain("When creating the new task, you must include a task_progress parameter")
		expect(commandPrompt).not.toContain("The task must include a <task_progress> list")
		expect(commandPrompt).not.toContain("**new_task Tool Definition:**")
		expect(systemGenerator).not.toContain("# CAPABILITIES")
		expect(toolSpecs).not.toContain("Must include <task> and <context> sections")
		expect(toolSpecs).not.toContain("Optional positive integer timeout in seconds")
		expect(xmlProjector).not.toContain('"Parameters: None"')
		expect(xmlProjector).not.toContain("`Description: ${spec.description}`")
		expect(capabilitySection).not.toContain('"# Capabilities"')
		expect(capabilitySection).not.toContain('{ title: "Skills"')
	})

	it("keeps production prompt lookup raw and structural composition non-recursive", async () => {
		const registry = await read("i18n/index.ts")

		expect(registry).not.toContain("applyLegacyReplacements")
		expect(registry).not.toContain("PromptReplacements")
		expect(registry).not.toContain(".replaceAll(")
	})

	it("removes invalid complete-profile rendering assets from the new architecture", async () => {
		const invalidAssets = [
			"generators/SystemSectionRenderer.ts",
			"i18n/en/variants/profile-contract.ts",
			"i18n/en/variants/native/layout.ts",
			"i18n/en/variants/native/contract.ts",
			"i18n/en/variants/lite/layout.ts",
			"i18n/en/variants/lite/contract.ts",
		]

		for (const asset of invalidAssets) {
			expect(await exists(asset), asset).toBe(false)
		}
	})

	it("keeps Native tool-use fragments in the i18n variant domain", async () => {
		const source = await read("system-prompt/variants/tool-use-content.ts")

		expect(source).toContain('getPrompt("variants.native", "toolUsePrefix")')
		expect(source).toContain('getPrompt("variants.native", "toolUseSuffix")')
		expect(source).toContain('getPrompt("variants.native", "parallelToolUse")')
	})
})
