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
	it("declares selectable OpenAI image models with gpt-image-2.5 as the default", () => {
		const openai = allProviderModels.openai as ImageCatalogFixture

		expect(openai.defaultImageModelId).toBe("gpt-image-2.5")
		expect(Object.keys(openai.imageModels ?? {})).toEqual(
			expect.arrayContaining(["gpt-image-1", "gpt-image-2", "gpt-image-2.5"]),
		)
		expect(openai.imageModels?.["gpt-image-2-sub"]).toBeUndefined()
		expect(openai.imageModels?.["gpt-image-1"]).toMatchObject({
			id: "gpt-image-1",
			capabilities: {
				supportsEditing: true,
				supportsGeneration: true,
				supportsMask: true,
			},
		})
		expect(openai.imageModels?.["gpt-image-2"]).toMatchObject({
			id: "gpt-image-2",
			capabilities: {
				supportsEditing: true,
				supportsGeneration: true,
				supportsMask: true,
			},
		})
		expect(openai.imageModels?.["gpt-image-2.5"]).toMatchObject({
			id: "gpt-image-2.5",
			capabilities: { supportsEditing: true, supportsGeneration: true, supportsMask: true },
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

	it("shares the OpenAI image catalog with the ChatGPT subscription Codex provider", () => {
		const codex = allProviderModels["openai-codex"] as ImageCatalogFixture

		expect(codex.defaultImageModelId).toBe("gpt-image-2.5")
		expect(codex.imageModels).toBe((allProviderModels.openai as ImageCatalogFixture).imageModels)
	})
})
