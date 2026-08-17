import { readdir, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page, type TestInfo } from "@playwright/test"
import type { ClineApiServerMock, MockApiTarget } from "./fixtures/server"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredProfile {
	id: string
	name: string
	provider: string
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
	[key: string]: unknown
}

interface StoredTaskSettings {
	actModeReasoningOverrideKind?: string
	actModeReasoningOverrideEffort?: string
	actModeThinkingBudgetTokens?: number
	actModeServiceTierOverrideKind?: string
	actModeServiceTierOverrideTier?: string
}

interface ThinkingCapability {
	supported: true
	mode: "effort" | "budget"
	effortLevels?: string[]
	maxBudget?: number
}

const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")
const settingsPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "settings.json")

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

async function configureDefaultProfile(
	dlineDir: string,
	profileName: string,
	thinking?: ThinkingCapability,
): Promise<StoredProfile> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === profileName)
	if (!profile) throw new Error(`Missing E2E Profile: ${profileName}`)
	profile.webSearchMode = "WEB_SEARCH_MODE_FORCE_OFF"

	if (thinking) {
		const providerConfig = asRecord(profile[profile.provider])
		profile[profile.provider] = {
			...providerConfig,
			capabilities: {
				...asRecord(providerConfig.capabilities),
				supportsReasoning: true,
				thinking,
			},
		}
		profile.modelInfo = {
			...(profile.modelInfo ?? {}),
			capabilities: {
				...(profile.modelInfo?.capabilities ?? {}),
				supportsReasoning: true,
				thinking,
			},
		}
	}

	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	await Promise.all([
		writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8"),
		writeFile(
			settingsPath(dlineDir),
			`${JSON.stringify(
				{
					...settings,
					actModeProfile: profile.name,
					actModeProfileId: profile.id,
					planModeProfile: profile.name,
					planModeProfileId: profile.id,
				},
				null,
				2,
			)}\n`,
			"utf8",
		),
	])
	return profile
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

async function startTaskAndWaitForRuntimeControls(
	sidebar: Frame,
	target: MockApiTarget,
	server: ClineApiServerMock,
	markers: { task: string; prompt: string; completion: string },
): Promise<void> {
	server.enqueueResponses(
		target,
		{
			type: "tool",
			name: "qna_respond",
			arguments: { response: markers.prompt },
			delayMs: 1_000,
		},
		{
			type: "tool",
			name: "attempt_completion",
			arguments: { result: markers.completion },
		},
	)

	const input = sidebar.getByTestId("chat-input")
	await input.fill(markers.task)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByRole("combobox", { name: "Task thinking override" })).toHaveCount(0)
	await expect(sidebar.getByRole("button", { name: "Task service tier" })).toHaveCount(0)
	await expect(sidebar.locator("[data-chat-input-runtime-controls] [disabled]")).toHaveCount(0)
	await expect(sidebar.getByText(markers.prompt, { exact: true })).toBeVisible({ timeout: 60_000 })
	await expect.poll(() => server.getRequestCount(target)).toBe(1)
}

async function selectThinkingOverride(sidebar: Frame, optionName: string): Promise<void> {
	const control = sidebar.getByRole("combobox", { name: "Task thinking override" })
	await expect(control).toBeVisible()
	await expect(control).toBeEnabled()
	await control.click()
	await expect(sidebar.getByRole("option", { name: "Profile", exact: true })).toHaveCount(0)
	await sidebar.getByRole("option", { name: optionName, exact: true }).click()
	await expect(control).toContainText(optionName)
}

async function selectServiceTier(sidebar: Frame, optionName: string): Promise<void> {
	const control = sidebar.getByRole("button", { name: "Task service tier" })
	await expect(control).toBeVisible()
	await expect(control).toBeEnabled()
	await control.click()
	await expect(sidebar.getByRole("listbox", { name: "Task service tier options" })).toBeVisible()
	await expect(sidebar.getByRole("option", { name: "Profile", exact: true })).toHaveCount(0)
	await sidebar.getByRole("option", { name: optionName, exact: true }).click()
	await expect(control).toHaveAttribute("title", `Service tier: ${optionName}`)
}

async function submitFeedback(sidebar: Frame, feedback: string, completion: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled()
	await input.fill(feedback)
	await input.press("Enter")
	await expect(sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
}

async function captureRuntimeControls(page: Page, sidebar: Frame, testInfo: TestInfo, name: string): Promise<void> {
	const pagePath = testInfo.outputPath(`${name}-vscode.png`)
	await page.screenshot({ path: pagePath })
	await testInfo.attach(`${name}-vscode`, { path: pagePath, contentType: "image/png" })

	const controlsPath = testInfo.outputPath(`${name}-controls.png`)
	await sidebar.locator("[data-chat-input-runtime-controls]").screenshot({ path: controlsPath })
	await testInfo.attach(`${name}-controls`, { path: controlsPath, contentType: "image/png" })
}

async function expectEqualVisibleGaps(sidebar: Frame): Promise<void> {
	const profile = sidebar.getByRole("button", { name: "Select model" })
	const thinking = sidebar.getByRole("combobox", { name: "Task thinking override" })
	const tier = sidebar.getByRole("button", { name: "Task service tier" })
	const boxes = await Promise.all([profile.boundingBox(), thinking.boundingBox(), tier.boundingBox()])
	if (boxes.some((box) => box === null)) throw new Error("Runtime control geometry is unavailable")
	const [profileBox, thinkingBox, tierBox] = boxes as NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>[]
	const profileToThinking = thinkingBox.x - (profileBox.x + profileBox.width)
	const thinkingToTier = tierBox.x - (thinkingBox.x + thinkingBox.width)

	expect(profileToThinking).toBeGreaterThanOrEqual(3)
	expect(thinkingToTier).toBeGreaterThanOrEqual(3)
	expect(Math.abs(profileToThinking - thinkingToTier)).toBeLessThanOrEqual(1)
}

async function openSidebar(page: Page, helper: E2ETestHelper): Promise<Frame> {
	await E2ETestHelper.openClineSidebar(page)
	const sidebar = await helper.getSidebar(page)
	await helper.signin(sidebar)
	return sidebar
}

e2e(
	"Task runtime controls - OpenAI effort and Service Tier are actionable, equidistant, persisted, and used by the next request",
	async ({ dlineDir, dlineDocsDir, helper, openVSCode, server, userDataDir, workspaceDir }, testInfo) => {
		e2e.setTimeout(240_000)
		await configureDefaultProfile(dlineDir, E2E_PROFILE_NAMES.mockOpenAi, {
			supported: true,
			mode: "effort",
			effortLevels: ["none", "low", "medium", "high", "xhigh", "max"],
		})
		const app = await openVSCode(workspaceDir)
		try {
			const page = await app.firstWindow()
			const sidebar = await openSidebar(page, helper)
			const markers = {
				task: "E2E_OPENAI_RUNTIME_CONTROLS_TASK",
				prompt: "E2E_OPENAI_RUNTIME_CONTROLS_READY",
				completion: "E2E_OPENAI_RUNTIME_CONTROLS_DONE",
			}
			await startTaskAndWaitForRuntimeControls(sidebar, "openai-compatible-chat", server, markers)
			await expectEqualVisibleGaps(sidebar)
			await selectThinkingOverride(sidebar, "Low")
			await selectServiceTier(sidebar, "Priority")
			await captureRuntimeControls(page, sidebar, testInfo, "openai-runtime-controls")

			const taskId = await onlyTaskId(dlineDocsDir)
			await expect
				.poll(async () => readTaskSettings(dlineDocsDir, taskId), { timeout: 30_000 })
				.toMatchObject({
					actModeReasoningOverrideKind: "effort",
					actModeReasoningOverrideEffort: "low",
					actModeServiceTierOverrideKind: "tier",
					actModeServiceTierOverrideTier: "priority",
				})

			await submitFeedback(sidebar, "E2E_OPENAI_RUNTIME_CONTROLS_FEEDBACK", markers.completion)
			await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(2)
			const nextRequest = server.getMockConsumptions("openai-compatible-chat")[1]
			expect(nextRequest.thinking).toEqual({ mode: "effort", effort: "low" })
			expect(nextRequest.requestBody).toMatchObject({ service_tier: "priority" })
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Task runtime controls - DeepSeek exposes Low, High and Max, persists Max, and uses it in the next request",
	async ({ dlineDir, dlineDocsDir, helper, openVSCode, server, userDataDir, workspaceDir }, testInfo) => {
		e2e.setTimeout(240_000)
		const profileBefore = await configureDefaultProfile(dlineDir, E2E_PROFILE_NAMES.mockDeepSeek)
		const app = await openVSCode(workspaceDir)
		try {
			const page = await app.firstWindow()
			const sidebar = await openSidebar(page, helper)
			const markers = {
				task: "E2E_DEEPSEEK_RUNTIME_CONTROLS_TASK",
				prompt: "E2E_DEEPSEEK_RUNTIME_CONTROLS_READY",
				completion: "E2E_DEEPSEEK_RUNTIME_CONTROLS_DONE",
			}
			await startTaskAndWaitForRuntimeControls(sidebar, "deepseek-chat", server, markers)
			const thinking = sidebar.getByRole("combobox", { name: "Task thinking override" })
			await expect(thinking).toBeEnabled()
			await thinking.click()
			await expect(sidebar.getByRole("option", { name: "Low", exact: true })).toBeVisible()
			await expect(sidebar.getByRole("option", { name: "High", exact: true })).toBeVisible()
			await expect(sidebar.getByRole("option", { name: "Max", exact: true })).toBeVisible()
			await expect(sidebar.getByRole("option", { name: "Xhigh", exact: true })).toHaveCount(0)
			await sidebar.getByRole("option", { name: "Max", exact: true }).click()
			await expect(sidebar.getByRole("button", { name: "Task service tier" })).toHaveCount(0)
			await captureRuntimeControls(page, sidebar, testInfo, "deepseek-runtime-controls")

			const taskId = await onlyTaskId(dlineDocsDir)
			await expect
				.poll(async () => readTaskSettings(dlineDocsDir, taskId), { timeout: 30_000 })
				.toMatchObject({
					actModeReasoningOverrideKind: "effort",
					actModeReasoningOverrideEffort: "max",
				})

			await submitFeedback(sidebar, "E2E_DEEPSEEK_RUNTIME_CONTROLS_FEEDBACK", markers.completion)
			await expect.poll(() => server.getRequestCount("deepseek-chat")).toBe(2)
			expect(server.getMockConsumptions("deepseek-chat")[1].thinking).toEqual({ mode: "effort", effort: "max" })

			const persistedProfiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
			const persisted = persistedProfiles.find((profile) => profile.id === profileBefore.id)
			expect(asRecord(asRecord(persisted?.deepseek).reasoning).effort).toBe("high")
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Task runtime controls - a budget Provider edits tokens without Service Tier, persists them, and uses them in the next request",
	async ({ dlineDir, dlineDocsDir, helper, openVSCode, server, userDataDir, workspaceDir }, testInfo) => {
		e2e.setTimeout(240_000)
		const profileBefore = await configureDefaultProfile(dlineDir, E2E_PROFILE_NAMES.mockAnthropic, {
			supported: true,
			mode: "budget",
			effortLevels: [],
			maxBudget: 16_384,
		})
		const app = await openVSCode(workspaceDir)
		try {
			const page = await app.firstWindow()
			const sidebar = await openSidebar(page, helper)
			const markers = {
				task: "E2E_BUDGET_RUNTIME_CONTROLS_TASK",
				prompt: "E2E_BUDGET_RUNTIME_CONTROLS_READY",
				completion: "E2E_BUDGET_RUNTIME_CONTROLS_DONE",
			}
			await startTaskAndWaitForRuntimeControls(sidebar, "anthropic-messages", server, markers)
			await expect(sidebar.getByRole("combobox", { name: "Task thinking override" })).toContainText("Budget")
			await expect(sidebar.getByRole("button", { name: "Task service tier" })).toHaveCount(0)
			const budget = sidebar.getByRole("spinbutton", { name: "Task thinking budget" })
			await expect(budget).toBeEnabled()
			await budget.fill("4096")
			await budget.press("Enter")
			await captureRuntimeControls(page, sidebar, testInfo, "budget-runtime-controls")

			const taskId = await onlyTaskId(dlineDocsDir)
			await expect
				.poll(async () => readTaskSettings(dlineDocsDir, taskId), { timeout: 30_000 })
				.toMatchObject({
					actModeReasoningOverrideKind: "budget",
					actModeThinkingBudgetTokens: 4_096,
				})

			await submitFeedback(sidebar, "E2E_BUDGET_RUNTIME_CONTROLS_FEEDBACK", markers.completion)
			await expect.poll(() => server.getRequestCount("anthropic-messages")).toBe(2)
			expect(server.getMockConsumptions("anthropic-messages")[1].thinking).toEqual({ mode: "budget", budget: 4_096 })

			const persistedProfiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
			const persisted = persistedProfiles.find((profile) => profile.id === profileBefore.id)
			expect(asRecord(asRecord(persisted?.anthropic).reasoning).thinkingBudget).toBe(2_048)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)
