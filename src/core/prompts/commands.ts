import type { ApiProviderInfo } from "@/core/api"
import { getDeepPlanningPrompt } from "./commands/deep-planning"
import { getPrompt } from "./i18n"

export const newTaskToolResponse = (willUseNativeTools: boolean) => {
	const xmlExample = getPrompt("commands", "newTaskXmlExample")
	const nativeToolNote = willUseNativeTools ? getPrompt("commands", "newTaskNativeToolNote") : ""

	return `${getPrompt("commands", "newTaskMain", { nativeToolNote, xmlExample })}\n`
}

export const condenseToolResponse = (focusChainSettings?: { enabled: boolean }) => {
	const focusChainEnabled = focusChainSettings?.enabled
	const focusChainParam = focusChainEnabled ? getPrompt("commands", "condenseFocusChainParam") : ""
	const focusChainUsage = focusChainEnabled ? getPrompt("toolUseTools", "focusChainUsage") : ""
	const focusChainExample = focusChainEnabled ? getPrompt("commands", "condenseFocusChainExample") : ""

	return `${getPrompt("commands", "condenseMain", { focusChainParam, focusChainUsage, focusChainExample })}\n`
}

export const newRuleToolResponse = () => `${getPrompt("commands", "newRuleToolResponse")}\n`

export const reportBugToolResponse = () => `${getPrompt("commands", "reportBugToolResponse")}\n`

export const explainChangesToolResponse = () => `${getPrompt("commands", "explainChangesToolResponse")}\n`

/**
 * Generates the deep-planning slash command response with model-family-aware variant selection
 * @param focusChainSettings Optional focus chain settings to include in the prompt
 * @param providerInfo Optional API provider info for model family detection
 * @param enableNativeToolCalls Optional flag to determine if native tool calling is enabled
 * @returns The deep-planning prompt string with appropriate variant and focus chain settings applied
 */
export const deepPlanningToolResponse = (
	focusChainSettings?: { enabled: boolean },
	providerInfo?: ApiProviderInfo,
	enableNativeToolCalls?: boolean,
) => {
	return getDeepPlanningPrompt(focusChainSettings, providerInfo, enableNativeToolCalls)
}
