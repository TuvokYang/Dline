import { access, readFile } from "node:fs/promises"
import * as path from "node:path"
import { expect } from "@playwright/test"
import packageJson from "../../../package.json"
import { E2ETestHelper, e2e } from "./utils/helpers"
import {
	ensureLegacyE2EFixture,
	LEGACY_COMPATIBLE_PROFILE_ID,
	LEGACY_COMPLETION_TEXT,
	LEGACY_OPENAI_PROFILE_ID,
	LEGACY_OPENAI_PROFILE_NAME,
	LEGACY_TASK_ID,
	LEGACY_TASK_TEXT,
	recordLegacyE2EValidation,
} from "./utils/legacy-state"

async function exists(filePath: string): Promise<boolean> {
	return access(filePath)
		.then(() => true)
		.catch(() => false)
}

async function readJson<T>(filePath: string): Promise<T> {
	return JSON.parse(await readFile(filePath, "utf8")) as T
}

interface MigratedProfile {
	id?: string
	provider?: string
	apiKey?: string
	openaiNative?: unknown
	openai?: {
		apiFormat?: string
		apiEndpoint?: string
	}
}

const legacyE2E = e2e.extend({
	workspaceDir: async ({ channel: _channel }, use) => use((await ensureLegacyE2EFixture()).workspaceDir),
	dlineDir: async ({ channel: _channel }, use) => use((await ensureLegacyE2EFixture()).dlineDir),
	dlineHomeDir: async ({ channel: _channel }, use) => use((await ensureLegacyE2EFixture()).dlineDir),
	dlineDocsDir: async ({ channel: _channel }, use) => use((await ensureLegacyE2EFixture()).dlineDocsDir),
})

legacyE2E.describe.configure({ mode: "serial" })

legacyE2E(
	"upgrades persistent legacy profiles, settings, history, and task data in place",
	async ({ dlineDir, dlineDocsDir, helper, sidebar, userDataDir }) => {
		await helper.signin(sidebar)
		await expect(sidebar.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByRole("button", { name: "Select model" })).toContainText(LEGACY_OPENAI_PROFILE_NAME)

		const profilesPath = path.join(dlineDir, "data", "settings", "api_profiles.json")
		const settingsPath = path.join(dlineDir, "data", "settings", "settings.json")
		const apiKeysPath = path.join(dlineDir, "data", "secrets", "api_keys.json")

		await expect
			.poll(async () => {
				const profiles = await readJson<MigratedProfile[]>(profilesPath)
				const native = profiles.find((profile) => profile.id === LEGACY_OPENAI_PROFILE_ID)
				const compatible = profiles.find((profile) => profile.id === LEGACY_COMPATIBLE_PROFILE_ID)
				return (
					native?.provider === "openai" &&
					native.openai?.apiFormat === "OPENAI_RESPONSES" &&
					native.openaiNative === undefined &&
					native.apiKey === undefined &&
					compatible?.openai?.apiFormat === "OPENAI_CHAT" &&
					compatible.openai?.apiEndpoint === undefined &&
					compatible.apiKey === undefined
				)
			})
			.toBe(true)

		const settings = await readJson<Record<string, unknown>>(settingsPath)
		expect(settings).toMatchObject({
			__settingsMigrationVersion: 1,
			planModeProfile: LEGACY_OPENAI_PROFILE_NAME,
			actModeProfile: LEGACY_OPENAI_PROFILE_NAME,
			enableParallelToolCalling: true,
		})
		const apiKeys = await readJson<Record<string, { apiKey: string }>>(apiKeysPath)
		expect(apiKeys[LEGACY_OPENAI_PROFILE_ID]?.apiKey).toBe("sk-dline-e2e-legacy-fake")
		expect(apiKeys[LEGACY_COMPATIBLE_PROFILE_ID]?.apiKey).toBe("sk-dline-e2e-legacy-fake-compatible")

		const historyTask = sidebar.getByText(LEGACY_TASK_TEXT, { exact: true }).last()
		await expect(historyTask).toBeVisible({ timeout: 30_000 })
		await historyTask.click()
		await expect(sidebar.getByText(LEGACY_COMPLETION_TEXT, { exact: true })).toBeVisible({ timeout: 30_000 })

		const tasksDir = path.join(dlineDocsDir, "tasks")
		const taskDir = path.join(tasksDir, LEGACY_TASK_ID)
		await expect.poll(() => exists(path.join(tasksDir, "taskHistory.jsonl"))).toBe(true)
		await expect.poll(() => exists(path.join(tasksDir, "taskHistory.json.bak"))).toBe(true)
		await expect.poll(() => exists(path.join(taskDir, "ui_messages.jsonl"))).toBe(true)
		await expect.poll(() => exists(path.join(taskDir, "api_conversation_history.jsonl"))).toBe(true)

		const output = await E2ETestHelper.readDlineOutput(userDataDir)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		const unexpectedWarnings = output
			.split(/\r?\n/)
			.filter((line) => /\[warn\]/i.test(line))
			.filter((line) => !line.includes("No user found after restoring auth token"))
		expect(unexpectedWarnings, `Unexpected Dline warnings:\n${unexpectedWarnings.join("\n")}`).toEqual([])
		expect(output.split(/\r?\n/).length, "Dline startup log unexpectedly expanded").toBeLessThan(1_500)

		await recordLegacyE2EValidation(packageJson.version)
	},
)
