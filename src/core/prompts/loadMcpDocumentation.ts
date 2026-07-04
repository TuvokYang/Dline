import { McpHub } from "@services/mcp/McpHub"
import { getPrompt } from "./i18n"

export async function loadMcpDocumentation(mcpHub: McpHub) {
	const mcpServersPath = await mcpHub.getMcpServersPath()
	const mcpSettingsFilePath = await mcpHub.getMcpSettingsFilePath()
	const connectedServers =
		mcpHub
			.getServers()
			.filter((server) => server.status === "connected")
			.map((server) => server.name)
			.join(", ") || "(None running currently)"

	return `${getPrompt("loadMcpDocumentation", "main", { mcpServersPath, mcpSettingsFilePath, connectedServers })}\n`
}
