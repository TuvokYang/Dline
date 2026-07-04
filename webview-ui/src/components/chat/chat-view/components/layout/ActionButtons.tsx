import type { ClineMessage } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { BUTTON_CONFIGS, ButtonActionType, getButtonConfig } from "../../shared/buttonConfig"

import type { ChatState, MessageHandlers } from "../../types/chatTypes"

interface ActionButtonsProps {
	task?: ClineMessage
	messages: ClineMessage[]
	chatState: ChatState
	messageHandlers: MessageHandlers
	mode: Mode
	isWorking?: boolean
	isLastMsgResume?: boolean
}

/**
 * Action buttons area including scroll-to-bottom and approve/reject buttons
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({
	task,
	messages,
	chatState,
	mode,
	messageHandlers,
	isWorking,
	isLastMsgResume,
}) => {
	const { inputValue, selectedImages, selectedFiles, setSendingDisabled, sendingDisabled } = chatState
	const [isProcessing, setIsProcessing] = useState(false)

	// Memoize last messages to avoid unnecessary recalculations
	const [lastMessage, secondLastMessage] = useMemo(() => {
		if (chatState.lastMessage) {
			return [chatState.lastMessage, chatState.secondLastMessage]
		}
		const len = messages.length
		return len > 0 ? [messages[len - 1], messages[len - 2]] : [undefined, undefined]
	}, [chatState.lastMessage, chatState.secondLastMessage, messages])

	// Memoize button configuration to avoid recalculation on every render
	const buttonConfig = useMemo(() => {
		// Priority 1: activeBlock from TaskController (approval state machine)
		if (chatState.activeBlock && chatState.activeBlock.phase === "awaiting_approval") {
			const syntheticAsk: ClineMessage = {
				ts: Date.now(),
				type: "ask",
				ask: chatState.activeBlock.askType as any,
				text: "",
			} as ClineMessage
			return getButtonConfig(syntheticAsk, mode)
		}
		const config = lastMessage ? getButtonConfig(lastMessage, mode) : { sendingDisabled: false, enableButtons: false }
		if (isWorking && (config === BUTTON_CONFIGS.default || !config.enableButtons)) {
			return {
				sendingDisabled: true,
				enableButtons: true,
				primaryText: undefined,
				secondaryText: "Cancel",
				secondaryAction: "cancel" as ButtonActionType,
			}
		}
		if (isLastMsgResume) {
			return BUTTON_CONFIGS.resume_task
		}
		return config
	}, [chatState.activeBlock, lastMessage, mode, isWorking, isLastMsgResume])

	// Update sendingDisabled whenever button config changes
	useEffect(() => {
		setSendingDisabled(buttonConfig.sendingDisabled)
	}, [buttonConfig, setSendingDisabled])

	// Reset isProcessing when lastMessage changes so consecutive same-type
	// asks (common with parallel tool calls) don't leave buttons disabled.
	useEffect(() => {
		setIsProcessing(false)
	}, [])

	// Reset isProcessing after cancel — cancel handler sets sendingDisabled
	// to false on completion but cannot reach this component's local state.
	useEffect(() => {
		if (!sendingDisabled) {
			setIsProcessing(false)
		}
	}, [sendingDisabled])

	// Clear input when transitioning from command_output to api_req
	// This happens when user provides feedback during command execution
	useEffect(() => {
		if (lastMessage?.type === "say" && lastMessage.say === "api_req_started" && secondLastMessage?.ask === "command_output") {
			chatState.setInputValue("")
			chatState.setSelectedImages([])
			chatState.setSelectedFiles([])
		}
	}, [lastMessage?.type, lastMessage?.say, secondLastMessage?.ask, chatState])

	const handleActionClick = useCallback(
		(action: ButtonActionType, text?: string, images?: string[], files?: string[]) => {
			if (isProcessing) {
				return
			}
			setIsProcessing(true)

			void messageHandlers.executeButtonAction(action, text, images, files).catch(() => {
				// Reset processing state on errors to avoid getting stuck.
				setIsProcessing(false)
			})
		},
		[messageHandlers, isProcessing],
	)

	// Keyboard event handler
	const handleKeyDown = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault()
				event.stopPropagation()
				handleActionClick("cancel")
			}
		},
		[handleActionClick],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown])

	if (!task) {
		return null
	}

	const { primaryText, secondaryText, primaryAction, secondaryAction, enableButtons } = buttonConfig
	const hasButtons = primaryText || secondaryText
	const isStreaming = task.partial === true
	const canInteract = enableButtons && !isProcessing

	if (!hasButtons) {
		return null
	}

	const opacity = canInteract || isStreaming ? 1 : 0.5

	return (
		<div className="flex mx-3.5 border border-(--vscode-panel-border) rounded" style={{ opacity }}>
			{primaryText && primaryAction && (
				<VSCodeButton
					appearance="primary"
					className={`${secondaryText ? "flex-1 mr-[6px]" : "flex-2"} focus:ring-2 focus:ring-[--vscode-focusBorder] rounded`}
					disabled={!canInteract}
					onClick={() => handleActionClick(primaryAction, inputValue, selectedImages, selectedFiles)}>
					{primaryText}
				</VSCodeButton>
			)}
			{secondaryText && secondaryAction && (
				<VSCodeButton
					appearance="secondary"
					className={`${primaryText ? "flex-1" : "flex-2"} focus:ring-2 focus:ring-[--vscode-focusBorder] rounded`}
					disabled={!canInteract}
					onClick={() => handleActionClick(secondaryAction, inputValue, selectedImages, selectedFiles)}>
					{secondaryText}
				</VSCodeButton>
			)}
		</div>
	)
}
