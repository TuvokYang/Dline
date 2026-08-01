import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { InteractionDraft } from "@/task-interaction/types"
import { InputSection } from "./InputSection"

vi.mock("@/components/chat/ChatTextArea", () => ({
	default: (props: {
		onSend: (draft?: { text: string; images: string[]; files: string[] }) => void
		onSendBlocked?: (draft: { text: string; images: string[]; files: string[] }) => void
		sendingDisabled: boolean
	}) => (
		<>
			<button
				onClick={() =>
					props.sendingDisabled
						? props.onSendBlocked?.({ text: "captured", images: ["image"], files: ["file"] })
						: props.onSend()
				}
				type="button">
				Submit
			</button>
			<button
				onClick={() => props.onSend({ text: "mode switch", images: ["mode-image"], files: ["mode-file"] })}
				type="button">
				Complete Mode Switch
			</button>
		</>
	),
}))
vi.mock("@/components/chat/QuotedMessagePreview", () => ({ default: ({ children }: { children?: ReactNode }) => children }))

const draft = (text: string): InteractionDraft => ({ text, images: [], files: [], activeQuote: null, ownerRevision: 1 })

function props(currentDraft: InteractionDraft): ComponentProps<typeof InputSection> {
	return {
		chatState: {
			activeQuote: null,
			setActiveQuote: vi.fn(),
			isTextAreaFocused: false,
			inputValue: currentDraft.text,
			setInputValue: vi.fn(),
			sendingDisabled: false,
			selectedImages: currentDraft.images,
			setSelectedImages: vi.fn(),
			selectedFiles: currentDraft.files,
			setSelectedFiles: vi.fn(),
			textAreaRef: { current: null },
			handleFocusChange: vi.fn(),
		},
		messageHandlers: { handleSendMessage: vi.fn() },
		scrollBehavior: { isAtBottom: true, scrollToBottomAuto: vi.fn() },
		placeholderText: "Type a message...",
		shouldDisableFilesAndImages: false,
		selectFilesAndImages: vi.fn(),
		draft: currentDraft,
		onDraftAccepted: vi.fn(),
	} as ComponentProps<typeof InputSection>
}

describe("InputSection deferred task submission", () => {
	it("submits the captured draft once the same task interaction becomes enabled", async () => {
		const onSubmit = vi.fn(async () => undefined)
		const initial = props(draft("initial"))
		const { rerender } = render(<InputSection {...initial} enabled={false} onSubmit={onSubmit} submissionScope="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Submit" }))
		expect(onSubmit).not.toHaveBeenCalled()

		const updated = props(draft("changed after enter"))
		rerender(<InputSection {...updated} enabled={true} onSubmit={onSubmit} submissionScope="task-1" />)

		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
		expect(onSubmit).toHaveBeenCalledWith({
			text: "captured",
			images: ["image"],
			files: ["file"],
			activeQuote: null,
			ownerRevision: 1,
		})
	})

	it("drops a deferred draft when task ownership changes", async () => {
		const onSubmit = vi.fn(async () => undefined)
		const initial = props(draft("initial"))
		const { rerender } = render(<InputSection {...initial} enabled={false} onSubmit={onSubmit} submissionScope="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Submit" }))
		const updated = props(draft("new task"))
		rerender(<InputSection {...updated} enabled={true} onSubmit={onSubmit} submissionScope="task-2" />)

		await Promise.resolve()
		expect(onSubmit).not.toHaveBeenCalled()
	})

	it("defers a mode-switch draft until the same task interaction becomes enabled", async () => {
		const onSubmit = vi.fn(async () => undefined)
		const initial = props(draft("initial"))
		const { rerender } = render(<InputSection {...initial} enabled={false} onSubmit={onSubmit} submissionScope="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Complete Mode Switch" }))
		expect(onSubmit).not.toHaveBeenCalled()

		const updated = props(draft("changed after switch"))
		rerender(<InputSection {...updated} enabled={true} onSubmit={onSubmit} submissionScope="task-1" />)

		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
		expect(onSubmit).toHaveBeenCalledWith({
			text: "mode switch",
			images: ["mode-image"],
			files: ["mode-file"],
			activeQuote: null,
			ownerRevision: 1,
		})
	})
})
