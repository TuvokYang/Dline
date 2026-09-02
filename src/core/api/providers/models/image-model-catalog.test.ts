import { describe, expect, it } from "vitest"
import { allProviderModels } from "./index"

interface ImageModelFixture {
	id: string
	pricing?: { pricePerImage?: number; currency?: string }
	capabilities?: {
		supportsEditing?: boolean
		supportsGeneration?: boolean
		supportsMask?: boolean
	}
}

interface ImageCatalogFixture {
	defaultImageModelId?: string
	imageModels?: Record<string, ImageModelFixture>
}

describe("built-in image model catalogs", () => {
	it("declares gpt-image-2 as the OpenAI default with generation, editing, and mask support", () => {
		const openai = allProviderModels.openai as ImageCatalogFixture

		expect(openai.defaultImageModelId).toBe("gpt-image-2")
		expect(openai.imageModels?.["gpt-image-2"]).toMatchObject({
			id: "gpt-image-2",
			capabilities: {
				supportsEditing: true,
				supportsGeneration: true,
				supportsMask: true,
			},
		})
	})

	it("declares Nano Banana 2 as the Gemini default and keeps Lite and Pro choices", () => {
		const gemini = allProviderModels.gemini as ImageCatalogFixture

		expect(gemini.defaultImageModelId).toBe("gemini-3.1-flash-image")
		expect(Object.keys(gemini.imageModels ?? {})).toEqual(
			expect.arrayContaining([
				"gemini-2.5-flash-image",
				"gemini-3-pro-image",
				"gemini-3.1-flash-image",
				"gemini-3.1-flash-lite-image",
			]),
		)
		expect(gemini.imageModels?.["gemini-3.1-flash-image"]?.pricing).toEqual({
			pricePerImage: 0.151,
			currency: "USD",
		})
	})

	it("does not mark the ChatGPT subscription Codex provider as an image provider", () => {
		const codex = allProviderModels["openai-codex"] as ImageCatalogFixture

		expect(codex.defaultImageModelId).toBeUndefined()
		expect(codex.imageModels).toBeUndefined()
	})
})
