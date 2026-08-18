import { ApiHandler } from "@core/api"
import { findLastIndex } from "@shared/array"
import { showApprovalNotification } from "@/integrations/notifications"
import { ClineApiReqCancelReason, ClineApiReqInfo } from "@/shared/ExtensionMessage"
import { calculateApiCostAnthropic } from "@/utils/cost"
import { MessageStateHandler } from "./message-state"

export const showNotificationForApproval = (message: string, notificationsEnabled: boolean) => {
	void showApprovalNotification({ message }, notificationsEnabled)
}

type UpdateApiReqMsgParams = {
	messageStateHandler: MessageStateHandler
	lastApiReqIndex: number
	inputTokens: number
	outputTokens: number
	cacheWriteTokens: number
	cacheReadTokens: number
	contextTokens: number
	totalCost?: number
	cacheHitRate?: number
	api: ApiHandler
	cancelReason?: ClineApiReqCancelReason
	streamingFailedMessage?: string
}

/**
 * Finalize persisted API request usage and pricing metadata.
 *
 * @param params Normalized request metrics and persistence dependencies.
 * @returns A promise that resolves after the request message is updated.
 */
export const updateApiReqMsg = async (params: UpdateApiReqMsgParams): Promise<void> => {
	const clineMessages = params.messageStateHandler.clineMessages
	const requestedMessage = clineMessages[params.lastApiReqIndex]
	const currentApiReqIndex =
		requestedMessage?.say === "api_req_started"
			? params.lastApiReqIndex
			: findLastIndex(clineMessages, (message) => message.say === "api_req_started")
	if (currentApiReqIndex === -1) {
		throw new Error(
			`Unable to finalize API request message: no api_req_started message remains (requested index ${params.lastApiReqIndex})`,
		)
	}
	const currentApiReqInfo: ClineApiReqInfo = JSON.parse(clineMessages[currentApiReqIndex].text || "{}")
	delete currentApiReqInfo.retryStatus // Clear retry status when request is finalized

	const modelInfo = params.api.getModel().info
	const totalInputTokens = params.inputTokens + (params.cacheWriteTokens || 0) + (params.cacheReadTokens || 0)
	const cacheHitRate = params.cacheHitRate ?? (totalInputTokens > 0 ? (params.cacheReadTokens / totalInputTokens) * 100 : 0)

	const hasReliableContextTokens = Number.isFinite(params.contextTokens) && params.contextTokens > 0
	await params.messageStateHandler.updateClineMessage(currentApiReqIndex, {
		text: JSON.stringify({
			...currentApiReqInfo, // Spread the modified info (with retryStatus removed)
			...(hasReliableContextTokens
				? { contextTokens: params.contextTokens, contextTokensSource: "provider" as const }
				: {}),
			tokensIn: params.inputTokens,
			tokensOut: params.outputTokens,
			cacheWrites: params.cacheWriteTokens,
			cacheReads: params.cacheReadTokens,
			cost:
				params.totalCost ??
				calculateApiCostAnthropic(
					modelInfo,
					params.inputTokens,
					params.outputTokens,
					params.cacheWriteTokens,
					params.cacheReadTokens,
				),
			cacheHitRate: Math.round(cacheHitRate * 100) / 100, // Round to 2 decimal places
			currency: modelInfo.pricing?.currency || "USD",
			inputPrice: modelInfo.pricing?.inputPrice,
			outputPrice: modelInfo.pricing?.outputPrice,
			cancelReason: params.cancelReason,
			streamingFailedMessage: params.streamingFailedMessage,
		} satisfies ClineApiReqInfo),
	})
}

/**
 * Extracts the domain from a provider URL string
 * @param url The URL to extract domain from
 * @returns The domain/hostname or undefined if invalid
 */
export function extractProviderDomainFromUrl(url: string | undefined): string | undefined {
	if (!url) {
		return undefined
	}
	try {
		const urlObj = new URL(url)
		return urlObj.hostname
	} catch {
		return undefined
	}
}
