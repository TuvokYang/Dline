import { createHash } from "node:crypto"
import type { E2EMockApiProtocol, E2EMockProviderTarget } from "./api"

const TOKEN_ESTIMATE_BYTES = 4
const PREFIX_REGRESSION_RATIO = 0.8
const PREFIX_REGRESSION_MIN_TOKENS = 32
const PLATEAU_OBSERVATION_COUNT = 3
const PLATEAU_GROWTH_MIN_TOKENS = 64
const CACHE_READ_GROWTH_TOLERANCE = 4

const OPENAI_TARGETS = new Set<E2EMockProviderTarget>([
	"openai-compatible-chat",
	"openai-compatible-responses",
	"openai-official-responses",
])

export interface OpenAiCacheUsage {
	readonly inputTokens: number
	readonly cacheReadTokens?: number
	readonly cacheWriteTokens?: number
}

export type MockCacheWarningCode = "identity_changed" | "prefix_regression" | "cache_plateau" | "warm_cache_miss"

export interface MockCacheWarning {
	readonly code: MockCacheWarningCode
	readonly message: string
	readonly target: E2EMockProviderTarget
	readonly requestIndex: number
	readonly previousCacheReadTokens?: number
	readonly cacheReadTokens: number
	readonly totalInputTokens: number
}

export interface MockCacheDiagnostic {
	readonly state: "cold" | "warm" | "miss" | "regressed" | "plateau"
	readonly identity: string
	readonly totalInputTokens: number
	readonly reusablePrefixTokens: number
	readonly cacheReadTokens: number
	readonly cacheWriteTokens: number
	readonly warnings: readonly MockCacheWarning[]
}

interface CacheRequestProjection {
	readonly identity: string
	readonly promptText: string
}

interface CacheObservation {
	readonly requestIndex: number
	readonly identity: string
	readonly promptText: string
	readonly totalInputTokens: number
	readonly reusablePrefixTokens: number
	readonly cacheReadTokens: number
}

interface TargetCacheState {
	readonly observations: CacheObservation[]
	readonly highWaterPrefixByIdentity: Map<string, number>
	lastIdentity?: string
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function estimateTokens(text: string): number {
	return text.length === 0 ? 0 : Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / TOKEN_ESTIMATE_BYTES))
}

function commonPrefixLength(left: string, right: string): number {
	const limit = Math.min(left.length, right.length)
	let index = 0
	while (index < limit && left[index] === right[index]) index++
	return index
}

function stableSerialize(value: unknown): string {
	if (value === undefined) return "undefined"
	if (value === null || typeof value !== "object") return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
		.join(",")}}`
}

function hashProjection(value: unknown): string {
	return createHash("sha256").update(stableSerialize(value)).digest("hex").slice(0, 16)
}

function createProjection(protocol: E2EMockApiProtocol, requestBody: unknown): CacheRequestProjection | undefined {
	if (protocol !== "openai-chat" && protocol !== "openai-responses") return undefined
	const body = asRecord(requestBody)
	if (!body) return undefined

	const promptCacheKey = typeof body.prompt_cache_key === "string" ? body.prompt_cache_key : undefined
	const promptContent = protocol === "openai-chat" ? body.messages : body.input
	const identityProjection = {
		protocol,
		model: body.model,
		promptCacheKey,
		include: body.include,
		reasoning: body.reasoning,
		serviceTier: body.service_tier,
	}
	const promptProjection = {
		instructions: body.instructions,
		tools: body.tools,
		content: promptContent,
	}

	return {
		identity: `${promptCacheKey ?? "auto"}:${hashProjection(identityProjection)}`,
		promptText: stableSerialize(promptProjection),
	}
}

function createWarning(
	code: MockCacheWarningCode,
	message: string,
	target: E2EMockProviderTarget,
	requestIndex: number,
	usage: { totalInputTokens: number; cacheReadTokens: number; previousCacheReadTokens?: number },
): MockCacheWarning {
	return {
		code,
		message,
		target,
		requestIndex,
		...(usage.previousCacheReadTokens === undefined ? {} : { previousCacheReadTokens: usage.previousCacheReadTokens }),
		cacheReadTokens: usage.cacheReadTokens,
		totalInputTokens: usage.totalInputTokens,
	}
}

function hasCachePlateau(observations: readonly CacheObservation[]): boolean {
	if (observations.length < PLATEAU_OBSERVATION_COUNT) return false
	const window = observations.slice(-PLATEAU_OBSERVATION_COUNT)
	const first = window[0]
	const last = window.at(-1)!
	const inputGrowth = last.totalInputTokens - first.totalInputTokens
	const cacheReadValues = window.map(({ cacheReadTokens }) => cacheReadTokens)
	const cacheReadSpread = Math.max(...cacheReadValues) - Math.min(...cacheReadValues)
	return first.cacheReadTokens > 0 && inputGrowth >= PLATEAU_GROWTH_MIN_TOKENS && cacheReadSpread <= CACHE_READ_GROWTH_TOLERANCE
}

/** Track semantic OpenAI prompt prefixes and expose deterministic cache anomaly diagnostics for E2E tests. */
export class OpenAiCacheDiagnostics {
	private readonly states = new Map<E2EMockProviderTarget, TargetCacheState>()
	private readonly warnings: MockCacheWarning[] = []

	public observe(
		target: E2EMockProviderTarget,
		protocol: E2EMockApiProtocol,
		requestBody: unknown,
		usage: OpenAiCacheUsage,
	): MockCacheDiagnostic | undefined {
		if (!OPENAI_TARGETS.has(target)) return undefined
		const projection = createProjection(protocol, requestBody)
		if (!projection) return undefined

		const state = this.getOrCreateState(target)
		const requestIndex = state.observations.length
		const previous = state.observations.at(-1)
		const sameIdentityHistory = state.observations.filter(({ identity }) => identity === projection.identity)
		const reusablePrefixTokens = sameIdentityHistory.reduce((highest, observation) => {
			const sharedText = projection.promptText.slice(
				0,
				commonPrefixLength(observation.promptText, projection.promptText),
			)
			return Math.max(highest, estimateTokens(sharedText))
		}, 0)
		const totalInputTokens = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
		const cacheReadTokens = usage.cacheReadTokens ?? 0
		const cacheWriteTokens = usage.cacheWriteTokens ?? 0
		const highWaterPrefix = state.highWaterPrefixByIdentity.get(projection.identity) ?? 0
		const currentWarnings: MockCacheWarning[] = []
		const warningUsage = {
			totalInputTokens,
			cacheReadTokens,
			...(previous ? { previousCacheReadTokens: previous.cacheReadTokens } : {}),
		}

		if (state.lastIdentity && state.lastIdentity !== projection.identity) {
			currentWarnings.push(
				createWarning(
					"identity_changed",
					"OpenAI prompt cache identity changed after a successful request; expect a new cache partition or cold start.",
					target,
					requestIndex,
					warningUsage,
				),
			)
		}

		const regressed =
			sameIdentityHistory.length > 0 &&
			highWaterPrefix >= PREFIX_REGRESSION_MIN_TOKENS &&
			reusablePrefixTokens < highWaterPrefix * PREFIX_REGRESSION_RATIO
		if (regressed) {
			currentWarnings.push(
				createWarning(
					"prefix_regression",
					`Reusable OpenAI prompt prefix regressed from ${highWaterPrefix} to ${reusablePrefixTokens} estimated tokens.`,
					target,
					requestIndex,
					warningUsage,
				),
			)
		}

		const warmMiss = sameIdentityHistory.length > 0 && cacheReadTokens === 0
		if (warmMiss) {
			currentWarnings.push(
				createWarning(
					"warm_cache_miss",
					"OpenAI reported zero cache-read tokens for an identity that already has successful request history.",
					target,
					requestIndex,
					warningUsage,
				),
			)
		}

		const observation: CacheObservation = {
			requestIndex,
			identity: projection.identity,
			promptText: projection.promptText,
			totalInputTokens,
			reusablePrefixTokens,
			cacheReadTokens,
		}
		state.observations.push(observation)
		state.highWaterPrefixByIdentity.set(projection.identity, Math.max(highWaterPrefix, reusablePrefixTokens))
		state.lastIdentity = projection.identity

		const identityObservations = state.observations.filter(({ identity }) => identity === projection.identity)
		const plateau = hasCachePlateau(identityObservations)
		if (plateau) {
			currentWarnings.push(
				createWarning(
					"cache_plateau",
					`OpenAI cache reads remained near ${cacheReadTokens} tokens while total input grew across ${PLATEAU_OBSERVATION_COUNT} requests.`,
					target,
					requestIndex,
					warningUsage,
				),
			)
		}

		this.warnings.push(...currentWarnings)
		return {
			state: plateau
				? "plateau"
				: regressed
					? "regressed"
					: warmMiss
						? "miss"
						: sameIdentityHistory.length === 0
							? "cold"
							: "warm",
			identity: projection.identity,
			totalInputTokens,
			reusablePrefixTokens,
			cacheReadTokens,
			cacheWriteTokens,
			warnings: currentWarnings,
		}
	}

	public getWarnings(target?: E2EMockProviderTarget): readonly MockCacheWarning[] {
		return target ? this.warnings.filter((warning) => warning.target === target) : this.warnings
	}

	public reset(): void {
		this.states.clear()
		this.warnings.length = 0
	}

	private getOrCreateState(target: E2EMockProviderTarget): TargetCacheState {
		const existing = this.states.get(target)
		if (existing) return existing
		const state: TargetCacheState = {
			observations: [],
			highWaterPrefixByIdentity: new Map<string, number>(),
		}
		this.states.set(target, state)
		return state
	}
}
