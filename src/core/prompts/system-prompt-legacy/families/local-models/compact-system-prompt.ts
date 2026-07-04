import type { McpHub } from "@services/mcp/McpHub"
import { BrowserSettings } from "@shared/BrowserSettings"
import { FocusChainSettings } from "@shared/FocusChainSettings"
import { getShell } from "@utils/shell"
import os from "os"
import osName from "os-name"
import { getPrompt } from "../../../i18n"

export const SYSTEM_PROMPT_COMPACT = async (
	cwd: string,
	_supportsBrowserUse: boolean,
	_mcpHub: McpHub,
	_browserSettings: BrowserSettings,
	_focusChainSettings: FocusChainSettings,
) => {
	return getPrompt("compactSystemPrompt", "main", {
		cwd: cwd.toPosix(),
		osName: osName(),
		shell: getShell(),
		homeDir: os.homedir().toPosix(),
	})
}
