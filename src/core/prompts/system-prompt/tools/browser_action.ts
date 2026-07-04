import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.BROWSER

const GENERIC: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "browser_action",
	description: getPrompt("browserAction", "description"),
	contextRequirements: (context) => context.supportsBrowserUse === true,
	parameters: [
		{
			name: "action",
			required: true,
			instruction: getPrompt("browserAction", "actionInstruction"),
			usage: getPrompt("browserAction", "actionUsage"),
		},
		{
			name: "url",
			required: false,
			instruction: getPrompt("browserAction", "urlInstruction"),
			usage: getPrompt("browserAction", "urlUsage"),
		},
		{
			name: "coordinate",
			required: false,
			instruction: getPrompt("browserAction", "coordinateInstruction"),
			usage: getPrompt("browserAction", "coordinateUsage"),
		},
		{
			name: "text",
			required: false,
			instruction: getPrompt("browserAction", "textInstruction"),
			usage: getPrompt("browserAction", "textUsage"),
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "browser_action",
	description: getPrompt("browserAction", "description"),
	contextRequirements: (context) => context.supportsBrowserUse === true,
	parameters: [
		{
			name: "action",
			required: true,
			instruction: getPrompt("browserAction", "nativeActionInstruction"),
		},
		{
			name: "url",
			required: false,
			instruction: getPrompt("browserAction", "nativeUrlInstruction"),
		},
		{
			name: "coordinate",
			required: false,
			instruction: getPrompt("browserAction", "nativeCoordinateInstruction"),
		},
		{
			name: "text",
			required: false,
			instruction: getPrompt("browserAction", "nativeTextInstruction"),
		},
	],
}

export const browser_action_variants = [GENERIC, NATIVE_NEXT_GEN]
