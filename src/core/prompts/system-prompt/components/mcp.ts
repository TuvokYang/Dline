import type { McpServer } from "@/shared/mcp"
import { getPrompt } from "../../i18n"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

export function hasEnabledMcpServers(context: SystemPromptContext): boolean {
	return (context.mcpHub?.getServers() || []).length > 0
}

export async function getMcp(variant: PromptVariant, context: SystemPromptContext): Promise<string | undefined> {
	const servers = context.mcpHub?.getServers() || []
	if (servers.length === 0) {
		return undefined
	}
	return await getMcpServers(servers, variant, context)
}

async function getMcpServers(servers: McpServer[], variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const defaultTemplate = getPrompt("mcp", "main")
	const template = variant.componentOverrides?.[SystemPromptSection.MCP]?.template || defaultTemplate

	const serversList = servers.length > 0 ? formatMcpServersList(servers) : "(No MCP servers currently connected)"
	return new TemplateEngine().resolve(template, context, {
		MCP_SERVERS_LIST: serversList,
	})
}

function formatMcpServersList(servers: McpServer[]): string {
	return servers
		.filter((server) => server.status === "connected")
		.map((server) => {
			const tools = server.tools
				?.map((tool) => {
					const schemaStr = tool.inputSchema
						? `    Input Schema:\n    ${JSON.stringify(tool.inputSchema, null, 2).split("\n").join("\n    ")}`
						: ""
					return `- ${tool.name}: ${tool.description}\n${schemaStr}`
				})
				.join("\n\n")

			const templates = server.resourceTemplates
				?.map((template) => `- ${template.uriTemplate} (${template.name}): ${template.description}`)
				.join("\n")

			const resources = server.resources
				?.map((resource) => `- ${resource.uri} (${resource.name}): ${resource.description}`)
				.join("\n")

			const prompts = server.prompts
				?.map((prompt) => {
					const argsStr = prompt.arguments?.length
						? `\n    Arguments: ${prompt.arguments
								.map(
									(arg) =>
										`${arg.name}${arg.required ? " (required)" : ""}${arg.description ? `: ${arg.description}` : ""}`,
								)
								.join(", ")}`
						: ""
					const title = prompt.title ? ` (${prompt.title})` : ""
					return `- ${prompt.name}${title}: ${prompt.description || "No description"}${argsStr}`
				})
				.join("\n")

			const config = JSON.parse(server.config)

			return (
				`## ${server.name}` +
				(config.command
					? ` (\`${config.command}${config.args && Array.isArray(config.args) ? ` ${config.args.join(" ")}` : ""}\`)`
					: "") +
				(tools ? `\n\n### Available Tools\n${tools}` : "") +
				(templates ? `\n\n### Resource Templates\n${templates}` : "") +
				(resources ? `\n\n### Direct Resources\n${resources}` : "") +
				(prompts ? `\n\n### Available Prompts\n${prompts}` : "")
			)
		})
		.join("\n\n")
}
