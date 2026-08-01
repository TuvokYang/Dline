import type { ModelPricing } from "@shared/api"
import { ClineMessage } from "@shared/ExtensionMessage"
import React from "react"
import TaskHeader from "@/components/chat/task-header/TaskHeader"
import { MessageHandlers } from "../../types/chatTypes"

interface TaskSectionProps {
	task: ClineMessage
	apiMetrics: {
		totalTokensIn: number
		totalTokensOut: number
		totalCacheWrites?: number
		totalCacheReads?: number
		totalCost: number
		cacheHitRate?: number
		currency?: string
	}
	lastApiReqTotalTokens?: number
	selectedModelInfo: {
		contextWindow?: number
		supportsPromptCache: boolean
		supportsImages: boolean
		pricing?: ModelPricing
	}
	messageHandlers: MessageHandlers
	lastProgressMessageText?: string
	showFocusChainPlaceholder?: boolean
}

/**
 * Task section shown when there's an active task
 * Includes the task header and manages task-specific UI
 */
export const TaskSection: React.FC<TaskSectionProps> = ({
	task,
	apiMetrics,
	lastApiReqTotalTokens,
	selectedModelInfo,
	messageHandlers,
	lastProgressMessageText,
	showFocusChainPlaceholder,
}) => {
	return (
		<TaskHeader
			cacheHitRate={apiMetrics.cacheHitRate}
			cacheReads={apiMetrics.totalCacheReads}
			cacheWrites={apiMetrics.totalCacheWrites}
			contextWindow={selectedModelInfo.contextWindow}
			currency={apiMetrics.currency}
			doesModelSupportPromptCache={selectedModelInfo.supportsPromptCache}
			lastApiReqTotalTokens={lastApiReqTotalTokens}
			lastProgressMessageText={lastProgressMessageText}
			onClose={messageHandlers.handleTaskCloseButtonClick}
			onSendMessage={messageHandlers.handleSendMessage}
			pricing={selectedModelInfo.pricing}
			showFocusChainPlaceholder={showFocusChainPlaceholder}
			task={task}
			tokensIn={apiMetrics.totalTokensIn}
			tokensOut={apiMetrics.totalTokensOut}
			totalCost={apiMetrics.totalCost}
		/>
	)
}
