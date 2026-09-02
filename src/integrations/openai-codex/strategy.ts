import { type OpenAiOAuthCredentials, parseOpenAiOAuthCredentials } from "@/core/storage/secrets/OpenAiCodexProfileAuthRepository"
import type { OAuthAuthorizationInput, OAuthAuthorizationStrategy, OAuthCodeExchangeInput } from "@/services/oauth"
import { fetch as proxyFetch } from "@/shared/net"

export const OPENAI_CODEX_OAUTH_CONFIG = {
	authorizationEndpoint: "https://auth.openai.com/oauth/authorize",
	tokenEndpoint: "https://auth.openai.com/oauth/token",
	clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
	scopes: "openid profile email offline_access",
	callbackPort: 1455,
	callbackPath: "/auth/callback",
} as const

export type OpenAiCodexOAuthTokenErrorCode =
	| "TOKEN_EXCHANGE_FAILED"
	| "TOKEN_REFRESH_FAILED"
	| "INVALID_GRANT"
	| "INVALID_TOKEN_RESPONSE"

export class OpenAiCodexOAuthTokenError extends Error {
	constructor(
		public readonly code: OpenAiCodexOAuthTokenErrorCode,
		message: string,
		public readonly status?: number,
	) {
		super(message)
		this.name = "OpenAiCodexOAuthTokenError"
	}

	isInvalidGrant(): boolean {
		return this.code === "INVALID_GRANT"
	}
}

export interface OpenAiCodexOAuthConfiguration {
	authorizationEndpoint: string
	tokenEndpoint: string
	clientId: string
	scopes: string
	callbackPort: number
	callbackPath: string
}

interface TokenResponse {
	accessToken: string
	refreshToken?: string
	idToken?: string
	expiresInSeconds: number
	email?: string
}

export interface OpenAiCodexOAuthStrategyOptions {
	configuration?: Partial<OpenAiCodexOAuthConfiguration>
	fetchImpl?: typeof proxyFetch
	now?: () => number
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined
}

function parseTokenResponse(value: unknown): TokenResponse {
	if (!isRecord(value)) {
		throw new OpenAiCodexOAuthTokenError("INVALID_TOKEN_RESPONSE", "The OAuth token response was invalid.")
	}
	const accessToken = optionalString(value.access_token)
	const expiresInSeconds = value.expires_in
	if (!accessToken || typeof expiresInSeconds !== "number" || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
		throw new OpenAiCodexOAuthTokenError("INVALID_TOKEN_RESPONSE", "The OAuth token response was invalid.")
	}
	return {
		accessToken,
		refreshToken: optionalString(value.refresh_token),
		idToken: optionalString(value.id_token),
		expiresInSeconds,
		email: optionalString(value.email),
	}
}

function parseProviderErrorCode(value: unknown): string | undefined {
	if (!isRecord(value)) return undefined
	if (typeof value.error === "string") return value.error
	if (isRecord(value.error) && typeof value.error.type === "string") return value.error.type
	return undefined
}

function parseJwtClaims(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".")
	if (parts.length !== 3) return undefined
	try {
		const value: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))
		return isRecord(value) ? value : undefined
	} catch {
		return undefined
	}
}

function accountIdFromClaims(claims: Record<string, unknown>): string | undefined {
	if (typeof claims.chatgpt_account_id === "string" && claims.chatgpt_account_id.length > 0) {
		return claims.chatgpt_account_id
	}
	const auth = claims["https://api.openai.com/auth"]
	if (isRecord(auth) && typeof auth.chatgpt_account_id === "string" && auth.chatgpt_account_id.length > 0) {
		return auth.chatgpt_account_id
	}
	const organizations = claims.organizations
	if (Array.isArray(organizations) && isRecord(organizations[0])) {
		return optionalString(organizations[0].id)
	}
	return undefined
}

function extractAccountId(tokens: Pick<TokenResponse, "accessToken" | "idToken">): string | undefined {
	for (const token of [tokens.idToken, tokens.accessToken]) {
		if (!token) continue
		const claims = parseJwtClaims(token)
		if (!claims) continue
		const accountId = accountIdFromClaims(claims)
		if (accountId) return accountId
	}
	return undefined
}

export class OpenAiCodexOAuthStrategy implements OAuthAuthorizationStrategy<OpenAiOAuthCredentials> {
	readonly strategyId = "openai-codex"
	readonly callbackPort: number
	readonly callbackPath: string
	private readonly configuration: OpenAiCodexOAuthConfiguration
	private readonly fetchImpl: typeof proxyFetch
	private readonly now: () => number

	constructor(options: OpenAiCodexOAuthStrategyOptions = {}) {
		this.configuration = { ...OPENAI_CODEX_OAUTH_CONFIG, ...options.configuration }
		this.callbackPort = this.configuration.callbackPort
		this.callbackPath = this.configuration.callbackPath
		this.fetchImpl = options.fetchImpl ?? proxyFetch
		this.now = options.now ?? Date.now
	}

	buildAuthorizationUrl(input: OAuthAuthorizationInput): URL {
		const url = new URL(this.configuration.authorizationEndpoint)
		url.search = new URLSearchParams({
			client_id: this.configuration.clientId,
			redirect_uri: input.redirectUri,
			scope: this.configuration.scopes,
			code_challenge: input.codeChallenge,
			code_challenge_method: "S256",
			response_type: "code",
			state: input.state,
			codex_cli_simplified_flow: "true",
			originator: "cline",
		}).toString()
		return url
	}

	async exchangeAuthorizationCode(input: OAuthCodeExchangeInput): Promise<OpenAiOAuthCredentials> {
		const tokens = await this.requestTokens(
			new URLSearchParams({
				grant_type: "authorization_code",
				client_id: this.configuration.clientId,
				code: input.code,
				redirect_uri: input.redirectUri,
				code_verifier: input.codeVerifier,
			}),
			"exchange",
		)
		if (!tokens.refreshToken) {
			throw new OpenAiCodexOAuthTokenError("INVALID_TOKEN_RESPONSE", "The OAuth token response was invalid.")
		}
		return parseOpenAiOAuthCredentials({
			type: "openai-codex",
			access_token: tokens.accessToken,
			refresh_token: tokens.refreshToken,
			expires: this.expiryFrom(tokens.expiresInSeconds),
			email: tokens.email,
			accountId: extractAccountId(tokens),
		})
	}

	async refreshCredential(credential: OpenAiOAuthCredentials): Promise<OpenAiOAuthCredentials> {
		const current = parseOpenAiOAuthCredentials(credential)
		const tokens = await this.requestTokens(
			new URLSearchParams({
				grant_type: "refresh_token",
				client_id: this.configuration.clientId,
				refresh_token: current.refresh_token,
			}),
			"refresh",
		)
		return parseOpenAiOAuthCredentials({
			...(current.type !== undefined ? { type: current.type } : {}),
			access_token: tokens.accessToken,
			refresh_token: tokens.refreshToken ?? current.refresh_token,
			expires: this.expiryFrom(tokens.expiresInSeconds),
			email: tokens.email ?? current.email,
			accountId: extractAccountId(tokens) ?? current.accountId,
		})
	}

	private async requestTokens(body: URLSearchParams, operation: "exchange" | "refresh"): Promise<TokenResponse> {
		let response: Response
		try {
			response = await this.fetchImpl(this.configuration.tokenEndpoint, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: body.toString(),
				signal: AbortSignal.timeout(30_000),
			})
		} catch {
			throw new OpenAiCodexOAuthTokenError(
				operation === "exchange" ? "TOKEN_EXCHANGE_FAILED" : "TOKEN_REFRESH_FAILED",
				operation === "exchange"
					? "The OAuth authorization code could not be exchanged."
					: "The OAuth credential could not be refreshed.",
			)
		}

		const responseText = await response.text()
		let payload: unknown
		try {
			payload = JSON.parse(responseText)
		} catch {
			payload = undefined
		}
		if (!response.ok) {
			const providerCode = parseProviderErrorCode(payload)
			const invalidGrant =
				(providerCode !== undefined && /invalid_grant/i.test(providerCode)) || /invalid_grant/i.test(responseText)
			throw new OpenAiCodexOAuthTokenError(
				invalidGrant ? "INVALID_GRANT" : operation === "exchange" ? "TOKEN_EXCHANGE_FAILED" : "TOKEN_REFRESH_FAILED",
				invalidGrant
					? "The OAuth authorization grant is no longer valid."
					: operation === "exchange"
						? "The OAuth authorization code could not be exchanged."
						: "The OAuth credential could not be refreshed.",
				response.status,
			)
		}
		return parseTokenResponse(payload)
	}

	private expiryFrom(expiresInSeconds: number): number {
		const expires = this.now() + expiresInSeconds * 1_000
		if (!Number.isSafeInteger(expires)) {
			throw new OpenAiCodexOAuthTokenError("INVALID_TOKEN_RESPONSE", "The OAuth token response was invalid.")
		}
		return expires
	}
}

export function isOpenAiCodexCredentialExpired(
	credential: OpenAiOAuthCredentials,
	now = Date.now(),
	bufferMs = 5 * 60_000,
): boolean {
	return now >= parseOpenAiOAuthCredentials(credential).expires - bufferMs
}
