// English MCP prompts — key-value pairs only, no code logic.

const prompts: Record<string, string> = {
	main: `MCP SERVERS

The Model Context Protocol (MCP) enables communication between the system and locally running MCP servers that provide additional tools, resources, and prompts to extend your capabilities.

# Connected MCP Servers

When a server is connected, you can use the server's tools via the \`use_mcp_tool\` tool, and access the server's resources via the \`access_mcp_resource\` tool.

Servers may also provide prompts - predefined templates that can be invoked by users to generate contextual messages.

{{MCP_SERVERS_LIST}}`,
}

export default prompts
