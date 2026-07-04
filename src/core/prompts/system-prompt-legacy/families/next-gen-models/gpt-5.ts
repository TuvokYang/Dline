import { McpHub } from "@services/mcp/McpHub"
import { BrowserSettings } from "@shared/BrowserSettings"
import { FocusChainSettings } from "@shared/FocusChainSettings"
import { getShell } from "@utils/shell"
import os from "os"
import osName from "os-name"
import { getPrompt } from "../../../i18n"

export const SYSTEM_PROMPT_GPT_5 = async (
	cwd: string,
	supportsBrowserUse: boolean,
	mcpHub: McpHub,
	browserSettings: BrowserSettings,
	focusChainSettings: FocusChainSettings,
) => {
	const fc = focusChainSettings.enabled
	const M = "gpt5Legacy"

	const taskProgressFormattingExample = fc ? getPrompt(M, "focusChainFormattingExample") : ""
	const taskProgressParam = fc ? getPrompt(M, "taskProgressParam") : ""
	const taskProgressUsage = fc ? getPrompt(M, "focusChainFormattingExample") : ""
	const taskProgressExamplesBash = fc ? getPrompt(M, "focusChainExamplesBash") : ""
	const taskProgressExamplesFile = fc ? getPrompt(M, "focusChainExamplesFile") : ""
	const taskProgressAttemptNote = fc ? getPrompt(M, "taskProgressAttemptNote") : ""
	const taskProgressAttemptUsage = fc ? getPrompt(M, "taskProgressAttemptUsage") : ""
	const taskProgressPlanModeUsage = fc ? getPrompt(M, "taskProgressPlanModeUsage") : ""

	const browserToolSection = supportsBrowserUse
		? `\n${getPrompt(M, "browserActionTool", {
				viewportWidth: browserSettings.viewport.width,
				viewportHeight: browserSettings.viewport.height,
				taskProgressLine: fc ? getPrompt(M, "taskProgressParam") : "",
				taskProgressFormattingUsage: fc ? getPrompt(M, "focusChainFormattingExample") : "",
			})}`
		: ""

	const focusChainUpdateSection = fc ? getPrompt(M, "focusChainUpdateSection") : ""

	const mcpServersList =
		mcpHub.getServers().length > 0
			? `${mcpHub
					.getServers()
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
						const config = JSON.parse(server.config)
						return (
							`## ${server.name}` +
							(config.command
								? ` (\`${config.command}${config.args && Array.isArray(config.args) ? ` ${config.args.join(" ")}` : ""}\`)`
								: "") +
							(tools ? `\n\n### Available Tools\n${tools}` : "") +
							(templates ? `\n\n### Resource Templates\n${templates}` : "") +
							(resources ? `\n\n### Direct Resources\n${resources}` : "")
						)
					})
					.join("\n\n")}`
			: "(No MCP servers currently connected)"

	const focusChainUpdatePlanMode = fc ? getPrompt(M, "focusChainUpdatePlanMode") : ""

	const browserSupportText = supportsBrowserUse ? getPrompt(M, "browserSupportText") : ""
	const browserCapabilitiesText = supportsBrowserUse ? getPrompt(M, "browserCapabilitiesText") : ""
	const browserRulesText = supportsBrowserUse ? getPrompt(M, "browserRulesText") : ""
	const browserWaitRulesText = supportsBrowserUse ? getPrompt(M, "browserWaitRulesText") : ""

	return getPrompt(M, "main", {
		cwd: cwd.toPosix(),
		taskProgressFormattingExample,
		taskProgressParam,
		taskProgressUsage,
		taskProgressExamplesBash,
		taskProgressExamplesFile,
		taskProgressAttemptNote,
		taskProgressAttemptUsage,
		taskProgressPlanModeUsage,
		browserToolSection,
		focusChainUpdateSection,
		mcpServersList,
		focusChainUpdatePlanMode,
		browserSupportText,
		browserCapabilitiesText,
		browserRulesText,
		browserWaitRulesText,
		osName: osName(),
		shell: getShell(),
		homeDir: os.homedir().toPosix(),
	})
}
