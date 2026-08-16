import type { ReactNode } from "react"
import { TaskRuntimeControls } from "./TaskRuntimeControls"

interface ChatInputRuntimeControlsProps {
	profileControl: ReactNode
}

/** Existing Profile entry followed by Task-local runtime controls in the chat input toolbar. */
export function ChatInputRuntimeControls({ profileControl }: ChatInputRuntimeControlsProps) {
	return (
		<>
			<div className="min-w-[10ch] max-w-[24ch] flex-[1_0_12ch] overflow-visible" data-chat-input-slot="profile">
				{profileControl}
			</div>
			<TaskRuntimeControls />
		</>
	)
}
