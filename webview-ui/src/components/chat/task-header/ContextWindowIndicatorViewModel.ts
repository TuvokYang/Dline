import type { ContextWindowIndicatorSnapshot } from "@shared/context-window-indicator"

export type ContextWindowSegmentKind = "durable" | "sending" | "receiving" | "environment"

export interface ContextWindowSegmentViewModel {
	kind: ContextWindowSegmentKind
	label: string
	authoritativeTokens: number
	displayTokens: number
	visualTokens: number
	widthPercent: number
}

export interface ContextWindowIndicatorViewModel {
	contextWindow: number
	totalTokens: number
	percentage: number
	remainingTokens: number
	displayDenominator: number
	minorGroupFactor: number
	segments: ContextWindowSegmentViewModel[]
}

export interface ContextWindowIndicatorDisplayTokens {
	sending?: number
	receiving?: number
}

const MAX_MINOR_GROUP_FACTOR = 3

const SEGMENT_LABELS: Record<ContextWindowSegmentKind, string> = {
	durable: "Durable",
	sending: "Sending",
	receiving: "Receiving",
	environment: "ENV",
}

/** Build the single presentation model shared by the bar, totals, accessibility, and hover details. */
export function createContextWindowIndicatorViewModel(
	snapshot: ContextWindowIndicatorSnapshot,
	displayTokens: ContextWindowIndicatorDisplayTokens = {},
): ContextWindowIndicatorViewModel {
	const contextWindow = normalizeTokens(snapshot.contextWindow)
	const authoritativeTokens = {
		durable: normalizeTokens(snapshot.durableContextTokens),
		sending: normalizeTokens(snapshot.pendingSendTokens),
		receiving: normalizeTokens(snapshot.receivingTokens),
		environment: normalizeTokens(snapshot.environmentTokens),
	}
	const displayedTokens = {
		durable: authoritativeTokens.durable,
		sending: normalizeTokens(displayTokens.sending ?? authoritativeTokens.sending),
		receiving: normalizeTokens(displayTokens.receiving ?? authoritativeTokens.receiving),
		environment: authoritativeTokens.environment,
	}
	const totalTokens = Object.values(authoritativeTokens).reduce((total, tokens) => total + tokens, 0)
	const displayTotal = Object.values(displayedTokens).reduce((total, tokens) => total + tokens, 0)
	const displayDenominator = Math.max(contextWindow, totalTokens, displayTotal)
	const minorGroupTotal = displayedTokens.sending + displayedTokens.receiving + displayedTokens.environment
	const availableMinorSpace = Math.max(0, displayDenominator - displayedTokens.durable)
	const minorGroupFactor =
		minorGroupTotal > 0
			? Math.min(MAX_MINOR_GROUP_FACTOR, Math.max(1, availableMinorSpace / minorGroupTotal))
			: 1
	const segments = (Object.keys(SEGMENT_LABELS) as ContextWindowSegmentKind[]).map((kind) => {
		const visualTokens = kind === "durable" ? displayedTokens[kind] : Math.floor(displayedTokens[kind] * minorGroupFactor)
		return {
			kind,
			label: SEGMENT_LABELS[kind],
			authoritativeTokens: authoritativeTokens[kind],
			displayTokens: displayedTokens[kind],
			visualTokens,
			widthPercent: displayDenominator > 0 ? Math.min(100, (visualTokens / displayDenominator) * 100) : 0,
		}
	})

	return {
		contextWindow,
		totalTokens,
		percentage: contextWindow > 0 ? (totalTokens / contextWindow) * 100 : 0,
		remainingTokens: Math.max(0, contextWindow - totalTokens),
		displayDenominator,
		minorGroupFactor,
		segments,
	}
}

function normalizeTokens(value: number): number {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}
