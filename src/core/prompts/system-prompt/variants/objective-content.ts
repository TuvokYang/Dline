import { getPrompt } from "../../i18n"
import { withoutPromptFragments } from "./conditional-content"
import type { SystemSectionContentConfig } from "./section-content-config"

const STANDARD_OBJECTIVE = getPrompt("variants.standard", "objective")
const STANDARD_OBJECTIVE_FOCUS_PROGRESS = getPrompt("variants.standard", "objectiveFocusProgress")
const STANDARD_OBJECTIVE_FOCUS_CLOSURE_STEP = getPrompt("variants.standard", "objectiveFocusClosureStep")
const LITE_OBJECTIVE = getPrompt("variants.lite", "objective")

export function createStandardObjective(config: SystemSectionContentConfig): string {
	return config.focusChainEnabled
		? STANDARD_OBJECTIVE
		: withoutPromptFragments(STANDARD_OBJECTIVE, [STANDARD_OBJECTIVE_FOCUS_PROGRESS, STANDARD_OBJECTIVE_FOCUS_CLOSURE_STEP])
}

export function createLiteObjective(): string {
	return LITE_OBJECTIVE
}
