import type { ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { OpenAICompatibleProvider } from "./OpenAICompatible"
import type { ApiProfile } from "./ProviderProfile"

const registryModel: ModelInfo = {
	id: "gpt-custom",
	name: "Registry GPT",
	capabilities: {
		contextWindow: 128_000,
		maxTokens: 4096,
		supportsImages: false,
		supportsPromptCache: false,
	} as ModelCapabilities,
	pricing: {
		inputPrice: 1,
		outputPrice: 2,
		currency: "USD",
	} as ModelPricing,
}

vi.mock("./useProviderModels", () => ({
	useProviderModels: () => ({
		models: { "gpt-custom": registryModel },
		defaultModelId: "gpt-custom",
		modelInfoSaneDefaults: registryModel,
		loading: false,
	}),
}))

vi.mock("../common/ModelConfiguration", () => ({
	ModelConfiguration: ({ onCapabilitiesUpdate }: { onCapabilitiesUpdate: (updates: Partial<ModelCapabilities>) => void }) => (
		<button onClick={() => onCapabilitiesUpdate({ supportsImages: true })} type="button">
			Update Images
		</button>
	),
}))

vi.mock("../common/ModelInfoView", () => ({
	ModelInfoView: ({ modelInfo }: { modelInfo: ModelInfo }) => (
		<div>
			<span>max:{modelInfo.capabilities?.maxTokens}</span>
			<span>input:{modelInfo.pricing?.inputPrice}</span>
		</div>
	),
}))

vi.mock("../common/ApiKeyField", () => ({ ApiKeyField: () => <div /> }))
vi.mock("../common/BaseUrlField", () => ({ BaseUrlField: () => <div /> }))
vi.mock("../common/DebouncedTextField", () => ({ DebouncedTextField: () => <div /> }))
vi.mock("../ThinkingControl", () => ({ default: () => <div /> }))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
	VSCodeCheckbox: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}))

describe("OpenAICompatibleProvider", () => {
	it("uses provider capabilities for configuration updates and merged display", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "profile-1",
			provider: "openai",
			modelId: "gpt-custom",
			openai: OpenAiProviderConfig.create({
				capabilities: { maxTokens: 64_000 } as ModelCapabilities,
				pricing: { inputPrice: 0.5 } as ModelPricing,
			}),
		} as unknown as ApiProfile

		render(<OpenAICompatibleProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		expect(screen.getByText("max:64000")).toBeInTheDocument()
		expect(screen.getByText("input:0.5")).toBeInTheDocument()

		fireEvent.click(screen.getByText("Update Images"))

		expect(onUpdate).toHaveBeenCalledWith({
			openai: {
				...profile.openai,
				capabilities: { maxTokens: 64_000, supportsImages: true },
			},
		})
	})
})
