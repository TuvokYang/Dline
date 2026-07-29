import { getPrompt } from "../../i18n"
import { createLiteActVsPlan, createStandardActVsPlan } from "./act-vs-plan-content"
import { withoutPromptFragments } from "./conditional-content"
import { createLiteObjective, createStandardObjective } from "./objective-content"
import { createLiteRules, createStandardRules } from "./rules-content"
import type { SystemSectionContentConfig } from "./section-content-config"
import type { SystemSectionSet } from "./section-preparation"
import { createLiteSectionSet, createStandardSectionSet } from "./section-preparation"
import { createLiteToolUse, createStandardToolUse } from "./tool-use-content"

export type { SystemSectionContentConfig } from "./section-content-config"

const STANDARD_AGENT_ROLE = getPrompt("agentRole", "main")
const STANDARD_CAPABILITIES = getPrompt("capabilities", "main")
const STANDARD_FEEDBACK = getPrompt("variants.standard", "feedback")
const SHARED_SKILLS = getPrompt("skills", "main")
const SHARED_SYSTEM_INFO = getPrompt("systemInfo", "main")
const SHARED_USER_INSTRUCTIONS = getPrompt("userInstructions", "main")
const SHARED_FOCUS_CHAIN = getPrompt("focusChain", "main")
const SHARED_TASK_PROGRESS = getPrompt("taskProgress", "standardFused")
const LITE_AGENT_ROLE = getPrompt("variants.lite", "agentRole")
const LITE_CAPABILITIES = getPrompt("variants.lite", "capabilities")
const LITE_CAPABILITIES_YOLO_QUESTION_GUIDANCE = getPrompt("variants.lite", "capabilitiesYoloQuestionGuidance")
const LITE_EDITING_FILES = getPrompt("variants.lite", "editingFiles")

export function createStandardSystemSections(config: SystemSectionContentConfig): SystemSectionSet {
	return createStandardSectionSet({
		"agent-role": STANDARD_AGENT_ROLE,
		"tool-use": createStandardToolUse(config),
		todo: config.focusChainEnabled ? SHARED_FOCUS_CHAIN : "",
		"task-progress": config.focusChainEnabled ? SHARED_TASK_PROGRESS : "",
		"act-vs-plan": createStandardActVsPlan(),
		capabilities: STANDARD_CAPABILITIES,
		skills: config.skillsEnabled ? SHARED_SKILLS : "",
		feedback: config.focusChainEnabled ? STANDARD_FEEDBACK : "",
		rules: createStandardRules(config),
		"system-info": SHARED_SYSTEM_INFO,
		objective: createStandardObjective(config),
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
