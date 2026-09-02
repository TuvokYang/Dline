import type { ImageModelInfo } from "@shared/proto/dline/models"

export const openAIImageModels: Record<string, ImageModelInfo> = {
	"gpt-image-2": {
		id: "gpt-image-2",
		name: "GPT Image 2",
		description: "OpenAI image generation and editing model.",
		capabilities: {
			supportsGeneration: true,
			supportsEditing: true,
			supportsMask: true,
			supportsReferenceImages: true,
			supportsTransparentBackground: true,
			maxImages: 10,
		},
		pricing: undefined,
		userDefined: false,
	},
}

export const openAIDefaultImageModelId = "gpt-image-2"
