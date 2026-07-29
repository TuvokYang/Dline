import { getPrompt } from "../../i18n"
import { withoutPromptFragments } from "./conditional-content"
import type { SystemSectionContentConfig } from "./section-content-config"

const LITE_TOOLS_NATIVE = getPrompt("variants.lite", "toolsNative")
const LITE_TOOLS_XML = getPrompt("variants.lite", "toolsXml")
const STANDARD_TOOL_USE_PREFIX = getPrompt("variants.standard", "toolUsePrefix")
const STANDARD_TOOL_USE_SUFFIX = getPrompt("variants.standard", "toolUseSuffix")
const STANDARD_TOOL_USE_FOCUS_STAGE = getPrompt("variants.standard", "toolUseFocusStage")
const STANDARD_TOOL_USE_FOCUS_FORMAT = getPrompt("variants.standard", "toolUseFocusFormat")
const PARALLEL_TOOL_USE = getPrompt("variants.standard", "parallelToolUse")

export function createStandardToolUse(config: SystemSectionContentConfig): string {
	const suffix = config.focusChainEnabled
		? STANDARD_TOOL_USE_SUFFIX
		: withoutPromptFragments(STANDARD_TOOL_USE_SUFFIX, [STANDARD_TOOL_USE_FOCUS_STAGE, STANDARD_TOOL_USE_FOCUS_FORMAT])
	return `${STANDARD_TOOL_USE_PREFIX}${config.parallelTools ? PARALLEL_TOOL_USE : ""}${suffix}`
}

export function createLiteToolUse(config: SystemSectionContentConfig): string {
	return config.transport === "native" ? LITE_TOOLS_NATIVE : LITE_TOOLS_XML
}
