import { getPrompt } from "../../i18n"
import { createNativeActVsPlan, createXsActVsPlan } from "./act-vs-plan-content"
import { createNativeObjective, createXsObjective } from "./objective-content"
import { createNativeRules, createXsRules } from "./rules-content"
import type { SystemSectionContentConfig } from "./section-content-config"
import type { SystemSectionSet } from "./section-preparation"
import { createNativeSectionSet, createXsSectionSet } from "./section-preparation"
import { createNativeToolUse, createXsToolUse } from "./tool-use-content"

export type { SystemSectionContentConfig } from "./section-content-config"

const NATIVE_AGENT_ROLE = getPrompt("agentRole", "main")
const NATIVE_CAPABILITIES = getPrompt("capabilities", "main")
const NATIVE_FEEDBACK = getPrompt("variants.native", "feedback")
const SHARED_SKILLS = getPrompt("skills", "main")
const SHARED_SYSTEM_INFO = getPrompt("systemInfo", "main")
const SHARED_USER_INSTRUCTIONS = getPrompt("userInstructions", "main")
const NATIVE_TODO = getPrompt("focusChain", "main")
const NATIVE_TASK_PROGRESS = getPrompt("taskProgress", "nativeFused")
const XS_AGENT_ROLE = getPrompt("variants.lite", "agentRole")
const XS_CAPABILITIES = getPrompt("variants.lite", "capabilities")
const XS_EDITING_FILES = getPrompt("variants.lite", "editingFiles")

export function createNativeSystemSections(config: SystemSectionContentConfig): SystemSectionSet {
	return createNativeSectionSet({
		"agent-role": NATIVE_AGENT_ROLE,
		"tool-use": createNativeToolUse(config),
		todo: config.focusChainEnabled ? NATIVE_TODO : "",
		"task-progress": config.focusChainEnabled ? NATIVE_TASK_PROGRESS : "",
		"act-vs-plan": createNativeActVsPlan(),
		capabilities: NATIVE_CAPABILITIES,
		skills: config.skillsEnabled ? SHARED_SKILLS : "",
		feedback: config.focusChainEnabled ? NATIVE_FEEDBACK : "",
		rules: createNativeRules(),
		"system-info": SHARED_SYSTEM_INFO,
		objective: createNativeObjective(),
		"user-instructions": config.userInstructionsEnabled ? SHARED_USER_INSTRUCTIONS : "",
	})
}

export function createXsSystemSections(config: SystemSectionContentConfig): SystemSectionSet {
	return createXsSectionSet({
		"agent-role": XS_AGENT_ROLE,
		"tool-use": createXsToolUse(config),
		"editing-files": XS_EDITING_FILES,
		"act-vs-plan": createXsActVsPlan(),
		capabilities: XS_CAPABILITIES,
		skills: config.skillsEnabled ? SHARED_SKILLS : "",
		rules: createXsRules(),
		"system-info": SHARED_SYSTEM_INFO,
		objective: createXsObjective(),
		"user-instructions": config.userInstructionsEnabled ? SHARED_USER_INSTRUCTIONS : "",
	})
}
