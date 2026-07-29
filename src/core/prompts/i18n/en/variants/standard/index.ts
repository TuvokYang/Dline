import { createRuntimeContract } from "../../../helpers/create-contract"
import { definePromptModule } from "../../../helpers/define-module"
import {
	STANDARD_ACT_VS_PLAN,
	STANDARD_FEEDBACK,
	STANDARD_OBJECTIVE,
	STANDARD_OBJECTIVE_FOCUS_CLOSURE_STEP,
	STANDARD_OBJECTIVE_FOCUS_PROGRESS,
	STANDARD_PARALLEL_TOOL_USE,
	STANDARD_RULES,
	STANDARD_RULES_FOCUS_CONTRACT,
	STANDARD_TOOL_USE_FOCUS_FORMAT,
	STANDARD_TOOL_USE_FOCUS_STAGE,
	STANDARD_TOOL_USE_PREFIX,
	STANDARD_TOOL_USE_SUFFIX,
} from "./content"
export const standardPromptModule = definePromptModule({
	name: "variants.standard",
	domain: "variants",
	prompts: {
		actVsPlan: STANDARD_ACT_VS_PLAN,
		feedback: STANDARD_FEEDBACK,
		objective: STANDARD_OBJECTIVE,
		objectiveFocusClosureStep: STANDARD_OBJECTIVE_FOCUS_CLOSURE_STEP,
		objectiveFocusProgress: STANDARD_OBJECTIVE_FOCUS_PROGRESS,
		parallelToolUse: STANDARD_PARALLEL_TOOL_USE,
		rules: STANDARD_RULES,
		rulesFocusContract: STANDARD_RULES_FOCUS_CONTRACT,
		toolUseFocusFormat: STANDARD_TOOL_USE_FOCUS_FORMAT,
		toolUseFocusStage: STANDARD_TOOL_USE_FOCUS_STAGE,
		toolUsePrefix: STANDARD_TOOL_USE_PREFIX,
		toolUseSuffix: STANDARD_TOOL_USE_SUFFIX,
	},
	contracts: {
		actVsPlan: createRuntimeContract("CLARIFY_PERMISSION"),
		objective: createRuntimeContract("PARALLEL_TOOL_POLICY", "CLARIFY_RULE", "MISSING_PARAM_POLICY"),
		rules: createRuntimeContract("CWD", "PARALLEL_TOOLS_RULE", "BROWSER_WAIT_RULES", "MCP_RULE"),
	},
	source: "i18n/en/variants/standard/index.ts",
})
