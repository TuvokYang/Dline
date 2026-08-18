import type { ReactNode } from "react"
import { TaskRuntimeControls } from "./TaskRuntimeControls"

interface ChatInputRuntimeControlsProps {
	profileControl: ReactNode
}

/** Existing Profile entry followed by Task-local runtime controls in the chat input toolbar. */
export function ChatInputRuntimeControls({ profileControl }: ChatInputRuntimeControlsProps) {
	return (
		<div className="flex min-w-0 items-center gap-[3px]" data-chat-input-runtime-controls>
			<div className="min-w-0 max-w-[12ch] flex-[0_1_auto] overflow-hidden" data-chat-input-slot="profile">
				{profileControl}
			</div>
			<TaskRuntimeControls />
		</div>
	)
}
