import { ApiProfile } from "@shared/proto/dline/profile"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import ProviderProfileList from "./ProviderProfileList"

vi.mock("./ProviderProfileCard", () => ({
	default: ({ profile }: { profile: ApiProfile }) => <div>{profile.name}</div>,
}))

const providerOptions = [{ value: "openai", label: "OpenAI" }]

/**
 * Build a profile fixture for list rendering tests.
 * @returns Api profile test fixture.
 */
function buildProfile(): ApiProfile {
	return ApiProfile.create({
		id: "profile-1",
		name: "openai:model-a",
		provider: "openai",
		modelId: "model-a",
		usedFor: ["act"],
		enabled: true,
	})
}

describe("ProviderProfileList", () => {
	it("uses muted settings-compatible button surfaces", () => {
		render(
			<ProviderProfileList
				currentMode="act"
				editMode={false}
				expandedId={null}
				onAddProfile={vi.fn()}
				onDeleteProfile={vi.fn()}
				onToggleEditMode={vi.fn()}
				onToggleExpand={vi.fn()}
				onUpdateProfile={vi.fn()}
				profiles={[buildProfile()]}
				providerOptions={providerOptions}
			/>,
		)

		expect(screen.getByRole("button", { name: /Edit/ })).toHaveClass("border-editor-widget-border/40")
		expect(screen.getByRole("button", { name: /Add API/ })).toHaveClass("bg-(--vscode-editor-background)")
	})

	it("uses a muted destructive style for delete confirmation", () => {
		render(
			<ProviderProfileList
				currentMode="act"
				editMode={true}
				expandedId={null}
				onAddProfile={vi.fn()}
				onDeleteProfile={vi.fn()}
				onToggleEditMode={vi.fn()}
				onToggleExpand={vi.fn()}
				onUpdateProfile={vi.fn()}
				profiles={[buildProfile()]}
				providerOptions={providerOptions}
			/>,
		)

		const deleteButton = screen.getByRole("button", { name: /Delete \(0\)/ })

		expect(deleteButton).toHaveClass("border-editor-widget-border/40")
		expect(deleteButton).not.toHaveClass("border-red-600")
	})
})
