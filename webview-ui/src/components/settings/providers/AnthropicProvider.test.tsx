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

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({ remoteConfigSettings: {} }),
}))

vi.mock("./useProviderModels", () => ({
	useProviderModels: () => ({
		models: { "claude-custom": registryModel },
		defaultModelId: "claude-custom",
		modelInfoSaneDefaults: registryModel,
		loading: false,
	}),
}))

vi.mock("../common/ModelConfiguration", () => ({
	ModelConfiguration: ({ onCapabilitiesUpdate }: { onCapabilitiesUpdate: (updates: Partial<ModelCapabilities>) => void }) => (
		<button onClick={() => onCapabilitiesUpdate({ supportsPromptCache: false })} type="button">
			Update Cache
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
vi.mock("../common/ContextWindowSwitcher", () => ({ ContextWindowSwitcher: () => <div /> }))
vi.mock("../common/DebouncedTextField", () => ({ DebouncedTextField: () => <div /> }))
vi.mock("../common/ModelSelector", () => ({ ModelSelector: () => <div /> }))
vi.mock("../common/RemotelyConfiguredInputWrapper", () => ({
	RemotelyConfiguredInputWrapper: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock("../ThinkingControl", () => ({ default: () => <div /> }))
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

		fireEvent.click(screen.getByText("Update Cache"))

		expect(onUpdate).toHaveBeenCalledWith({
			anthropic: {
				...profile.anthropic,
				capabilities: { maxTokens: 64_000, supportsPromptCache: false },
			},
		})
	})
})
