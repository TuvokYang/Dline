import type { ClineMessage, TaskUiAction } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { BUTTON_CONFIGS, ButtonActionType, getButtonConfig } from "../../shared/buttonConfig"

import type { ChatState, MessageHandlers } from "../../types/chatTypes"

/**
 * Map TaskUiAction type to ButtonActionType for backward compatibility
 */
const mapActionType = (type: TaskUiAction["type"]): ButtonActionType => {
	switch (type) {
		case "approve":
			return "approve"
		case "reject":
			return "reject"
		case "cancel":
			return "cancel"
		case "resume":
			return "proceed"
		case "retry":
			return "retry"
		case "process_anyway":
			return "proceed"
		case "start_new_task":
			return "new_task"
		case "primary":
			return "proceed"
		case "secondary":
			return "reject"
		default:
			return "approve"
	}
}

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

	// Memoize button configuration for legacy fallback path
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

	// Update sendingDisabled for legacy path (when taskUiState is not available)
	useEffect(() => {
		if (!chatState.taskUiState) {
			setSendingDisabled(buttonConfig.sendingDisabled)
		}
	}, [chatState.taskUiState, buttonConfig.sendingDisabled, setSendingDisabled])

	// Update sendingDisabled from taskUiState.inputEnabled when snapshot-first architecture is active
	useEffect(() => {
		if (chatState.taskUiState) {
			setSendingDisabled(!chatState.taskUiState.inputEnabled)
		}
	}, [chatState.taskUiState, setSendingDisabled])

	const taskActionKey = useMemo(() => {
		const state = chatState.taskUiState
		if (!state) {
			return ""
		}
		return state.actions.map((action) => `${action.type}:${action.label}:${action.enabled}`).join("|")
	}, [chatState.taskUiState])

	// Reset isProcessing when the active interaction changes so new buttons
	// are not disabled by the previous action's pending state.
	useEffect(() => {
		setIsProcessing(false)
	}, [
		lastMessage?.ts,
		lastMessage?.type,
		lastMessage?.ask,
		lastMessage?.say,
		chatState.taskUiState?.phase,
		chatState.taskUiState?.reason,
		chatState.taskUiState?.activeAsk,
		chatState.taskUiState?.activeCallId,
		taskActionKey,
	])

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
			if (event.key !== "Escape") {
				return
			}

			if (chatState.taskUiState && !chatState.taskUiState.cancelEnabled) {
				return
			}

			event.preventDefault()
			event.stopPropagation()
			handleActionClick("cancel")
		},
		[chatState.taskUiState, handleActionClick],
	)

	useEffect(() => {
		window.addEventListener("keydown", handleKeyDown)
		return () => window.removeEventListener("keydown", handleKeyDown)
	}, [handleKeyDown])

	// Priority 1: Use taskUiState if available (snapshot-first architecture)
	if (chatState.taskUiState && (!chatState.taskUiState.showFooter || chatState.taskUiState.actions.length === 0)) {
		return null
	}

	if (chatState.taskUiState?.actions && chatState.taskUiState.actions.length > 0) {
		// Limit to max 3 buttons to prevent UI crowding
		const visibleActions = chatState.taskUiState.actions.slice(0, 3)
		const canInteract = !isProcessing
		const isStreaming = task?.partial === true
		const opacity = canInteract || isStreaming ? 1 : 0.5

		return (
			<div className="flex mx-3.5 border border-(--vscode-panel-border) rounded gap-1.5" style={{ opacity }}>
				{visibleActions.map((action, index) => {
					// First button is primary, rest are secondary
					const appearance = index === 0 ? "primary" : "secondary"

					return (
						<VSCodeButton
							appearance={appearance}
							className="flex-1 focus:ring-2 focus:ring-[--vscode-focusBorder] rounded"
							disabled={!action.enabled || !canInteract}
							key={action.type}
							onClick={() => {
								if (isProcessing) {
									return
								}
								setIsProcessing(true)
								void messageHandlers.executeTaskUiAction(action).catch(() => {
									setIsProcessing(false)
								})
							}}>
							{action.label}
						</VSCodeButton>
					)
				})}
			</div>
		)
	}

	if (!task) {
		return null
	}

	// Priority 2: Fallback to legacy buttonConfig logic (backward compatibility)
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
