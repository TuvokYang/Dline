import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const LOAD_CAPABILITY_PARAMETERS: ClineToolSpec["parameters"] = [
	{
		name: "name",
		required: true,
		instruction: getPrompt("loadCapability", "nameInstruction"),
		usage: getPrompt("loadCapability", "nameUsage"),
	},
]

/**
 * Build stable variants for a load capability tool.
 *
 * @param id Tool identifier registered in ClineDefaultTool.
 * @param name Stable tool name exposed to model calls.
 * @returns Generic and native variants for the given load tool.
 */
function createLoadVariants(id: ClineDefaultTool, name: string): ClineToolSpec[] {
	const generic: ClineToolSpec = {
		variant: ModelFamily.GENERIC,
		id,
		name,
		description: getPrompt("loadCapability", "description"),
		parameters: LOAD_CAPABILITY_PARAMETERS,
	}

	const nativeNextGen: ClineToolSpec = {
		...generic,
		variant: ModelFamily.NATIVE_NEXT_GEN,
		description: getPrompt("loadCapability", "nativeDescription"),
	}

	const nativeGpt5: ClineToolSpec = {
		...nativeNextGen,
		variant: ModelFamily.NATIVE_GPT_5,
	}

	return [generic, nativeNextGen, nativeGpt5]
}

export const load_mcp_variants = createLoadVariants(ClineDefaultTool.LOAD_MCP, "load_mcp")
export const load_skill_variants = createLoadVariants(ClineDefaultTool.LOAD_SKILL, "load_skill")
export const load_workflow_variants = createLoadVariants(ClineDefaultTool.LOAD_WORKFLOW, "load_workflow")
export const load_subagent_variants = createLoadVariants(ClineDefaultTool.LOAD_SUBAGENT, "load_subagent")
