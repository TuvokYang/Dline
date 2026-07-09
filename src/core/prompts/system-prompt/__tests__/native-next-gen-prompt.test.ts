import { expect } from "chai"
import { describe, it } from "vitest"
import { ModelFamily } from "@/shared/prompts"
import type { ClineTool } from "@/shared/tools"
import { ClineDefaultTool } from "@/shared/tools"
import { getSystemPrompt } from "../index"
import { ClineToolSet } from "../registry/ClineToolSet"
import { toolSpecFunctionDefinition } from "../spec"
import { registerClineToolSets } from "../tools/init"
import type { SystemPromptContext } from "../types"
import { mockProviderInfo } from "./test-helpers"

/**
 * Create a native-next-gen prompt context for prompt architecture assertions.
 *
 * @returns SystemPromptContext configured for DeepSeek native tool calling.
 */
function createContext(): SystemPromptContext {
	return {
		cwd: "/test/project",
		ide: "TestIde",
		supportsBrowserUse: true,
		clineWebToolsEnabled: true,
		subagentsEnabled: true,
		focusChainSettings: { enabled: true, remindClineInterval: 6 },
		browserSettings: { viewport: { width: 1280, height: 720 } },
		isTesting: true,
		providerInfo: {
			providerId: "deepseek",
			model: { ...mockProviderInfo.model, id: "deepseek-v4-pro" },
			mode: "act",
		},
		enableNativeToolCalls: true,
	}
}

/**
 * Resolve the native function-call schema for a registered tool.
 *
 * @param toolName Tool identifier to resolve.
 * @returns Native function definition object for assertions.
 */
function getToolDef(toolName: ClineDefaultTool): ClineTool {
	registerClineToolSets()
	const registered = ClineToolSet.getToolByNameWithFallback(toolName, ModelFamily.NATIVE_NEXT_GEN)
	expect(registered).to.exist
	return toolSpecFunctionDefinition(registered!.config, createContext())
}

describe("native-next-gen prompt architecture", () => {
	it("uses a closure-loop objective with architecture quality gates", async () => {
		const { systemPrompt } = await getSystemPrompt(createContext())

		expect(systemPrompt).to.include("## Execution Loop")
		expect(systemPrompt).to.include("Task Closure Contract")
		expect(systemPrompt).to.include("Architecture Quality Gate")
		expect(systemPrompt).to.include("Professional implementation includes targeted architecture adjustments")
		expect(systemPrompt).to.include("Avoid circular dependencies, mutual calls, hidden shared state")
		expect(systemPrompt).to.include("Prefer resolving uncertainty through tools and project evidence")
	})

	it("allows planning artifacts in plan mode without implementation work", async () => {
		const { systemPrompt } = await getSystemPrompt(createContext())

		expect(systemPrompt).to.include("create planning artifacts such as specs, design documents, and implementation plans")
		expect(systemPrompt).to.include(
			"Planning documents are allowed in PLAN MODE because they define the work rather than implementing product behavior",
		)
		expect(systemPrompt).to.include("execute the approved implementation plan")
	})

	it("uses concise task_progress parameter descriptions in function tools", () => {
		const definition = getToolDef(ClineDefaultTool.FILE_READ)
		const functionTool = definition as { function: { parameters: { properties: Record<string, { description?: string }> } } }
		const description = functionTool.function.parameters.properties.task_progress?.description ?? ""

		expect(description).to.equal(
			"Report task_progress as a separate parameter. Follow the UPDATING TASK PROGRESS section: use exact checklist text for completed items, and include full checklists only when starting or replacing a plan.",
		)
	})
})
