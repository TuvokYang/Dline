import type { ChatContent } from "@shared/ChatContent"
import type { ClineUserToolResultContentBlock } from "@shared/messages/content"
import type { Mode } from "@shared/storage/types"
import type { InteractionKind } from "./interaction/Interaction"
import { projectInteractionContinuation } from "./interaction/InteractionContinuation"

export interface ModeSwitchContinuationInput {
	kind: InteractionKind
	functionId: string
	dlineTid: string
	sourceMode: Mode
	targetMode: Mode
	chatContent?: ChatContent
}

/** Project the canonical tool result that a pending interaction will produce after a mode switch commits. */
export async function projectModeSwitchContinuation(
	input: ModeSwitchContinuationInput,
): Promise<ClineUserToolResultContentBlock> {
	return projectInteractionContinuation({
		kind: input.kind,
		functionId: input.functionId,
		dlineTid: input.dlineTid,
		chatContent: input.chatContent,
		switchesPlanToAct: input.sourceMode === "plan" && input.targetMode === "act",
	})
}
