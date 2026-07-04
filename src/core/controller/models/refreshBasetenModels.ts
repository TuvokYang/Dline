import fs from "node:fs/promises"
import path from "node:path"
import { findEnabledProfiles } from "@core/controller/file/getApiProfiles"
import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import * as SecretsManager from "@core/storage/secrets"
import { ANTHROPIC_MAX_THINKING_BUDGET, ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import { parsePrice } from "@utils/model-utils"
import axios from "axios"
import { StateManager } from "@/core/storage/StateManager"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { basetenModels } from "../../../shared/api"
import { Controller } from ".."

// Track pending refresh promise to prevent duplicate concurrent fetches
let pendingRefresh: Promise<Record<string, ModelInfo>> | null = null

/**
 * Core function: Refreshes the Baseten models and returns application types
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshBasetenModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	// Check in-memory cache first
	const cache = StateManager.get().getModelsCache("baseten")
	if (cache) {
		return cache
	}

	// If a fetch is already in progress, return the same promise
	if (pendingRefresh) {
		return pendingRefresh
	}

	// Start new fetch and track the promise
	pendingRefresh = (async () => {
		try {
			return await fetchAndCacheModels(controller)
		} finally {
			// Clear pending promise when done (success or error)
			pendingRefresh = null
		}
	})()

	return pendingRefresh
}

async function fetchAndCacheModels(_controller: Controller): Promise<Record<string, ModelInfo>> {
	const basetenModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.basetenModels)

	// Find the first enabled baseten profile with a valid apiKey
	let basetenApiKey: string | undefined
	for (const p of findEnabledProfiles("baseten")) {
		const key = SecretsManager.getApiKey(p.id)
		if (key) {
			basetenApiKey = key
			break
		}
	}

	const models: Record<string, Partial<ModelInfo> & { supportedFeatures?: string[] }> = {}
	try {
		if (basetenApiKey) {
			// Ensure the API key is properly formatted
			const cleanApiKey = basetenApiKey.trim()
			if (!cleanApiKey) {
				throw new Error("Invalid Baseten API key format")
			}

			const response = await axios.get("https://inference.baseten.co/v1/models", {
				headers: {
					Authorization: `Bearer ${cleanApiKey}`,
					"Content-Type": "application/json",
					"User-Agent": "Cline-VSCode-Extension",
				},
				timeout: 10000, // 10 second timeout
				...getAxiosSettings(),
			})

			const rawModels = response?.data?.data

			if (rawModels && Array.isArray(rawModels)) {
				for (const rawModel of rawModels) {
					// Filter out non-chat models and validate model capabilities
					if (!isValidChatModel(rawModel)) {
						continue
					}

					// Check if we have static pricing information for this model
					const staticModelInfo = basetenModels[rawModel.id as keyof typeof basetenModels]
					const supportThinking = rawModel?.supported_features?.some(
						(p: string) => p === "reasoning_effort" || p === "reasoning",
					)

					const modelInfo: Partial<ModelInfo> & { supportedFeatures?: string[] } = {
						capabilities: {
							maxTokens: rawModel.max_completion_tokens || staticModelInfo?.capabilities?.maxTokens,
							contextWindow: rawModel.context_length || staticModelInfo?.capabilities?.contextWindow,
							supportsImages: false,
							supportsPromptCache: staticModelInfo?.capabilities?.supportsPromptCache || false,
							supportsReasoning: supportThinking || false,
							thinking: supportThinking
								? { supported: true, mode: "budget" as const, maxBudget: ANTHROPIC_MAX_THINKING_BUDGET }
								: undefined,
						},
						pricing: {
							inputPrice: parsePrice(rawModel.pricing?.prompt) || staticModelInfo?.pricing?.inputPrice || 0,
							outputPrice: parsePrice(rawModel.pricing?.completion) || staticModelInfo?.pricing?.outputPrice || 0,
							cacheWritesPrice: staticModelInfo?.pricing?.cacheWritesPrice || 0,
							cacheReadsPrice: staticModelInfo?.pricing?.cacheReadsPrice || 0,
						},
						description: generateModelDescription(rawModel, staticModelInfo),
						supportedFeatures: rawModel.supported_features || [],
					}

					models[rawModel.id] = modelInfo
				}
			}
			// Cache the fetched models to disk
			await fs.writeFile(basetenModelsFilePath, JSON.stringify(models))
		}

		// If no API key is set or models is empty, throw an error to trigger fallback
		if (Object.keys(models).length === 0) {
			throw new Error("No Baseten API key set or no models fetched")
		}
	} catch (error) {
		Logger.error("Error fetching Baseten models:", error)

		// Provide more specific error messages
		let errorMessage = "Unknown error occurred"
		if (axios.isAxiosError(error)) {
			if (error.response?.status === 401) {
				errorMessage = "Invalid Baseten API key. Please check your API key in settings."
			} else if (error.response?.status === 403) {
				errorMessage = "Access forbidden. Please verify your Baseten API key has the correct permissions."
			} else if (error.response?.status === 429) {
				errorMessage = "Rate limit exceeded. Please try again later."
			} else if (error.code === "ECONNABORTED") {
				errorMessage = "Request timeout. Please check your internet connection."
			} else {
				errorMessage = `API request failed: ${error.response?.status || error.code || "Unknown error"}`
			}
		} else if (error instanceof Error) {
			errorMessage = error.message
		}

		Logger.error("Baseten API Error:", errorMessage)

		// If we failed to fetch models, try to read cached models first
		const cachedModels = await readBasetenModels()
		if (cachedModels && Object.keys(cachedModels).length > 0) {
			// Use all cached models (no filtering)
			for (const [modelId, modelInfo] of Object.entries(cachedModels)) {
				models[modelId] = modelInfo
			}
		} else {
			// Fall back to static models from shared/api.ts
			for (const [modelId, modelInfo] of Object.entries(basetenModels)) {
				models[modelId] = {
					capabilities: {
						maxTokens: modelInfo.capabilities?.maxTokens,
						contextWindow: modelInfo.capabilities?.contextWindow,
						supportsImages: modelInfo.capabilities?.supportsImages ?? false,
						supportsPromptCache: modelInfo.capabilities?.supportsPromptCache ?? false,
						supportsReasoning: modelInfo.capabilities?.supportsReasoning || false,
						thinking: modelInfo.capabilities?.supportsReasoning
							? { supported: true, mode: "budget" as const, maxBudget: ANTHROPIC_MAX_THINKING_BUDGET }
							: undefined,
					},
					pricing: {
						inputPrice: modelInfo.pricing?.inputPrice,
						outputPrice: modelInfo.pricing?.outputPrice,
						cacheWritesPrice: modelInfo.pricing?.cacheWritesPrice ?? 0,
						cacheReadsPrice: modelInfo.pricing?.cacheReadsPrice ?? 0,
					},
					description: modelInfo.description || `${modelId} model`,
				}
			}
		}
	}

	// Convert the Record<string, Partial<ModelInfo>> to Record<string, ModelInfo>
	// by filling in any missing required fields with defaults
	const typedModels: Record<string, ModelInfo> = {}
	for (const [key, model] of Object.entries(models)) {
		typedModels[key] = {
			id: key,
			capabilities: {
				maxTokens: model.capabilities?.maxTokens ?? 8192,
				contextWindow: model.capabilities?.contextWindow ?? 8192,
				supportsImages: model.capabilities?.supportsImages ?? false,
				supportsPromptCache: model.capabilities?.supportsPromptCache ?? false,
				supportsReasoning: model.capabilities?.supportsReasoning || false,
				thinking: model.capabilities?.supportsReasoning
					? { supported: true, mode: "budget" as const, maxBudget: ANTHROPIC_MAX_THINKING_BUDGET }
					: undefined,
			},
			pricing: {
				inputPrice: model.pricing?.inputPrice ?? 0,
				outputPrice: model.pricing?.outputPrice ?? 0,
				cacheWritesPrice: model.pricing?.cacheWritesPrice ?? 0,
				cacheReadsPrice: model.pricing?.cacheReadsPrice ?? 0,
				tiers: model.pricing?.tiers,
			},
			description: model.description ?? "",
		}
	}

	// Store in StateManager's in-memory cache
	StateManager.get().setModelsCache("baseten", typedModels)

	return typedModels
}

/**
 * Reads cached Baseten models from disk (application types)
 */
async function readBasetenModels(): Promise<Record<string, Partial<ModelInfo>> | undefined> {
	const basetenModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.basetenModels)
	const fileExists = await fileExistsAtPath(basetenModelsFilePath)
	if (fileExists) {
		try {
			const fileContents = await fs.readFile(basetenModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		} catch (error) {
			Logger.error("Error reading cached Baseten models:", error)
			return undefined
		}
	}
	return undefined
}

/**
 * Validates if a model is suitable for chat completions
 */
function isValidChatModel(rawModel: any): boolean {
	// Filter out non-chat models (whisper, TTS, guard models, etc.)
	if (rawModel.id.includes("whisper") || rawModel.id.includes("tts") || rawModel.id.includes("embedding")) {
		return false
	}

	// Check if model supports chat completions
	if (rawModel.object === "model" && rawModel.id) {
		return true
	}

	return false
}

/**
 * Generates a descriptive name for the model
 */
function generateModelDescription(rawModel: any, staticModelInfo?: any): string {
	// Use static description if available and preferred
	if (staticModelInfo?.description) {
		return staticModelInfo.description
	}

	// Use API description if available
	if (rawModel.description) {
		const contextWindow = rawModel.context_length
		const quantization = rawModel.quantization
		const features = rawModel.supported_features || []

		let description = rawModel.description

		// Add technical details if available
		const technicalDetails = []
		if (contextWindow) {
			technicalDetails.push(`${contextWindow.toLocaleString()} token context`)
		}
		if (quantization) {
			technicalDetails.push(`${quantization} precision`)
		}
		if (features.length > 0) {
			const featureList = features.join(", ")
			technicalDetails.push(`supports ${featureList}`)
		}

		if (technicalDetails.length > 0) {
			description += ` (${technicalDetails.join(", ")})`
		}

		return description
	}

	// Fallback: use name or model ID
	const modelName = rawModel.name || rawModel.id
	const contextWindow = rawModel.context_length
	const ownedBy = rawModel.owned_by || "Baseten"

	if (contextWindow) {
		return `${ownedBy} ${modelName} with ${contextWindow.toLocaleString()} token context window`
	}

	return `${ownedBy} model: ${modelName}`
}
