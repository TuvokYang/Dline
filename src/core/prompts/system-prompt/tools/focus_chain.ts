import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

// HACK: Placeholder to act as tool dependency (existing TODO tool)
const todoPlaceholder: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.TODO,
	name: "focus_chain",
	description: "",
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
}

// focus_chain_change tool — override focus chain plan with user approval
const fcChangeGeneric: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id: ClineDefaultTool.FOCUS_CHAIN_CHANGE,
	name: "focus_chain_change",
	description: getPrompt("focusChain", "focusChainChangeToolDescription"),
	parameters: [
		{
			name: "new_plan",
			required: true,
			instruction: getPrompt("focusChain", "focusChainChangeNewPlanInstruction"),
		},
		{
			name: "reason",
			required: false,
			instruction: getPrompt("focusChain", "focusChainChangeReasonInstruction"),
		},
	],
	contextRequirements: (context) => context.focusChainSettings?.enabled === true,
}

const fcChangeNative: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id: ClineDefaultTool.FOCUS_CHAIN_CHANGE,
	name: "focus_chain_change",
	description: getPrompt("focusChain", "focusChainChangeToolDescription"),
	parameters: [
		{
			name: "new_plan",
			required: true,
			instruction: getPrompt("focusChain", "focusChainChangeNewPlanNativeInstruction"),
		},
		{
			name: "reason",
			required: false,
			instruction: getPrompt("focusChain", "focusChainChangeReasonNativeInstruction"),
		},
	],
}

export const focus_chain_variants = [todoPlaceholder, fcChangeGeneric, fcChangeNative]
