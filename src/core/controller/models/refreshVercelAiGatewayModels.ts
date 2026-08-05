import { ModelRegistry } from "@core/model-registry/ModelRegistry"
import { getProviderConfigFileName } from "@core/model-registry/provider-config-file"
import { ensureCacheDirectoryExists, GlobalFileNames } from "@core/storage/disk"
import { ModelInfo } from "@shared/api"
import type { ProviderModelsConfig } from "@shared/providers/types"
import { fileExistsAtPath } from "@utils/fs"
import axios from "axios"
import fs from "fs/promises"
import path from "path"
import { StateManager } from "@/core/storage/StateManager"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

const VERCEL_PROVIDER_ID = "vercel-ai-gateway"

/**
 * Derives thinkingConfig from model ID and tags.
 * The Vercel API only provides a "reasoning" tag to indicate support,
 * so we derive the specific configuration based on model patterns.
 */
function deriveThinkingConfig(modelId: string, tags?: string[]): NonNullable<ModelInfo["capabilities"]>["thinking"] {
	if (!tags?.includes("reasoning")) {
		return undefined
	}

	// Anthropic Claude models — budget mode
	if (modelId.startsWith("anthropic/claude")) {
		return { supported: true, mode: "budget", maxBudget: 8192 }
	}

	// Google Gemini models — effort mode
	if (modelId.includes("gemini-3")) {
		return { supported: true, mode: "effort", maxBudget: 32767, effortLevels: ["high"] }
	}

	// DeepSeek R1 models — budget mode
	if (modelId.startsWith("deepseek/deepseek-r1")) {
		return { supported: true, mode: "budget", maxBudget: 8192 }
	}

	// OpenAI o-series reasoning models — effort mode
	if (modelId.startsWith("openai/o1") || modelId.startsWith("openai/o3")) {
		return { supported: true, mode: "effort", maxBudget: 32000, effortLevels: ["low", "medium", "high"] }
	}

	// Qwen QwQ models (specific IDs to match OpenRouter)
	if (modelId === "qwen/qwq-32b:free" || modelId === "qwen/qwq-32b") {
		return { supported: true, mode: "budget", maxBudget: 32000 }
	}

	// Default for other reasoning models
	return { supported: true, mode: "budget", maxBudget: 32000 }
}

/**
 * Derives recommended temperature for specific model types.
 * Returns undefined to use the default (0).
 */
function _deriveTemperature(modelId: string): number | undefined {
	// DeepSeek R1 and similar reasoning models recommend 0.7
	// Use specific model IDs to match OpenRouter behavior
	if (
		modelId.startsWith("deepseek/deepseek-r1") ||
		modelId === "perplexity/sonar-reasoning" ||
		modelId === "qwen/qwq-32b:free" ||
		modelId === "qwen/qwq-32b"
	) {
		return 0.7
	}

	// Gemini 3 models recommend temperature 1.0
	if (modelId.startsWith("google/gemini-3")) {
		return 1.0
	}

	return undefined
}

// Track pending refresh promise to prevent duplicate concurrent fetches
let pendingRefresh: Promise<Record<string, ModelInfo>> | null = null

/**
 * Core function: Refreshes Vercel AI Gateway models and returns application types
 * @param controller The controller used to persist models and update the Webview
 * @returns Record of model ID to ModelInfo (application types)
 */
export async function refreshVercelAiGatewayModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	// Check in-memory cache first
	const cache = StateManager.get().getModelsCache("vercel")
	if (cache) {
		await persistVercelProviderModels(controller, cache)
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

async function fetchAndCacheModels(controller: Controller): Promise<Record<string, ModelInfo>> {
	const vercelAiGatewayModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.vercelAiGatewayModels)

	let models: Record<string, ModelInfo> = {}

	try {
		const response = await axios.get("https://ai-gateway.vercel.sh/v1/models?include_mappings=true", getAxiosSettings())

		if (response.data?.data) {
			const rawModels = response.data.data
			const parsePrice = (price: any) => {
				if (price) {
					return Number.parseFloat(price) * 1_000_000
				}
				return undefined
			}

			for (const rawModel of rawModels) {
				const modelId = typeof rawModel.id === "string" ? rawModel.id : undefined
				if (!modelId || rawModel.type === "embedding") {
					continue
				}

				const modelInfo: ModelInfo = {
					id: modelId,
					name: typeof rawModel.name === "string" ? rawModel.name : modelId,
					description: rawModel.description ?? "",
					capabilities: {
						maxTokens: rawModel.max_tokens ?? 0,
						contextWindow: rawModel.context_window ?? 0,
						supportsImages: true, // assume all models support images since vercel ai doesn't give this info
						supportsPromptCache: !!(rawModel.pricing?.input_cache_read && rawModel.pricing?.input_cache_write),
						thinking: deriveThinkingConfig(modelId, rawModel.tags),
					},
					pricing: {
						inputPrice: parsePrice(rawModel.pricing?.input) ?? 0,
						outputPrice: parsePrice(rawModel.pricing?.output) ?? 0,
						cacheWritesPrice: parsePrice(rawModel.pricing?.input_cache_write) ?? 0,
						cacheReadsPrice: parsePrice(rawModel.pricing?.input_cache_read) ?? 0,
					},
				}

				models[modelId] = modelInfo
			}

			await fs.writeFile(vercelAiGatewayModelsFilePath, JSON.stringify(models))
			Logger.log("Vercel AI Gateway models fetched and saved")
		} else {
			throw new Error("Invalid response from Vercel AI Gateway API")
		}
	} catch (error) {
		Logger.error("Error fetching Vercel AI Gateway models:", error)

		// If we failed to fetch models, try to read cached models
		const cachedModels = (await readVercelAiGatewayModels()) ?? readPersistedVercelProviderModels()
		if (cachedModels) {
			models = cachedModels
		}
	}

	if (Object.keys(models).length > 0) {
		await persistVercelProviderModels(controller, models)
	}

	// Store in StateManager's in-memory cache
	StateManager.get().setModelsCache("vercel", models)

	return models
}

function readPersistedVercelProviderModels(): Record<string, ModelInfo> | undefined {
	const models = ModelRegistry.getInstance().getProviderModels(VERCEL_PROVIDER_ID)?.models
	return models && Object.keys(models).length > 0 ? models : undefined
}

/** Persist the dynamic catalog where ModelRegistry and provider editors preload it. */
export async function persistVercelProviderModels(controller: Controller, models: Record<string, ModelInfo>): Promise<void> {
	const registry = ModelRegistry.getInstance()
	const existing = registry.getProviderModels(VERCEL_PROVIDER_ID)
	const remoteModels = Object.fromEntries(
		Object.entries(models).map(([modelId, model]) => [
			modelId,
			{ ...model, id: modelId, name: model.name || modelId, userDefined: false },
		]),
	)
	const persistedModels = remoteModels
	const modelIds = Object.keys(persistedModels).sort((left, right) => left.localeCompare(right))
	const defaultModelId =
		existing?.defaultModelId && persistedModels[existing.defaultModelId] ? existing.defaultModelId : modelIds[0]
	const config: ProviderModelsConfig = {
		provider: VERCEL_PROVIDER_ID,
		providerName: "Vercel AI Gateway",
		baseUrl: "https://ai-gateway.vercel.sh/v1",
		billingMode: "token",
		models: persistedModels,
		...(defaultModelId ? { defaultModelId } : {}),
	}

	await fs.mkdir(registry.providersDir, { recursive: true })
	await fs.writeFile(
		path.join(registry.providersDir, getProviderConfigFileName(VERCEL_PROVIDER_ID)),
		JSON.stringify(config, null, "\t"),
		"utf8",
	)
	await registry.reload()
	await controller.postStateToWebview()
}

/**
 * Reads cached Vercel AI Gateway models from disk (application types)
 */
async function readVercelAiGatewayModels(): Promise<Record<string, ModelInfo> | undefined> {
	const vercelAiGatewayModelsFilePath = path.join(await ensureCacheDirectoryExists(), GlobalFileNames.vercelAiGatewayModels)
	const fileExists = await fileExistsAtPath(vercelAiGatewayModelsFilePath)
	if (fileExists) {
		try {
			const fileContents = await fs.readFile(vercelAiGatewayModelsFilePath, "utf8")
			return JSON.parse(fileContents)
		} catch (error) {
			Logger.error("Error reading cached Vercel AI Gateway models:", error)
			return undefined
		}
	}
	return undefined
}
