// @vitest-environment jsdom
import type { ModelInfo } from "@shared/proto/dline/models"
import type { ModelCapabilities, ModelPricing } from "@shared/proto/dline/models/metadata"
import { OpenAiProviderConfig } from "@shared/proto/dline/provider/openai"
import { act, render, screen } from "@testing-library/react"
import { useState } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { OpenAIProvider } from "./OpenAIProvider"
import type { ApiProfile } from "./ProviderProfile"

/** Registry metadata whose prices differ from the ones typed in the test. */
/** Approximates how long the extension host takes to echo a saved profile. */
const ECHO_DELAY_MS = 500

const registryModel: ModelInfo = {
	id: "gpt-custom",
	name: "Registry GPT",
	capabilities: { contextWindow: 128_000, maxTokens: 4096 } as ModelCapabilities,
	pricing: { inputPrice: 1, outputPrice: 2, currency: "USD" } as ModelPricing,
}

vi.mock("./useProviderModels", () => ({
	useProviderModels: () => ({
		models: { "gpt-custom": registryModel },
		defaultModelId: "gpt-custom",
		modelInfoSaneDefaults: registryModel,
		loading: false,
	}),
}))

vi.mock("../common/ApiKeyField", () => ({ ApiKeyField: () => <div /> }))
vi.mock("../common/BaseUrlField", () => ({ BaseUrlField: () => <div /> }))
vi.mock("../common/ModelSelector", () => ({ ModelSelector: () => <div /> }))
vi.mock("../common/ModelAutocomplete", () => ({ ModelAutocomplete: () => <div /> }))
vi.mock("../ThinkingControl", () => ({ default: () => <div /> }))
vi.mock("../OpenAIServiceTierSelector", () => ({ default: () => <div /> }))
vi.mock("@/services/grpc-client", () => ({ ModelsServiceClient: { refreshOpenAiModels: vi.fn() } }))

/** Surfaces the merged pricing the summary would render. */
vi.mock("../common/ModelInfoView", () => ({
	ModelInfoView: ({ modelInfo }: { modelInfo: ModelInfo }) => (
		<div>
			<span data-testid="summary-input">{String(modelInfo.pricing?.inputPrice)}</span>
			<span data-testid="summary-output">{String(modelInfo.pricing?.outputPrice)}</span>
		</div>
	),
}))

/**
 * Holds the profile the way the settings list does: each update replaces the
 * stored profile and re-renders the provider with the new value.
 */
function ProfileHost() {
	const [profile, setProfile] = useState<ApiProfile>(
		() =>
			({
				id: "profile-1",
				provider: "openai",
				modelId: "gpt-custom",
				openai: OpenAiProviderConfig.create({ customModelEnabled: false }),
			}) as unknown as ApiProfile,
	)

	return (
		<OpenAIProvider
			onUpdate={(updates) => {
				// The real profile round-trips through the extension host, so the
				// prop lags behind the edit that produced it.
				setTimeout(() => {
					setProfile((current) => ({ ...current, ...updates }))
				}, ECHO_DELAY_MS)
			}}
			profile={profile}
			showModelOptions={true}
		/>
	)
}

async function typePrice(label: string, value: string): Promise<void> {
	// jsdom does not upgrade the toolkit element, so it exposes no textbox role.
	const field = document.querySelector<HTMLElement>(`vscode-text-field[aria-label="${label}"]`)
	if (!field) {
		throw new Error(`missing price field: ${label}`)
	}

	await act(async () => {
		// The toolkit field reports edits through `input`, matching real typing.
		;(field as unknown as { value: string }).value = value
		field.dispatchEvent(new Event("input", { bubbles: true }))
	})
	await act(async () => {
		await vi.advanceTimersByTimeAsync(200)
	})
}

describe("OpenAIProvider pricing round trip", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	it("keeps every price entered in sequence", async () => {
		render(<ProfileHost />)

		// Pricing fields only mount once the disclosure is open, as in the UI.
		await act(async () => {
			screen.getByRole("button", { name: "Model Configuration" }).click()
		})

		await typePrice("Input Price ($/1M tokens)", "1.25")
		await typePrice("Output Price ($/1M tokens)", "2.5")
		await typePrice("Cache Writes ($/M)", "0.75")
		await typePrice("Cache Reads ($/M)", "0.25")

		// Let every pending echo arrive before reading the summary.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(ECHO_DELAY_MS * 4)
		})

		expect(screen.getByTestId("summary-input")).toHaveTextContent("1.25")
		expect(screen.getByTestId("summary-output")).toHaveTextContent("2.5")
	})
})
