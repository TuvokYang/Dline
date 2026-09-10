import { describe, expect, it, vi } from "vitest"
import { ExtensionRegistryInfo } from "@/registry"
import {
	OPENAI_CODEX_CLIENT_VERSION_REGISTRY_URL,
	OPENAI_CODEX_MODEL_LIST_MINIMUM_VERSION,
	OpenAiCodexClientVersionResolver,
} from "../vendors/openai-codex-client-version"

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("OpenAiCodexClientVersionResolver", () => {
	it("reads the official npm latest endpoint with Dline identity, coalesces callers, and refreshes after the TTL", async () => {
		let now = 1_000
		const registryVersions = ["0.154.0", "0.155.0"]
		const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			expect(String(input)).toBe(OPENAI_CODEX_CLIENT_VERSION_REGISTRY_URL)
			expect(new Headers(init?.headers).get("User-Agent")).toBe(`Dline/${ExtensionRegistryInfo.version}`)
			return jsonResponse({ version: registryVersions.shift() })
		})
		const resolver = new OpenAiCodexClientVersionResolver({
			fetchImpl,
			now: () => now,
			successTtlMs: 1_000,
			failureTtlMs: 100,
		})

		await expect(Promise.all([resolver.resolve(), resolver.resolve()])).resolves.toEqual(["0.154.0", "0.154.0"])
		expect(fetchImpl).toHaveBeenCalledTimes(1)

		now = 1_999
		await expect(resolver.resolve()).resolves.toBe("0.154.0")
		expect(fetchImpl).toHaveBeenCalledTimes(1)

		now = 2_000
		await expect(resolver.resolve()).resolves.toBe("0.155.0")
		expect(fetchImpl).toHaveBeenCalledTimes(2)
	})

	it("never downgrades below the known Astra-compatible minimum", async () => {
		const resolver = new OpenAiCodexClientVersionResolver({
			fetchImpl: vi.fn(async () => jsonResponse({ version: "0.111.0" })),
		})

		await expect(resolver.resolve()).resolves.toBe(OPENAI_CODEX_MODEL_LIST_MINIMUM_VERSION)
	})

	it("uses the stable floor during registry failures and retries after the shorter failure TTL", async () => {
		let now = 10_000
		const fetchImpl = vi
			.fn<typeof globalThis.fetch>()
			.mockRejectedValueOnce(new Error("registry_unavailable"))
			.mockResolvedValueOnce(jsonResponse({ version: "0.160.0" }))
		const resolver = new OpenAiCodexClientVersionResolver({
			fetchImpl,
			now: () => now,
			successTtlMs: 1_000,
			failureTtlMs: 100,
		})

		await expect(resolver.resolve()).resolves.toBe(OPENAI_CODEX_MODEL_LIST_MINIMUM_VERSION)
		now = 10_099
		await expect(resolver.resolve()).resolves.toBe(OPENAI_CODEX_MODEL_LIST_MINIMUM_VERSION)
		expect(fetchImpl).toHaveBeenCalledTimes(1)

		now = 10_100
		await expect(resolver.resolve()).resolves.toBe("0.160.0")
		expect(fetchImpl).toHaveBeenCalledTimes(2)
	})
})
