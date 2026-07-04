import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.MCP_DOCS

const generic: ClineToolSpec = {
	id,
	variant: ModelFamily.GENERIC,
	name: "load_mcp_documentation",
	description: getPrompt("loadMcpDocumentationTool", "description"),
	contextRequirements: (context) => context.mcpHub !== undefined && context.mcpHub !== null,
}

export const load_mcp_documentation_variants = [generic]
