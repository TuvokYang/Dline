// @vitest-environment jsdom
import type { ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"
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
	ModelConfiguration: ({
		fields,
		onCapabilitiesUpdate,
	}: {
		fields: { capabilities?: string[] }
		onCapabilitiesUpdate: (updates: Partial<ModelCapabilities>) => void
	}) => (
		<>
			<button onClick={() => onCapabilitiesUpdate({ supportsImages: true })} type="button">
				Update Images
			</button>
			{fields.capabilities?.includes("supportsTools") && (
				<button onClick={() => onCapabilitiesUpdate({ supportsTools: true })} type="button">
					Enable Native Tools
				</button>
			)}
		</>
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
vi.mock("../ThinkingControl", () => ({
	default: ({ effortOptions }: { effortOptions?: readonly string[] }) => (
		<div data-testid="thinking-efforts">{effortOptions?.join(",")}</div>
	),
}))
vi.mock("../OpenAIServiceTierSelector", () => ({
	default: ({ onServiceTierChange }: { onServiceTierChange: (value: string) => void }) => (
		<button onClick={() => onServiceTierChange("priority")} type="button">
			Set Priority Tier
		</button>
	),
}))
vi.mock("../OpenAIApiEndpointSelector", () => ({
	default: ({ onApiEndpointChange }: { onApiEndpointChange: (value: string) => void }) => (
		<button onClick={() => onApiEndpointChange("responses")} type="button">
			Use Responses Endpoint
		</button>
	),
}))
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
				capabilities: { contextWindowTiers: [], maxTokens: 64_000, supportsImages: true },
			},
		})

		fireEvent.click(screen.getByRole("button", { name: "Enable Native Tools" }))
		expect(onUpdate).toHaveBeenCalledWith({
			openai: {
				...profile.openai,
				capabilities: { contextWindowTiers: [], maxTokens: 64_000, supportsTools: true },
			},
		})
	})

	it("offers the complete compatible effort set and persists OpenAI request options", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "profile-1",
			provider: "openai",
			modelId: "gpt-custom",
			openai: OpenAiProviderConfig.create({ serviceTier: "auto" }),
		} as unknown as ApiProfile

		render(<OpenAICompatibleProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		expect(screen.getByTestId("thinking-efforts")).toHaveTextContent("none,minimal,low,medium,high,xhigh,max,ultra")
		fireEvent.click(screen.getByRole("button", { name: "Set Priority Tier" }))
		expect(onUpdate).toHaveBeenCalledWith({
			openai: {
				...profile.openai,
				serviceTier: "priority",
			},
		})

		fireEvent.click(screen.getByRole("button", { name: "Use Responses Endpoint" }))
		expect(onUpdate).toHaveBeenCalledWith({
			openai: {
				...profile.openai,
				apiEndpoint: "responses",
			},
		})
	})
})
