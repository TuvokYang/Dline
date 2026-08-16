import { shouldCompactProjectedUsage } from "./context-window-utils"

const TOKEN_ESTIMATE_BYTES = 4

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

/** Estimate the complete provider-neutral request candidate. */
export function estimateContextWindowCandidate(input: EstimateContextWindowCandidateInput): number {
	return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(input), "utf8") / TOKEN_ESTIMATE_BYTES))
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

	if (latestReliableIndex >= 0) {
		const reliable = input.requestInfos[latestReliableIndex]
		baselineTokens = normalizeTokens(reliable.contextTokens)
		pressureSource = "provider"
		previousEstimatedTokens = normalizeTokens(reliable.estimatedContextTokens) || baselineTokens

		for (const requestInfo of input.requestInfos.slice(latestReliableIndex + 1)) {
			const estimatedTokens = normalizeTokens(requestInfo.estimatedContextTokens)
			if (estimatedTokens <= 0) continue
			pendingDeltaTokens += Math.max(0, estimatedTokens - previousEstimatedTokens)
			previousEstimatedTokens = Math.max(previousEstimatedTokens, estimatedTokens)
		}
	} else {
		const latestEstimate = findLatestEstimate(input.requestInfos)
		if (latestEstimate > 0) {
			baselineTokens = latestEstimate
			previousEstimatedTokens = latestEstimate
			pressureSource = "estimate"
		}
	}

	const candidateDeltaTokens =
		input.candidateDeltaTokens === undefined
			? Math.max(0, normalizedCandidateEstimate - previousEstimatedTokens)
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

function normalizeTokens(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
