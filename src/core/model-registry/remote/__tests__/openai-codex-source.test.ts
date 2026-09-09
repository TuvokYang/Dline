import { afterEach, describe, expect, it, vi } from "vitest"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { ExtensionRegistryInfo } from "@/registry"
import { mockFetchForTesting } from "@/shared/net"
import { discoverProviderModels } from "../model-refresh"
import { OPENAI_CODEX_MODEL_LIST_CLIENT_VERSION, OpenAiCodexModelSource } from "../vendors/openai-codex"

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("OpenAiCodexModelSource", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("lists only visible API models with the Codex model-list wire identity", async () => {
		vi.spyOn(openAiCodexOAuthManager, "getCredentialContext").mockResolvedValue({
			accessToken: "access-a",
			expires: 1_900_000_000_000,
			accountId: "account-a",
		})
		const requests: Array<{ url: string; headers: Headers }> = []
		const source = new OpenAiCodexModelSource()

		const models = await mockFetchForTesting(
			async (input: RequestInfo | URL, init?: RequestInit) => {
				requests.push({ url: String(input), headers: new Headers(init?.headers) })
				return jsonResponse({
					models: [
						{ slug: "gpt-reserve", supported_in_api: true, visibility: "hide" },
						{ slug: "gpt-5.6-sol", supported_in_api: true, visibility: "list" },
						{ slug: "gpt-5.6-terra", supported_in_api: true, visibility: "list" },
						{ slug: "gpt-5.6-luna", supported_in_api: true, visibility: "list" },
						{ slug: "gpt-5.5", supported_in_api: true, visibility: "list" },
						{ slug: "codex-auto-review", supported_in_api: true, visibility: "hide" },
					],
				})
			},
			async () => source.fetchModels({ profileId: "profile-a" }),
		)

		expect(Object.keys(models)).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5"])
		expect(models["gpt-5.6-sol"]).toMatchObject({
			id: "gpt-5.6-sol",
			capabilities: { supportsPromptCache: true, supportsReasoning: true },
		})
		expect(models).not.toHaveProperty("gpt-reserve")
		expect(models).not.toHaveProperty("codex-auto-review")
		expect(models).not.toHaveProperty("gpt-6-astra")
		expect(requests).toHaveLength(1)
		const url = new URL(requests[0].url)
		expect(url.pathname).toBe("/backend-api/codex/models")
		expect(url.searchParams.get("client_version")).toBe(OPENAI_CODEX_MODEL_LIST_CLIENT_VERSION)
		expect(url.searchParams.has("include_hidden")).toBe(false)
		expect(requests[0].headers.get("Authorization")).toBe("Bearer access-a")
		expect(requests[0].headers.get("ChatGPT-Account-Id")).toBe("account-a")
		expect(requests[0].headers.get("Accept")).toBeNull()
		expect(requests[0].headers.get("originator")).toBeNull()
		expect(requests[0].headers.get("version")).toBe(OPENAI_CODEX_MODEL_LIST_CLIENT_VERSION)
		expect(requests[0].headers.get("User-Agent")).toBe(`Dline/${ExtensionRegistryInfo.version}`)
	})

	it("refreshes the full credential snapshot once after a 401", async () => {
		vi.spyOn(openAiCodexOAuthManager, "getCredentialContext").mockResolvedValue({
			accessToken: "access-a",
			expires: 1_900_000_000_000,
			accountId: "account-a",
		})
		const refresh = vi.spyOn(openAiCodexOAuthManager, "forceRefreshCredentialContext").mockResolvedValue({
			accessToken: "access-b",
			expires: 1_900_000_100_000,
			accountId: "account-b",
		})
		const authorizations: string[] = []
		const accounts: string[] = []
		const source = new OpenAiCodexModelSource()

		const models = await mockFetchForTesting(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				const headers = new Headers(init?.headers)
				authorizations.push(headers.get("Authorization") ?? "")
				accounts.push(headers.get("ChatGPT-Account-Id") ?? "")
				return authorizations.length === 1
					? jsonResponse({ error: { code: "unauthorized" } }, 401)
					: jsonResponse({ models: [{ slug: "gpt-codex-refreshed", supported_in_api: true }] })
			},
			async () => source.fetchModels({ profileId: "profile-a" }),
		)

		expect(refresh).toHaveBeenCalledWith("profile-a")
		expect(authorizations).toEqual(["Bearer access-a", "Bearer access-b"])
		expect(accounts).toEqual(["account-a", "account-b"])
		expect(Object.keys(models)).toEqual(["gpt-codex-refreshed"])
	})

	it("does not coalesce discovery requests from different Codex Profiles", async () => {
		vi.spyOn(openAiCodexOAuthManager, "getCredentialContext").mockImplementation(async (profileId) => ({
			accessToken: `access-${profileId}`,
			expires: 1_900_000_000_000,
			accountId: `account-${profileId}`,
		}))
		const requests: string[] = []

		const results = await mockFetchForTesting(
			async (_input: RequestInfo | URL, init?: RequestInit) => {
				const authorization = new Headers(init?.headers).get("Authorization") ?? ""
				requests.push(authorization)
				return jsonResponse({ models: [{ slug: authorization.replace("Bearer access-", "model-") }] })
			},
			async () =>
				Promise.all([
					discoverProviderModels("openai-codex", { profileId: "profile-a" }),
					discoverProviderModels("openai-codex", { profileId: "profile-b" }),
				]),
		)

		expect(requests.sort()).toEqual(["Bearer access-profile-a", "Bearer access-profile-b"])
		expect(Object.keys(results[0])).toEqual(["model-profile-a"])
		expect(Object.keys(results[1])).toEqual(["model-profile-b"])
	})

	it("does not send a listing request without a Profile identity", async () => {
		const getCredential = vi.spyOn(openAiCodexOAuthManager, "getCredentialContext")
		let calls = 0
		const source = new OpenAiCodexModelSource()

		const models = await mockFetchForTesting(
			async () => {
				calls++
				return jsonResponse({ models: [] })
			},
			async () => source.fetchModels({}),
		)

		expect(models).toEqual({})
		expect(calls).toBe(0)
		expect(getCredential).not.toHaveBeenCalled()
	})
})
