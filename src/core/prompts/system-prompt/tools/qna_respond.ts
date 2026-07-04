import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import { getPrompt } from "../../i18n"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.QNA_RESPOND

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "qna_respond",
	description: getPrompt("qnaRespond", "description"),
	parameters: [
		{
			name: "response",
			required: true,
			instruction: getPrompt("qnaRespond", "responseInstruction"),
			usage: getPrompt("qnaRespond", "responseUsage"),
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	variant: ModelFamily.NATIVE_NEXT_GEN,
	id,
	name: "qna_respond",
	description: getPrompt("qnaRespond", "nativeDescription"),
	parameters: [
		{
			name: "response",
			required: true,
			instruction: getPrompt("qnaRespond", "nativeResponseInstruction"),
		},
	],
}

export const qna_respond_variants = [generic, NATIVE_NEXT_GEN]
