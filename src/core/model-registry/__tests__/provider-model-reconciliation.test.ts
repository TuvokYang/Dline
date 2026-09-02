import type { ProviderModelsConfig } from "@shared/providers/types"
import { describe, expect, it } from "vitest"
import { reconcileProviderModels } from "../provider-model-reconciliation"

interface ImageModelFixture {
	id: string
	name?: string
	userDefined?: boolean
}

interface ImageCatalogConfig extends ProviderModelsConfig {
	defaultImageModelId?: string
	imageModels?: Record<string, ImageModelFixture>
}

describe("provider image model reconciliation", () => {
	it("refreshes built-in image models while preserving unknown user image models", () => {
		const seed: ImageCatalogConfig = {
			provider: "openai",
			providerName: "OpenAI",
			billingMode: "token",
			defaultModelId: "gpt-chat",
			models: { "gpt-chat": { id: "gpt-chat" } },
			defaultImageModelId: "gpt-image-2",
			imageModels: {
				"gpt-image-2": { id: "gpt-image-2", name: "GPT Image 2" },
			},
		}
		const stored: ImageCatalogConfig = {
			provider: "openai",
			providerName: "OpenAI",
			billingMode: "token",
			defaultModelId: "gpt-chat",
			models: { "gpt-chat": { id: "gpt-chat" } },
			imageModels: {
				"gpt-image-2": { id: "gpt-image-2", name: "Stale image model" },
				"private-image": { id: "private-image", name: "Private Image" },
			},
		}

		const result = reconcileProviderModels(seed, stored, "refresh-built-ins") as ImageCatalogConfig

		expect(result.defaultImageModelId).toBe("gpt-image-2")
		expect(result.imageModels?.["gpt-image-2"]).toMatchObject({
			name: "GPT Image 2",
			userDefined: false,
		})
		expect(result.imageModels?.["private-image"]).toMatchObject({
			name: "Private Image",
			userDefined: true,
		})
	})
})
