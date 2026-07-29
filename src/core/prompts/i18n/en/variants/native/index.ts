import { createRuntimeContract } from "../../../helpers/create-contract"
import { definePromptModule } from "../../../helpers/define-module"
import {
	NATIVE_ACT_VS_PLAN,
	NATIVE_FEEDBACK,
	NATIVE_OBJECTIVE,
	NATIVE_OBJECTIVE_FOCUS_CLOSURE_STEP,
	NATIVE_OBJECTIVE_FOCUS_PROGRESS,
	NATIVE_PARALLEL_TOOL_USE,
	NATIVE_RULES,
	NATIVE_RULES_FOCUS_CONTRACT,
	NATIVE_TOOL_USE_FOCUS_FORMAT,
	NATIVE_TOOL_USE_FOCUS_STAGE,
	NATIVE_TOOL_USE_PREFIX,
	NATIVE_TOOL_USE_SUFFIX,
} from "./content"
export const nativePromptModule = definePromptModule({
	name: "variants.native",
	domain: "variants",
	prompts: {
		actVsPlan: NATIVE_ACT_VS_PLAN,
		feedback: NATIVE_FEEDBACK,
		objective: NATIVE_OBJECTIVE,
		objectiveFocusClosureStep: NATIVE_OBJECTIVE_FOCUS_CLOSURE_STEP,
		objectiveFocusProgress: NATIVE_OBJECTIVE_FOCUS_PROGRESS,
		parallelToolUse: NATIVE_PARALLEL_TOOL_USE,
		rules: NATIVE_RULES,
		rulesFocusContract: NATIVE_RULES_FOCUS_CONTRACT,
		toolUseFocusFormat: NATIVE_TOOL_USE_FOCUS_FORMAT,
		toolUseFocusStage: NATIVE_TOOL_USE_FOCUS_STAGE,
		toolUsePrefix: NATIVE_TOOL_USE_PREFIX,
		toolUseSuffix: NATIVE_TOOL_USE_SUFFIX,
	},
	contracts: {
		actVsPlan: createRuntimeContract("CLARIFY_PERMISSION"),
		objective: createRuntimeContract("PARALLEL_TOOL_POLICY", "CLARIFY_RULE", "MISSING_PARAM_POLICY"),
		rules: createRuntimeContract("CWD", "PARALLEL_TOOLS_RULE", "BROWSER_WAIT_RULES", "MCP_RULE"),
	},
	source: "i18n/en/variants/native/index.ts",
})
