import { randomUUID } from "node:crypto"
import { parseOAuthCallbackUri } from "./callbackUri"
import { LocalOAuthCallbackServer } from "./LocalOAuthCallbackServer"
import { createOAuthState, createPkceChallenge, createPkceVerifier } from "./pkce"
import {
	type CancelOAuthFlowInput,
	type CompleteOAuthCallbackInput,
	type OAuthAuthorizationStrategy,
	OAuthFlowError,
	type OAuthFlowLease,
	type OAuthFlowLeaseHandle,
	type OAuthFlowStarted,
	type StartOAuthFlowInput,
} from "./types"

interface CoordinatorOptions {
	lease: OAuthFlowLease
	openExternal: (authorizationUrl: string) => Promise<void>
	timeoutMs?: number
}

interface PendingFlow<TCredential> {
	flowId: string
	profileId: string
	state: string
	codeVerifier: string
	redirectUri: string
	server: LocalOAuthCallbackServer
	lease: OAuthFlowLeaseHandle
	timeout: ReturnType<typeof setTimeout>
	result: Promise<TCredential>
	resolve: (credential: TCredential) => void
	reject: (error: OAuthFlowError) => void
	completion?: Promise<TCredential>
}

export class LocalOAuthFlowCoordinator<TCredential> {
	private pending: PendingFlow<TCredential> | undefined
	private readonly timeoutMs: number

	constructor(
		private readonly strategy: OAuthAuthorizationStrategy<TCredential>,
		private readonly options: CoordinatorOptions,
	) {
		this.timeoutMs = options.timeoutMs ?? 5 * 60_000
	}

	async startFlow(input: StartOAuthFlowInput): Promise<OAuthFlowStarted<TCredential>> {
		if (this.pending) throw new OAuthFlowError("FLOW_ALREADY_IN_PROGRESS", "An OAuth authorization flow is already active.")
		const flowId = randomUUID()
		const lease = await this.options.lease.acquire({
			flowId,
			profileId: input.profileId,
			strategyId: this.strategy.strategyId,
		})
		const codeVerifier = createPkceVerifier()
		const state = createOAuthState()
		let server: LocalOAuthCallbackServer
		try {
			server = await LocalOAuthCallbackServer.listen({
				port: this.strategy.callbackPort,
				callbackPath: this.strategy.callbackPath,
				onCallback: (callbackUri) => this.complete(flowId, input.profileId, callbackUri, false).then(() => undefined),
			})
		} catch (error) {
			await lease.release()
			throw error
		}

		let resolve!: (credential: TCredential) => void
		let reject!: (error: OAuthFlowError) => void
		const result = new Promise<TCredential>((res, rej) => {
			resolve = res
			reject = rej
		})
		void result.catch(() => undefined)
		const timeout = setTimeout(() => {
			void this.fail(flowId, new OAuthFlowError("FLOW_TIMED_OUT", "The OAuth authorization flow timed out.", true))
		}, this.timeoutMs)
		this.pending = {
			flowId,
			profileId: input.profileId,
			state,
			codeVerifier,
			redirectUri: server.redirectUri,
			server,
			lease,
			timeout,
			result,
			resolve,
			reject,
		}

		const authorizationUrl = this.strategy
			.buildAuthorizationUrl({ redirectUri: server.redirectUri, codeChallenge: createPkceChallenge(codeVerifier), state })
			.toString()
		try {
			await this.options.openExternal(authorizationUrl)
		} catch (error) {
			await this.fail(
				flowId,
				new OAuthFlowError("BROWSER_OPEN_FAILED", "The OAuth authorization URL could not be opened.", true, {
					cause: error,
				}),
			)
			throw new OAuthFlowError("BROWSER_OPEN_FAILED", "The OAuth authorization URL could not be opened.", true, {
				cause: error,
			})
		}
		return { flowId, profileId: input.profileId, result }
	}

	completeFromCallbackUri(input: CompleteOAuthCallbackInput): Promise<TCredential> {
		return this.complete(input.flowId, input.profileId, input.callbackUri, true)
	}

	async cancelFlow(input: CancelOAuthFlowInput): Promise<void> {
		const pending = this.requirePending(input.flowId, input.profileId)
		await this.settleFailure(
			pending,
			new OAuthFlowError("FLOW_CANCELLED", "The OAuth authorization flow was cancelled.", true),
			true,
		)
	}

	async dispose(): Promise<void> {
		if (!this.pending) return
		await this.settleFailure(
			this.pending,
			new OAuthFlowError("FLOW_CANCELLED", "The OAuth authorization flow was cancelled.", true),
			true,
		)
	}

	private complete(flowId: string, profileId: string, callbackUri: string, waitForServer: boolean): Promise<TCredential> {
		const pending = this.requirePending(flowId, profileId)
		if (pending.completion) return pending.completion
		let parsed: { code: string }
		try {
			parsed = parseOAuthCallbackUri(callbackUri, pending.redirectUri, pending.state)
		} catch (error) {
			if (error instanceof OAuthFlowError && error.terminal) void this.settleFailure(pending, error, waitForServer)
			throw error
		}
		pending.completion = this.strategy
			.exchangeAuthorizationCode({
				code: parsed.code,
				codeVerifier: pending.codeVerifier,
				redirectUri: pending.redirectUri,
			})
			.then(async (credential) => {
				await this.settleSuccess(pending, credential, waitForServer)
				return credential
			})
			.catch(async (error: unknown) => {
				const wrapped =
					error instanceof OAuthFlowError
						? error
						: new OAuthFlowError(
								"TOKEN_EXCHANGE_FAILED",
								"The OAuth authorization code could not be exchanged.",
								true,
								{
									cause: error,
								},
							)
				await this.settleFailure(pending, wrapped, waitForServer)
				throw wrapped
			})
		return pending.completion
	}

	private requirePending(flowId: string, profileId: string): PendingFlow<TCredential> {
		const pending = this.pending
		if (!pending || pending.flowId !== flowId)
			throw new OAuthFlowError("FLOW_NOT_FOUND", "The OAuth authorization flow is no longer active.")
		if (pending.profileId !== profileId)
			throw new OAuthFlowError("FLOW_OWNER_MISMATCH", "The OAuth authorization flow belongs to another profile.")
		return pending
	}

	private async fail(flowId: string, error: OAuthFlowError): Promise<void> {
		if (!this.pending || this.pending.flowId !== flowId) return
		await this.settleFailure(this.pending, error, true)
	}

	private async settleSuccess(
		pending: PendingFlow<TCredential>,
		credential: TCredential,
		waitForServer: boolean,
	): Promise<void> {
		await this.cleanup(pending, waitForServer)
		pending.resolve(credential)
	}

	private async settleFailure(pending: PendingFlow<TCredential>, error: OAuthFlowError, waitForServer: boolean): Promise<void> {
		await this.cleanup(pending, waitForServer)
		pending.reject(error)
	}

	private async cleanup(pending: PendingFlow<TCredential>, waitForServer: boolean): Promise<void> {
		if (this.pending !== pending) return
		this.pending = undefined
		clearTimeout(pending.timeout)
		await pending.lease.release()
		if (waitForServer) await pending.server.close()
		else void pending.server.close().catch(() => undefined)
	}
}
