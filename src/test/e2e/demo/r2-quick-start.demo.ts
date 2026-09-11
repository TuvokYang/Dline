import { readFile } from "node:fs/promises"
import path from "node:path"
import { expect } from "@playwright/test"
import { ApiFormat } from "../../../shared/proto/dline/models/metadata"
import { getE2EMockProviderBaseUrl } from "../fixtures/server/api"
import { demo } from "./utils/demo-fixture"

interface StoredProfile {
	id: string
	name: string
	provider: string
	modelId?: string
	baseUrl?: string
	openai?: { apiFormat?: string }
}

const PROFILE_NAME = "openai:dline-e2e-model"
const MODEL_ID = "dline-e2e-model"
const MOCK_API_KEY = "demo-api-key-not-real"
const TASK_TEXT = "Give me one concise suggestion for this demo workspace."
const COMPLETION_TEXT = "Your first Dline task is ready."

async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await readFile(filePath, "utf8")) as T
}

demo("R2", async ({ dlineDir, finishRecording, helper, pace, page, registerRecording, server, sidebar }) => {
	await helper.signin(sidebar)
	const profilesPath = path.join(dlineDir, "data", "settings", "api_profiles.json")
	const apiKeysPath = path.join(dlineDir, "data", "secrets", "api_keys.json")
	const existingIds = new Set((await readJson<StoredProfile[]>(profilesPath)).map((profile) => profile.id))

	await registerRecording("r2-quick-start")
	await page.getByRole("button", { name: "Settings", exact: true }).click()
	await expect(sidebar.getByRole("heading", { name: "API Configuration", exact: true })).toBeVisible()
	await sidebar.getByRole("button", { name: "Add profile", exact: true }).click()
	const profileCard = sidebar.getByTestId("api-profile-card").last()
	await expect(profileCard).toBeVisible()
	await pace()

	const createdProfileId = await (async () => {
		let resolved = ""
		await expect
			.poll(async () => {
				resolved =
					(await readJson<StoredProfile[]>(profilesPath)).find((profile) => !existingIds.has(profile.id))?.id ?? ""
				return resolved
			})
			.not.toBe("")
		return resolved
	})()

	await profileCard.getByRole("combobox", { name: "Provider", exact: true }).selectOption("openai")
	const apiFormat = profileCard.getByRole("combobox", { name: "API Format", exact: true })
	await apiFormat.selectOption(String(ApiFormat.OPENAI_CHAT))

	const customBaseUrl = profileCard.locator("vscode-checkbox").filter({ hasText: "Use custom base URL" })
	await customBaseUrl.click()
	const baseUrl = getE2EMockProviderBaseUrl(server.baseUrl, "openai-compatible-chat")
	const baseUrlInput = profileCard.locator('vscode-text-field[placeholder="Enter base URL..."] input')
	await baseUrlInput.fill(baseUrl)

	const apiKeyInput = profileCard.getByRole("textbox", { name: "OpenAI API Key", exact: true })
	await apiKeyInput.fill(MOCK_API_KEY)
	const customModelId = profileCard.locator("vscode-checkbox").filter({ hasText: "Use custom model ID" })
	await customModelId.click()
	const modelInput = profileCard.locator('vscode-text-field[placeholder="Enter Model ID..."] input')
	await modelInput.fill(MODEL_ID)

	await expect
		.poll(async () => {
			const profile = (await readJson<StoredProfile[]>(profilesPath)).find((candidate) => candidate.id === createdProfileId)
			return (
				profile && {
					provider: profile.provider,
					baseUrl: profile.baseUrl,
					modelId: profile.modelId,
					apiFormat: profile.openai?.apiFormat,
				}
			)
		})
		.toEqual({ provider: "openai", baseUrl, modelId: MODEL_ID, apiFormat: "OPENAI_CHAT" })

	await expect
		.poll(
			async () => (await readJson<StoredProfile[]>(profilesPath)).find((profile) => profile.id === createdProfileId)?.name,
		)
		.toBe(PROFILE_NAME)
	await expect
		.poll(async () => (await readJson<Record<string, { apiKey?: string }>>(apiKeysPath))[createdProfileId]?.apiKey)
		.toBe(MOCK_API_KEY)
	await pace()

	await sidebar.getByRole("button", { name: "Done", exact: true }).click()
	const modelSwitcher = sidebar.getByRole("button", { name: "Select model", exact: true })
	await expect(modelSwitcher).toBeVisible()
	await modelSwitcher.click()
	const profileOption = sidebar.getByRole("option").filter({ has: sidebar.getByText(PROFILE_NAME, { exact: true }) })
	await expect(profileOption).toHaveCount(1)
	await profileOption.click()
	await expect(modelSwitcher).toHaveText(PROFILE_NAME)
	await pace()

	server.resetOpenAiMock()
	server.enqueueOpenAiResponses({
		type: "tool",
		id: "call_demo_first_task",
		name: "attempt_completion",
		arguments: { result: COMPLETION_TEXT },
		expectedRequestIncludes: [TASK_TEXT],
	})
	const input = sidebar.getByTestId("chat-input")
	await input.fill(TASK_TEXT)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(COMPLETION_TEXT, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
	await pace()
	await finishRecording()

	const consumptions = server.getMockConsumptions("openai-compatible-chat")
	expect(consumptions).toHaveLength(1)
	expect(consumptions[0]?.contractError).toBeUndefined()
})
