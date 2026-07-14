import React from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import type { ModeSwitchDraft } from "@/components/chat/mode-switch/useModeSwitch"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputDraft {
	text: string
	images: string[]
	files: string[]
}

interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
	enabled?: boolean
	onSubmit?: (draft: InputDraft) => Promise<boolean>
}

/**
 * Input section including quoted message preview and chat text area
 */
export const InputSection: React.FC<InputSectionProps> = ({
	chatState,
	messageHandlers,
	scrollBehavior,
	placeholderText,
	shouldDisableFilesAndImages,
	selectFilesAndImages,
	enabled,
	onSubmit,
}) => {
	const {
		activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		inputValue,
		setInputValue,
		sendingDisabled,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		textAreaRef,
		handleFocusChange,
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior
	const submitDraft = async (capturedDraft?: ModeSwitchDraft) => {
		const draft = {
			text: capturedDraft?.text ?? inputValue,
			images: capturedDraft?.images ?? selectedImages,
			files: capturedDraft?.files ?? selectedFiles,
		}
		const accepted = onSubmit
			? await onSubmit(draft)
			: (await messageHandlers.handleSendMessage(draft.text, draft.images, draft.files), true)
		if (accepted && onSubmit) {
			setInputValue("")
			setSelectedImages([])
			setSelectedFiles([])
		}
	}

	return (
		<>
			{activeQuote && (
				<div style={{ marginBottom: "-12px", marginTop: "10px" }}>
					<QuotedMessagePreview
						isFocused={isTextAreaFocused}
						onDismiss={() => setActiveQuote(null)}
						text={activeQuote}
					/>
				</div>
			)}

			<ChatTextArea
				activeQuote={activeQuote}
				inputValue={inputValue}
				onFocusChange={handleFocusChange}
				onHeightChange={() => {
					if (isAtBottom) {
						scrollToBottomAuto()
					}
				}}
				onSelectFilesAndImages={selectFilesAndImages}
				onSend={(capturedDraft?: ModeSwitchDraft) => void submitDraft(capturedDraft)}
				placeholderText={placeholderText}
				ref={textAreaRef}
				selectedFiles={selectedFiles}
				selectedImages={selectedImages}
				sendingDisabled={enabled === undefined ? sendingDisabled : !enabled}
				setInputValue={setInputValue}
				setSelectedFiles={setSelectedFiles}
				setSelectedImages={setSelectedImages}
				shouldDisableFilesAndImages={shouldDisableFilesAndImages}
			/>
		</>
	)
}
