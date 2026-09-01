import sizeOf from "image-size"
import { shouldCompactProjectedUsage } from "./context-window-utils"

const TOKEN_ESTIMATE_BYTES = 4
const OPENAI_IMAGE_PATCH_PIXELS = 32
/** Anthropic documents image cost as width * height / 750; used as the conservative default. */
const AREA_IMAGE_TOKENS_PER_PIXEL_DIVISOR = 750
/**
 * Conservative cost applied when image dimensions cannot be decoded.
 *
 * Charging the raw base64 payload as text instead would inflate a single screenshot by an order of
 * magnitude and can push an otherwise feasible request past the context window.
 */
const IMAGE_TOKEN_FALLBACK = 1600

/**
 * How a provider prices an image once the canonical base64 block has been transformed.
 *
 * No supported provider charges the base64 string as text, so estimation always drops the payload
 * and substitutes a dimension-derived cost regardless of provider.
 */
type ImageTokenModel = "openai_patch" | "area"

export type ContextPressureSource = "provider" | "estimate" | "unavailable"

export interface ContextWindowRequestPressure {
	contextTokens?: number
	estimatedContextTokens?: number
	contextTokensSource?: "provider" | "estimate"
	cancelReason?: string
}

export interface EstimateContextWindowCandidateInput {
	systemPrompt: string
	messages: unknown
	tools?: unknown
	serverTools?: unknown
}

export interface ContextWindowCandidateEstimator {
	providerId?: string
	modelId?: string
}

export interface ContextWindowCandidateBreakdown {
	totalTokens: number
	textTokens: number
	imageTokens: number
}

export interface ResolveContextWindowProjectionInput {
	requestInfos: readonly ContextWindowRequestPressure[]
	candidateEstimatedTokens: number
	candidateDeltaTokens?: number
	contextWindow: number
	triggerTokens: number
}

export interface ContextWindowProjection {
	baselineTokens: number
	pendingDeltaTokens: number
	candidateDeltaTokens: number
	projectedUsageTokens: number
	remainingTokens: number
	remainingRatio: number
	pressureSource: ContextPressureSource
	shouldCompact: boolean
}

/** Estimate the complete request candidate without charging binary image encoding as text. */
export function estimateContextWindowCandidate(
	input: EstimateContextWindowCandidateInput,
	estimator: ContextWindowCandidateEstimator = {},
): number {
	return estimateContextWindowCandidateBreakdown(input, estimator).totalTokens
}

/**
 * Same estimate as {@link estimateContextWindowCandidate}, exposing its text/image split.
 *
 * The split is diagnostic only: it lets a failed budget report distinguish "the input really is too
 * large" from "the estimate is dominated by image payloads".
 */
export function estimateContextWindowCandidateBreakdown(
	input: EstimateContextWindowCandidateInput,
	estimator: ContextWindowCandidateEstimator = {},
): ContextWindowCandidateBreakdown {
	const model = resolveImageTokenModel(estimator)
	let imageTokens = 0
	const normalized = JSON.stringify(input, (_key, value: unknown) => {
		if (!isBase64ImageSource(value)) return value
		imageTokens += estimateImageTokens(value, model)
		return { ...value, data: "" }
	})
	const textTokens = Math.ceil(Buffer.byteLength(normalized, "utf8") / TOKEN_ESTIMATE_BYTES)
	return { totalTokens: Math.max(1, textTokens + imageTokens), textTokens, imageTokens }
}

/** Resolve reliable usage, uncovered sent growth, and the current unsent candidate into one pressure projection. */
export function resolveContextWindowProjection(input: ResolveContextWindowProjectionInput): ContextWindowProjection {
	const normalizedWindow = normalizeTokens(input.contextWindow)
	const normalizedCandidateEstimate = normalizeTokens(input.candidateEstimatedTokens)
	const latestReliableIndex = findLatestReliableUsageIndex(input.requestInfos)

	let baselineTokens = 0
	let pendingDeltaTokens = 0
	let pressureSource: ContextPressureSource = "unavailable"
	let previousEstimatedTokens = 0
	let hasEstimateAnchor = false

	if (latestReliableIndex >= 0) {
		const reliable = input.requestInfos[latestReliableIndex]
		baselineTokens = normalizeTokens(reliable.contextTokens)
		pressureSource = "provider"
		previousEstimatedTokens = normalizeTokens(reliable.estimatedContextTokens)
		hasEstimateAnchor = previousEstimatedTokens > 0

		for (const requestInfo of input.requestInfos.slice(latestReliableIndex + 1)) {
			const estimatedTokens = normalizeTokens(requestInfo.estimatedContextTokens)
			if (estimatedTokens <= 0) continue
			if (!hasEstimateAnchor) {
				previousEstimatedTokens = estimatedTokens
				hasEstimateAnchor = true
				continue
			}
			pendingDeltaTokens += Math.max(0, estimatedTokens - previousEstimatedTokens)
			previousEstimatedTokens = Math.max(previousEstimatedTokens, estimatedTokens)
		}
	} else {
		const latestEstimate = findLatestEstimate(input.requestInfos)
		if (latestEstimate > 0) {
			baselineTokens = latestEstimate
			previousEstimatedTokens = latestEstimate
			hasEstimateAnchor = true
			pressureSource = "estimate"
		}
	}

	const candidateDeltaTokens =
		input.candidateDeltaTokens === undefined
			? hasEstimateAnchor
				? Math.max(0, normalizedCandidateEstimate - previousEstimatedTokens)
				: latestReliableIndex < 0
					? normalizedCandidateEstimate
					: Math.max(0, normalizedCandidateEstimate - baselineTokens)
			: normalizeTokens(input.candidateDeltaTokens)
	const projectedUsageTokens = baselineTokens + pendingDeltaTokens + candidateDeltaTokens
	const remainingTokens = Math.max(0, normalizedWindow - projectedUsageTokens)

	return {
		baselineTokens,
		pendingDeltaTokens,
		candidateDeltaTokens,
		projectedUsageTokens,
		remainingTokens,
		remainingRatio: normalizedWindow > 0 ? remainingTokens / normalizedWindow : 0,
		pressureSource,
		shouldCompact: shouldCompactProjectedUsage(projectedUsageTokens, input.triggerTokens),
	}
}

function findLatestReliableUsageIndex(requestInfos: readonly ContextWindowRequestPressure[]): number {
	for (let index = requestInfos.length - 1; index >= 0; index--) {
		const requestInfo = requestInfos[index]
		if (
			requestInfo.contextTokensSource !== "estimate" &&
			typeof requestInfo.contextTokens === "number" &&
			Number.isFinite(requestInfo.contextTokens) &&
			requestInfo.contextTokens > 0
		) {
			return index
		}
	}
	return -1
}

function findLatestEstimate(requestInfos: readonly ContextWindowRequestPressure[]): number {
	for (let index = requestInfos.length - 1; index >= 0; index--) {
		const estimatedTokens = normalizeTokens(requestInfos[index].estimatedContextTokens)
		if (estimatedTokens > 0) return estimatedTokens
	}
	return 0
}

function isBase64ImageSource(value: unknown): value is { type: "base64"; media_type: string; data: string } {
	if (typeof value !== "object" || value === null) return false
	const source = value as { type?: unknown; media_type?: unknown; data?: unknown }
	return (
		source.type === "base64" &&
		typeof source.media_type === "string" &&
		source.media_type.startsWith("image/") &&
		typeof source.data === "string"
	)
}

function estimateImageTokens(source: { type: "base64"; media_type: string; data: string }, model: ImageTokenModel): number {
	const dimensions = readImageDimensions(source.data)
	if (dimensions === undefined) return IMAGE_TOKEN_FALLBACK
	if (model === "openai_patch") {
		return Math.max(
			1,
			Math.ceil(dimensions.width / OPENAI_IMAGE_PATCH_PIXELS) * Math.ceil(dimensions.height / OPENAI_IMAGE_PATCH_PIXELS),
		)
	}
	return Math.max(1, Math.ceil((dimensions.width * dimensions.height) / AREA_IMAGE_TOKENS_PER_PIXEL_DIVISOR))
}

function readImageDimensions(data: string): { width: number; height: number } | undefined {
	try {
		const buffer = Buffer.from(data, "base64")
		const dimensions = sizeOf(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
		if (!dimensions.width || !dimensions.height) return undefined
		return { width: dimensions.width, height: dimensions.height }
	} catch {
		return undefined
	}
}

/**
 * Every provider gets a dimension-derived image cost; only the formula differs.
 *
 * The area model is the conservative default because it yields a slightly higher estimate than the
 * patch model at common screenshot resolutions, which is the safer bias for unknown providers.
 */
function resolveImageTokenModel(estimator: ContextWindowCandidateEstimator): ImageTokenModel {
	return isOpenAiPatchImageModel(estimator) ? "openai_patch" : "area"
}

function isOpenAiPatchImageModel(estimator: ContextWindowCandidateEstimator): boolean {
	if (estimator.providerId !== "openai") return false
	return ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(estimator.modelId?.toLowerCase() ?? "")
}

function normalizeTokens(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
