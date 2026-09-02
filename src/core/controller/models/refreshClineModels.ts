import { discoverProviderModels } from "@core/model-registry/remote/model-refresh"
import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import type { ModelInfo } from "@shared/api"
import { fileExistsAtPath } from "@utils/fs"
import { GEMINI_FLASH_MAX_OUTPUT_TOKENS, isGeminiFlashModel } from "@utils/model-utils"
import cloneDeep from "clone-deep"
import fs from "fs/promises"
import path from "path"
import { featureFlagsService } from "@/services/feature-flags"
import {
	CLAUDE_OPUS_1M_TIERS,
	CLAUDE_SONNET_1M_TIERS,
	openRouterClaudeOpus461mModelId,
	openRouterClaudeOpus471mModelId,
	openRouterClaudeSonnet41mModelId,
	openRouterClaudeSonnet451mModelId,
	openRouterClaudeSonnet461mModelId,
} from "@/shared/api"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from ".."
import { refreshOpenRouterModels } from "./refreshOpenRouterModels"

const CLINE_PROVIDER_ID = "cline"

// Track pending refresh promise to prevent duplicate concurrent fetches
let pendingRefresh: Promise<Record<string, ModelInfo>> | null = null

/**
 * Core function: Refreshes the Cline models and returns application types
 * @param controller The controller instance
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshClineModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	const shouldUseClineEndpointSource = featureFlagsService.getBooleanFlagEnabled(FeatureFlag.EXTENSION_CLINE_MODELS_ENDPOINT)
	if (!shouldUseClineEndpointSource) {
		return refreshOpenRouterModels(controller)
	}

	// If a fetch is already in progress, return the same promise
	if (pendingRefresh) {
		return pendingRefresh
	}

	// Start new fetch and track the promise
	pendingRefresh = (async () => {
		try {
			return await fetchAndCacheClineModels()
		} finally {
			// Clear pending promise when done (success or error)
			pendingRefresh = null
		}
	})()

	return pendingRefresh
}

async function fetchAndCacheClineModels(): Promise<Record<string, ModelInfo>> {
	const clineModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.clineModels)

	let models: Record<string, ModelInfo> = {}
	try {
		const discovered = await discoverProviderModels(CLINE_PROVIDER_ID)
		if (Object.keys(discovered).length === 0) {
			throw new Error("Invalid response data when fetching Cline models")
		}
		Logger.log("Cline models source: Cline API")

		for (const [modelId, listedModel] of Object.entries(discovered)) {
			// The listing is authoritative; the corrections below only add what it cannot express.
			const modelInfo = cloneDeep(listedModel)

			// Apply model-specific overrides for known models
			switch (modelId) {
				case "anthropic/claude-sonnet-4.6":
				case "anthropic/claude-4.6-sonnet":
				case "anthropic/claude-sonnet-4.5":
				case "anthropic/claude-4.5-sonnet":
				case "anthropic/claude-sonnet-4":
					modelInfo.capabilities!.contextWindow = 200_000
					modelInfo.capabilities!.supportsPromptCache = true
					modelInfo.pricing!.cacheWritesPrice = 3.75
					modelInfo.pricing!.cacheReadsPrice = 0.3
					break
				case "anthropic/claude-3-7-sonnet":
				case "anthropic/claude-3.7-sonnet":
				case "anthropic/claude-3.5-sonnet":
					modelInfo.capabilities!.supportsPromptCache = true
					modelInfo.pricing!.cacheWritesPrice = 3.75
					modelInfo.pricing!.cacheReadsPrice = 0.3
					break
				case "anthropic/claude-opus-4.6":
				case "anthropic/claude-opus-4.7":
					modelInfo.capabilities!.contextWindow = 200_000
					modelInfo.capabilities!.supportsPromptCache = true
					modelInfo.pricing!.cacheWritesPrice = 6.25
					modelInfo.pricing!.cacheReadsPrice = 0.5
					break
				case "anthropic/claude-opus-4.5":
					modelInfo.capabilities!.supportsPromptCache = true
					modelInfo.pricing!.cacheWritesPrice = 6.25
					modelInfo.pricing!.cacheReadsPrice = 0.5
					break
				case "anthropic/claude-opus-4.1":
				case "anthropic/claude-opus-4":
					modelInfo.capabilities!.supportsPromptCache = true
					modelInfo.pricing!.cacheWritesPrice = 18.75
					modelInfo.pricing!.cacheReadsPrice = 1.5
					break
				case "anthropic/claude-haiku-4.5":
				case "anthropic/claude-4.5-haiku":
				case "anthropic/claude-3-5-haiku":
				case "anthropic/claude-3.5-haiku":
					modelInfo.capabilities!.supportsPromptCache = true
					modelInfo.pricing!.cacheWritesPrice = 1.25
					modelInfo.pricing!.cacheReadsPrice = 0.1
					break
				case "deepseek/deepseek-chat":
					modelInfo.capabilities!.supportsPromptCache = true
					modelInfo.pricing!.inputPrice = 0
					modelInfo.pricing!.cacheWritesPrice = 0.14
					modelInfo.pricing!.cacheReadsPrice = 0.014
					break
				case "openai/gpt-5":
				case "openai/gpt-5-chat":
				case "openai/gpt-5-mini":
				case "openai/gpt-5-nano":
					modelInfo.capabilities!.maxTokens = 8_192
					modelInfo.capabilities!.contextWindow = 272_000
					break
				default:
					// OpenAI and Google publish cache prices in the listing, so the
					// prompt-cache flag follows from whether a cache read price came back.
					if (modelId.startsWith("openai/") || modelId.startsWith("google/")) {
						if (modelInfo.pricing?.cacheReadsPrice) {
							modelInfo.capabilities!.supportsPromptCache = true
						}
					}
					break
			}

			if (isGeminiFlashModel(modelId)) {
				modelInfo.capabilities!.maxTokens = Math.min(
					modelInfo.capabilities!.maxTokens || GEMINI_FLASH_MAX_OUTPUT_TOKENS,
					GEMINI_FLASH_MAX_OUTPUT_TOKENS,
				)
			}

			models[modelId] = modelInfo

			// Add custom :1m model variant for Sonnet models
			if (
				modelId === "anthropic/claude-sonnet-4" ||
				modelId === "anthropic/claude-sonnet-4.5" ||
				modelId === "anthropic/claude-sonnet-4.6" ||
				modelId === "anthropic/claude-4.6-sonnet"
			) {
				const claudeSonnet1mModelInfo = cloneDeep(modelInfo)
				claudeSonnet1mModelInfo.capabilities!.contextWindow = 1_000_000
				claudeSonnet1mModelInfo.pricing!.tiers = CLAUDE_SONNET_1M_TIERS

				if (modelId === "anthropic/claude-sonnet-4") {
					models[openRouterClaudeSonnet41mModelId] = claudeSonnet1mModelInfo
				}
				if (modelId === "anthropic/claude-sonnet-4.5") {
					models[openRouterClaudeSonnet451mModelId] = claudeSonnet1mModelInfo
				}
				if (modelId === "anthropic/claude-sonnet-4.6" || modelId === "anthropic/claude-4.6-sonnet") {
					models[openRouterClaudeSonnet461mModelId] = claudeSonnet1mModelInfo
				}
			}

			// Add custom :1m model variant for Opus 4.6 and 4.7
			if (modelId === "anthropic/claude-opus-4.6" || modelId === "anthropic/claude-opus-4.7") {
				const claudeOpus1mModelInfo = cloneDeep(modelInfo)
				claudeOpus1mModelInfo.capabilities!.contextWindow = 1_000_000
				claudeOpus1mModelInfo.pricing!.tiers = CLAUDE_OPUS_1M_TIERS
				if (modelId === "anthropic/claude-opus-4.6") {
					models[openRouterClaudeOpus461mModelId] = claudeOpus1mModelInfo
				}
				if (modelId === "anthropic/claude-opus-4.7") {
					models[openRouterClaudeOpus471mModelId] = claudeOpus1mModelInfo
				}
			}
		}
		// Save models and cache them in memory
		await fs.writeFile(clineModelsFilePath, JSON.stringify(models))
		Logger.log("Cline models fetched and saved")
	} catch (error) {
		Logger.error("Error fetching Cline models:", error)

		// If we failed to fetch models, try to read cached models from disk
		try {
			const fileExists = await fileExistsAtPath(clineModelsFilePath)
			if (fileExists) {
				const fileContents = await fs.readFile(clineModelsFilePath, "utf8")
				models = JSON.parse(fileContents)
				Logger.log("Loaded Cline models from cache")
			}
		} catch (cacheError) {
			Logger.error("Error reading Cline models from cache:", cacheError)
		}
	}

	return models
}

/**
 * Read cached Cline models from disk
 * @returns The cached models or undefined if not found
 */
export async function readClineModelsFromCache(): Promise<Record<string, ModelInfo> | undefined> {
	try {
		const clineModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.clineModels)
		const fileExists = await fileExistsAtPath(clineModelsFilePath)
		if (fileExists) {
			const fileContents = await fs.readFile(clineModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		}
	} catch (error) {
		Logger.error("Error reading Cline models from cache:", error)
	}
	return undefined
}
