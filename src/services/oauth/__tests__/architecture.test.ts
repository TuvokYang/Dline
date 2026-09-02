import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const oauthDirectory = path.dirname(fileURLToPath(new URL("../index.ts", import.meta.url)))
const productionFiles = [
	"FileOAuthFlowLease.ts",
	"LocalOAuthCallbackServer.ts",
	"LocalOAuthFlowCoordinator.ts",
	"callbackUri.ts",
	"index.ts",
	"pkce.ts",
	"types.ts",
]

describe("generic OAuth architecture", () => {
	it("does not depend on a provider, ordinary state, logging, or telemetry implementation", async () => {
		const sources = await Promise.all(productionFiles.map((file) => fs.readFile(path.join(oauthDirectory, file), "utf8")))
		const combined = sources.join("\n")

		expect(combined).not.toMatch(/openai-codex|OpenAiCodex|CloudCode/)
		expect(combined).not.toMatch(/Logger\.|console\.|Telemetry|StateManager|ExtensionState/)
	})

	it("does not expose the authorization URL or redirect URI from the started-flow contract", async () => {
		const types = await fs.readFile(path.join(oauthDirectory, "types.ts"), "utf8")
		const startedFlow = types.match(/export interface OAuthFlowStarted[\s\S]*?\n}/)?.[0]

		expect(startedFlow).toBeTruthy()
		expect(startedFlow).not.toContain("authorizationUrl")
		expect(startedFlow).not.toContain("redirectUri")
	})
})
