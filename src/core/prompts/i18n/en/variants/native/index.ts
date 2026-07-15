import { createRuntimeContract } from "../../../helpers/create-contract"
import { definePromptModule } from "../../../helpers/define-module"
import {
	NATIVE_FEEDBACK,
	NATIVE_NEXT_GEN_ACT_VS_PLAN,
	NATIVE_NEXT_GEN_OBJECTIVE,
	NATIVE_NEXT_GEN_RULES,
	NATIVE_PARALLEL_TOOL_USE,
	NATIVE_TOOL_USE_PREFIX,
	NATIVE_TOOL_USE_SUFFIX,
} from "./content"
export const nativePromptModule = definePromptModule({
	name: "variants.native",
	domain: "variants",
	prompts: {
		actVsPlan: NATIVE_NEXT_GEN_ACT_VS_PLAN,
		feedback: NATIVE_FEEDBACK,
		objective: NATIVE_NEXT_GEN_OBJECTIVE,
		parallelToolUse: NATIVE_PARALLEL_TOOL_USE,
		rules: NATIVE_NEXT_GEN_RULES,
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
