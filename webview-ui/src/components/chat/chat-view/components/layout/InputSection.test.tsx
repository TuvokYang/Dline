import type { ClineAsk } from "@shared/ExtensionMessage"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { type ComponentProps, forwardRef, type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { InteractionDraft } from "@/task-interaction/types"
import { InputSection } from "./InputSection"

vi.mock("@/components/chat/ChatTextArea", () => ({
	default: forwardRef<
		HTMLTextAreaElement,
		{
			onSend: (draft: { text: string; images: string[]; files: string[] }) => void
			onSendBlocked?: (draft: { text: string; images: string[]; files: string[] }) => void
			sendingDisabled: boolean
			clineAsk?: ClineAsk
		}
	>((props, _ref) => (
		<>
			<output data-testid="cline-ask">{props.clineAsk}</output>
			<button
				onClick={() =>
					props.sendingDisabled
						? props.onSendBlocked?.({ text: "captured", images: ["image"], files: ["file"] })
						: props.onSend({ text: "captured", images: ["image"], files: ["file"] })
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
	)),
}))
vi.mock("@/components/chat/QuotedMessagePreview", () => ({ default: ({ children }: { children?: ReactNode }) => children }))

const mocks = vi.hoisted(() => ({
	flushPendingTaskSettingsRequests: vi.fn(async () => undefined),
}))

vi.mock("@components/settings/utils/settingsHandlers", () => ({
	flushPendingTaskSettingsRequests: mocks.flushPendingTaskSettingsRequests,
}))

const draft = (text: string): InteractionDraft => ({ text, images: [], files: [], activeQuote: null, ownerRevision: 1 })

/** Give any pending replay effect and its async submit chain a chance to run. */
async function settleEffects(): Promise<void> {
	for (let tick = 0; tick < 5; tick++) {
		await Promise.resolve()
	}
}

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
	it("waits for Task settings before submitting the next request", async () => {
		let releaseSettings!: () => void
		mocks.flushPendingTaskSettingsRequests.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					releaseSettings = resolve
				}),
		)
		const onSubmit = vi.fn(async () => undefined)
		const current = props(draft("pending settings"))
		render(<InputSection {...current} enabled={true} onSubmit={onSubmit} submissionScope="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Submit" }))
		await waitFor(() => expect(mocks.flushPendingTaskSettingsRequests).toHaveBeenCalledWith("task-1"))
		expect(onSubmit).not.toHaveBeenCalled()

		releaseSettings()
		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
	})

	it("forwards the active interaction ask to mode-switch draft ownership", () => {
		render(<InputSection {...props(draft("answer"))} clineAsk="qna_respond" />)

		expect(screen.getByTestId("cline-ask")).toHaveTextContent("qna_respond")
	})

	it("submits the input-owned draft instead of a stale parent draft", async () => {
		const onSubmit = vi.fn(async () => undefined)
		const current = props(draft("stale parent"))
		render(<InputSection {...current} enabled={true} onSubmit={onSubmit} submissionScope="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Submit" }))

		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
		expect(onSubmit).toHaveBeenCalledWith({
			text: "captured",
			images: ["image"],
			files: ["file"],
			activeQuote: null,
			ownerRevision: 1,
		})
	})

	// A blocked send must never be replayed by a later state flip. Enabling the
	// input only means the composer may submit again; it must not resurrect a
	// draft the user captured earlier and has since stopped tracking.
	it("does not submit a blocked draft when the same task interaction becomes enabled", async () => {
		const onSubmit = vi.fn(async () => undefined)
		const initial = props(draft("initial"))
		const { rerender } = render(<InputSection {...initial} enabled={false} onSubmit={onSubmit} submissionScope="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Submit" }))
		expect(onSubmit).not.toHaveBeenCalled()

		const updated = props(draft("changed after enter"))
		rerender(<InputSection {...updated} enabled={true} onSubmit={onSubmit} submissionScope="task-1" />)

		await settleEffects()
		expect(onSubmit).not.toHaveBeenCalled()
	})

	// Cancelling re-enables the input once the task settles into its resume
	// interaction. That transition must not deliver anything the user typed
	// while the task was still running.
	it("does not submit a blocked draft after a cancel re-enables the input", async () => {
		const onSubmit = vi.fn(async () => undefined)
		const initial = props(draft("typed during run"))
		const { rerender } = render(<InputSection {...initial} enabled={false} onSubmit={onSubmit} submissionScope="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Submit" }))

		// Cancel keeps the same task identity, so scope alone cannot fence the replay.
		const cancelled = props(draft("typed during run"))
		rerender(<InputSection {...cancelled} enabled={true} onSubmit={onSubmit} submissionScope="task-1" />)

		await settleEffects()
		expect(onSubmit).not.toHaveBeenCalled()
	})

	it("does not submit a blocked draft when task ownership changes", async () => {
		const onSubmit = vi.fn(async () => undefined)
		const initial = props(draft("initial"))
		const { rerender } = render(<InputSection {...initial} enabled={false} onSubmit={onSubmit} submissionScope="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Submit" }))
		const updated = props(draft("new task"))
		rerender(<InputSection {...updated} enabled={true} onSubmit={onSubmit} submissionScope="task-2" />)

		await settleEffects()
		expect(onSubmit).not.toHaveBeenCalled()
	})

	it("does not submit a blocked mode-switch draft when the input becomes enabled", async () => {
		const onSubmit = vi.fn(async () => undefined)
		const initial = props(draft("initial"))
		const { rerender } = render(<InputSection {...initial} enabled={false} onSubmit={onSubmit} submissionScope="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Complete Mode Switch" }))
		expect(onSubmit).not.toHaveBeenCalled()

		const updated = props(draft("changed after switch"))
		rerender(<InputSection {...updated} enabled={true} onSubmit={onSubmit} submissionScope="task-1" />)

		await settleEffects()
		expect(onSubmit).not.toHaveBeenCalled()
	})

	// A blocked send is retained as a visible queue entry instead of being
	// dropped, but it must still never be delivered by a state flip.
	it("enqueues a blocked draft instead of submitting it", async () => {
		const onSubmit = vi.fn(async () => undefined)
		const onEnqueue = vi.fn()
		const current = props(draft("queue me"))
		render(
			<InputSection {...current} enabled={false} onEnqueueInput={onEnqueue} onSubmit={onSubmit} submissionScope="task-1" />,
		)

		fireEvent.click(screen.getByRole("button", { name: "Submit" }))

		expect(onEnqueue).toHaveBeenCalledWith({ text: "captured", images: ["image"], files: ["file"] })
		await settleEffects()
		expect(onSubmit).not.toHaveBeenCalled()
	})

	// Editing pulls the entry back into the composer, because adding images or
	// file references is only possible there.
	it("loads a queue entry back into the composer when editing starts", () => {
		const setInputValue = vi.fn()
		const setSelectedImages = vi.fn()
		const setSelectedFiles = vi.fn()
		const current = props(draft("current"))
		current.chatState = { ...current.chatState, setInputValue, setSelectedImages, setSelectedFiles }
		render(
			<InputSection
				{...current}
				inputQueue={[{ id: "entry-1", text: "queued text", images: ["img"], files: ["file"], mode: "queued" }]}
				onEditQueuedInput={vi.fn()}
				onSubmit={vi.fn(async () => undefined)}
				submissionScope="task-1"
			/>,
		)

		fireEvent.click(screen.getByTestId("input-queue-toggle"))
		fireEvent.click(screen.getByTestId("input-queue-edit-entry-1"))

		expect(setInputValue).toHaveBeenCalledWith("queued text")
		expect(setSelectedImages).toHaveBeenCalledWith(["img"])
		expect(setSelectedFiles).toHaveBeenCalledWith(["file"])
	})

	// The composer now stands for the entry, so a quote left over from earlier
	// must go: committing would otherwise attach a quote the user never chose.
	it("clears a leftover quote when the edited entry carries none", () => {
		const setActiveQuote = vi.fn()
		const current = props(draft("current"))
		current.chatState = { ...current.chatState, activeQuote: "unrelated quote", setActiveQuote }
		render(
			<InputSection
				{...current}
				inputQueue={[{ id: "entry-1", text: "queued text", images: [], files: [], mode: "queued" }]}
				onEditQueuedInput={vi.fn()}
				onSubmit={vi.fn(async () => undefined)}
				submissionScope="task-1"
			/>,
		)

		fireEvent.click(screen.getByTestId("input-queue-toggle"))
		fireEvent.click(screen.getByTestId("input-queue-edit-entry-1"))

		expect(setActiveQuote).toHaveBeenCalledWith(null)
	})

	// Editing must round-trip: the next blocked send commits the entry being
	// edited instead of creating a second copy of it.
	it("commits the edited entry instead of enqueuing a duplicate", () => {
		const onEnqueue = vi.fn()
		const onCommitEdit = vi.fn()
		const current = props(draft("current"))
		render(
			<InputSection
				{...current}
				enabled={false}
				inputQueue={[{ id: "entry-1", text: "queued text", images: [], files: [], mode: "queued" }]}
				onCommitQueuedInput={onCommitEdit}
				onEditQueuedInput={vi.fn()}
				onEnqueueInput={onEnqueue}
				onSubmit={vi.fn(async () => undefined)}
				submissionScope="task-1"
			/>,
		)

		fireEvent.click(screen.getByTestId("input-queue-toggle"))
		fireEvent.click(screen.getByTestId("input-queue-edit-entry-1"))
		fireEvent.click(screen.getByRole("button", { name: "Submit" }))

		expect(onCommitEdit).toHaveBeenCalledWith("entry-1", {
			text: "captured",
			images: ["image"],
			files: ["file"],
		})
		expect(onEnqueue).not.toHaveBeenCalled()
	})

	// The edited entry can vanish while the composer still holds it, by removal
	// or by switching tasks. The next blocked send is then new input and must be
	// queued; committing it to a dead id would silently discard what was typed.
	it("queues the draft when the entry being edited disappeared", () => {
		const onEnqueue = vi.fn()
		const onCommitEdit = vi.fn()
		const current = props(draft("current"))
		const entry = { id: "entry-1", text: "queued text", images: [], files: [], mode: "queued" as const }
		const view = (
			<InputSection
				{...current}
				enabled={false}
				inputQueue={[entry]}
				onCommitQueuedInput={onCommitEdit}
				onEditQueuedInput={vi.fn()}
				onEnqueueInput={onEnqueue}
				onSubmit={vi.fn(async () => undefined)}
				submissionScope="task-1"
			/>
		)
		const { rerender } = render(view)

		fireEvent.click(screen.getByTestId("input-queue-toggle"))
		fireEvent.click(screen.getByTestId("input-queue-edit-entry-1"))
		rerender(
			<InputSection
				{...current}
				enabled={false}
				inputQueue={[]}
				onCommitQueuedInput={onCommitEdit}
				onEditQueuedInput={vi.fn()}
				onEnqueueInput={onEnqueue}
				onSubmit={vi.fn(async () => undefined)}
				submissionScope="task-1"
			/>,
		)
		fireEvent.click(screen.getByRole("button", { name: "Submit" }))

		expect(onCommitEdit).not.toHaveBeenCalled()
		expect(onEnqueue).toHaveBeenCalledWith({ text: "captured", images: ["image"], files: ["file"] })
	})

	// Cancelling releases the backend gate and drops the composer's claim, so
	// the next blocked send is treated as new input rather than an edit.
	it("releases the edit when the user cancels it", () => {
		const onCancelEdit = vi.fn()
		const onCommitEdit = vi.fn()
		const onEnqueue = vi.fn()
		const current = props(draft("current"))
		render(
			<InputSection
				{...current}
				enabled={false}
				inputQueue={[{ id: "entry-1", text: "queued text", images: [], files: [], mode: "queued", editing: true }]}
				onCancelQueuedInput={onCancelEdit}
				onCommitQueuedInput={onCommitEdit}
				onEditQueuedInput={vi.fn()}
				onEnqueueInput={onEnqueue}
				onSubmit={vi.fn(async () => undefined)}
				submissionScope="task-1"
			/>,
		)

		fireEvent.click(screen.getByTestId("input-queue-toggle"))
		fireEvent.click(screen.getByTestId("input-queue-cancel-edit-entry-1"))
		fireEvent.click(screen.getByRole("button", { name: "Submit" }))

		expect(onCancelEdit).toHaveBeenCalledWith("entry-1")
		expect(onCommitEdit).not.toHaveBeenCalled()
		expect(onEnqueue).toHaveBeenCalledWith({ text: "captured", images: ["image"], files: ["file"] })
	})

	// An enabled composer must still submit normally; removing the replay path
	// must not disable ordinary sending.
	it("still submits directly while the input is enabled", async () => {
		const onSubmit = vi.fn(async () => undefined)
		const current = props(draft("ready"))
		render(<InputSection {...current} enabled={true} onSubmit={onSubmit} submissionScope="task-1" />)

		fireEvent.click(screen.getByRole("button", { name: "Submit" }))

		await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
	})
})
