import { getPrompt } from "../../i18n"
import type { SystemSectionContentConfig } from "./section-content-config"

const XS_TOOLS_NATIVE = getPrompt("variants.lite", "toolsNative")
const XS_TOOLS_XML = getPrompt("variants.lite", "toolsXml")
const NATIVE_TOOL_USE_PREFIX = getPrompt("variants.native", "toolUsePrefix")
const NATIVE_TOOL_USE_SUFFIX = getPrompt("variants.native", "toolUseSuffix")
const PARALLEL_TOOL_USE = getPrompt("variants.native", "parallelToolUse")

export function createNativeToolUse(config: SystemSectionContentConfig): string {
	return `${NATIVE_TOOL_USE_PREFIX}${config.parallelTools ? PARALLEL_TOOL_USE : ""}${NATIVE_TOOL_USE_SUFFIX}`
}

export function createXsToolUse(config: SystemSectionContentConfig): string {
	return config.transport === "native" ? XS_TOOLS_NATIVE : XS_TOOLS_XML
}
