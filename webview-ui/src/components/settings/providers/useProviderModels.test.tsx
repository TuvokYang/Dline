import { renderHook, waitFor } from "@testing-library/react"
import type { PropsWithChildren } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionStateContext, type ExtensionStateContextType } from "@/context/ExtensionStateContext"
import { useProviderModels } from "./useProviderModels"

const mocks = vi.hoisted(() => ({
	providersVersion: 1,
	getAvailableModels: vi.fn(),
}))

vi.mock("@/services/grpc-client", () => ({
	ModelsServiceClient: {
		getAvailableModels: mocks.getAvailableModels,
	},
}))

function catalog(modelId: string) {
	return {
		providers: [
			{
				provider: "deepseek",
				providerName: "DeepSeek",
				defaultModelId: modelId,
				models: [{ id: modelId, name: modelId }],
			},
		],
	}
}

describe("useProviderModels", () => {
	beforeEach(() => {
		mocks.providersVersion = 1
		mocks.getAvailableModels.mockReset()
		mocks.getAvailableModels.mockResolvedValueOnce(catalog("deepseek-before"))
	})

	it("reloads the shared model catalog when providersVersion changes", async () => {
		const wrapper = ({ children }: PropsWithChildren) => (
			<ExtensionStateContext.Provider value={{ providersVersion: mocks.providersVersion } as ExtensionStateContextType}>
				{children}
			</ExtensionStateContext.Provider>
		)
		const { result, rerender } = renderHook(() => useProviderModels("deepseek"), { wrapper })

		await waitFor(() => expect(result.current.models).toHaveProperty("deepseek-before"))
		expect(mocks.getAvailableModels).toHaveBeenCalledTimes(1)
		rerender()
		expect(mocks.getAvailableModels).toHaveBeenCalledTimes(1)

		mocks.getAvailableModels.mockResolvedValueOnce(catalog("deepseek-after"))
		mocks.providersVersion = 2
		rerender()

		await waitFor(() => expect(result.current.models).toHaveProperty("deepseek-after"))
		expect(result.current.models).not.toHaveProperty("deepseek-before")
		expect(mocks.getAvailableModels).toHaveBeenCalledTimes(2)
	})
})
