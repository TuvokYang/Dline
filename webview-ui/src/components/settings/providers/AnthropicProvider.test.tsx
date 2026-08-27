// @vitest-environment jsdom
import type { ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import type { ApiProfile } from "@shared/proto/dline/profile"
import { AnthropicProviderConfig } from "@shared/proto/dline/provider/anthropic"
import { fireEvent, render, screen } from "@testing-library/react"
import React, { type ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { AnthropicProvider } from "./AnthropicProvider"

const registryModel: ModelInfo = {
	id: "claude-custom",
	name: "Registry Claude",
	capabilities: {
		contextWindow: 200_000,
		contextWindowTiers: [
			{ id: "standard", contextWindow: 200_000, label: "200K" },
			{ id: "long", contextWindow: 1_000_000, label: "1M", apiModelSuffix: ":1m" },
		],
		maxTokens: 8192,
		supportsImages: true,
		supportsPromptCache: true,
	} as ModelCapabilities,
	pricing: {
		inputPrice: 3,
		outputPrice: 15,
		currency: "USD",
	} as ModelPricing,
}

const nativeContextModel: ModelInfo = {
	id: "claude-native",
	name: "Native Context Claude",
	capabilities: {
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		supportsPromptCache: true,
	} as ModelCapabilities,
}

const adaptiveModel: ModelInfo = {
	id: "claude-sonnet-4-6",
	name: "Claude Sonnet 4.6",
	capabilities: {
		supportsReasoning: true,
		thinking: {
			supported: true,
			mode: "effort",
			effortLevels: ["none", "low", "medium", "high", "max"],
		},
	} as ModelCapabilities,
}

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ remoteConfigSettings: {} }),
}))

vi.mock("./useProviderModels", () => ({
	useProviderModels: () => ({
		models: { "claude-custom": registryModel, "claude-native": nativeContextModel, "claude-sonnet-4-6": adaptiveModel },
		defaultModelId: "claude-custom",
		modelInfoSaneDefaults: registryModel,
		loading: false,
	}),
}))

vi.mock("../common/ModelConfiguration", () => ({
	ModelConfiguration: ({
		contextWindowValue,
		fields,
		onCapabilitiesUpdate,
		onContextWindowUpdate,
	}: {
		contextWindowValue?: number
		fields: { capabilities?: string[] }
		onCapabilitiesUpdate: (updates: Partial<ModelCapabilities>) => void
		onContextWindowUpdate?: (value: number) => void
	}) => (
		<>
			<span data-testid="capability-fields">{fields.capabilities?.join(",")}</span>
			<span data-testid="current-context-window">{contextWindowValue}</span>
			<button onClick={() => onContextWindowUpdate?.(1_500_000)} type="button">
				Update Current Window
			</button>
			<button onClick={() => onCapabilitiesUpdate({ supportsPromptCache: false })} type="button">
				Update Cache
			</button>
			<button
				onClick={() =>
					onCapabilitiesUpdate({
						contextWindowTiers: [{ id: "long", contextWindow: 1_000_000, label: "1M" }],
					})
				}
				type="button">
				Add Context Tier
			</button>
		</>
	),
}))

vi.mock("../common/ModelInfoView", () => ({
	ModelInfoView: ({ modelInfo }: { modelInfo: ModelInfo }) => (
		<div>
			<span>max:{modelInfo.capabilities?.maxTokens}</span>
			<span>input:{modelInfo.pricing?.inputPrice}</span>
			<span>context:{modelInfo.capabilities?.contextWindow}</span>
		</div>
	),
}))

vi.mock("../common/ApiKeyField", () => ({ ApiKeyField: () => <div /> }))
vi.mock("../common/BaseUrlField", () => ({ BaseUrlField: () => <div /> }))
vi.mock("../common/ContextWindowSwitcher", () => ({ ContextWindowSwitcher: () => <div /> }))
vi.mock("../common/DebouncedTextField", () => ({ DebouncedTextField: () => <div /> }))
vi.mock("../common/ModelSelector", () => ({ ModelSelector: () => <div /> }))
vi.mock("../common/RemotelyConfiguredInputWrapper", () => ({
	RemotelyConfiguredInputWrapper: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock("../ThinkingControl", () => ({
	default: ({ effortOptions }: { effortOptions?: readonly string[] }) => (
		<div data-testid="thinking-efforts">{effortOptions?.join(",")}</div>
	),
}))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({
		checked,
		children,
		onChange,
	}: {
		checked?: boolean
		children: ReactNode
		onChange?: React.ChangeEventHandler<HTMLInputElement>
	}) => (
		<label>
			<input checked={checked} onChange={onChange} type="checkbox" />
			{children}
		</label>
	),
}))

describe("AnthropicProvider", () => {
	it("uses provider capabilities for custom model updates and merged display", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "profile-1",
			provider: "anthropic",
			modelId: "claude-custom",
			anthropic: AnthropicProviderConfig.create({
				customModelEnabled: true,
				capabilities: { maxTokens: 64_000 } as ModelCapabilities,
				pricing: { inputPrice: 0.5 } as ModelPricing,
			}),
		} as unknown as ApiProfile

		render(<AnthropicProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		expect(screen.getByText("max:64000")).toBeInTheDocument()
		expect(screen.getByText("input:0.5")).toBeInTheDocument()
		expect(screen.getByTestId("capability-fields")).toHaveTextContent(
			"supportsImages,supportsWebSearch,supportsBrowserAction,supportsPromptCache",
		)

		fireEvent.click(screen.getByText("Update Cache"))

		expect(onUpdate).toHaveBeenCalledWith({
			anthropic: {
				...profile.anthropic,
				capabilities: { maxTokens: 64_000, supportsPromptCache: false },
			},
		})
	})

	it("replaces a custom model's selected tier window without preserving a legacy direct window", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "profile-custom-tier-window",
			provider: "anthropic",
			modelId: "claude-custom",
			anthropic: AnthropicProviderConfig.create({
				customModelEnabled: true,
				enableLongContext: true,
				capabilities: {
					contextWindow: 999_999,
					contextWindowTiers: [
						{ id: "standard", contextWindow: 160_000, label: "160K" },
						{ id: "long", contextWindow: 1_200_000, label: "1.2M", apiModelSuffix: ":1m" },
					],
				} as ModelCapabilities,
			}),
		} as unknown as ApiProfile

		render(<AnthropicProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)
		fireEvent.click(screen.getByText("Update Current Window"))

		expect(onUpdate).toHaveBeenCalledWith({
			anthropic: {
				...profile.anthropic,
				capabilities: {
					contextWindowTiers: [
						{ id: "standard", contextWindow: 160_000, label: "160K" },
						{ id: "long", contextWindow: 1_500_000, label: "1.2M", apiModelSuffix: ":1m" },
					],
				},
			},
		})
	})

	it("exposes context window tier editing for official models and persists updates", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "profile-2",
			provider: "anthropic",
			modelId: "claude-custom",
			anthropic: AnthropicProviderConfig.create({}),
		} as unknown as ApiProfile

		render(<AnthropicProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		// Official models keep the context-window tier fields editable.
		expect(screen.getByTestId("capability-fields")).toHaveTextContent("contextWindowTiers")

		fireEvent.click(screen.getByText("Add Context Tier"))

		expect(onUpdate).toHaveBeenCalledWith({
			anthropic: {
				...profile.anthropic,
				capabilities: { contextWindowTiers: [{ id: "long", contextWindow: 1_000_000, label: "1M" }] },
			},
		})
	})

	it("uses the selected tier for the explicit context window and preserves both tier values", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "profile-tier-window",
			provider: "anthropic",
			modelId: "claude-custom",
			anthropic: AnthropicProviderConfig.create({
				enableLongContext: true,
				capabilities: {
					contextWindowTiers: [
						{ id: "standard", contextWindow: 160_000, label: "160K" },
						{ id: "long", contextWindow: 1_200_000, label: "1.2M", apiModelSuffix: ":1m" },
					],
				} as ModelCapabilities,
			}),
		} as unknown as ApiProfile

		const { rerender } = render(<AnthropicProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		expect(screen.getByRole("checkbox", { name: "Enable Long Context" })).toBeChecked()
		expect(screen.getByTestId("current-context-window")).toHaveTextContent("1200000")
		fireEvent.click(screen.getByText("Update Current Window"))
		expect(onUpdate).toHaveBeenCalledWith({
			anthropic: {
				...profile.anthropic,
				capabilities: {
					contextWindowTiers: [
						{ id: "standard", contextWindow: 160_000, label: "160K" },
						{ id: "long", contextWindow: 1_500_000, label: "1.2M", apiModelSuffix: ":1m" },
					],
				},
			},
		})

		rerender(
			<AnthropicProvider
				onUpdate={onUpdate}
				profile={{ ...profile, anthropic: { ...profile.anthropic, enableLongContext: false } }}
				showModelOptions={true}
			/>,
		)
		expect(screen.getByRole("checkbox", { name: "Enable Long Context" })).not.toBeChecked()
		expect(screen.getByTestId("current-context-window")).toHaveTextContent("160000")
	})

	it("edits direct context windows without adding a long-context suffix tier", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "profile-native-window",
			provider: "anthropic",
			modelId: "claude-native",
			anthropic: AnthropicProviderConfig.create({
				enableLongContext: true,
				capabilities: {
					contextWindow: 1_250_000,
					contextWindowTiers: [
						{ id: "standard", contextWindow: 200_000, label: "200K" },
						{ id: "long", contextWindow: 1_000_000, label: "1M", apiModelSuffix: ":1m" },
					],
				} as ModelCapabilities,
			}),
		} as unknown as ApiProfile

		render(<AnthropicProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		expect(screen.queryByRole("checkbox", { name: "Enable Long Context" })).not.toBeInTheDocument()
		expect(screen.getByTestId("current-context-window")).toHaveTextContent("1250000")
		fireEvent.click(screen.getByText("Update Current Window"))
		expect(onUpdate).toHaveBeenCalledWith({
			anthropic: {
				...profile.anthropic,
				capabilities: { contextWindow: 1_500_000 },
			},
		})
	})

	it("reads adaptive-thinking efforts from the selected model metadata", () => {
		const profile = {
			id: "profile-adaptive",
			provider: "anthropic",
			modelId: "claude-sonnet-4-6",
			anthropic: AnthropicProviderConfig.create({ reasoning: { enableThinking: true, effort: "high" } }),
		} as unknown as ApiProfile

		render(<AnthropicProvider onUpdate={vi.fn()} profile={profile} showModelOptions={true} />)

		expect(screen.getByTestId("thinking-efforts")).toHaveTextContent("none,low,medium,high,max")
	})

	it("enables the 1M long context by default for official models with tiers", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "profile-3",
			provider: "anthropic",
			modelId: "claude-custom",
			anthropic: AnthropicProviderConfig.create({}),
		} as unknown as ApiProfile

		render(<AnthropicProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		// Long context is on by default: the effective context window resolves to 1M.
		expect(screen.getByText("context:1000000")).toBeInTheDocument()
	})
})
