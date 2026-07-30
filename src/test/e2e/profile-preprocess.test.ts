import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { expect, test } from "@playwright/test"
import { E2E_PROFILE_NAMES, prepareE2EState } from "./utils/api-profile"

interface PreparedProfile {
	name: string
	deepseek?: { reasoning?: { effort?: string } }
	openai?: { reasoning?: { effort?: string } }
	openaiCodex?: { reasoning?: { effort?: string } }
}

test("E2E profile preprocessing copies only auth/profile state and creates high-effort profiles", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), "dline-e2e-profile-preprocess-"))
	const sourceDataDir = path.join(root, "source", "data")
	const dlineDir = path.join(root, "isolated")

	try {
		await Promise.all([
			writeJson(path.join(sourceDataDir, "settings", "api_profiles.json"), [
				{
					id: "local-profile",
					name: "Local Profile",
					provider: "deepseek",
					modelId: "local-model",
					usedFor: ["act", "plan"],
					enabled: true,
				},
			]),
			writeJson(path.join(sourceDataDir, "settings", "settings.json"), {
				actModeProfile: "Local Profile",
				planModeProfile: "Local Profile",
			}),
			writeJson(path.join(sourceDataDir, "secrets", "api_keys.json"), {
				"local-profile": { apiKey: "local-secret", name: "Local Profile" },
			}),
			writeJson(path.join(sourceDataDir, "secrets.json"), { "openai-codex-oauth-credentials": "local-oauth" }),
			writeJson(path.join(sourceDataDir, "globalState.json"), { taskHistory: ["must-not-copy"] }),
		])

		const result = await prepareE2EState({
			dlineDir,
			mockBaseUrl: "http://127.0.0.1:43210",
			sourceDataDir,
			env: {
				DLINE_E2E_DEEPSEEK_API_KEY: "ci-deepseek-key",
				DLINE_E2E_OPENAI_CODEX_CREDENTIALS_JSON: JSON.stringify({
					type: "openai-codex",
					access_token: "codex-access-token",
					refresh_token: "codex-refresh-token",
					expires: 4_102_444_800_000,
				}),
				DLINE_E2E_OPENAI_COMPATIBLE_API_KEY: "ci-compatible-key",
				DLINE_E2E_OPENAI_COMPATIBLE_BASE_URL: "https://compatible.example.test/v1",
				DLINE_E2E_PROFILE: "deepseek",
			},
		})

		expect(result.selectedProfileName).toBe(E2E_PROFILE_NAMES.deepseek)
		const profiles = await readJson<PreparedProfile[]>(path.join(dlineDir, "data", "settings", "api_profiles.json"))
		const deepseek = profiles.find((profile) => profile.name === E2E_PROFILE_NAMES.deepseek)
		const codex = profiles.find((profile) => profile.name === E2E_PROFILE_NAMES.openAiCodex)
		const compatible = profiles.find((profile) => profile.name === E2E_PROFILE_NAMES.openAiCompatible)
		expect(deepseek?.deepseek?.reasoning?.effort).toBe("high")
		expect(codex?.openaiCodex?.reasoning?.effort).toBe("high")
		expect(compatible?.openai?.reasoning?.effort).toBe("high")
		expect(profiles.some((profile) => profile.name === "Local Profile")).toBe(true)

		const apiKeys = await readJson<Record<string, { apiKey: string }>>(
			path.join(dlineDir, "data", "secrets", "api_keys.json"),
		)
		expect(apiKeys["local-profile"].apiKey).toBe("local-secret")
		expect(apiKeys["dline-e2e-deepseek"].apiKey).toBe("ci-deepseek-key")
		expect(apiKeys["dline-e2e-openai-compatible"].apiKey).toBe("ci-compatible-key")

		const secrets = await readJson<Record<string, string>>(path.join(dlineDir, "data", "secrets.json"))
		expect(JSON.parse(secrets["openai-codex-oauth-credentials"])).toMatchObject({
			type: "openai-codex",
			access_token: "codex-access-token",
		})

		const globalState = await readJson<Record<string, unknown>>(path.join(dlineDir, "data", "globalState.json"))
		expect(globalState).toEqual({
			isNewUser: false,
			mode: "act",
			nativeToolCallEnabled: true,
			welcomeViewCompleted: true,
		})
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

async function writeJson(filePath: string, data: unknown): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true })
	await writeFile(filePath, `${JSON.stringify(data)}\n`, "utf8")
}

async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await readFile(filePath, "utf8")) as T
}
