import { getPrompt } from "../../i18n"
import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

export async function getCapabilitiesSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	const yoloAskText = context.yoloModeToggled !== true ? ", and ask follow-up questions" : ""

	const defaultTemplate = getPrompt("capabilities", "main", { yoloAskText })
	const template = variant.componentOverrides?.[SystemPromptSection.CAPABILITIES]?.template || defaultTemplate

	const browserSupport = context.supportsBrowserUse ? ", use the browser" : ""
	const browserCapabilities = context.supportsBrowserUse
		? `\n- You can use the browser_action tool to interact with websites (including html files and locally running development servers) through a Puppeteer-controlled browser when you feel it is necessary in accomplishing the user's task. This tool is particularly useful for web development tasks as it allows you to launch a browser, navigate to pages, interact with elements through clicks and keyboard input, and capture the results through screenshots and console logs. This tool may be useful at key stages of web development tasks-such as after implementing new features, making substantial changes, when troubleshooting issues, or to verify the result of your work. You can analyze the provided screenshots to ensure correct rendering or identify errors, and review console logs for runtime issues.\n\t- For example, if asked to add a component to a react website, you might create the necessary files, use execute_command to run the site locally, then use browser_action to launch the browser, navigate to the local server, and verify the component renders & functions correctly before closing the browser.`
		: ""

	const webToolsCapabilities =
		context.providerInfo.providerId === "cline" && context.clineWebToolsEnabled === true
			? `\n- When the task requires or could benefit from getting up to date information on a topic (e.g. latest best practices, latest documentation, latest news, etc.), use the web_search tool to find current results, then use the web_fetch tool to retrieve and analyze the content from relevant URLs.`
			: ""

	const templateEngine = new TemplateEngine()
	return templateEngine.resolve(template, context, {
		BROWSER_SUPPORT: browserSupport,
		BROWSER_CAPABILITIES: browserCapabilities,
		WEB_TOOLS_CAPABILITIES: webToolsCapabilities,
		CWD: context.cwd || process.cwd(),
	})
}
