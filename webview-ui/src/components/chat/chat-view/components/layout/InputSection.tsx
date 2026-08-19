import { flushPendingTaskSettingsRequests } from "@components/settings/utils/settingsHandlers"
import type { ClineAsk } from "@shared/ExtensionMessage"
import React, { useEffect, useRef } from "react"
import ChatTextArea from "@/components/chat/ChatTextArea"
import type { ModeSwitchDraft } from "@/components/chat/mode-switch/useModeSwitch"
import QuotedMessagePreview from "@/components/chat/QuotedMessagePreview"
import type { AcceptedInteractionSettlement, InteractionDraft } from "@/task-interaction/types"
import { ChatState, MessageHandlers, ScrollBehavior } from "../../types/chatTypes"

interface InputSectionProps {
	chatState: ChatState
	messageHandlers: MessageHandlers
	scrollBehavior: ScrollBehavior
	placeholderText: string
	shouldDisableFilesAndImages: boolean
	selectFilesAndImages: () => Promise<void>
	draft: InteractionDraft
	enabled?: boolean
	onSubmit?: (draft: InteractionDraft) => Promise<AcceptedInteractionSettlement | undefined>
	onDraftAccepted: (settlement: AcceptedInteractionSettlement) => void
	submissionScope?: string
	clineAsk?: ClineAsk
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
	draft: currentDraft,
	enabled,
	onSubmit,
	onDraftAccepted,
	submissionScope,
	clineAsk,
}) => {
	const {
		activeQuote,
		setActiveQuote,
		isTextAreaFocused,
		inputValue,
		setInputValue,
		undoInputValue,
		redoInputValue,
		sendingDisabled,
		selectedImages,
		setSelectedImages,
		selectedFiles,
		setSelectedFiles,
		textAreaRef,
		handleFocusChange,
	} = chatState

	const { isAtBottom, scrollToBottomAuto } = scrollBehavior
	const deferredSubmitRef = useRef<{ scope: string | undefined; draft: ModeSwitchDraft }>()
	const submitDraft = async (capturedDraft?: ModeSwitchDraft) => {
		if (submissionScope) await flushPendingTaskSettingsRequests(submissionScope)
		const draft: InteractionDraft = capturedDraft
			? {
					text: capturedDraft.text,
					images: [...capturedDraft.images],
					files: [...capturedDraft.files],
					activeQuote,
					ownerRevision: currentDraft.ownerRevision,
				}
			: currentDraft
		if (!onSubmit) {
			await messageHandlers.handleSendMessage(draft.text, draft.images, draft.files)
			return
		}
		const settlement = await onSubmit(draft)
		if (settlement) {
			onDraftAccepted(settlement)
		}
	}
	const submitDraftRef = useRef(submitDraft)
	submitDraftRef.current = submitDraft
	const deferDraft = (capturedDraft: ModeSwitchDraft) => {
		deferredSubmitRef.current = { scope: submissionScope, draft: capturedDraft }
	}
	const handleSend = (capturedDraft?: ModeSwitchDraft) => {
		if (capturedDraft && onSubmit && enabled === false) {
			deferDraft(capturedDraft)
			return
		}
		void submitDraft(capturedDraft)
	}

	useEffect(() => {
		const deferred = deferredSubmitRef.current
		if (!deferred) return
		if (deferred.scope !== submissionScope) {
			deferredSubmitRef.current = undefined
			return
		}
		if (!enabled) return
		deferredSubmitRef.current = undefined
		void submitDraftRef.current(deferred.draft)
	}, [enabled, submissionScope])

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
				clineAsk={clineAsk}
				inputValue={inputValue}
				onFocusChange={handleFocusChange}
				onHeightChange={() => {
					if (isAtBottom) {
						scrollToBottomAuto()
					}
				}}
				onSelectFilesAndImages={selectFilesAndImages}
				onSend={handleSend}
				onSendBlocked={onSubmit ? deferDraft : undefined}
				placeholderText={placeholderText}
				redoInputValue={redoInputValue}
				ref={textAreaRef}
				selectedFiles={selectedFiles}
				selectedImages={selectedImages}
				sendingDisabled={enabled === undefined ? sendingDisabled : !enabled}
				setInputValue={setInputValue}
				setSelectedFiles={setSelectedFiles}
				setSelectedImages={setSelectedImages}
				shouldDisableFilesAndImages={shouldDisableFilesAndImages}
				undoInputValue={undoInputValue}
			/>
		</>
	)
}
