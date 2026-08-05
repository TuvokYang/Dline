// @vitest-environment jsdom
import type { ModelInfo } from "@shared/proto/dline/models"
import { ApiFormat } from "@shared/proto/dline/models/metadata"
import { BaseProviderConfig } from "@shared/proto/dline/provider/common"
import { fireEvent, render, screen } from "@testing-library/react"
import React from "react"
import { describe, expect, it, vi } from "vitest"
import { DeepSeekProvider } from "./DeepSeekProvider"
import type { ApiProfile } from "./ProviderProfile"

const models = {
	"deepseek-v4-pro": {
		id: "deepseek-v4-pro",
		apiFormats: [ApiFormat.OPENAI_CHAT, ApiFormat.OPENAI_RESPONSES, ApiFormat.ANTHROPIC_CHAT],
		capabilities: { supportsReasoning: true },
	} as ModelInfo,
	"deepseek-v4-flash": {
		id: "deepseek-v4-flash",
		apiFormats: [ApiFormat.OPENAI_CHAT, ApiFormat.OPENAI_RESPONSES, ApiFormat.ANTHROPIC_CHAT],
		capabilities: { supportsReasoning: true },
	} as ModelInfo,
}

vi.mock("./useProviderModels", () => ({
	useProviderModels: () => ({
		models,
		defaultModelId: "deepseek-v4-flash",
		modelInfoSaneDefaults: models["deepseek-v4-flash"],
	}),
}))

vi.mock("../common/ApiKeyField", () => ({ ApiKeyField: () => <div /> }))
vi.mock("../common/ModelInfoView", () => ({ ModelInfoView: () => <div /> }))
vi.mock("../ReasoningEffortSelector", () => ({ default: () => <div /> }))
vi.mock("../common/ModelSelector", () => ({
	ModelSelector: ({ models: availableModels }: { models: Record<string, ModelInfo> }) => (
		<div data-testid="deepseek-models">{Object.keys(availableModels).join(",")}</div>
	),
}))
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeCheckbox: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}))

describe("DeepSeekProvider", () => {
	it("shows metadata-supported API formats while retaining the complete model catalog", () => {
		const onUpdate = vi.fn()
		const profile = {
			id: "deepseek-profile",
			provider: "deepseek",
			modelId: "deepseek-v4-pro",
			modelInfo: {
				id: "deepseek-v4-pro",
				capabilities: { supportsReasoning: true },
			},
			deepseek: BaseProviderConfig.create(),
		} as unknown as ApiProfile

		render(<DeepSeekProvider onUpdate={onUpdate} profile={profile} showModelOptions={true} />)

		expect(screen.getByTestId("deepseek-models")).toHaveTextContent("deepseek-v4-pro,deepseek-v4-flash")
		const format = screen.getByRole("combobox", { name: "API Format" })
		expect(format).toHaveValue(String(ApiFormat.OPENAI_CHAT))
		expect(screen.getByRole("option", { name: "OpenAI Chat" })).toBeInTheDocument()
		expect(screen.getByRole("option", { name: "OpenAI Responses" })).toBeInTheDocument()
		expect(screen.getByRole("option", { name: "Anthropic Messages" })).toBeInTheDocument()

		fireEvent.change(format, { target: { value: String(ApiFormat.OPENAI_RESPONSES) } })
		expect(onUpdate).toHaveBeenCalledWith({
			deepseek: expect.objectContaining({ apiFormat: ApiFormat.OPENAI_RESPONSES }),
		})
	})
})
