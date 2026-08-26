import { name, publisher, version } from "../package.json"
import { HostProvider } from "./hosts/host-provider"

/**
 * List of commands with the name of the extension they are registered under.
 * These should match the command IDs defined in package.json for each distribution package.
 */
const ClineCommands = {
	PlusButton: `${name}.plusButtonClicked`,
	McpButton: `${name}.mcpButtonClicked`,
	SettingsButton: `${name}.settingsButtonClicked`,
	HistoryButton: `${name}.historyButtonClicked`,
	AccountButton: `${name}.accountButtonClicked`,
	WorktreesButton: `${name}.worktreesButtonClicked`,
	TerminalOutput: `${name}.addTerminalOutputToChat`,
	AddToChat: `${name}.addToChat`,
	FixWithCline: `${name}.fixWithCline`,
	ExplainCode: `${name}.explainCode`,
	ImproveCode: `${name}.improveCode`,
	FocusChatInput: `${name}.focusChatInput`,
	Walkthrough: `${name}.openWalkthrough`,
	GenerateCommit: `${name}.generateGitCommitMessage`,
	AbortCommit: `${name}.abortGitCommitMessage`,
	ReconstructTaskHistory: `${name}.reconstructTaskHistory`,
	RecoverUiMessages: `${name}.recoverUiMessages`,
	// Jupyter Notebook commands
	JupyterGenerateCell: `${name}.jupyterGenerateCell`,
	JupyterExplainCell: `${name}.jupyterExplainCell`,
	JupyterImproveCell: `${name}.jupyterImproveCell`,
}

/**
 * IDs for the views registered by the extension.
 * These should match the name + view IDs defined in package.json.
 */
const ClineViewIds = {
	Sidebar: `${name}.SidebarProvider`,
}

/**
 * The registry info for the extension, including its ID, name, version, commands, and views
 * registered for the current host.
 */
export const ExtensionRegistryInfo = {
	id: `${publisher}.${name}`,
	name,
	version,
	publisher,
	commands: ClineCommands,
	views: ClineViewIds,
}

export interface HostInfo {
	/**
	 * The name of the host platform, e.g VSCode, IntelliJ Ultimate Edition, etc.
	 */
	platform: string
	/**
	 * The operating system platform, e.g. linux, darwin, win32
	 */
	os: string
	/**
	 * The type of the cline host environment, e.g. 'VSCode Extension', 'Cline for JetBrains', 'CLI'
	 * This is different from the platform because there are many JetBrains IDEs, but they all use the same
	 * plugin.
	 */
	ide: string
	/**
	 * A distinct ID for this installation of the host client
	 */
	distinctId: string
	/**
	 * The version of the host platform, e.g. 1.103.0 for VSCode, or 2025.1.1.1 for JetBrains IDEs.
	 */
	hostVersion?: string
	/**
	 * The version of Cline that the host client is running
	 */
	extensionVersion: string
}

let hostInfo = null as HostInfo | null

export const HostRegistryInfo = {
	init: async (distinctId: string) => {
		const host = await HostProvider.env.getHostVersion({})
		const hostVersion = host.version
		const extensionVersion = host.clineVersion || ExtensionRegistryInfo.version
		const platform = host.platform || "unknown"
		const os = process.platform || "unknown"
		const ide = host.clineType || "unknown"
		hostInfo = { hostVersion, extensionVersion, platform, os, ide, distinctId }
	},
	get: () => hostInfo,
}
