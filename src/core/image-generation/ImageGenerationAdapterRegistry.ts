import type { ImageGenerationAdapter, ImageGenerationAdapterConfig, ImageGenerationAdapterFactory } from "./contracts"
import { ImageGenerationError } from "./contracts"

export class ImageGenerationAdapterRegistry {
	private readonly factories = new Map<string, ImageGenerationAdapterFactory>()

	register(providerId: string, factory: ImageGenerationAdapterFactory): void {
		if (!providerId.trim()) {
			throw new ImageGenerationError({
				code: "invalid_request",
				message: "Image generation adapter provider ID must not be empty.",
				retryable: false,
			})
		}
		if (this.factories.has(providerId)) {
			throw new ImageGenerationError({
				code: "adapter_already_registered",
				message: `An image generation adapter is already registered for provider "${providerId}".`,
				retryable: false,
			})
		}
		this.factories.set(providerId, factory)
	}

	has(providerId: string): boolean {
		return this.factories.has(providerId)
	}

	create(providerId: string, config: ImageGenerationAdapterConfig): ImageGenerationAdapter {
		const factory = this.factories.get(providerId)
		if (!factory) {
			throw new ImageGenerationError({
				code: "adapter_not_found",
				message: `No image generation adapter is registered for provider "${providerId}".`,
				retryable: false,
			})
		}
		return factory(config)
	}
}
