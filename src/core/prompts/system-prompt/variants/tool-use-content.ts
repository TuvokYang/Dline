import { getPrompt } from "../../i18n"
import { withoutPromptFragments } from "./conditional-content"
import type { SystemSectionContentConfig } from "./section-content-config"

const LITE_TOOLS_NATIVE = getPrompt("variants.lite", "toolsNative")
const LITE_TOOLS_XML = getPrompt("variants.lite", "toolsXml")
const NATIVE_TOOL_USE_PREFIX = getPrompt("variants.native", "toolUsePrefix")
const NATIVE_TOOL_USE_SUFFIX = getPrompt("variants.native", "toolUseSuffix")
const NATIVE_TOOL_USE_FOCUS_STAGE = getPrompt("variants.native", "toolUseFocusStage")
const NATIVE_TOOL_USE_FOCUS_FORMAT = getPrompt("variants.native", "toolUseFocusFormat")
const PARALLEL_TOOL_USE = getPrompt("variants.native", "parallelToolUse")

export function createNativeToolUse(config: SystemSectionContentConfig): string {
	const suffix = config.focusChainEnabled
		? NATIVE_TOOL_USE_SUFFIX
		: withoutPromptFragments(NATIVE_TOOL_USE_SUFFIX, [NATIVE_TOOL_USE_FOCUS_STAGE, NATIVE_TOOL_USE_FOCUS_FORMAT])
	return `${NATIVE_TOOL_USE_PREFIX}${config.parallelTools ? PARALLEL_TOOL_USE : ""}${suffix}`
}

export function createLiteToolUse(config: SystemSectionContentConfig): string {
	return config.transport === "native" ? LITE_TOOLS_NATIVE : LITE_TOOLS_XML
}
