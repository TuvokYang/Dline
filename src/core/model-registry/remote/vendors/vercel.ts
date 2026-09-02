/**
 * Vercel AI Gateway `GET /v1/models`.
 *
 * The gateway aggregates other vendors, so the listing is authoritative and
 * replaces the stored catalog. It reports reasoning support only as a `tags`
 * entry, so the concrete thinking configuration is derived from the model id.
 */
import type { ModelCapabilities, ModelInfo, ModelPricing } from "@shared/providers/types"
import type { ProviderModelReconciliationMode } from "../../provider-model-reconciliation"
import { isRecord, ModelListingSource, readPerMillionPrice, readPositiveNumber, readString } from "../model-listing-source"
import type { ProviderRemoteContext } from "../model-source"

type ThinkingConfig = NonNullable<ModelInfo["capabilities"]>["thinking"]

function readTags(raw: unknown): string[] {
	if (!isRecord(raw) || !Array.isArray(raw.tags)) {
		return []
	}
	return raw.tags.filter((value): value is string => typeof value === "string")
}

/**
 * The gateway only publishes a `reasoning` tag, so the mode, budget and effort
 * levels are derived from the model id to match what each upstream accepts.
 */
export function deriveThinkingConfig(modelId: string, tags: string[]): ThinkingConfig {
	if (!tags.includes("reasoning")) {
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

export class VercelAiGatewayModelSource extends ModelListingSource {
	readonly providerId = "vercel-ai-gateway"
	readonly providerName = "Vercel AI Gateway"
	/** The gateway lists its catalog publicly. */
	override readonly requiresApiKey = false
	override readonly reconciliation: ProviderModelReconciliationMode = "replace"
	protected override readonly defaultBaseUrl = "https://ai-gateway.vercel.sh/v1"

	/** `include_mappings` makes the gateway report the upstream model ids. */
	protected override buildListingUrl(context: ProviderRemoteContext): string {
		return `${super.buildListingUrl(context)}?include_mappings=true`
	}

	protected override isChatModel(raw: unknown): boolean {
		if (!isRecord(raw) || raw.type === "embedding") {
			return false
		}
		return typeof raw.id === "string" && raw.id.length > 0
	}

	protected override readModelName(raw: unknown, modelId: string): string {
		return readString(raw, "name") ?? modelId
	}

	protected override readDescription(raw: unknown): string {
		return readString(raw, "description") ?? ""
	}

	protected override readContextWindow(raw: unknown): number | undefined {
		return readPositiveNumber(raw, "context_window")
	}

	protected override readMaxTokens(raw: unknown): number | undefined {
		return readPositiveNumber(raw, "max_tokens")
	}

	protected override readCapabilities(raw: unknown): ModelCapabilities {
		const modelId = this.readModelId(raw) ?? ""
		const cacheReadsPrice = readPerMillionPrice(raw, "pricing.input_cache_read")
		const cacheWritesPrice = readPerMillionPrice(raw, "pricing.input_cache_write")

		return {
			maxTokens: this.readMaxTokens(raw) ?? 0,
			contextWindow: this.readContextWindow(raw) ?? 0,
			// The gateway does not report image support, so assume every model has it.
			supportsImages: true,
			supportsPromptCache: cacheReadsPrice !== undefined && cacheWritesPrice !== undefined,
			thinking: deriveThinkingConfig(modelId, readTags(raw)),
		}
	}

	protected override readPricing(raw: unknown): ModelPricing {
		return {
			inputPrice: readPerMillionPrice(raw, "pricing.input") ?? 0,
			outputPrice: readPerMillionPrice(raw, "pricing.output") ?? 0,
			cacheWritesPrice: readPerMillionPrice(raw, "pricing.input_cache_write") ?? 0,
			cacheReadsPrice: readPerMillionPrice(raw, "pricing.input_cache_read") ?? 0,
		}
	}
}

export const vercelAiGatewayModelSource = new VercelAiGatewayModelSource()
