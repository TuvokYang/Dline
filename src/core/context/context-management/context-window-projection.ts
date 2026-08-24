import sizeOf from "image-size"
import { shouldCompactProjectedUsage } from "./context-window-utils"

const TOKEN_ESTIMATE_BYTES = 4
const OPENAI_IMAGE_PATCH_PIXELS = 32

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
	let imageTokens = 0
	const normalized = JSON.stringify(input, (_key, value: unknown) => {
		if (!isBase64ImageSource(value) || !isOpenAiPatchImageModel(estimator)) return value
		const estimatedImageTokens = estimateOpenAiPatchImageTokens(value)
		if (estimatedImageTokens === undefined) return value
		imageTokens += estimatedImageTokens
		return { ...value, data: "" }
	})
	return Math.max(1, Math.ceil(Buffer.byteLength(normalized, "utf8") / TOKEN_ESTIMATE_BYTES) + imageTokens)
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

function estimateOpenAiPatchImageTokens(source: { type: "base64"; media_type: string; data: string }): number | undefined {
	try {
		const buffer = Buffer.from(source.data, "base64")
		const dimensions = sizeOf(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength))
		if (!dimensions.width || !dimensions.height) return undefined
		return Math.max(
			1,
			Math.ceil(dimensions.width / OPENAI_IMAGE_PATCH_PIXELS) * Math.ceil(dimensions.height / OPENAI_IMAGE_PATCH_PIXELS),
		)
	} catch {
		return undefined
	}
}

function isOpenAiPatchImageModel(estimator: ContextWindowCandidateEstimator): boolean {
	if (estimator.providerId !== "openai") return false
	return ["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"].includes(estimator.modelId?.toLowerCase() ?? "")
}

function normalizeTokens(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
