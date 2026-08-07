// English MCP prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	standardCatalogGuidance:
		"MCP tools connect Dline to external services, data sources, and specialized operations that are not provided by built-in tools. Use `load_mcp` to inspect one advertised MCP tool's detailed metadata and input schema before calling it. Loading does not execute the tool; use `use_mcp_tool` with the matching server and tool names when execution is required.",
	liteCatalogGuidance:
		"MCP tools connect Dline to external services, data sources, and specialized operations that are not provided by built-in tools. This Lite profile lists connected MCP tools for awareness but does not expose MCP metadata-loading or execution tools; switch to a profile that exposes them when an MCP operation is required.",
	standardCatalogListIntroduction: "The MCP tools available to the current task are listed below:",
	liteCatalogListIntroduction: "The connected MCP tools known to the current task are listed below:",
	main: `MCP SERVERS

The Model Context Protocol (MCP) enables communication between the system and locally running MCP servers that provide additional tools, resources, and prompts to extend your capabilities.

# Connected MCP Servers

When a server is connected, you can use the server's tools via the \`use_mcp_tool\` tool, and access the server's resources via the \`access_mcp_resource\` tool.

Servers may also provide prompts - predefined templates that can be invoked by users to generate contextual messages.

{{MCP_SERVERS_LIST}}`,
}

export default prompts
