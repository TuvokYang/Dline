import { Logger } from "@shared/services/Logger"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { fetch } from "@/shared/net"

/** Official npm dist-tag endpoint used by sub2api to discover the current Codex CLI version. */
export const OPENAI_CODEX_CLIENT_VERSION_REGISTRY_URL = "https://registry.npmjs.org/@openai/codex/latest"

/** Known-good floor required to keep the GPT-6-Astra catalog entry visible. */
export const OPENAI_CODEX_MODEL_LIST_MINIMUM_VERSION = "0.153.0"

export const OPENAI_CODEX_CLIENT_VERSION_SUCCESS_TTL_MS = 60 * 60 * 1000
export const OPENAI_CODEX_CLIENT_VERSION_FAILURE_TTL_MS = 5 * 60 * 1000
export const OPENAI_CODEX_CLIENT_VERSION_REQUEST_TIMEOUT_MS = 5_000

interface ParsedVersion {
	readonly value: string
	readonly core: readonly [number, number, number]
	readonly prerelease: readonly string[]
}

interface VersionCacheEntry {
	readonly version: string
	readonly expiresAt: number
}

export interface OpenAiCodexClientVersionSource {
	resolve(signal?: AbortSignal): Promise<string>
}

export interface OpenAiCodexClientVersionResolverOptions {
	readonly fetchImpl?: typeof globalThis.fetch
	readonly now?: () => number
	readonly minimumVersion?: string
	readonly registryUrl?: string
	readonly successTtlMs?: number
	readonly failureTtlMs?: number
	readonly timeoutMs?: number
}

const SEMVER_PATTERN =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const NUMERIC_IDENTIFIER_PATTERN = /^(0|[1-9]\d*)$/

function parseVersion(value: string): ParsedVersion | undefined {
	const normalized = value.trim()
	const match = SEMVER_PATTERN.exec(normalized)
	if (!match) return undefined
	const core = [Number(match[1]), Number(match[2]), Number(match[3])] as const
	if (core.some((part) => !Number.isSafeInteger(part))) return undefined
	return {
		value: normalized,
		core,
		prerelease: match[4]?.split(".") ?? [],
	}
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
	if (left.length === 0 || right.length === 0) {
		if (left.length === right.length) return 0
		return left.length === 0 ? 1 : -1
	}
	const count = Math.max(left.length, right.length)
	for (let index = 0; index < count; index++) {
		const leftPart = left[index]
		const rightPart = right[index]
		if (leftPart === undefined || rightPart === undefined) {
			if (leftPart === rightPart) return 0
			return leftPart === undefined ? -1 : 1
		}
		if (leftPart === rightPart) continue
		const leftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(leftPart)
		const rightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(rightPart)
		if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart)
		if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
		return leftPart < rightPart ? -1 : 1
	}
	return 0
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
	for (let index = 0; index < left.core.length; index++) {
		const difference = left.core[index] - right.core[index]
		if (difference !== 0) return difference
	}
	return comparePrerelease(left.prerelease, right.prerelease)
}

function highestVersion(minimumVersion: string, ...candidates: Array<string | undefined>): string {
	let selected = parseVersion(minimumVersion)
	if (!selected) throw new Error(`Invalid OpenAI Codex minimum client version: ${minimumVersion}`)
	for (const candidate of candidates) {
		if (!candidate) continue
		const parsed = parseVersion(candidate)
		if (parsed && compareVersions(parsed, selected) > 0) selected = parsed
	}
	return selected.value
}

function readRegistryVersion(payload: unknown): string | undefined {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined
	const version = (payload as Record<string, unknown>).version
	return typeof version === "string" && parseVersion(version) ? version.trim() : undefined
}

function aborted(signal: AbortSignal): Error {
	return signal.reason instanceof Error ? signal.reason : new DOMException("The operation was aborted", "AbortError")
}

function waitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise
	if (signal.aborted) return Promise.reject(aborted(signal))
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(aborted(signal))
		signal.addEventListener("abort", onAbort, { once: true })
		promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort))
	})
}

/** Resolves and caches the current Codex CLI version without making model discovery depend on npm availability. */
export class OpenAiCodexClientVersionResolver implements OpenAiCodexClientVersionSource {
	private readonly fetchImpl: typeof globalThis.fetch
	private readonly now: () => number
	private readonly minimumVersion: string
	private readonly registryUrl: string
	private readonly successTtlMs: number
	private readonly failureTtlMs: number
	private readonly timeoutMs: number
	private cache: VersionCacheEntry | undefined
	private inFlight: Promise<string> | undefined

	constructor(options: OpenAiCodexClientVersionResolverOptions = {}) {
		this.fetchImpl = options.fetchImpl ?? fetch
		this.now = options.now ?? Date.now
		this.minimumVersion = highestVersion(options.minimumVersion ?? OPENAI_CODEX_MODEL_LIST_MINIMUM_VERSION)
		this.registryUrl = options.registryUrl ?? OPENAI_CODEX_CLIENT_VERSION_REGISTRY_URL
		this.successTtlMs = Math.max(1, options.successTtlMs ?? OPENAI_CODEX_CLIENT_VERSION_SUCCESS_TTL_MS)
		this.failureTtlMs = Math.max(1, options.failureTtlMs ?? OPENAI_CODEX_CLIENT_VERSION_FAILURE_TTL_MS)
		this.timeoutMs = Math.max(1, options.timeoutMs ?? OPENAI_CODEX_CLIENT_VERSION_REQUEST_TIMEOUT_MS)
	}

	resolve(signal?: AbortSignal): Promise<string> {
		const cached = this.cache
		if (cached && this.now() < cached.expiresAt) return waitForCaller(Promise.resolve(cached.version), signal)
		if (!this.inFlight) {
			const refresh = this.refresh().finally(() => {
				if (this.inFlight === refresh) this.inFlight = undefined
			})
			this.inFlight = refresh
		}
		const inFlight = this.inFlight
		if (!inFlight) return waitForCaller(Promise.resolve(this.minimumVersion), signal)
		return waitForCaller(inFlight, signal)
	}

	private async refresh(): Promise<string> {
		const previousVersion = this.cache?.version
		const fallback = highestVersion(this.minimumVersion, previousVersion)
		try {
			const response = await this.fetchImpl(this.registryUrl, {
				headers: buildExternalBasicHeaders(),
				signal: AbortSignal.timeout(this.timeoutMs),
			})
			if (!response.ok) throw new Error(`status_${response.status}`)
			const registryVersion = readRegistryVersion(await response.json())
			if (!registryVersion) throw new Error("invalid_version_payload")
			const version = highestVersion(this.minimumVersion, previousVersion, registryVersion)
			this.cache = { version, expiresAt: this.now() + this.successTtlMs }
			Logger.debug(
				`[OpenAiCodexClientVersionResolver] Registry resolved registryVersion=${registryVersion} selectedVersion=${version} floorApplied=${version !== registryVersion}`,
			)
			return version
		} catch (error) {
			this.cache = { version: fallback, expiresAt: this.now() + this.failureTtlMs }
			const reason = error instanceof Error ? error.message : "unknown_error"
			Logger.debug(`[OpenAiCodexClientVersionResolver] Registry unavailable; using version=${fallback} reason=${reason}`)
			return fallback
		}
	}
}

export const openAiCodexClientVersionResolver = new OpenAiCodexClientVersionResolver()
