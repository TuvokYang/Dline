export type OAuthFlowErrorCode =
	| "FLOW_ALREADY_IN_PROGRESS"
	| "CALLBACK_PORT_IN_USE"
	| "CALLBACK_SERVER_FAILED"
	| "FLOW_NOT_FOUND"
	| "FLOW_OWNER_MISMATCH"
	| "CALLBACK_URI_INVALID"
	| "CALLBACK_URI_MISMATCH"
	| "CALLBACK_MISSING_PARAMETERS"
	| "STATE_MISMATCH"
	| "AUTHORIZATION_DENIED"
	| "TOKEN_EXCHANGE_FAILED"
	| "CREDENTIAL_PERSIST_FAILED"
	| "BROWSER_OPEN_FAILED"
	| "FLOW_CANCELLED"
	| "FLOW_TIMED_OUT"

export class OAuthFlowError extends Error {
	constructor(
		public readonly code: OAuthFlowErrorCode,
		message: string,
		public readonly terminal = false,
		options?: ErrorOptions,
	) {
		super(message, options)
		this.name = "OAuthFlowError"
	}
}

export interface OAuthAuthorizationInput {
	redirectUri: string
	codeChallenge: string
	state: string
}

export interface OAuthCodeExchangeInput {
	code: string
	codeVerifier: string
	redirectUri: string
}

export interface OAuthAuthorizationStrategy<TCredential> {
	readonly strategyId: string
	readonly callbackPort: number
	readonly callbackPorts?: readonly number[]
	readonly callbackPath: string
	buildAuthorizationUrl(input: OAuthAuthorizationInput): URL
	exchangeAuthorizationCode(input: OAuthCodeExchangeInput): Promise<TCredential>
	refreshCredential?(credential: TCredential): Promise<TCredential>
}

export interface OAuthFlowLeaseOwner {
	flowId: string
	profileId: string
	strategyId: string
}

export interface OAuthFlowLeaseHandle {
	release(): Promise<void>
}

export interface OAuthFlowLease {
	acquire(owner: OAuthFlowLeaseOwner): Promise<OAuthFlowLeaseHandle>
}

export type OAuthBrowserOpenStatus = "opened" | "failed"

export interface OAuthFlowStarted<TCredential> {
	flowId: string
	profileId: string
	authorizationUrl: string
	redirectUri: string
	expiresAtMs: number
	browserOpenStatus: OAuthBrowserOpenStatus
	result: Promise<TCredential>
}

export interface StartOAuthFlowInput {
	profileId: string
	flowId?: string
}

export interface CompleteOAuthCallbackInput {
	flowId: string
	profileId: string
	callbackUri: string
}

export interface CancelOAuthFlowInput {
	flowId: string
	profileId: string
}
