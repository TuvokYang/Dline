import { getPrompt } from "../../i18n"
import { withoutPromptFragments } from "./conditional-content"
import type { SystemSectionContentConfig } from "./section-content-config"

const NATIVE_RULES = getPrompt("variants.native", "rules")
const NATIVE_RULES_FOCUS_CONTRACT = getPrompt("variants.native", "rulesFocusContract")
const LITE_RULES = getPrompt("variants.lite", "rules")
const LITE_RULES_YOLO_ASK_CLAUSE = getPrompt("variants.lite", "rulesYoloAskClause")

export function createNativeRules(config: SystemSectionContentConfig): string {
	return config.focusChainEnabled ? NATIVE_RULES : withoutPromptFragments(NATIVE_RULES, [NATIVE_RULES_FOCUS_CONTRACT])
}

export function createLiteRules(config: SystemSectionContentConfig): string {
	return config.yoloModeEnabled ? withoutPromptFragments(LITE_RULES, [LITE_RULES_YOLO_ASK_CLAUSE]) : LITE_RULES
}
