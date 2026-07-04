import { isGPT51Model } from "@utils/model-utils"
import { getShell } from "@utils/shell"
import type { SystemPromptContext } from "@/core/prompts/system-prompt/types"
import { getPrompt } from "../../../i18n"
import type { DeepPlanningVariant } from "../types"

export function createGPT51Variant(): DeepPlanningVariant {
	return {
		id: "gpt-5",
		description: "Deep-planning variant optimized for OpenAI GPT-5 models",
		family: "gpt-5",
		version: 1,
		matcher: (context: SystemPromptContext) => {
			const modelId = context.providerInfo?.model?.id
			if (!modelId) {
				return false
			}
			return isGPT51Model(modelId)
		},
		template: "",
	}
}

export function generateGPT51Template(focusChainEnabled: boolean, enableNativeToolCalls: boolean): string {
	const detectedShell = getShell()

	let isPowerShell = false
	try {
		isPowerShell =
			detectedShell != null &&
			typeof detectedShell === "string" &&
			(detectedShell.toLowerCase().includes("powershell") || detectedShell.toLowerCase().includes("pwsh"))
	} catch {}

	const shellCommands = isPowerShell
		? getPrompt("deepPlanning5Step", "powershellCommands")
		: getPrompt("deepPlanning5Step", "bashCommands")

	const focusChainNote = focusChainEnabled ? getPrompt("deepPlanning5Step", "focusChainNote") : ""

	const focusChainTaskProgressLine = focusChainEnabled
		? "A task_progress list of steps that will need to be completed during the implementation"
		: ""

	const focusChainTaskNote = focusChainEnabled
		? "The task must include a <task_progress> list that breaks down the implementation into trackable steps."
		: ""

	const focusChainTaskProgress = focusChainEnabled ? getPrompt("deepPlanning5Step", "focusChainTaskProgress") : ""

	const toolDefinition = enableNativeToolCalls
		? getPrompt("deepPlanning5Step", "nativeToolDef")
		: getPrompt("deepPlanning5Step", "xmlToolDef")

	return getPrompt("deepPlanning5Step", "main", {
		focusChainNote,
		shellCommands,
		focusChainTaskProgressLine,
		focusChainTaskNote,
		focusChainTaskProgress,
		toolDefinition,
	})
}
