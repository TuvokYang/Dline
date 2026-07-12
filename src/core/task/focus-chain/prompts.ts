import { getPrompt, renderPrompt } from "../../prompts/i18n"

// Focus Chain prompts migrated to i18n layer for localization support.
// Each prompt is resolved via getPrompt() during module initialization.

const reminder = getPrompt("focusChain", "reminder")
const listInstructionsRecommended = getPrompt("focusChain", "listInstructionsRecommended")

export const FocusChainPrompts = {
	initial: getPrompt("focusChain", "initial"),
	reminder,
	recommended: renderPrompt("focusChain", "recommended", {
		LIST_INSTRUCTIONS_RECOMMENDED: listInstructionsRecommended,
	}),
	planModeReminder: renderPrompt("focusChain", "planModeReminder", {
		REMINDER: reminder,
	}),
	completed: getPrompt("focusChain", "completed"),
	apiRequestCount: (count: number) =>
		renderPrompt("focusChain", "apiRequestCount", {
			API_REQUEST_COUNT: count,
			REMINDER: reminder,
		}),
	tamperingRejected: getPrompt("focusChain", "tamperingRejected"),
	skipOrderRejected: getPrompt("focusChain", "skipOrderRejected"),
	skipOrderWarning: getPrompt("focusChain", "skipOrderWarning"),
	itemMismatchRejected: getPrompt("focusChain", "itemMismatchRejected"),
	inProgressMismatchRejected: getPrompt("focusChain", "inProgressMismatchRejected"),
	allCompletedAlready: getPrompt("focusChain", "allCompletedAlready"),
	attemptCompletionBlocked: getPrompt("focusChain", "attemptCompletionBlocked"),
}
