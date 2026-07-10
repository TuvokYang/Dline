import { ApiProfile } from "@shared/proto/dline/profile"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ProviderProfileCard from "./ProviderProfileCard"

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		getAvailableModels: vi.fn().mockResolvedValue({ providers: [] }),
	},
}))

vi.mock("./ProviderProfileEditor", () => ({
	default: () => <div>Provider editor</div>,
}))

const providerOptions = [{ value: "openai", label: "OpenAI" }]

/**
 * Build a profile fixture for card rendering tests.
 * @returns Api profile test fixture.
 */
function buildProfile(): ApiProfile {
	return ApiProfile.create({
		id: "profile-1",
		name: "openai:model-a",
		provider: "openai",
		modelId: "model-a",
		usedFor: ["act", "plan"],
		enabled: true,
	})
}

describe("ProviderProfileCard", () => {
	it("keeps the profile name input editable", () => {
		const onUpdate = vi.fn()

		render(
			<ProviderProfileCard
				currentMode="act"
				editMode={false}
				isExpanded={false}
				onDelete={vi.fn()}
				onToggleExpand={vi.fn()}
				onUpdate={onUpdate}
				profile={buildProfile()}
				providerOptions={providerOptions}
			/>,
		)

		fireEvent.change(screen.getByDisplayValue("openai:model-a"), { target: { value: "openai:custom" } })

		expect(onUpdate).toHaveBeenCalledWith({ name: "openai:custom" })
	})

	it("uses muted settings-compatible card surfaces", () => {
		const { container } = render(
			<ProviderProfileCard
				currentMode="act"
				editMode={false}
				isExpanded={true}
				onDelete={vi.fn()}
				onToggleExpand={vi.fn()}
				onUpdate={vi.fn()}
				profile={buildProfile()}
				providerOptions={providerOptions}
			/>,
		)

		const card = container.firstElementChild
		const body = screen.getByText("Provider editor").parentElement

		expect(card).toHaveClass("border-editor-widget-border/40")
		expect(card).toHaveClass("bg-(--vscode-editor-background)")
		expect(body).toHaveClass("border-editor-widget-border/30")
	})
})
