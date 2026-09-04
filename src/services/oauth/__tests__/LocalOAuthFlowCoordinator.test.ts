import fs from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { FileOAuthFlowLease } from "../FileOAuthFlowLease"
import { LocalOAuthFlowCoordinator } from "../LocalOAuthFlowCoordinator"
import type { OAuthAuthorizationStrategy } from "../types"

interface TestCredential {
	code: string
	verifier: string
}

class TestStrategy implements OAuthAuthorizationStrategy<TestCredential> {
	readonly strategyId = "test-oauth"
	readonly callbackPath = "/oauth/callback"

	constructor(
		readonly callbackPort = 0,
		private readonly exchange: (code: string, verifier: string) => Promise<TestCredential> = async (code, verifier) => ({
			code,
			verifier,
		}),
	) {}

	buildAuthorizationUrl(input: { redirectUri: string; codeChallenge: string; state: string }): URL {
		const url = new URL("https://auth.example.test/authorize")
		url.searchParams.set("redirect_uri", input.redirectUri)
		url.searchParams.set("code_challenge", input.codeChallenge)
		url.searchParams.set("state", input.state)
		return url
	}

	exchangeAuthorizationCode(input: { code: string; codeVerifier: string }): Promise<TestCredential> {
		return this.exchange(input.code, input.codeVerifier)
	}
}

describe("LocalOAuthFlowCoordinator", () => {
	let tempDir: string | undefined
	const coordinators: LocalOAuthFlowCoordinator<TestCredential>[] = []
	const openedAuthorizationUrls: string[] = []

	afterEach(async () => {
		await Promise.all(coordinators.map((coordinator) => coordinator.dispose()))
		coordinators.length = 0
		openedAuthorizationUrls.length = 0
		if (tempDir) await fs.rm(tempDir, { recursive: true, force: true })
		tempDir = undefined
		vi.restoreAllMocks()
	})

	async function createCoordinator(
		options: { strategy?: TestStrategy; openExternal?: (url: string) => Promise<void>; timeoutMs?: number } = {},
	): Promise<LocalOAuthFlowCoordinator<TestCredential>> {
		tempDir ??= await fs.mkdtemp(path.join(os.tmpdir(), "dline-oauth-flow-"))
		const coordinator = new LocalOAuthFlowCoordinator(options.strategy ?? new TestStrategy(), {
			lease: new FileOAuthFlowLease(path.join(tempDir, "flow-lease.json")),
			openExternal:
				options.openExternal ??
				(async (authorizationUrl) => {
					openedAuthorizationUrls.push(authorizationUrl)
				}),
			timeoutMs: options.timeoutMs ?? 5_000,
		})
		coordinators.push(coordinator)
		return coordinator
	}

	function lastAuthorizationUrl(): URL {
		const authorizationUrl = openedAuthorizationUrls.at(-1)
		if (!authorizationUrl) throw new Error("expected the authorization URL to be opened")
		return new URL(authorizationUrl)
	}

	async function getAvailablePort(): Promise<number> {
		const server = http.createServer()
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject)
			server.listen(0, "127.0.0.1", resolve)
		})
		const address = server.address()
		if (!address || typeof address === "string") throw new Error("expected TCP address")
		await new Promise<void>((resolve) => server.close(() => resolve()))
		return address.port
	}

	function requestWithAgent(url: string, agent: http.Agent): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
		return new Promise((resolve, reject) => {
			const request = http.get(url, { agent }, (response) => {
				response.resume()
				response.once("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers }))
			})
			request.once("error", reject)
		})
	}

	it("listens before opening the browser and completes from a pasted callback URI", async () => {
		let listenedRedirectUri = ""
		let openedAuthorizationUrl = ""
		const openExternal = vi.fn(async (authorizationUrl: string) => {
			openedAuthorizationUrl = authorizationUrl
			const redirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri")
			expect(redirectUri).toBeTruthy()
			listenedRedirectUri = redirectUri!
			const probe = await fetch(new URL("/not-the-callback", redirectUri!))
			expect(probe.status).toBe(404)
		})
		const coordinator = await createCoordinator({ openExternal })
		const flow = await coordinator.startFlow({ profileId: "profile-a" })
		const state = new URL(openedAuthorizationUrl).searchParams.get("state")

		const credential = await coordinator.completeFromCallbackUri({
			flowId: flow.flowId,
			profileId: "profile-a",
			callbackUri: `${listenedRedirectUri}?code=manual-code&state=${state}`,
		})

		expect(credential).toMatchObject({ code: "manual-code" })
		await expect(flow.result).resolves.toEqual(credential)
		expect(openExternal).toHaveBeenCalledOnce()
	})

	it("completes the same flow through the HTTP callback", async () => {
		const coordinator = await createCoordinator()
		const flow = await coordinator.startFlow({ profileId: "profile-a" })
		const authorization = lastAuthorizationUrl()
		const redirectUri = authorization.searchParams.get("redirect_uri")!
		const state = authorization.searchParams.get("state")!

		const response = await fetch(`${redirectUri}?code=browser-code&state=${state}`)
		expect(response.status).toBe(200)
		await expect(flow.result).resolves.toMatchObject({ code: "browser-code" })
	})

	it("closes a fixed-port callback connection before the next flow starts", async () => {
		const port = await getAvailablePort()
		const coordinator = await createCoordinator({ strategy: new TestStrategy(port) })
		const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
		try {
			for (const [profileId, code] of [
				["profile-a", "browser-code-a"],
				["profile-b", "browser-code-b"],
			] as const) {
				const flow = await coordinator.startFlow({ profileId })
				const authorization = lastAuthorizationUrl()
				const redirectUri = authorization.searchParams.get("redirect_uri")!
				const state = authorization.searchParams.get("state")!
				const response = await requestWithAgent(`${redirectUri}?code=${code}&state=${state}`, agent)

				expect(response.status).toBe(200)
				expect(response.headers.connection).toBe("close")
				expect(response.headers["cache-control"]).toBe("no-store")
				await expect(flow.result).resolves.toMatchObject({ code })
			}
		} finally {
			agent.destroy()
		}
	})

	it("rejects a wrong state without terminating the pending flow", async () => {
		const coordinator = await createCoordinator()
		const flow = await coordinator.startFlow({ profileId: "profile-a" })
		const authorization = lastAuthorizationUrl()
		const redirectUri = authorization.searchParams.get("redirect_uri")!
		const state = authorization.searchParams.get("state")!

		const invalid = await fetch(`${redirectUri}?code=bad&state=wrong`)
		expect(invalid.status).toBe(400)
		const valid = await fetch(`${redirectUri}?code=good&state=${state}`)
		expect(valid.status).toBe(200)
		await expect(flow.result).resolves.toMatchObject({ code: "good" })
	})

	it("turns an OAuth error callback into a terminal authorization result without exposing provider details", async () => {
		const coordinator = await createCoordinator()
		const flow = await coordinator.startFlow({ profileId: "profile-a" })
		const authorization = lastAuthorizationUrl()
		const redirectUri = authorization.searchParams.get("redirect_uri")!
		const state = authorization.searchParams.get("state")!

		const response = await fetch(`${redirectUri}?error=access_denied&error_description=private-detail&state=${state}`)
		const body = await response.text()
		expect(response.status).toBe(400)
		expect(body).not.toContain("access_denied")
		expect(body).not.toContain("private-detail")
		await expect(flow.result).rejects.toMatchObject({ code: "AUTHORIZATION_DENIED" })
	})

	it("prevents a second coordinator from stealing the active flow", async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dline-oauth-flow-"))
		const leasePath = path.join(tempDir, "shared-lease.json")
		const left = new LocalOAuthFlowCoordinator(new TestStrategy(), {
			lease: new FileOAuthFlowLease(leasePath),
			openExternal: async () => undefined,
		})
		const right = new LocalOAuthFlowCoordinator(new TestStrategy(), {
			lease: new FileOAuthFlowLease(leasePath),
			openExternal: async () => undefined,
		})
		coordinators.push(left, right)
		const active = await left.startFlow({ profileId: "profile-a" })

		await expect(right.startFlow({ profileId: "profile-b" })).rejects.toMatchObject({ code: "FLOW_ALREADY_IN_PROGRESS" })
		await expect(right.cancelFlow({ flowId: active.flowId, profileId: "profile-a" })).rejects.toMatchObject({
			code: "FLOW_NOT_FOUND",
		})
		await left.cancelFlow({ flowId: active.flowId, profileId: "profile-a" })
		await expect(active.result).rejects.toMatchObject({ code: "FLOW_CANCELLED" })
	})

	it("distinguishes an occupied callback port from another Dline flow", async () => {
		const occupied = http.createServer()
		await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve))
		const address = occupied.address()
		if (!address || typeof address === "string") throw new Error("expected TCP address")
		try {
			const coordinator = await createCoordinator({ strategy: new TestStrategy(address.port) })
			await expect(coordinator.startFlow({ profileId: "profile-a" })).rejects.toMatchObject({
				code: "CALLBACK_PORT_IN_USE",
			})
		} finally {
			await new Promise<void>((resolve) => occupied.close(() => resolve()))
		}
	})

	it("times out and releases the flow lease", async () => {
		const coordinator = await createCoordinator({ timeoutMs: 20 })
		const flow = await coordinator.startFlow({ profileId: "profile-a" })
		await expect(flow.result).rejects.toMatchObject({ code: "FLOW_TIMED_OUT" })
		const replacement = await coordinator.startFlow({ profileId: "profile-a" })
		await coordinator.cancelFlow({ flowId: replacement.flowId, profileId: "profile-a" })
		await expect(replacement.result).rejects.toMatchObject({ code: "FLOW_CANCELLED" })
	})

	it("does not expose token exchange error details in the callback response", async () => {
		const coordinator = await createCoordinator({
			strategy: new TestStrategy(0, async () => {
				throw new Error("upstream-secret-response")
			}),
		})
		const flow = await coordinator.startFlow({ profileId: "profile-a" })
		const authorization = lastAuthorizationUrl()
		const response = await fetch(
			`${authorization.searchParams.get("redirect_uri")}?code=bad&state=${authorization.searchParams.get("state")}`,
		)
		const body = await response.text()
		expect(response.status).toBe(500)
		expect(body).not.toContain("upstream-secret-response")
		await expect(flow.result).rejects.toMatchObject({ code: "TOKEN_EXCHANGE_FAILED" })
	})
})
