import { getPrompt } from "./i18n"

export const summarizeTask = (focusChainSettings?: { enabled: boolean }, cwd?: string, isMultiRootEnabled?: boolean) => {
	const CWD = cwd ? cwd.toPosix() : ""

	const MULTI_ROOT_HINT = isMultiRootEnabled
		? " Use @workspace:path syntax (e.g., @frontend:src/index.ts) to specify a workspace."
		: ""

	const focusChainEnabled = focusChainSettings?.enabled
	const focusChainParam = focusChainEnabled ? getPrompt("contextManagement", "summarizeFocusChainParam") : ""
	const focusChainUsage = focusChainEnabled ? getPrompt("contextManagement", "summarizeFocusChainUsage") : ""
	const focusChainExample = focusChainEnabled ? getPrompt("contextManagement", "summarizeFocusChainExample") : ""

	return `${getPrompt("contextManagement", "autoCompactMain", { CWD, MULTI_ROOT_HINT, focusChainParam, focusChainUsage, focusChainExample })}\n`
}

export const continuationPrompt = (summaryText: string) =>
	`${getPrompt("contextManagement", "continuationPrompt", { summaryText })}\n`
