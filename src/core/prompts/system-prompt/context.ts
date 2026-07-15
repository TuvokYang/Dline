import type { CapabilityToggleState } from "@core/prompts/capabilities/CapabilitiesAggregator"
import type { ApiProviderInfo } from "@/core/api"
import type { McpHub } from "@/services/mcp/McpHub"
import type { BrowserSettings } from "@/shared/BrowserSettings"
import type { FocusChainSettings } from "@/shared/FocusChainSettings"
import type { SkillMetadata } from "@/shared/skills"
import type { ClineDefaultTool } from "@/shared/tools"

/** Complete runtime context consumed by profile prompt generators. */
export interface SystemPromptContext {
	readonly taskId?: string
	readonly providerInfo: ApiProviderInfo
	readonly cwd?: string
	readonly ide: string
	readonly editorTabs?: {
		readonly open?: readonly string[]
		readonly visible?: readonly string[]
	}
	readonly supportsBrowserUse?: boolean
	readonly mcpHub?: McpHub
	readonly skills?: SkillMetadata[]
	readonly capabilitiesSection?: string
	readonly capabilityToggleState?: CapabilityToggleState
	readonly focusChainSettings?: FocusChainSettings
	readonly globalClineRulesFileInstructions?: string
	readonly localClineRulesFileInstructions?: string
	readonly localCursorRulesFileInstructions?: string
	readonly localCursorRulesDirInstructions?: string
	readonly localWindsurfRulesFileInstructions?: string
	readonly localAgentsRulesFileInstructions?: string
	readonly clineIgnoreInstructions?: string
	readonly preferredLanguageInstructions?: string
	readonly browserSettings?: BrowserSettings
	readonly isTesting?: boolean
	readonly runtimePlaceholders?: Readonly<Record<string, unknown>>
	readonly yoloModeToggled?: boolean
	readonly subagentsEnabled?: boolean
	readonly clineWebToolsEnabled?: boolean
	readonly isMultiRootEnabled?: boolean
	readonly workspaceRoots?: Array<{ path: string; name: string; vcs?: string }>
	readonly isSubagentsEnabledAndCliInstalled?: boolean
	readonly isCliSubagent?: boolean
	readonly isSubagentRun?: boolean
	readonly isCliEnvironment?: boolean
	readonly enableNativeToolCalls?: boolean
	readonly enableParallelToolCalling?: boolean
	readonly terminalExecutionMode?: "vscodeTerminal" | "backgroundExec"
	readonly disableTools?: readonly ClineDefaultTool[]
}
