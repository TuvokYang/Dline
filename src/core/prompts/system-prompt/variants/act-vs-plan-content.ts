import { getPrompt } from "../../i18n"
import { withoutPromptFragments } from "./conditional-content"
import type { SystemSectionContentConfig } from "./section-content-config"

const STANDARD_ACT_VS_PLAN = getPrompt("variants.standard", "actVsPlan")
const LITE_ACT_VS_PLAN = getPrompt("variants.lite", "actVsPlan")
const LITE_ACT_PLAN_YOLO_ASK_TOOL = getPrompt("variants.lite", "actVsPlanYoloAskTool")
const LITE_ACT_PLAN_YOLO_QUESTION_GUIDANCE = getPrompt("variants.lite", "actVsPlanYoloQuestionGuidance")

export function createStandardActVsPlan(): string {
	return STANDARD_ACT_VS_PLAN
}

export function createLiteActVsPlan(config: SystemSectionContentConfig): string {
	return config.yoloModeEnabled
		? withoutPromptFragments(LITE_ACT_VS_PLAN, [LITE_ACT_PLAN_YOLO_ASK_TOOL, LITE_ACT_PLAN_YOLO_QUESTION_GUIDANCE])
		: LITE_ACT_VS_PLAN
}
