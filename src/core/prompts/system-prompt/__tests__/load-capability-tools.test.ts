import { ClineDefaultTool, READ_ONLY_TOOLS, toolUseNames } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import { ModelFamily } from "@/shared/prompts"
import { ClineToolSet } from "../registry/ClineToolSet"
import { toolSpecFunctionDefinition } from "../spec"
import { registerClineToolSets } from "../tools/init"

vi.mock("@core/task/tools/handlers/SubagentToolHandler", () => ({
	UseSubagentsToolHandler: class {},
}))

const LOAD_TOOLS = [
	ClineDefaultTool.LOAD_MCP,
	ClineDefaultTool.LOAD_SKILL,
	ClineDefaultTool.LOAD_WORKFLOW,
	ClineDefaultTool.LOAD_SUBAGENT,
] as const

/**
 * Build a minimal system prompt context for schema conversion.
 *
 * @returns Context object accepted by toolSpecFunctionDefinition.
 */
function createContext(): Parameters<typeof toolSpecFunctionDefinition>[1] {
	return {} as Parameters<typeof toolSpecFunctionDefinition>[1]
}

describe("load capability tool specs", () => {
	it("registers all load_xxx tools as default read-only tools", () => {
		for (const tool of LOAD_TOOLS) {
			expect(toolUseNames).toContain(tool)
			expect(READ_ONLY_TOOLS).toContain(tool)
		}
	})

	it("does not classify subagent execution tools as static read-only tools", () => {
		expect(READ_ONLY_TOOLS).not.toContain(ClineDefaultTool.USE_SUBAGENT)
		expect(READ_ONLY_TOOLS).not.toContain(ClineDefaultTool.USE_SUBAGENTS)
	})

	it("uses stable schema with required name only", () => {
		registerClineToolSets()
		for (const tool of LOAD_TOOLS) {
			const registered = ClineToolSet.getToolByNameWithFallback(tool, ModelFamily.NATIVE_NEXT_GEN)
			expect(registered).toBeDefined()
			const definition = toolSpecFunctionDefinition(registered!.config, createContext()) as unknown as {
				function: { parameters: { required: string[]; properties: Record<string, { type: string }> } }
			}
			expect(definition.function.parameters.required).toEqual(["name"])
			expect(Object.keys(definition.function.parameters.properties)).toEqual(["name"])
			expect(definition.function.parameters.properties.name.type).toBe("string")
		}
	})
})
