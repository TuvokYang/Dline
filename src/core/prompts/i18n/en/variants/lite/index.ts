import { createRuntimeContract } from "../../../helpers/create-contract"
import { definePromptModule } from "../../../helpers/define-module"
import {
	LITE_ACT_PLAN,
	LITE_AGENT_ROLE,
	LITE_CAPABILITIES,
	LITE_EDITING_FILES,
	LITE_OBJECTIVE,
	LITE_RULES,
	LITE_SUBAGENTS_GUIDANCE,
	LITE_TOOLS_NATIVE,
	LITE_TOOLS_XML,
} from "./content"
export const litePromptModule = definePromptModule({
	name: "variants.lite",
	domain: "variants",
	prompts: {
		actVsPlan: LITE_ACT_PLAN,
		agentRole: LITE_AGENT_ROLE,
		capabilities: LITE_CAPABILITIES,
		editingFiles: LITE_EDITING_FILES,
		objective: LITE_OBJECTIVE,
		rules: LITE_RULES,
		subagentsGuidance: LITE_SUBAGENTS_GUIDANCE,
		toolsNative: LITE_TOOLS_NATIVE,
		toolsXml: LITE_TOOLS_XML,
	},
	contracts: {
		rules: createRuntimeContract("CWD"),
		toolsNative: createRuntimeContract("SUBAGENTS_GUIDANCE"),
		toolsXml: createRuntimeContract("XML_TOOLS_SECTION"),
	},
	source: "i18n/en/variants/lite/index.ts",
})
