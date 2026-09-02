import { ImageGenerationSource, type ApiProfile, type ImageGenerationProfile } from "@shared/proto/dline/profile"
import { describe, expect, it } from "vitest"
import { ImageGenerationError } from "../contracts"
import { ImageProfileResolver } from "../ImageProfileResolver"

const modelCatalog = {
	openai: {
		"gpt-image-2": { id: "gpt-image-2", capabilities: { supportsGeneration: true, maxImages: 4 } },
	},
	gemini: {
		"gemini-3.1-flash-image": {
			id: "gemini-3.1-flash-image",
			capabilities: { supportsGeneration: true, maxImages: 4 },
		},
	},
}

function createResolver(apiProfiles: ApiProfile[], imageProfiles: ImageGenerationProfile[], currentProfileId?: string) {
	return new ImageProfileResolver({
		readApiProfiles: () => apiProfiles,
		readImageProfiles: () => imageProfiles,
		getCurrentProfileId: () => currentProfileId,
		getCurrentProfileName: () => undefined,
		getImageModel: (providerId, modelId) => modelCatalog[providerId as keyof typeof modelCatalog]?.[modelId as never],
	})
}

const currentProfile = {
	id: "current-openai",
	name: "Current OpenAI",
	provider: "openai",
	baseUrl: "https://current.example.test/v1",
	apiKey: "current-secret",
	modelId: "gpt-5",
	imageModelId: "gpt-image-2",
	imageSource: ImageGenerationSource.IMAGE_GENERATION_SOURCE_CURRENT,
	usedFor: ["act"],
	enabled: true,
} as ApiProfile

const independentConnection = {
	id: "independent-gemini",
	name: "Independent Gemini",
	provider: "gemini",
	baseUrl: "https://images.example.test",
	apiKey: "independent-secret",
	enabled: true,
	legacyNames: [],
} as ImageGenerationProfile

describe("ImageProfileResolver", () => {
	it("uses the current API Profile connection without replacing its custom URL or key", () => {
		const resolved = createResolver([currentProfile], [], currentProfile.id).resolve()
		expect(resolved.profile).toBe(currentProfile)
		expect(resolved.profile.baseUrl).toBe("https://current.example.test/v1")
		expect(resolved.profile.apiKey).toBe("current-secret")
	})

	it("uses only the explicitly bound independent Image Profile connection", () => {
		const profile = {
			...currentProfile,
			imageSource: ImageGenerationSource.IMAGE_GENERATION_SOURCE_INDEPENDENT,
			imageProfileId: independentConnection.id,
			imageModelId: "gemini-3.1-flash-image",
		} as ApiProfile
		const resolved = createResolver([profile], [independentConnection], profile.id).resolve()
		expect(resolved.profile).toMatchObject({
			id: independentConnection.id,
			provider: "gemini",
			baseUrl: "https://images.example.test",
			apiKey: "independent-secret",
		})
	})

	it("does not fall back to another API or independent profile", () => {
		const invalid = { ...currentProfile, id: "invalid-current", name: "Invalid Current", imageModelId: undefined } as ApiProfile
		expect(() => createResolver([invalid, currentProfile], [independentConnection], invalid.id).resolve()).toThrow(
			/Image generation is not enabled/,
		)
		expect(() => createResolver([currentProfile], [], undefined).resolve()).toThrow(/current API Profile is not configured/)
	})

	it("rejects a tool selector that does not match the configured source binding", () => {
		try {
			createResolver([currentProfile], [], currentProfile.id).resolve("another-profile")
			throw new Error("Expected profile resolution to fail")
		} catch (error) {
			expect(error).toBeInstanceOf(ImageGenerationError)
			expect((error as ImageGenerationError).code).toBe("invalid_request")
		}
	})

	it("exposes the same fail-closed predicate used by prompt gating", () => {
		expect(createResolver([currentProfile], [], currentProfile.id).hasAvailableProfile()).toBe(true)
		expect(createResolver([currentProfile], [], undefined).hasAvailableProfile()).toBe(false)
	})
})
