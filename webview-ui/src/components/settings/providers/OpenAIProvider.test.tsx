// @vitest-environment jsdom
import type { ModelInfo } from "@shared/proto/dline/models"
import { ApiFormat, type ModelCapabilities, type ModelPricing } from "@shared/proto/dline/models/metadata"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { OpenAIProvider } from "./OpenAIProvider"
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

const multiFormatModel: ModelInfo = {
	id: "gpt-multi",
	name: "GPT Multi",
	apiFormats: [ApiFormat.OPENAI_RESPONSES, ApiFormat.OPENAI_CHAT],
	capabilities: {
		contextWindow: 272_000,
		contextWindowTiers: [
			{ id: "standard", contextWindow: 272_000, label: "272K" },
			{ id: "long", contextWindow: 1_050_000, label: "1.05M" },
		],
		maxTokens: 128_000,
		supportsTools: true,
		supportsReasoning: true,
	} as ModelCapabilities,
}

vi.mock("./useProviderModels", () => ({
	useProviderModels: () => ({
		models: { "gpt-multi": multiFormatModel, "gpt-custom": registryModel },
		defaultModelId: "gpt-multi",
		modelInfoSaneDefaults: multiFormatModel,
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
			<span>context:{modelInfo.capabilities?.contextWindow}</span>
			<span>max:{modelInfo.capabilities?.maxTokens}</span>
			<span>input:{modelInfo.pricing?.inputPrice}</span>
		</div>
	),
}))

vi.mock("../common/ApiKeyField", () => ({ ApiKeyField: () => <div /> }))
vi.mock("../common/BaseUrlField", () => ({ BaseUrlField: () => <div /> }))
vi.mock("../common/DebouncedTextField", () => ({
	DebouncedTextField: ({ children, initialValue, onChange }: any) => (
		<label>
			{children}
			<input aria-label="Model ID" defaultValue={initialValue} onChange={(event) => onChange(event.target.value)} />
		</label>
	),
}))
vi.mock("../common/ModelSelector", () => ({
	ModelSelector: ({ label, models, onChange, selectedModelId }: any) => (
		<label>
			{label}
			<select aria-label={label} onChange={onChange} value={selectedModelId}>
				{Object.keys(models).map((modelId) => (
					<option key={modelId} value={modelId}>
						{modelId}
					</option>
				))}
			</select>
		</label>
	),
}))
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
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeButton: ({ children, onClick }: any) => (
		<button onClick={onClick} type="button">
			{children}
		</button>
	),
	VSCodeCheckbox: ({ checked, children, onChange }: any) => (
		<label>
			<input checked={checked} onChange={onChange} type="checkbox" />
			{children}
		</label>
	),
}))

describe("OpenAIProvider", () => {
	it("uses the official model catalog and metadata-driven API Format selector", () => {
		const onUpdate = vi.fn()
		const config = OpenAiProviderConfig.create({ customModelEnabled: false })
		;(config as any).apiFormat = ApiFormat.OPENAI_RESPONSES
		const profile = {
			id: "official-openai",
			provider: "openai",
			modelId: "gpt-multi",
			openai: config,
		} as unknown as ApiProfile

		render(<OpenAIProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("gpt-multi")
		expect(screen.queryByRole("textbox", { name: "Model ID" })).not.toBeInTheDocument()
		const apiFormat = screen.getByRole("combobox", { name: "API Format" })
		expect(apiFormat).toHaveValue(String(ApiFormat.OPENAI_RESPONSES))
		expect(screen.getByRole("option", { name: "OpenAI Responses" })).toBeInTheDocument()
		expect(screen.getByRole("option", { name: "OpenAI Chat" })).toBeInTheDocument()

		fireEvent.change(apiFormat, { target: { value: String(ApiFormat.OPENAI_CHAT) } })
		expect(onUpdate).toHaveBeenCalledWith({
			openai: expect.objectContaining({ apiFormat: ApiFormat.OPENAI_CHAT }),
		})
	})

	it("preserves a legacy compatible profile as custom configuration", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "custom-openai",
			provider: "openai",
			modelId: "legacy-compatible-model",
			openai: OpenAiProviderConfig.create(),
		} as unknown as ApiProfile

		render(<OpenAIProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		expect(screen.getByRole("checkbox", { name: "Use custom model ID" })).toBeChecked()
		expect(screen.getByRole("textbox", { name: "Model ID" })).toHaveValue("legacy-compatible-model")
		expect(screen.getByRole("combobox", { name: "API Format" })).toBeInTheDocument()
		expect(screen.getByText("context:128000")).toBeInTheDocument()
	})

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

		render(<OpenAIProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		expect(screen.getByText("max:64000")).toBeInTheDocument()
		expect(screen.getByText("input:0.5")).toBeInTheDocument()

		fireEvent.click(screen.getByText("Update Images"))

		expect(onUpdate).toHaveBeenCalledWith({
			openai: {
				...profile.openai,
				capabilities: { maxTokens: 64_000, supportsImages: true },
			},
		})

		fireEvent.click(screen.getByRole("button", { name: "Enable Native Tools" }))
		expect(onUpdate).toHaveBeenCalledWith({
			openai: {
				...profile.openai,
				capabilities: { maxTokens: 64_000, supportsTools: true },
			},
		})
	})

	it("offers the complete compatible effort set and persists OpenAI request options", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "profile-1",
			provider: "openai",
			modelId: "gpt-custom",
			openai: OpenAiProviderConfig.create({ customModelEnabled: true, serviceTier: "auto" }),
		} as unknown as ApiProfile

		render(<OpenAIProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		expect(screen.getByTestId("thinking-efforts")).toHaveTextContent("none,minimal,low,medium,high,xhigh,max,ultra")
		fireEvent.click(screen.getByRole("button", { name: "Set Priority Tier" }))
		expect(onUpdate).toHaveBeenCalledWith({
			openai: {
				...profile.openai,
				serviceTier: "priority",
			},
		})

		fireEvent.change(screen.getByRole("combobox", { name: "API Format" }), {
			target: { value: String(ApiFormat.OPENAI_RESPONSES) },
		})
		expect(onUpdate).toHaveBeenCalledWith({
			openai: {
				...profile.openai,
				apiEndpoint: undefined,
				apiFormat: ApiFormat.OPENAI_RESPONSES,
			},
		})
	})
})
