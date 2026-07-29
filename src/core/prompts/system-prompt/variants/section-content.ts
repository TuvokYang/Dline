import { getPrompt } from "../../i18n"
import { createLiteActVsPlan, createNativeActVsPlan } from "./act-vs-plan-content"
import { withoutPromptFragments } from "./conditional-content"
import { createLiteObjective, createNativeObjective } from "./objective-content"
import { createLiteRules, createNativeRules } from "./rules-content"
import type { SystemSectionContentConfig } from "./section-content-config"
import type { SystemSectionSet } from "./section-preparation"
import { createLiteSectionSet, createNativeSectionSet } from "./section-preparation"
import { createLiteToolUse, createNativeToolUse } from "./tool-use-content"

export type { SystemSectionContentConfig } from "./section-content-config"

const NATIVE_AGENT_ROLE = getPrompt("agentRole", "main")
const NATIVE_CAPABILITIES = getPrompt("capabilities", "main")
const NATIVE_FEEDBACK = getPrompt("variants.native", "feedback")
const SHARED_SKILLS = getPrompt("skills", "main")
const SHARED_SYSTEM_INFO = getPrompt("systemInfo", "main")
const SHARED_USER_INSTRUCTIONS = getPrompt("userInstructions", "main")
const SHARED_FOCUS_CHAIN = getPrompt("focusChain", "main")
const SHARED_TASK_PROGRESS = getPrompt("taskProgress", "nativeFused")
const LITE_AGENT_ROLE = getPrompt("variants.lite", "agentRole")
const LITE_CAPABILITIES = getPrompt("variants.lite", "capabilities")
const LITE_CAPABILITIES_YOLO_QUESTION_GUIDANCE = getPrompt("variants.lite", "capabilitiesYoloQuestionGuidance")
const LITE_EDITING_FILES = getPrompt("variants.lite", "editingFiles")

export function createNativeSystemSections(config: SystemSectionContentConfig): SystemSectionSet {
	return createNativeSectionSet({
		"agent-role": NATIVE_AGENT_ROLE,
		"tool-use": createNativeToolUse(config),
		todo: config.focusChainEnabled ? SHARED_FOCUS_CHAIN : "",
		"task-progress": config.focusChainEnabled ? SHARED_TASK_PROGRESS : "",
		"act-vs-plan": createNativeActVsPlan(),
		capabilities: NATIVE_CAPABILITIES,
		skills: config.skillsEnabled ? SHARED_SKILLS : "",
		feedback: config.focusChainEnabled ? NATIVE_FEEDBACK : "",
		rules: createNativeRules(config),
		"system-info": SHARED_SYSTEM_INFO,
		objective: createNativeObjective(config),
		"user-instructions": config.userInstructionsEnabled ? SHARED_USER_INSTRUCTIONS : "",
	})
}

export function createLiteSystemSections(config: SystemSectionContentConfig): SystemSectionSet {
	return createLiteSectionSet({
		"agent-role": LITE_AGENT_ROLE,
		"tool-use": createLiteToolUse(config),
		"editing-files": LITE_EDITING_FILES,
		"act-vs-plan": createLiteActVsPlan(config),
		capabilities: config.yoloModeEnabled
			? withoutPromptFragments(LITE_CAPABILITIES, [LITE_CAPABILITIES_YOLO_QUESTION_GUIDANCE])
			: LITE_CAPABILITIES,
		skills: "",
		rules: createLiteRules(config),
		"system-info": SHARED_SYSTEM_INFO,
		objective: createLiteObjective(),
		"user-instructions": config.userInstructionsEnabled ? SHARED_USER_INSTRUCTIONS : "",
	})
}
