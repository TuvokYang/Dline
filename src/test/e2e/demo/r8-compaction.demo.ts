import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Frame } from "@playwright/test"
import { E2E_PROFILE_NAMES } from "../utils/api-profile"
import { E2ETestHelper } from "../utils/helpers"
import { demo } from "./utils/demo-fixture"
import { dismissDemoNotifications } from "./utils/png-asset"

const TASK_TEXT = "Review the release checklist and keep the next action ready."
const READY_TEXT = "The release checklist is ready. The next action is preserved."
const CONTINUE_TEXT = "Continue with the next release check."
const SUMMARY_TEXT = "Context compacted automatically. Preserved: the release goal, completed checks, and the next action."
const COMPLETION_TEXT = "Context compacted. Continuing with the next release check."
const COMPACT_INSTRUCTION_MARKER = "The current conversation is rapidly running out of context"

interface StoredProfile {
	id: string
	name: string
	modelId?: string
	webToolsMode?: "WEB_TOOLS_MODE_FORCE_OFF"
	openai?: {
		capabilities?: {
			contextWindow?: number
		}
	}
}

async function configureAutoCompaction(dlineDir: string): Promise<void> {
	const profilePath = path.join(dlineDir, "data", "settings", "api_profiles.json")
	const profiles = await E2ETestHelper.waitForValue(async () => {
		try {
			return JSON.parse(await readFile(profilePath, "utf8")) as StoredProfile[]
		} catch {
			return undefined
		}
	}, 15_000)
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!profile?.openai?.capabilities) throw new Error("Missing configurable OpenAI Responses E2E profile")
	profile.modelId = "gpt-5.4-mini"
	profile.webToolsMode = "WEB_TOOLS_MODE_FORCE_OFF"
	profile.openai.capabilities.contextWindow = 131_072
	await writeFile(profilePath, `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settingsPath = path.join(dlineDir, "data", "settings", "settings.json")
	const settings = await E2ETestHelper.waitForValue(async () => {
		try {
			return JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>
		} catch {
			return undefined
		}
	}, 15_000)
	Object.assign(settings, {
		actModeProfile: profile.name,
		actModeProfileId: profile.id,
		planModeProfile: profile.name,
		planModeProfileId: profile.id,
		useAutoCondense: true,
		autoCondenseTriggerPercent: 60,
		autoCondenseMinReserveTokens: 10_000,
		autoCondenseMaxReserveTokens: 40_000,
		autoCondenseMaxContextTokens: 100_000,
		clineWebToolsEnabled: false,
	})
	await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}

async function selectProfile(sidebar: Frame, profileName: string): Promise<void> {
	const modelSwitcher = sidebar.getByRole("button", { name: "Select model" })
	await expect.poll(async () => (await modelSwitcher.innerText()).trim(), { timeout: 20_000 }).not.toContain("Loading profiles")
	if ((await modelSwitcher.innerText()).trim() === profileName) return

	await modelSwitcher.press("Enter")
	const profileOption = sidebar.getByRole("option").filter({ has: sidebar.getByText(profileName, { exact: true }) })
	await expect(profileOption).toHaveCount(1)
	await profileOption.press("Enter")
	await expect(modelSwitcher).toHaveText(profileName)
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled({ timeout: 30_000 })
	await input.fill(text)
	await input.press("Enter")
	await expect(input).toHaveValue("")
}

demo("R8", async ({ dlineDir, finishRecording, helper, pace, page, registerRecording, server, sidebar, userDataDir }) => {
	demo.setTimeout(180_000)
	await configureAutoCompaction(dlineDir)
	await helper.signin(sidebar)
	await selectProfile(sidebar, E2E_PROFILE_NAMES.mockOpenAiResponses)

	server.resetOpenAiMock()
	server.enqueueResponses(
		"openai-compatible-responses",
		{
			type: "tool",
			id: "call_r8_ready",
			name: "qna_respond",
			arguments: { response: READY_TEXT },
			usage: { inputTokens: 125_000, outputTokens: 100 },
			expectedRequestIncludes: [TASK_TEXT],
			matchRequestContract: true,
		},
		{
			type: "tool-with-completion-snapshots",
			id: "call_r8_summary",
			name: "summarize_task",
			arguments: { context: SUMMARY_TEXT },
			toolArgumentChunkSize: 20,
			toolArgumentChunkDelayMs: 600,
			expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER, TASK_TEXT],
			expectedRequestExcludes: [CONTINUE_TEXT],
			matchRequestContract: true,
		},
		{
			type: "tool",
			id: "call_r8_complete",
			name: "attempt_completion",
			arguments: { result: COMPLETION_TEXT },
			delayMs: 2_000,
			usage: { inputTokens: 18_000, outputTokens: 120 },
			expectedRequestIncludes: [SUMMARY_TEXT, CONTINUE_TEXT],
			expectedRequestExcludes: [COMPACT_INSTRUCTION_MARKER],
			matchRequestContract: true,
		},
	)

	await dismissDemoNotifications(page)
	await sendTask(sidebar, TASK_TEXT)
	await expect(sidebar.getByText(READY_TEXT, { exact: false }).last()).toBeVisible({ timeout: 60_000 })

	const taskHeaderToggle = sidebar.locator('[aria-label="Expand task header"], [aria-label="Collapse task header"]')
	await expect(taskHeaderToggle).toHaveCount(1)
	if ((await taskHeaderToggle.getAttribute("aria-label")) === "Expand task header") await taskHeaderToggle.click()
	const contextProgress = sidebar.getByTestId("context-window-segmented-progress")
	await expect(sidebar.getByTestId("context-window-indicator")).toBeVisible({ timeout: 30_000 })
	await expect(contextProgress).toHaveAttribute("data-context-window", "131072")
	await expect
		.poll(async () => Number((await contextProgress.getAttribute("aria-valuenow")) ?? 0), { timeout: 30_000 })
		.toBeGreaterThanOrEqual(120_000)

	await registerRecording("r8-compaction")
	await pace()
	const input = sidebar.getByTestId("chat-input")
	await input.fill(CONTINUE_TEXT)
	await pace(500)
	await input.press("Enter")
	await expect(input).toHaveValue("")

	const compactionPass = sidebar.getByTestId("compaction-pass").last()
	await expect(compactionPass).toBeVisible({ timeout: 60_000 })
	await expect(compactionPass).not.toHaveAttribute("data-compaction-status", "completed")
	await pace()
	await expect(compactionPass).not.toHaveAttribute("data-compaction-status", "completed")
	await expect(compactionPass).toHaveAttribute("data-compaction-status", "completed", { timeout: 60_000 })
	await compactionPass.scrollIntoViewIfNeeded()
	await pace()
	await expect(compactionPass).toHaveAttribute("data-compaction-status", "completed")

	await expect(sidebar.getByText(COMPLETION_TEXT, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
	await expect
		.poll(async () => Number((await contextProgress.getAttribute("aria-valuenow")) ?? Number.POSITIVE_INFINITY), {
			timeout: 30_000,
		})
		.toBeLessThan(40_000)
	await pace()
	await finishRecording()

	await expect(sidebar.getByTestId("compaction-failure")).toHaveCount(0)
	await expect(sidebar.locator('vscode-button[aria-label="Condense Conversation"]')).toHaveCount(0)
	await expect(sidebar.locator('vscode-button[aria-label="Regenerate Summary"]')).toHaveCount(0)
	expect(await sidebar.locator("body").innerText()).not.toContain(COMPACT_INSTRUCTION_MARKER)
	const consumptions = server.getMockConsumptions("openai-compatible-responses")
	expect(consumptions.map(({ responseType }) => responseType)).toEqual(["tool", "tool-with-completion-snapshots", "tool"])
	expect(consumptions[0].toolName).toBe("qna_respond")
	expect(consumptions[2].toolName).toBe("attempt_completion")
	expect(consumptions.every(({ contractError }) => contractError === undefined)).toBe(true)
	await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
})
