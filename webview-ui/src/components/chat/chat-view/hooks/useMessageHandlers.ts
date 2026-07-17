import type { ClineMessage } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/dline/common"
import { NewTaskRequest } from "@shared/proto/dline/task"
import { useCallback } from "react"
import { TaskServiceClient } from "@/services/grpc-client"

import type { ChatState, MessageHandlers } from "../types/chatTypes"

export async function runNewTaskSubmission(
	startTask: () => Promise<unknown>,
	clearDraft: () => void,
	restoreDraft: () => void,
): Promise<void> {
	clearDraft()
	try {
		await startTask()
	} catch (error) {
		restoreDraft()
		throw error
	}
}

/**
 * Custom hook for managing message handlers
 * Handles sending messages, button clicks, and task management
 */
export function useMessageHandlers(
	messages: ClineMessage[],
	chatState: ChatState,
	disableAutoScrollRef?: React.MutableRefObject<boolean>,
): MessageHandlers {
	const {
		activeQuote,
		setActiveQuote,
		setEnableButtons,
		setInputValue,
		setSelectedFiles,
		setSelectedImages,
		setSendingDisabled,
	} = chatState

	const handleSendMessage = useCallback(
		async (text: string, images: string[], files: string[]) => {
			let messageToSend = text.trim()
			const hasContent = messageToSend.length > 0 || images.length > 0 || files.length > 0
			if (!hasContent || messages.length > 0) {
				return
			}
			if (activeQuote) {
				messageToSend = `[context] \n> ${activeQuote}\n[/context] \n\n${messageToSend}`
			}
			await runNewTaskSubmission(
				() => TaskServiceClient.newTask(NewTaskRequest.create({ text: messageToSend, images, files })),
				() => {
					setInputValue("")
					setActiveQuote(null)
					setSendingDisabled(true)
					setSelectedImages([])
					setSelectedFiles([])
					setEnableButtons(false)
				},
				() => {
					setInputValue(text)
					setActiveQuote(activeQuote)
					setSendingDisabled(false)
					setSelectedImages(images)
					setSelectedFiles(files)
					setEnableButtons(true)
				},
			)
			if (disableAutoScrollRef) {
				disableAutoScrollRef.current = false
			}
		},
		[
			activeQuote,
			disableAutoScrollRef,
			messages.length,
			setActiveQuote,
			setEnableButtons,
			setInputValue,
			setSelectedFiles,
			setSelectedImages,
			setSendingDisabled,
		],
	)

	const startNewTask = useCallback(async () => {
		setActiveQuote(null)
		await TaskServiceClient.clearTask(EmptyRequest.create({}))
	}, [setActiveQuote])

	const handleTaskCloseButtonClick = useCallback(() => {
		void startNewTask()
	}, [startNewTask])

	return {
		handleSendMessage,
		handleTaskCloseButtonClick,
		startNewTask,
	}
}
