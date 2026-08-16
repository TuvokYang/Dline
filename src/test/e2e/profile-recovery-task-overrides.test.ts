import { readdir, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredProfile {
	id: string
	name: string
	modelInfo?: {
		capabilities?: {
			supportsReasoning?: boolean
			thinking?: {
				supported?: boolean
				mode?: string
				effortLevels?: string[]
				maxBudget?: number
			}
		}
	}
	openai?: {
		serviceTier?: string
		reasoning?: {
			enableThinking?: boolean
			effort?: string
			thinkingBudget?: number
		}
		capabilities?: {
			supportsReasoning?: boolean
		}
	}
}

interface StoredTaskSettings {
	actModeProfileId?: string
	actModeProfile?: string
	actModeReasoningOverrideKind?: string
	actModeReasoningOverrideEffort?: string
	actModeServiceTierOverrideKind?: string
	actModeServiceTierOverrideTier?: string
}

const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")

async function configureRecoveryProfileCapabilities(dlineDir: string): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const recoveryProfile = profiles.find((profile) => profile.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!recoveryProfile?.openai?.capabilities) {
		throw new Error("Missing configurable OpenAI Responses E2E profile")
	}
	recoveryProfile.openai.capabilities.supportsReasoning = true
	recoveryProfile.modelInfo = {
		...(recoveryProfile.modelInfo ?? {}),
		capabilities: {
			...(recoveryProfile.modelInfo?.capabilities ?? {}),
			supportsReasoning: true,
			thinking: {
				supported: true,
				mode: "effort",
				effortLevels: ["none", "low", "medium", "high"],
			},
		},
	}
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")
}

async function onlyTaskId(dlineDocsDir: string): Promise<string> {
	return E2ETestHelper.waitForValue(async () => {
		const entries = await readdir(path.join(dlineDocsDir, "tasks"), { withFileTypes: true }).catch(() => [])
		const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
		return ids.length === 1 ? ids[0] : undefined
	}, 30_000)
}

async function readTaskSettings(dlineDocsDir: string, taskId: string): Promise<StoredTaskSettings> {
	return JSON.parse(await readFile(path.join(dlineDocsDir, "tasks", taskId, "settings.json"), "utf8")) as StoredTaskSettings
}

async function selectProfile(sidebar: Frame, profileName: string): Promise<void> {
	const modelSwitcher = sidebar.getByRole("button", { name: "Select model" })
	await modelSwitcher.click()
	await expect(sidebar.getByText("Available Models", { exact: true })).toBeVisible()
	const option = sidebar.getByRole("option").filter({ has: sidebar.getByText(profileName, { exact: true }) })
	await expect(option).toHaveCount(1)
	await option.click()
	await expect(modelSwitcher).toHaveText(profileName, { timeout: 30_000 })
	await expect(sidebar.getByText("Available Models", { exact: true })).not.toBeVisible()
}

async function selectThinkingOverride(sidebar: Frame, optionName: string): Promise<void> {
	const control = sidebar.getByRole("combobox", { name: "Task thinking override" })
	await expect(control).toBeVisible()
	await expect(control).toBeEnabled()
	await control.click()
	await expect(sidebar.getByRole("option", { name: "Profile", exact: true })).toHaveCount(0)
	await sidebar.getByRole("option", { name: optionName, exact: true }).click()
}

async function selectServiceTier(sidebar: Frame, optionName: string): Promise<void> {
	const control = sidebar.getByRole("button", { name: "Task service tier" })
	await expect(control).toBeVisible()
	await expect(control).toBeEnabled()
	await control.click()
	await expect(sidebar.getByRole("listbox", { name: "Task service tier options" })).toBeVisible()
	await expect(sidebar.getByRole("option", { name: "Profile", exact: true })).toHaveCount(0)
	await sidebar.getByRole("option", { name: optionName, exact: true }).click()
}

e2e(
	"Profile recovery clears the stale error and restores Task-local Thinking and Service Tier",
	async ({ dlineDir, dlineDocsDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(240_000)
		await configureRecoveryProfileCapabilities(dlineDir)
		const profileError = `Profile not valid: "${E2E_PROFILE_NAMES.mockOpenAi}" is unavailable.`
		server.enqueueResponses("openai-compatible-chat", {
			type: "error",
			status: 403,
			code: "e2e_profile_not_valid",
			message: profileError,
		})
		let app: ElectronApplication | undefined
		const taskText = "E2E_PROFILE_RECOVERY_TASK"

		try {
			app = await openVSCode(workspaceDir)
			let page = await app.firstWindow()
			await E2ETestHelper.openClineSidebar(page)
			let sidebar = await helper.getSidebar(page)
			await helper.signin(sidebar)

			const input = sidebar.getByTestId("chat-input")
			await input.fill(taskText)
			await sidebar.getByTestId("send-button").click()
			await expect(sidebar.getByText(taskText, { exact: true }).first()).toBeVisible()
			await expect(sidebar.getByText(profileError, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(1)
			await expect(sidebar.locator('vscode-button[aria-label="Retry"]')).toBeVisible()

			await selectProfile(sidebar, E2E_PROFILE_NAMES.mockOpenAiResponses)
			await expect(sidebar.getByText(/Profile not valid:/)).toHaveCount(0)
			await expect(input).toBeEnabled()

			const profileSlot = sidebar.locator('[data-chat-input-slot="profile"]')
			const thinkingControl = sidebar.getByRole("combobox", { name: "Task thinking override" })
			const serviceTierControl = sidebar.getByRole("button", { name: "Task service tier" })
			await expect(profileSlot).toBeVisible()
			await expect(thinkingControl).toBeVisible()
			await expect(serviceTierControl).toBeVisible()
			const profileLayout = await profileSlot.evaluate((element) => ({
				flexShrink: getComputedStyle(element).flexShrink,
				width: element.getBoundingClientRect().width,
			}))
			expect(profileLayout.flexShrink).toBe("0")
			expect(profileLayout.width).toBeGreaterThan(60)
			const thinkingAppearance = await thinkingControl.evaluate((element) => ({
				borderTopWidth: getComputedStyle(element).borderTopWidth,
				svgCount: element.querySelectorAll("svg").length,
			}))
			expect(thinkingAppearance).toEqual({ borderTopWidth: "0px", svgCount: 0 })
			await expect(thinkingControl).toContainText("High")
			await expect(thinkingControl).not.toContainText("Default")
			await expect(serviceTierControl).toHaveAttribute("data-icon-only", "true")
			await expect(serviceTierControl).toHaveAttribute("title", "Service tier: no Task override")
			await expect(serviceTierControl).toHaveText("")
			await expect(serviceTierControl.locator("svg")).toHaveCount(1)
			await expect(sidebar.getByTestId("task-service-tier-icon")).toBeVisible()
			await selectThinkingOverride(sidebar, "Low")
			await selectServiceTier(sidebar, "Priority")

			const taskId = await onlyTaskId(dlineDocsDir)
			await expect
				.poll(async () => readTaskSettings(dlineDocsDir, taskId), { timeout: 30_000 })
				.toMatchObject({
					actModeReasoningOverrideKind: "effort",
					actModeReasoningOverrideEffort: "low",
					actModeServiceTierOverrideKind: "tier",
					actModeServiceTierOverrideTier: "priority",
				})

			const persistedProfiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
			const persistedRecoveryProfile = persistedProfiles.find(
				(profile) => profile.name === E2E_PROFILE_NAMES.mockOpenAiResponses,
			)
			expect(persistedRecoveryProfile?.openai?.reasoning?.effort).toBe("high")
			expect(persistedRecoveryProfile?.openai?.serviceTier).toBeUndefined()

			await sidebar.getByRole("button", { name: "Close Task", exact: true }).click()
			await expect(input).toHaveAttribute("placeholder", "Type your task here...")
			await expect(sidebar.getByRole("combobox", { name: "Task thinking override" })).toHaveCount(0)
			await expect(sidebar.getByRole("button", { name: "Task service tier" })).toHaveCount(0)

			await app.close()
			app = undefined
			helper.clearCachedFrame()
			const taskSettingsPath = path.join(dlineDocsDir, "tasks", taskId, "settings.json")
			const staleNameSettings = await readTaskSettings(dlineDocsDir, taskId)
			await writeFile(
				taskSettingsPath,
				`${JSON.stringify({ ...staleNameSettings, actModeProfile: "stale-profile-name" }, null, 2)}\n`,
				"utf8",
			)

			app = await openVSCode(workspaceDir)
			page = await app.firstWindow()
			await E2ETestHelper.openClineSidebar(page)
			sidebar = await helper.getSidebar(page)
			await helper.signin(sidebar)
			await page.getByRole("button", { name: "History", exact: true }).click()
			await E2ETestHelper.dismissWhatsNewModal(sidebar)
			const historyItem = sidebar.locator(".history-item").filter({ hasText: taskText })
			await expect(historyItem).toHaveCount(1)
			await historyItem.click()
			await expect(sidebar.getByText(taskText, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
			await expect(sidebar.locator('[data-chat-input-slot="profile"]')).toBeVisible()
			await expect(sidebar.getByRole("button", { name: "Select model" })).toHaveText(E2E_PROFILE_NAMES.mockOpenAiResponses)
			await expect(sidebar.getByRole("combobox", { name: "Task thinking override" })).toContainText("Low")
			await expect(sidebar.getByRole("button", { name: "Task service tier" })).toHaveAttribute(
				"title",
				"Service tier: Priority",
			)
			await expect(sidebar.getByTestId("task-service-tier-icon")).toBeVisible()
			await expect(sidebar.getByText(/Profile not valid:/)).toHaveCount(0)
			await expect(sidebar.getByRole("combobox", { name: "Task thinking override" })).toBeEnabled()
			await expect(sidebar.getByRole("button", { name: "Task service tier" })).toBeEnabled()
			await selectThinkingOverride(sidebar, "Medium")
			await selectServiceTier(sidebar, "Flex")
			await expect
				.poll(async () => readTaskSettings(dlineDocsDir, taskId), { timeout: 30_000 })
				.toMatchObject({
					actModeProfileId: staleNameSettings.actModeProfileId,
					actModeProfile: E2E_PROFILE_NAMES.mockOpenAiResponses,
					actModeReasoningOverrideKind: "effort",
					actModeReasoningOverrideEffort: "medium",
					actModeServiceTierOverrideKind: "tier",
					actModeServiceTierOverrideTier: "flex",
				})

			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/Profile not valid:/, /e2e_profile_not_valid/])
		} finally {
			await app?.close()
		}
	},
)
