import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	OpenAiCodexProfileAuthRepository,
	type OpenAiOAuthCredentials,
} from "@/core/storage/secrets/OpenAiCodexProfileAuthRepository"
import type { OAuthAuthorizationStrategy, OAuthCodeExchangeInput, OAuthFlowLease } from "@/services/oauth"
import { OpenAiCodexOAuthManager } from "./oauth"
import type { OpenAiCodexRefreshStrategy } from "./session"
import { OpenAiCodexOAuthStrategy, OpenAiCodexOAuthTokenError } from "./strategy"

const NOW = 1_900_000_000_000

function credential(owner: string): OpenAiOAuthCredentials {
	return {
		type: "openai-codex",
		access_token: `${owner}-access`,
		refresh_token: `${owner}-refresh`,
		expires: NOW + 3_600_000,
		accountId: `${owner}-account`,
	}
}

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason?: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function request(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		http.get(url, (response) => {
			response.resume()
			response.once("end", resolve)
		}).once("error", reject)
	})
}

function callbackUri(authorizationUrl: string, code: string): string {
	const authorization = new URL(authorizationUrl)
	const redirect = new URL(authorization.searchParams.get("redirect_uri") ?? "")
	redirect.searchParams.set("code", code)
	redirect.searchParams.set("state", authorization.searchParams.get("state") ?? "")
	return redirect.toString()
}

describe("OpenAI Codex OAuth flow integration", () => {
	let root: string
	let repository: OpenAiCodexProfileAuthRepository
	let releases: Array<ReturnType<typeof vi.fn>>
	let lease: OAuthFlowLease

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "dline-codex-flow-"))
		repository = new OpenAiCodexProfileAuthRepository({ secretsDir: path.join(root, "secrets") })
		releases = []
		lease = {
			acquire: vi.fn(async () => {
				const release = vi.fn(async () => undefined)
				releases.push(release)
				return { release }
			}),
		}
	})

	afterEach(async () => {
		vi.restoreAllMocks()
		await fs.rm(root, { recursive: true, force: true })
	})

	it("persists automatic HTTP callbacks and manual callback URIs through the same target Profile path", async () => {
		const openedUrls: string[] = []
		const tokenRequests: string[] = []
		const strategy = new OpenAiCodexOAuthStrategy({
			configuration: { callbackPort: 0, tokenEndpoint: "https://token.example.test" },
			now: () => NOW,
			fetchImpl: vi.fn(async (_input, init) => {
				const body = String(init?.body)
				tokenRequests.push(body)
				const code = new URLSearchParams(body).get("code") ?? "missing"
				return new Response(
					JSON.stringify({ access_token: `${code}-access`, refresh_token: `${code}-refresh`, expires_in: 3600 }),
					{ status: 200 },
				)
			}) as unknown as typeof fetch,
		})
		const manager = new OpenAiCodexOAuthManager({
			repository,
			strategy,
			lease,
			profileCatalogLoader: async () => [
				{ id: "profile-manual", provider: "openai-codex" },
				{ id: "profile-automatic", provider: "openai-codex" },
			],
			openExternal: async (url) => {
				openedUrls.push(url)
			},
		})

		const manual = await manager.startAuthorizationFlow("profile-manual")
		await expect(
			manager.completeFromCallbackUri({
				flowId: manual.flowId,
				profileId: "profile-manual",
				callbackUri: callbackUri(openedUrls[0], "manual-code"),
			}),
		).resolves.toMatchObject({ access_token: "manual-code-access" })
		await expect(manual.result).resolves.toMatchObject({ access_token: "manual-code-access" })

		const automatic = await manager.startAuthorizationFlow("profile-automatic")
		await request(callbackUri(openedUrls[1], "automatic-code"))
		await expect(automatic.result).resolves.toMatchObject({ access_token: "automatic-code-access" })

		await expect(repository.read("profile-manual")).resolves.toMatchObject({
			status: "valid",
			credential: { access_token: "manual-code-access", refresh_token: "manual-code-refresh" },
		})
		await expect(repository.read("profile-automatic")).resolves.toMatchObject({
			status: "valid",
			credential: { access_token: "automatic-code-access", refresh_token: "automatic-code-refresh" },
		})
		expect(tokenRequests).toHaveLength(2)
		expect(tokenRequests.every((body) => body.includes("code_verifier=") && !body.includes("state="))).toBe(true)
		expect(releases).toHaveLength(2)
		expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true)
		await manager.dispose()
	})

	it("prevents an in-flight browser exchange from recreating a signed-out credential", async () => {
		const openedUrls: string[] = []
		const exchange = deferred<OpenAiOAuthCredentials>()
		const exchangeAuthorizationCode = vi.fn((_input: OAuthCodeExchangeInput) => exchange.promise)
		const strategy: OAuthAuthorizationStrategy<OpenAiOAuthCredentials> & OpenAiCodexRefreshStrategy = {
			strategyId: "openai-codex-test",
			callbackPort: 0,
			callbackPath: "/auth/callback",
			buildAuthorizationUrl: ({ redirectUri, state }) => {
				const url = new URL("https://auth.example.test/authorize")
				url.searchParams.set("redirect_uri", redirectUri)
				url.searchParams.set("state", state)
				return url
			},
			exchangeAuthorizationCode,
			refreshCredential: async (current) => current,
		}
		const manager = new OpenAiCodexOAuthManager({
			repository,
			strategy,
			lease,
			profileCatalogLoader: async () => [{ id: "profile-a", provider: "openai-codex" }],
			openExternal: async (url) => {
				openedUrls.push(url)
			},
		})
		const started = await manager.startAuthorizationFlow("profile-a")
		const completion = manager.completeFromCallbackUri({
			flowId: started.flowId,
			profileId: "profile-a",
			callbackUri: callbackUri(openedUrls[0], "authorization-code"),
		})
		await vi.waitFor(() => expect(exchangeAuthorizationCode).toHaveBeenCalledOnce())

		await manager.clearCredentials("profile-a")
		exchange.resolve(credential("stale-browser"))

		await expect(started.result).rejects.toMatchObject({ code: "FLOW_CANCELLED" })
		await expect(completion).rejects.toMatchObject({ code: "CREDENTIAL_PERSIST_FAILED" })
		await expect(repository.read("profile-a")).resolves.toEqual({ status: "missing" })
		await manager.dispose()
	})

	it("publishes committed runtime mutations with Profile-local revisions and deduplicates reauthentication", async () => {
		const strategy: OAuthAuthorizationStrategy<OpenAiOAuthCredentials> & OpenAiCodexRefreshStrategy = {
			strategyId: "openai-codex-test",
			callbackPort: 0,
			callbackPath: "/auth/callback",
			buildAuthorizationUrl: ({ redirectUri, state }) => {
				const url = new URL("https://auth.example.test/authorize")
				url.searchParams.set("redirect_uri", redirectUri)
				url.searchParams.set("state", state)
				return url
			},
			exchangeAuthorizationCode: async () => credential("exchange"),
			refreshCredential: async () => {
				throw new OpenAiCodexOAuthTokenError("INVALID_GRANT", "sensitive provider payload", 400)
			},
		}
		const manager = new OpenAiCodexOAuthManager({
			repository,
			strategy,
			lease,
			profileCatalogLoader: async () => [
				{ id: "profile-a", provider: "openai-codex" },
				{ id: "profile-b", provider: "openai-codex" },
			],
			openExternal: async () => undefined,
		})
		const events: Array<{ profileId: string; reason: string; revision: number }> = []
		const unsubscribe = manager.subscribeToRuntimeMutations((event) => {
			events.push(event)
		})

		await manager.saveCredentials("profile-a", credential("a"))
		await manager.saveCredentials("profile-b", credential("b"))
		await expect(manager.forceRefreshCredentialContext("profile-a")).resolves.toBeNull()
		await expect(manager.forceRefreshCredentialContext("profile-a")).resolves.toBeNull()
		await manager.clearCredentials("profile-b")

		expect(events).toEqual([
			{ profileId: "profile-a", reason: "credential-saved", revision: 1 },
			{ profileId: "profile-b", reason: "credential-saved", revision: 1 },
			{ profileId: "profile-a", reason: "reauthentication-required", revision: 2 },
			{ profileId: "profile-b", reason: "credential-cleared", revision: 2 },
		])
		expect(manager.getRuntimeRevision("profile-a")).toBe(2)
		expect(manager.getRuntimeRevision("profile-b")).toBe(2)
		unsubscribe()
		await manager.dispose()
	})

	it("keeps the Codex integration free of a private callback server, StateManager and secret logging", async () => {
		const [oauthSource, sessionSource, strategySource] = await Promise.all([
			fs.readFile(new URL("./oauth.ts", import.meta.url), "utf8"),
			fs.readFile(new URL("./session.ts", import.meta.url), "utf8"),
			fs.readFile(new URL("./strategy.ts", import.meta.url), "utf8"),
		])
		const combined = `${oauthSource}\n${sessionSource}\n${strategySource}`

		expect(combined).not.toContain("StateManager")
		expect(combined).not.toContain("createServer(")
		expect(combined).not.toContain("Logger.")
		expect(combined).not.toContain("openai-codex-oauth-credentials")
		expect(oauthSource).toContain("LocalOAuthFlowCoordinator")
	})
})
