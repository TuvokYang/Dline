// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionStateContext, type ExtensionStateContextType } from "@/context/ExtensionStateContext"
import { useProviderModelOptions } from "./useProviderModelOptions"

const mocks = vi.hoisted(() => ({
	getAvailableModels: vi.fn(),
	refreshProviderModels: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		getAvailableModels: mocks.getAvailableModels,
		refreshProviderModels: mocks.refreshProviderModels,
	},
}))

function catalogResponse() {
	return {
		providers: [
			{
				provider: "origin-test",
				providerName: "Origin Test",
				defaultModelId: "catalog-model",
				models: [{ id: "catalog-model", name: "catalog-model" }],
				defaultImageModelId: "",
				imageModels: [],
			},
		],
	}
}

const wrapper = ({ children }: PropsWithChildren) => (
	<ExtensionStateContext.Provider value={{ providersVersion: 1 } as ExtensionStateContextType}>
		{children}
	</ExtensionStateContext.Provider>
)

describe("useProviderModelOptions", () => {
	beforeEach(() => {
		mocks.getAvailableModels.mockReset()
		mocks.refreshProviderModels.mockReset()
		mocks.getAvailableModels.mockResolvedValue(catalogResponse())
	})

	it("marks ids the local catalog does not carry as remote", async () => {
		mocks.refreshProviderModels.mockResolvedValue({ values: ["catalog-model", "listing-only-model"] })

		const { result } = renderHook(
			() =>
				useProviderModelOptions({
					providerId: "origin-test",
					baseUrl: "https://example.test",
					apiKey: "key",
				}),
			{ wrapper },
		)

		await waitFor(() => expect(result.current.options).toHaveProperty("catalog-model"))
		result.current.refreshRemoteModels()
		await waitFor(() => expect(result.current.options).toHaveProperty("listing-only-model"))

		expect(result.current.optionOrigins["catalog-model"]).toBe("catalog")
		expect(result.current.optionOrigins["listing-only-model"]).toBe("remote")
	})

	it("leaves a free-form selection without an origin", async () => {
		mocks.refreshProviderModels.mockResolvedValue({ values: [] })

		const { result } = renderHook(
			() =>
				useProviderModelOptions({
					providerId: "origin-test",
					selectedModelId: "hand-typed-model",
				}),
			{ wrapper },
		)

		await waitFor(() => expect(result.current.options).toHaveProperty("hand-typed-model"))
		expect(result.current.optionOrigins["hand-typed-model"]).toBeUndefined()
	})
})
