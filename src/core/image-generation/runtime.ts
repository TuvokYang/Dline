import type { ArtifactUrlDownloader } from "@core/artifacts/ArtifactResolver"
import { createTaskArtifactResolver, getTaskArtifactDirectory } from "@core/artifacts/runtime"
import { readApiProfiles } from "@core/controller/file/getApiProfiles"
import { readImageGenerationProfiles } from "@core/controller/file/imageGenerationProfiles"
import { ModelRegistry } from "@core/model-registry/ModelRegistry"
import type { StateManager } from "@core/storage/StateManager"
import { GeminiImageGenerationAdapter } from "./adapters/GeminiImageGenerationAdapter"
import { OpenAIImageGenerationAdapter } from "./adapters/OpenAIImageGenerationAdapter"
import { ImageGenerationAdapterRegistry } from "./ImageGenerationAdapterRegistry"
import { ImageGenerationBudgetLedger } from "./ImageGenerationBudgetLedger"
import { ImageGenerationPolicy } from "./ImageGenerationPolicy"
import { ImageGenerationService } from "./ImageGenerationService"
import { ImageProfileResolver } from "./ImageProfileResolver"

export interface ImageGenerationRuntime {
	profileResolver: ImageProfileResolver
	adapterRegistry: ImageGenerationAdapterRegistry
	service: ImageGenerationService
}

export interface CreateImageGenerationRuntimeOptions {
	taskId: string
	stateManager: StateManager
	urlDownloader?: ArtifactUrlDownloader
}

export function createImageProfileResolver(stateManager: StateManager): ImageProfileResolver {
	return new ImageProfileResolver({
		readApiProfiles,
		readImageProfiles: readImageGenerationProfiles,
		getCurrentProfileId: () => {
			const configuration = stateManager.getApiConfiguration()
			return stateManager.getGlobalSettingsKey("mode") === "plan"
				? configuration.planModeProfileId
				: configuration.actModeProfileId
		},
		getCurrentProfileName: () => {
			const configuration = stateManager.getApiConfiguration()
			return stateManager.getGlobalSettingsKey("mode") === "plan"
				? configuration.planModeProfile
				: configuration.actModeProfile
		},
		getImageModel: (providerId, modelId) => ModelRegistry.getInstance().getProviderModels(providerId)?.imageModels?.[modelId],
	})
}

export function hasAvailableImageProfile(stateManager: StateManager): boolean {
	return stateManager.getGlobalSettingsKey("imageGenerationEnabled") === true && createImageProfileResolver(stateManager).hasAvailableProfile()
}

export function createImageGenerationRuntime(options: CreateImageGenerationRuntimeOptions): ImageGenerationRuntime {
	const profileResolver = createImageProfileResolver(options.stateManager)
	const adapterRegistry = new ImageGenerationAdapterRegistry()
	adapterRegistry.register("openai", (config) => new OpenAIImageGenerationAdapter(config))
	adapterRegistry.register("gemini", (config) => new GeminiImageGenerationAdapter(config))
	const artifactResolver = createTaskArtifactResolver(options.taskId, { urlDownloader: options.urlDownloader })
	const budgetLedger = new ImageGenerationBudgetLedger({
		taskId: options.taskId,
		taskDirectory: getTaskArtifactDirectory(options.taskId),
	})
	const service = new ImageGenerationService({
		profileResolver,
		adapterRegistry,
		policy: new ImageGenerationPolicy(),
		artifactResolver,
		budgetLedger,
		isFeatureEnabled: () => options.stateManager.getGlobalSettingsKey("imageGenerationEnabled") === true,
	})
	return { profileResolver, adapterRegistry, service }
}
