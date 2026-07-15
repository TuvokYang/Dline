import { getPrompt } from "../../i18n"
import type { PromptEnv } from "../../template/types"
import { assemblePromptFragments } from "../assembly/prompt-fragment-assembler"
import type { SystemPromptContext } from "../context"

/** Builds dynamic capability and user-content values for prompt generation. */
export function buildRuntimeEnv(context: SystemPromptContext): PromptEnv {
	const browserEnabled = context.supportsBrowserUse === true && context.browserSettings?.disableToolUse !== true
	const servers = context.mcpHub?.getServers() ?? []

	return {
		TOOL_TRANSPORT: context.enableNativeToolCalls === true ? "native" : "xml",
		NATIVE_TOOLS_ENABLED: context.enableNativeToolCalls === true,
		PARALLEL_TOOLS_ENABLED: context.enableParallelToolCalling === true,
		MCP_ENABLED: servers.length > 0,
		MCP_SERVERS_SECTION: formatServers(servers),
		BROWSER_ENABLED: browserEnabled,
		BROWSER_VIEWPORT_WIDTH: context.browserSettings?.viewport.width ?? 0,
		BROWSER_VIEWPORT_HEIGHT: context.browserSettings?.viewport.height ?? 0,
		SUBAGENTS_ENABLED: context.subagentsEnabled === true && context.isSubagentRun !== true,
		FOCUS_CHAIN_ENABLED: context.focusChainSettings?.enabled === true,
		YOLO_MODE_ENABLED: context.yoloModeToggled === true,
		USER_INSTRUCTIONS_SECTION: formatInstructions(context),
		CAPABILITIES_SECTION: context.capabilitiesSection?.trim() ?? "",
		SKILLS_SECTION: formatSkills(context),
	}
}

/** Formats connected MCP server names without embedding mutable tool schemas. */
function formatServers(servers: readonly { readonly name: string; readonly status?: string }[]): string {
	const names = servers.filter((server) => server.status === "connected").map((server) => server.name)
	return names.length > 0
		? assemblePromptFragments(getPrompt("runtimeEnvironment", "connectedMcpServers"), { NAMES: names.join(", ") })
		: ""
}

/** Formats user instruction sources in the established precedence order. */
function formatInstructions(context: SystemPromptContext): string {
	return [
		context.preferredLanguageInstructions,
		context.globalClineRulesFileInstructions,
		context.localClineRulesFileInstructions,
		context.localCursorRulesFileInstructions,
		context.localCursorRulesDirInstructions,
		context.localWindsurfRulesFileInstructions,
		context.localAgentsRulesFileInstructions,
		context.clineIgnoreInstructions,
	]
		.filter((value): value is string => Boolean(value))
		.join("\n\n")
}

/** Formats enabled skill metadata as deterministic prompt text. */
function formatSkills(context: SystemPromptContext): string {
	return (
		context.skills
			?.map((skill) =>
				assemblePromptFragments(getPrompt("runtimeEnvironment", "runtimeSkillListEntry"), {
					NAME: skill.name,
					DESCRIPTION: skill.description,
				}),
			)
			.join("\n") ?? ""
	)
}
