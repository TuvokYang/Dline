import { getPrompt } from "../../i18n"
import { withoutPromptFragments } from "./conditional-content"
import type { SystemSectionContentConfig } from "./section-content-config"

const NATIVE_OBJECTIVE = getPrompt("variants.native", "objective")
const NATIVE_OBJECTIVE_FOCUS_PROGRESS = getPrompt("variants.native", "objectiveFocusProgress")
const NATIVE_OBJECTIVE_FOCUS_CLOSURE_STEP = getPrompt("variants.native", "objectiveFocusClosureStep")
const LITE_OBJECTIVE = getPrompt("variants.lite", "objective")

export function createNativeObjective(config: SystemSectionContentConfig): string {
	return config.focusChainEnabled
		? NATIVE_OBJECTIVE
		: withoutPromptFragments(NATIVE_OBJECTIVE, [NATIVE_OBJECTIVE_FOCUS_PROGRESS, NATIVE_OBJECTIVE_FOCUS_CLOSURE_STEP])
}

export function createLiteObjective(): string {
	return LITE_OBJECTIVE
}
