import { isGemini2dot5ModelFamily } from "@utils/model-utils"
import { getShell } from "@utils/shell"
import type { SystemPromptContext } from "@/core/prompts/system-prompt/types"
import { getPrompt } from "../../../i18n"
import type { DeepPlanningVariant } from "../types"

export function createGeminiVariant(): DeepPlanningVariant {
	return {
		id: "gemini",
		description: "Deep-planning variant optimized for Google Gemini 2.5 models",
		family: "gemini",
		version: 1,
		matcher: (context: SystemPromptContext) => {
			const modelId = context.providerInfo?.model?.id
			if (!modelId) {
				return false
			}
			return isGemini2dot5ModelFamily(modelId)
		},
		template: generateTemplate(),
	}
}

function generateTemplate(): string {
	const detectedShell = getShell()

	let isPowerShell = false
	try {
		isPowerShell =
			detectedShell != null &&
			typeof detectedShell === "string" &&
			(detectedShell.toLowerCase().includes("powershell") || detectedShell.toLowerCase().includes("pwsh"))
	} catch {}

	const shellCommands = isPowerShell
		? getPrompt("deepPlanningGeneric", "powershellCommands")
		: getPrompt("deepPlanningGeneric", "bashCommands")

	const navCommands = isPowerShell
		? getPrompt("deepPlanningGeneric", "powershellNavCommands")
		: getPrompt("deepPlanningGeneric", "bashNavCommands")

	return getPrompt("deepPlanningGeneric", "main", { shellCommands, navCommands })
}
