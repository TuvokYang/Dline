import { getShell } from "@utils/shell"
import type { ApiProviderInfo } from "@/core/api"
import { CommandPromptGenerator } from "../../generators/CommandPromptGenerator"
import { englishTemplateStore } from "../../i18n/en"
import { PromptProfile, requirePromptProfile } from "../../profiles/types"
import { DEEP_PLANNING_VARIANTS } from "./variants"

const commandGenerator = new CommandPromptGenerator(englishTemplateStore)

/**
 * Generates a provider-independent deep-planning slash command response.
 * @param focusChainSettings Optional focus chain settings to include in the prompt
 * @param _providerInfo Retained provider input; content generation does not branch on it.
 * @param enableNativeToolCalls Optional flag to determine if native tool calling is enabled
 * @param promptProfile Typed prompt profile supplied by the caller.
 * @returns The deep-planning prompt with shell, focus-chain, and transport values applied.
 */
export function getDeepPlanningPrompt(
	focusChainSettings?: { enabled: boolean },
	_providerInfo?: ApiProviderInfo,
	enableNativeToolCalls?: boolean,
	promptProfile?: PromptProfile,
): string {
	const requiredProfile = requirePromptProfile(promptProfile)
	const variant = DEEP_PLANNING_VARIANTS.find((candidate) => candidate.id === requiredProfile)
	if (!variant) {
		throw new Error(`Missing deep-planning variant for profile '${requiredProfile}'`)
	}
	const isPowerShell = detectPowerShell(getShell())
	if (variant.id === PromptProfile.Native) {
		return commandGenerator.generate("deepPlanning5Step.main", {
			FOCUS_CHAIN_NOTE: focusChainSettings?.enabled
				? commandGenerator.generate("deepPlanning5Step.focusChainNote", {}).text
				: "",
			SHELL_COMMANDS: commandGenerator.generate(
				isPowerShell ? "deepPlanning5Step.powershellCommands" : "deepPlanning5Step.bashCommands",
				{},
			).text,
			FOCUS_CHAIN_TASK_PROGRESS_LINE: focusChainSettings?.enabled
				? commandGenerator.generate("deepPlanning5Step.focusChainTaskProgressLine", {}).text
				: "",
			FOCUS_CHAIN_TASK_NOTE: focusChainSettings?.enabled
				? commandGenerator.generate("deepPlanning5Step.focusChainTaskNote", {}).text
				: "",
			FOCUS_CHAIN_TASK_PROGRESS: focusChainSettings?.enabled
				? commandGenerator.generate("deepPlanning5Step.focusChainTaskProgress", {}).text
				: "",
			TOOL_DEFINITION: commandGenerator.generate(
				enableNativeToolCalls === true ? "deepPlanning5Step.nativeToolDef" : "deepPlanning5Step.xmlToolDef",
				{},
			).text,
		}).text
	}

	const shellCommands = commandGenerator.generate(
		isPowerShell ? "deepPlanningGeneric.powershellCommands" : "deepPlanningGeneric.bashCommands",
		{},
	).text
	const navCommands = commandGenerator.generate(
		isPowerShell ? "deepPlanningGeneric.powershellNavCommands" : "deepPlanningGeneric.bashNavCommands",
		{},
	).text

	return commandGenerator.generate("deepPlanningGeneric.main", {
		SHELL_COMMANDS: shellCommands,
		NAV_COMMANDS: navCommands,
		FOCUS_CHAIN_PARAM: focusChainSettings?.enabled
			? commandGenerator.generate("deepPlanningGeneric.focusChainIntro", {}).text
			: "",
		NEW_TASK_INSTRUCTIONS: commandGenerator.generate(
			enableNativeToolCalls === true
				? "deepPlanningGeneric.nativeNewTaskInstructions"
				: "deepPlanningGeneric.xmlNewTaskInstructions",
			{},
		).text,
	}).text
}

/**
 * Detects whether the current shell uses PowerShell syntax.
 *
 * @param shell Detected shell executable or label.
 * @returns True when PowerShell command examples should be used.
 */
function detectPowerShell(shell: string | undefined): boolean {
	const normalized = shell?.toLowerCase() ?? ""
	return normalized.includes("powershell") || normalized.includes("pwsh")
}
