import { GPT_IMAGE_1_MODEL_ID, GPT_IMAGE_2_MODEL_ID, GPT_IMAGE_2_SUBSCRIPTION_MODEL_ID } from "@shared/image-generation"
import type { ImageModelInfo } from "@shared/proto/dline/models"

export const openAIImageModels: Record<string, ImageModelInfo> = {
	[GPT_IMAGE_1_MODEL_ID]: {
		id: GPT_IMAGE_1_MODEL_ID,
		name: "GPT Image 1",
		description: "Previous OpenAI image generation and editing model.",
		capabilities: {
			supportsGeneration: true,
			supportsEditing: true,
			supportsMask: true,
			supportsReferenceImages: true,
			supportsTransparentBackground: false,
			maxImages: 10,
		},
		pricing: undefined,
		userDefined: false,
	},
	[GPT_IMAGE_2_MODEL_ID]: {
		id: GPT_IMAGE_2_MODEL_ID,
		name: "GPT Image 2",
		description: "OpenAI API Platform image generation and editing model.",
		capabilities: {
			supportsGeneration: true,
			supportsEditing: true,
			supportsMask: true,
			supportsReferenceImages: true,
			supportsTransparentBackground: false,
			maxImages: 10,
		},
		pricing: undefined,
		userDefined: false,
	},
	[GPT_IMAGE_2_SUBSCRIPTION_MODEL_ID]: {
		id: GPT_IMAGE_2_SUBSCRIPTION_MODEL_ID,
		name: "GPT Image 2 (Subscription)",
		description: "GPT/Codex subscription image generation through a compatible Responses endpoint.",
		capabilities: {
			supportsGeneration: true,
			supportsEditing: true,
			supportsMask: false,
			supportsReferenceImages: true,
			supportsTransparentBackground: false,
			maxImages: 1,
		},
		pricing: undefined,
		userDefined: false,
	},
}

export const openAIDefaultImageModelId = GPT_IMAGE_2_MODEL_ID
