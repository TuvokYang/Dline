import { getShell } from "@utils/shell"
import { getPrompt } from "../../../i18n"
import type { DeepPlanningVariant } from "../types"

export function createGenericVariant(): DeepPlanningVariant {
	return {
		id: "generic",
		description: "Generic fallback variant for deep-planning prompt, used for all models",
		family: "generic",
		version: 1,
		matcher: () => true,
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
