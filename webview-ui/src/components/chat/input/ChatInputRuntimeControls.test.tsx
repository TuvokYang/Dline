import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { ChatInputRuntimeControls } from "./ChatInputRuntimeControls"

vi.mock("./TaskRuntimeControls", () => ({
	TaskRuntimeControls: () => (
		<>
			<div data-chat-input-slot="thinking">Thinking control</div>
			<div data-chat-input-slot="service-tier">Service Tier control</div>
		</>
	),
}))

describe("ChatInputRuntimeControls", () => {
	it("keeps the existing Profile entry before Task Thinking and Service Tier", () => {
		const { container } = render(
			<ChatInputRuntimeControls profileControl={<button type="button">Existing Profile selector</button>} />,
		)

		const slots = Array.from(container.querySelectorAll<HTMLElement>("[data-chat-input-slot]")).map(
			(element) => element.dataset.chatInputSlot,
		)
		expect(slots).toEqual(["profile", "thinking", "service-tier"])
		expect(screen.getAllByRole("button", { name: "Existing Profile selector" })).toHaveLength(1)
	})

	it("preserves Profile width before allowing Task-local controls to shrink", () => {
		const { container } = render(
			<ChatInputRuntimeControls profileControl={<button type="button">Existing Profile selector</button>} />,
		)

		const profileSlot = container.querySelector<HTMLElement>('[data-chat-input-slot="profile"]')
		expect(profileSlot).toHaveClass("min-w-[10ch]", "max-w-[24ch]", "flex-[1_0_12ch]", "overflow-visible")
		expect(profileSlot).not.toHaveClass("min-w-0", "overflow-hidden")
	})
})
