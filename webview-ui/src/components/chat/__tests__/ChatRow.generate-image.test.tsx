import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import React, { type ComponentType } from "react"
import { describe, expect, it, vi } from "vitest"
import { ChatRowContent } from "../ChatRow"

void React

const { getImageArtifact, openImage, copyToClipboard } = vi.hoisted(() => ({
	getImageArtifact: vi.fn(async () => ({
		data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
		mimeType: "image/png",
	})),
	openImage: vi.fn(async () => undefined),
	copyToClipboard: vi.fn(async () => undefined),
}))

vi.mock("@/services/grpc-client", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/services/grpc-client")>()
	return {
		...original,
		UiServiceClient: { ...original.UiServiceClient, getImageArtifact },
		FileServiceClient: { ...original.FileServiceClient, openImage, copyToClipboard },
	}
})

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		backgroundEditEnabled: true,
		mcpServers: [],
		mcpMarketplaceCatalog: [],
		onRelinquishControl: () => () => undefined,
		vscodeTerminalExecutionMode: "backgroundExec",
		clineMessages: [],
		showFeatureTips: false,
		taskViewState: undefined,
		currentTaskItem: { id: "task-1" },
	}),
}))

const artifactId = `image:sha256:${"a".repeat(64)}`
const message = {
	ts: 1,
	type: "say" as const,
	say: "tool" as const,
	partial: false,
	text: JSON.stringify({
		tool: "generateImage",
		imageGeneration: {
			schemaVersion: 1,
			status: "completed",
			requestId: "request-1",
			prompt: "A blue owl",
			profileId: "profile-1",
			providerId: "openai",
			modelId: "gpt-image-2",
			count: 1,
			artifacts: [
				{
					id: artifactId,
					mimeType: "image/png",
					format: "png",
					byteLength: 64,
					width: 1024,
					height: 1024,
				},
			],
		},
	}),
}

const baseProps = {
	isExpanded: false,
	isLast: true,
	onSetQuote: vi.fn(),
	onToggleExpand: vi.fn(),
}

const TestableChatRowContent = ChatRowContent as ComponentType<Record<string, unknown>>

describe("ChatRow image generation rendering", () => {
	it("loads a completed task artifact without persisting base64 in the message", async () => {
		render(<TestableChatRowContent {...baseProps} message={message} />)

		expect(screen.getByText("A blue owl")).toBeInTheDocument()
		expect(screen.getByText((_, element) => element?.textContent === "openai · gpt-image-2")).toBeInTheDocument()
		expect(message.text).not.toContain("base64")
		await waitFor(() => expect(getImageArtifact).toHaveBeenCalledWith(expect.objectContaining({ artifactId })))
		const preview = await screen.findByRole("img", { name: "Generated image 1" })
		expect(preview).toHaveAttribute("src", expect.stringMatching(/^data:image\/png;base64,/))
	})

	it("opens, copies, and adds a stable Artifact ID as a future image reference", async () => {
		const onAddToInput = vi.fn()
		render(<TestableChatRowContent {...baseProps} message={message} onAddToInput={onAddToInput} />)

		await screen.findByRole("img", { name: "Generated image 1" })
		fireEvent.click(screen.getByRole("button", { name: "Open generated image" }))
		fireEvent.click(screen.getByRole("button", { name: "Copy Artifact ID" }))
		fireEvent.click(screen.getByRole("button", { name: "Use as Reference" }))

		await waitFor(() => expect(openImage).toHaveBeenCalled())
		expect(copyToClipboard).toHaveBeenCalledWith(expect.objectContaining({ value: artifactId }))
		expect(onAddToInput).toHaveBeenCalledWith(`Use image artifact ${artifactId} as a reference for the next image generation.`)
	})
})
