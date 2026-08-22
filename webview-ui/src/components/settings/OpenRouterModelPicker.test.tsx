// @vitest-environment jsdom
import type { ModelInfo } from "@shared/proto/dline/models"
import type { ApiProfile } from "@shared/proto/dline/profile"
import { fireEvent, render, screen } from "@testing-library/react"
import type { AnchorHTMLAttributes, InputHTMLAttributes } from "react"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import OpenRouterModelPicker from "./OpenRouterModelPicker"

const mocks = vi.hoisted(() => ({
	refreshOpenRouterModels: vi.fn(),
	toggleFavoriteModel: vi.fn(),
	models: {
		"anthropic/claude-sonnet-4.5": {
			id: "anthropic/claude-sonnet-4.5",
			name: "OpenRouter Default Model",
			capabilities: { contextWindow: 200_000, maxTokens: 64_000 },
			pricing: { inputPrice: 1, outputPrice: 2 },
		},
		"vendor/default-model": {
			id: "vendor/default-model",
			name: "Default Model",
			capabilities: { contextWindow: 200_000, maxTokens: 32_000 },
			pricing: { inputPrice: 1, outputPrice: 2 },
		},
		"vendor/native-1m-model": {
			id: "vendor/native-1m-model",
			name: "Native 1M Model",
			capabilities: { contextWindow: 1_000_000, maxTokens: 128_000 },
			pricing: { inputPrice: 3, outputPrice: 4 },
		},
	} as Record<string, ModelInfo>,
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: (props: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} />,
	VSCodeTextField: ({ children: _children, ...props }: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))

vi.mock("@context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		favoritedModelIds: [],
		openRouterModels: mocks.models,
		refreshOpenRouterModels: mocks.refreshOpenRouterModels,
	}),
}))

vi.mock("@services/grpc-client", () => ({
	StateServiceClient: { toggleFavoriteModel: mocks.toggleFavoriteModel },
}))

vi.mock("./ReasoningEffortSelector", () => ({ default: () => null }))
vi.mock("./ThinkingBudgetSlider", () => ({ default: () => null }))
vi.mock("./common/ContextWindowSwitcher", () => ({ ContextWindowSwitcher: () => null }))

beforeAll(() => {
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined })
})

describe("OpenRouterModelPicker", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("persists the searched Profile model and displays that model's native context window", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "openrouter-profile",
			name: "OpenRouter profile",
			provider: "openrouter",
			modelId: "vendor/default-model",
			usedFor: ["act"],
			enabled: true,
		} as ApiProfile

		const { rerender } = render(<OpenRouterModelPicker onUpdate={onUpdate} profile={profile} />)

		const modelInput = screen.getByRole("combobox", { name: "Model" })
		expect(modelInput).toHaveValue("vendor/default-model")

		fireEvent.input(modelInput, { target: { value: "native-1m" } })
		fireEvent.click(screen.getByRole("option"))

		expect(onUpdate).toHaveBeenCalledWith({
			modelId: "vendor/native-1m-model",
			modelInfo: mocks.models["vendor/native-1m-model"],
		})

		const selectedProfile = {
			...profile,
			modelId: "vendor/native-1m-model",
			modelInfo: mocks.models["vendor/native-1m-model"],
		} as ApiProfile
		rerender(<OpenRouterModelPicker onUpdate={onUpdate} profile={selectedProfile} />)

		expect(screen.getByText("1M", { exact: true })).toBeInTheDocument()
	})

	it("persists the visible OpenRouter default for a new Profile", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "new-openrouter-profile",
			name: "New OpenRouter profile",
			provider: "openrouter",
			modelId: "",
			usedFor: ["act"],
			enabled: true,
		} as ApiProfile

		render(<OpenRouterModelPicker onUpdate={onUpdate} profile={profile} />)

		expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("anthropic/claude-sonnet-4.5")
		expect(onUpdate).toHaveBeenCalledWith({
			modelId: "anthropic/claude-sonnet-4.5",
			modelInfo: mocks.models["anthropic/claude-sonnet-4.5"],
		})
	})
})
