import { ApiProfile } from "@shared/proto/dline/profile"
import { AnthropicProviderConfig } from "@shared/proto/dline/provider/anthropic"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
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

const providerOptions = [
	{ value: "openai", label: "OpenAI" },
	{ value: "anthropic", label: "Anthropic" },
]

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
	it("renders the profile name as text while collapsed outside Manage mode", () => {
		render(
			<ProviderProfileCard
				currentMode="act"
				editMode={false}
				isExpanded={false}
				onDelete={vi.fn()}
				onToggleExpand={vi.fn()}
				onUpdate={vi.fn()}
				profile={buildProfile()}
				providerOptions={providerOptions}
			/>,
		)

		expect(screen.getByText("openai:model-a")).toBeInTheDocument()
		expect(screen.queryByDisplayValue("openai:model-a")).not.toBeInTheDocument()
		expect(screen.getByText("openai · model-a")).toBeInTheDocument()
	})

	it("keeps the profile name input editable while expanded", () => {
		const onUpdate = vi.fn()

		render(
			<ProviderProfileCard
				currentMode="act"
				editMode={false}
				isExpanded={true}
				onDelete={vi.fn()}
				onToggleExpand={vi.fn()}
				onUpdate={onUpdate}
				profile={buildProfile()}
				providerOptions={providerOptions}
			/>,
		)

		const nameInput = screen.getByDisplayValue("openai:model-a")
		expect(nameInput).toHaveClass("max-w-80", "justify-self-start")
		fireEvent.change(nameInput, { target: { value: "openai:custom" } })
		expect(onUpdate).not.toHaveBeenCalled()
		fireEvent.blur(nameInput)

		expect(onUpdate).toHaveBeenCalledWith({ name: "openai:custom" })
	})

	it("shows effort-based Thinking in the second-line provider summary", () => {
		const profile = ApiProfile.create({
			...buildProfile(),
			modelInfo: {
				capabilities: {
					supportsReasoning: true,
					thinking: { supported: true, mode: "effort", effortLevels: ["low", "medium", "high"] },
				},
			},
			openai: OpenAiProviderConfig.create({ reasoning: { enableThinking: true, effort: "high", thinkingBudget: 0 } }),
		})
		render(
			<ProviderProfileCard
				currentMode="act"
				editMode={false}
				isExpanded={false}
				onDelete={vi.fn()}
				onToggleExpand={vi.fn()}
				onUpdate={vi.fn()}
				profile={profile}
				providerOptions={providerOptions}
			/>,
		)

		expect(screen.getByText("openai · model-a · Thinking: High")).toBeInTheDocument()
	})

	it("shows budget-based Thinking in the second-line provider summary", () => {
		const profile = ApiProfile.create({
			...buildProfile(),
			modelInfo: {
				capabilities: { supportsReasoning: true, thinking: { supported: true, mode: "budget", maxBudget: 16_384 } },
			},
			openai: OpenAiProviderConfig.create({ reasoning: { enableThinking: true, effort: "", thinkingBudget: 8_192 } }),
		})
		render(
			<ProviderProfileCard
				currentMode="act"
				editMode={false}
				isExpanded={false}
				onDelete={vi.fn()}
				onToggleExpand={vi.fn()}
				onUpdate={vi.fn()}
				profile={profile}
				providerOptions={providerOptions}
			/>,
		)

		expect(screen.getByText("openai · model-a · Thinking: 8,192 tokens")).toBeInTheDocument()
	})

	it("keeps usage badges and capability icons in a right-aligned tail", () => {
		const profile = ApiProfile.create({
			...buildProfile(),
			modelInfo: { capabilities: { supportsImages: true, supportsReasoning: true } },
		})
		render(
			<ProviderProfileCard
				currentMode="act"
				editMode={false}
				isExpanded={false}
				onDelete={vi.fn()}
				onToggleExpand={vi.fn()}
				onUpdate={vi.fn()}
				profile={profile}
				providerOptions={providerOptions}
			/>,
		)

		const tail = screen.getByTestId("profile-summary-tail")
		expect(tail).toHaveClass("ml-auto", "shrink-0", "justify-end", "row-start-2", "xs:row-start-1")
		const usageGroup = screen.getByRole("group", { name: "Profile uses" })
		expect(usageGroup).toBeInTheDocument()
		expect(usageGroup.querySelectorAll("span")).not.toHaveLength(0)
		for (const badge of usageGroup.querySelectorAll("span")) expect(badge).toHaveClass("h-5")
		expect(screen.getByRole("list", { name: "Model capabilities" })).toBeInTheDocument()
		expect(screen.queryByText("🧠")).not.toBeInTheDocument()
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
		const body = screen.getByText("Provider editor").closest(".profile-form")

		expect(card).toHaveClass("border-b", "border-editor-widget-border/35")
		expect(card).not.toHaveClass("bg-(--vscode-editor-background)")
		expect(body).toHaveClass("profile-form", "border-editor-widget-border/30", "gap-4")
		expect(screen.getByText("Provider editor").parentElement).toHaveClass(
			"gap-3",
			"[&>div]:flex",
			"[&>div]:flex-col",
			"[&>div]:!gap-3",
		)
	})

	it("initializes a newly selected Anthropic provider with long context enabled", () => {
		const onUpdate = vi.fn()
		render(
			<ProviderProfileCard
				currentMode="act"
				editMode={false}
				isExpanded={true}
				onDelete={vi.fn()}
				onToggleExpand={vi.fn()}
				onUpdate={onUpdate}
				profile={ApiProfile.create({ ...buildProfile(), provider: "", modelId: "" })}
				providerOptions={providerOptions}
			/>,
		)

		fireEvent.change(screen.getByRole("combobox", { name: "Provider" }), { target: { value: "anthropic" } })

		expect(onUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				provider: "anthropic",
				anthropic: AnthropicProviderConfig.create({ enableLongContext: true }),
			}),
		)
	})

	it("delegates Web Search settings to the provider editor without rendering a duplicate outer control", () => {
		render(
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

		expect(screen.queryByRole("combobox", { name: "Web Search mode" })).not.toBeInTheDocument()
	})
})
