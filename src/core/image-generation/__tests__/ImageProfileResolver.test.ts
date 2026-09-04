import { ApiFormat } from "@shared/proto/dline/models/metadata"
import { ImageGenerationSource, type ApiProfile, type ImageGenerationProfile } from "@shared/proto/dline/profile"
import { describe, expect, it } from "vitest"
import { ImageGenerationError } from "../contracts"
import { ImageProfileResolver, OPENAI_HOSTED_IMAGE_ADAPTER_ID } from "../ImageProfileResolver"

const modelCatalog = {
	openai: {
		"gpt-image-2": { id: "gpt-image-2", capabilities: { supportsGeneration: true, maxImages: 4 } },
		"gpt-image-2-sub": { id: "gpt-image-2-sub", capabilities: { supportsGeneration: true, maxImages: 1 } },
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
		getDefaultImageModelId: (providerId) => (providerId === "openai" ? "gpt-image-2" : undefined),
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
	openai: { apiFormat: ApiFormat.OPENAI_RESPONSES },
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
	it("uses the effective Responses transport declared by the gpt-5.6-sol model when raw apiFormat is absent", () => {
		const catalogBackedProfile = {
			...currentProfile,
			modelId: "gpt-5.6-sol",
			openai: {},
			modelInfo: {
				id: "gpt-5.6-sol",
				apiFormats: [ApiFormat.OPENAI_RESPONSES, ApiFormat.OPENAI_CHAT],
				capabilities: { supportsTools: true },
			},
		} as ApiProfile

		expect(createResolver([catalogBackedProfile], [], catalogBackedProfile.id).hasAvailableProfile()).toBe(true)
		expect(createResolver([catalogBackedProfile], [], catalogBackedProfile.id).resolve()).toMatchObject({
			adapterId: OPENAI_HOSTED_IMAGE_ADAPTER_ID,
			profile: { modelId: "gpt-5.6-sol" },
			model: { id: "gpt-image-2" },
		})
	})

	it("uses a free-form current Responses model without replacing its custom URL or key", () => {
		const freeFormProfile = { ...currentProfile, modelId: "custom-responses-model" } as ApiProfile
		const resolved = createResolver([freeFormProfile], [], freeFormProfile.id).resolve()
		expect(resolved.profile).toBe(freeFormProfile)
		expect(resolved.profile.baseUrl).toBe("https://current.example.test/v1")
		expect(resolved.profile.apiKey).toBe("current-secret")
		expect(resolved).toMatchObject({ adapterId: OPENAI_HOSTED_IMAGE_ADAPTER_ID, model: { id: "gpt-image-2" } })
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

	it("rejects the subscription alias for an Independent OpenAI Images connection", () => {
		const independentOpenAI = {
			...independentConnection,
			id: "independent-openai",
			name: "Independent OpenAI",
			provider: "openai",
		} as ImageGenerationProfile
		const profile = {
			...currentProfile,
			imageSource: ImageGenerationSource.IMAGE_GENERATION_SOURCE_INDEPENDENT,
			imageProfileId: independentOpenAI.id,
			imageModelId: "gpt-image-2-sub",
		} as ApiProfile

		expect(() => createResolver([profile], [independentOpenAI], profile.id).resolve()).toThrow(
			/only available with the Current image source/,
		)
	})

	it("routes Hosted through the dedicated Responses adapter without a local image model binding", () => {
		const profile = {
			...currentProfile,
			modelId: "gpt-5",
			imageSource: ImageGenerationSource.IMAGE_GENERATION_SOURCE_HOSTED,
			imageModelId: undefined,
			openai: { apiFormat: ApiFormat.OPENAI_RESPONSES },
		} as ApiProfile

		const resolved = createResolver([profile], [], profile.id).resolve()

		expect(resolved).toMatchObject({
			profile,
			source: ImageGenerationSource.IMAGE_GENERATION_SOURCE_HOSTED,
			adapterId: OPENAI_HOSTED_IMAGE_ADAPTER_ID,
			model: { id: "gpt-image-2" },
		})
	})

	it("fails closed when the current API Profile selects None", () => {
		const profile = {
			...currentProfile,
			imageSource: ImageGenerationSource.IMAGE_GENERATION_SOURCE_UNSPECIFIED,
			imageModelId: undefined,
		} as ApiProfile
		const resolver = createResolver([profile], [], profile.id)

		expect(() => resolver.resolve()).toThrow(/disabled for the current API Profile/)
		expect(resolver.hasAvailableProfile()).toBe(false)
	})

	it("does not fall back to another API or independent profile", () => {
		const invalid = { ...currentProfile, id: "invalid-current", name: "Invalid Current", imageModelId: "missing-image-model" } as ApiProfile
		expect(() => createResolver([invalid, currentProfile], [independentConnection], invalid.id).resolve()).toThrow(
			/selected image model is unavailable/,
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
