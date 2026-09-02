import { resolveProfileReference } from "@core/profiles/profile-binding"
import type { ImageModelInfo } from "@shared/proto/dline/models"
import {
	ApiProfile,
	ImageGenerationSource,
	type ImageGenerationProfile,
} from "@shared/proto/dline/profile"
import { ImageGenerationError } from "./contracts"

export interface ResolvedImageProfile {
	profile: ApiProfile
	model: ImageModelInfo
}

export interface ImageProfileResolverOptions {
	readApiProfiles?: () => ApiProfile[]
	readProfiles?: () => ApiProfile[]
	readImageProfiles?: () => ImageGenerationProfile[]
	getDefaultProfileId?: () => string | undefined
	getDefaultProfileName?: () => string | undefined
	getCurrentProfileId: () => string | undefined
	getCurrentProfileName: () => string | undefined
	getImageModel: (providerId: string, modelId: string) => ImageModelInfo | undefined
}

function unavailable(message: string): never {
	throw new ImageGenerationError({ code: "invalid_request", message, retryable: false })
}

export class ImageProfileResolver {
	constructor(private readonly options: ImageProfileResolverOptions) {}

	hasAvailableProfile(): boolean {
		try {
			this.resolve()
			return true
		} catch {
			return false
		}
	}

	resolve(selector?: string): ResolvedImageProfile {
		const apiProfiles = (this.options.readApiProfiles ?? this.options.readProfiles)?.() ?? []
		const reference = this.options.getCurrentProfileId() ?? this.options.getCurrentProfileName()
		if (!reference) return unavailable("The current API Profile is not configured for image generation.")
		const resolution = resolveProfileReference(apiProfiles, reference)
		if (resolution.status !== "resolved") return unavailable("The current API Profile could not be resolved.")
		const apiProfile = resolution.profile
		if (!apiProfile.enabled) {
			return unavailable("The current API Profile is disabled.")
		}
		if (apiProfile.imageSource === ImageGenerationSource.IMAGE_GENERATION_SOURCE_HOSTED) {
			return unavailable("Hosted image generation is executed by the current Provider request.")
		}
		if (!apiProfile.imageModelId) {
			return unavailable("Image generation is not enabled for the current API Profile.")
		}

		const source =
			apiProfile.imageSource === ImageGenerationSource.IMAGE_GENERATION_SOURCE_INDEPENDENT
				? ImageGenerationSource.IMAGE_GENERATION_SOURCE_INDEPENDENT
				: ImageGenerationSource.IMAGE_GENERATION_SOURCE_CURRENT
		let profile = apiProfile
		if (source === ImageGenerationSource.IMAGE_GENERATION_SOURCE_INDEPENDENT) {
			const imageProfile = (this.options.readImageProfiles?.() ?? [])
				.find((candidate) => candidate.id === apiProfile.imageProfileId && candidate.enabled)
			if (!imageProfile) return unavailable("The selected independent Image Profile is unavailable.")
			profile = ApiProfile.create({
				id: imageProfile.id,
				name: imageProfile.name,
				provider: imageProfile.provider,
				apiKey: imageProfile.apiKey,
				baseUrl: imageProfile.baseUrl,
				modelId: apiProfile.imageModelId,
				imageModelId: apiProfile.imageModelId,
				usedFor: [],
				enabled: true,
			})
		}

		if (selector && ![profile.id, profile.name, ...(profile.legacyNames ?? [])].includes(selector)) {
			return unavailable("The requested Image Profile does not match the current API Profile binding.")
		}
		const model = this.options.getImageModel(profile.provider, apiProfile.imageModelId)
		const capabilities = model?.capabilities
		if (!model || (capabilities?.supportsGeneration !== true && capabilities?.supportsEditing !== true)) {
			return unavailable("The selected image model is unavailable for the configured image source.")
		}
		return { profile, model }
	}
}
