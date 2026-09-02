import {
	OpenAiCodexProfileAuthRepository,
	type OpenAiOAuthCredentials,
	parseOpenAiOAuthCredentials,
} from "@/core/storage/secrets/OpenAiCodexProfileAuthRepository"
import { isOpenAiCodexCredentialExpired, OpenAiCodexOAuthTokenError } from "./strategy"

export type OpenAiCodexProfileAuthStatus =
	| "missing"
	| "malformed"
	| "legacy-shared"
	| "authenticated"
	| "refreshable-expired"
	| "reauthentication-required"

export interface OpenAiCodexCredentialContext {
	accessToken: string
	expires: number
	accountId?: string
}

export interface OpenAiCodexRefreshStrategy {
	refreshCredential(credential: OpenAiOAuthCredentials): Promise<OpenAiOAuthCredentials>
}

export type OpenAiCodexSessionErrorCode = "REFRESH_FAILED"

export class OpenAiCodexSessionError extends Error {
	constructor(
		public readonly code: OpenAiCodexSessionErrorCode,
		message: string,
	) {
		super(message)
		this.name = "OpenAiCodexSessionError"
	}
}

export interface OpenAiCodexProfileSessionRegistryOptions {
	repository?: OpenAiCodexProfileAuthRepository
	strategy: OpenAiCodexRefreshStrategy
	now?: () => number
}

function toContext(credential: OpenAiOAuthCredentials): OpenAiCodexCredentialContext {
	return {
		accessToken: credential.access_token,
		expires: credential.expires,
		...(credential.accountId !== undefined ? { accountId: credential.accountId } : {}),
	}
}

export class OpenAiCodexProfileSessionRegistry {
	readonly repository: OpenAiCodexProfileAuthRepository
	private readonly strategy: OpenAiCodexRefreshStrategy
	private readonly now: () => number
	private readonly refreshes = new Map<string, Promise<OpenAiCodexCredentialContext | null>>()
	private readonly reauthenticationRequired = new Set<string>()

	constructor(options: OpenAiCodexProfileSessionRegistryOptions) {
		this.repository = options.repository ?? new OpenAiCodexProfileAuthRepository()
		this.strategy = options.strategy
		this.now = options.now ?? Date.now
	}

	async getAuthStatus(profileId: string): Promise<OpenAiCodexProfileAuthStatus> {
		this.requireProfileId(profileId)
		if (this.reauthenticationRequired.has(profileId)) return "reauthentication-required"
		const current = await this.repository.read(profileId)
		if (current.status !== "valid") return current.status
		return isOpenAiCodexCredentialExpired(current.credential, this.now()) ? "refreshable-expired" : "authenticated"
	}

	async isAuthenticated(profileId: string): Promise<boolean> {
		const status = await this.getAuthStatus(profileId)
		return status === "authenticated" || status === "refreshable-expired"
	}

	async getCredentialContext(profileId: string): Promise<OpenAiCodexCredentialContext | null> {
		this.requireProfileId(profileId)
		const current = await this.repository.read(profileId)
		if (current.status !== "valid") return null
		this.reauthenticationRequired.delete(profileId)
		return isOpenAiCodexCredentialExpired(current.credential, this.now())
			? this.refresh(profileId, current.credential)
			: toContext(current.credential)
	}

	async forceRefreshCredentialContext(profileId: string): Promise<OpenAiCodexCredentialContext | null> {
		this.requireProfileId(profileId)
		const current = await this.repository.read(profileId)
		if (current.status !== "valid") return null
		this.reauthenticationRequired.delete(profileId)
		return this.refresh(profileId, current.credential)
	}

	async saveCredential(profileId: string, credential: OpenAiOAuthCredentials): Promise<void> {
		this.requireProfileId(profileId)
		await this.repository.save(profileId, parseOpenAiOAuthCredentials(credential))
		this.reauthenticationRequired.delete(profileId)
	}

	async clearCredential(profileId: string): Promise<void> {
		this.requireProfileId(profileId)
		await this.repository.delete(profileId)
		this.reauthenticationRequired.delete(profileId)
	}

	private refresh(profileId: string, sourceCredential: OpenAiOAuthCredentials): Promise<OpenAiCodexCredentialContext | null> {
		const pending = this.refreshes.get(profileId)
		if (pending) return pending
		const refresh = this.performRefresh(profileId, sourceCredential).finally(() => {
			if (this.refreshes.get(profileId) === refresh) this.refreshes.delete(profileId)
		})
		this.refreshes.set(profileId, refresh)
		return refresh
	}

	private async performRefresh(
		profileId: string,
		sourceCredential: OpenAiOAuthCredentials,
	): Promise<OpenAiCodexCredentialContext | null> {
		let refreshed: OpenAiOAuthCredentials
		try {
			refreshed = parseOpenAiOAuthCredentials(await this.strategy.refreshCredential(sourceCredential))
		} catch (error) {
			if (error instanceof OpenAiCodexOAuthTokenError && error.isInvalidGrant()) {
				const deleted = await this.repository.deleteIfMatches(profileId, sourceCredential)
				if (deleted === "deleted") this.reauthenticationRequired.add(profileId)
				return this.readLatestContext(profileId)
			}
			throw new OpenAiCodexSessionError("REFRESH_FAILED", "The OAuth credential could not be refreshed.")
		}

		const replaced = await this.repository.replaceIfMatches(profileId, sourceCredential, refreshed)
		if (replaced === "saved") {
			this.reauthenticationRequired.delete(profileId)
			return toContext(refreshed)
		}
		return this.readLatestContext(profileId)
	}

	private async readLatestContext(profileId: string): Promise<OpenAiCodexCredentialContext | null> {
		const latest = await this.repository.read(profileId)
		if (latest.status !== "valid") return null
		this.reauthenticationRequired.delete(profileId)
		return toContext(latest.credential)
	}

	private requireProfileId(profileId: string): void {
		if (typeof profileId !== "string" || profileId.length === 0) {
			throw new Error("OpenAI Codex OAuth requires a non-empty profile ID.")
		}
	}
}
