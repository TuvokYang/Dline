import { readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame } from "@playwright/test"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredProfile {
	name: string
	webSearchMode?: string
}

interface ContextWindowVisualState {
	contextWindow: number
	minorFactor: number
	phase?: string
	receivingTokens: number
	segmentKinds: string[]
	totalTokens: number
}

const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")
const settingsPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "settings.json")

async function configureHostedResponsesProfile(dlineDir: string): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiOfficialResponses)
	if (!profile) throw new Error("Official OpenAI E2E profile is missing")
	profile.webSearchMode = "WEB_SEARCH_MODE_AUTO"
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	settings.actModeProfile = E2E_PROFILE_NAMES.mockOpenAiOfficialResponses
	settings.planModeProfile = E2E_PROFILE_NAMES.mockOpenAiOfficialResponses
	settings.clineWebToolsEnabled = true
	settings.useAutoCondense = false
	await writeFile(settingsPath(dlineDir), `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}

async function selectProfile(sidebar: Frame, profileName: string): Promise<void> {
	const modelSwitcher = sidebar.getByRole("button", { name: "Select model" })
	if ((await modelSwitcher.innerText()).trim() === profileName) return
	await modelSwitcher.click()
	await expect(sidebar.getByText("Available Models", { exact: true })).toBeVisible()
	const profileOption = sidebar.getByRole("option").filter({ has: sidebar.getByText(profileName, { exact: true }) })
	await expect(profileOption).toHaveCount(1)
	await profileOption.click()
	await expect(modelSwitcher).toHaveText(profileName)
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

async function expandTaskHeader(sidebar: Frame): Promise<void> {
	const expand = sidebar.getByLabel("Expand task header")
	if (await expand.isVisible()) await expand.click()
	await expect(sidebar.getByTestId("context-window-indicator")).toBeVisible({ timeout: 60_000 })
}

async function readContextWindowVisual(sidebar: Frame): Promise<ContextWindowVisualState> {
	return sidebar.getByTestId("context-window-segmented-progress").evaluate((progress) => {
		const element = progress as HTMLElement
		const segments = Array.from(element.querySelectorAll<HTMLElement>("[data-segment]"))
		const receiving = segments.find((segment) => segment.dataset.segment === "receiving")
		return {
			contextWindow: Number(element.dataset.contextWindow ?? 0),
			minorFactor: Number(element.dataset.minorFactor ?? 1),
			phase: element.dataset.phase,
			receivingTokens: Number(receiving?.dataset.authoritativeTokens ?? 0),
			segmentKinds: segments.map((segment) => segment.dataset.segment ?? ""),
			totalTokens: segments.reduce((total, segment) => total + Number(segment.dataset.authoritativeTokens ?? 0), 0),
		}
	})
}

e2e(
	"Context indicator - hosted tool results never inflate Receiving and exact usage calibrates the request",
	async ({ dlineDir, helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await configureHostedResponsesProfile(dlineDir)
		server.resetOpenAiMock()

		const query = "E2E_CONTEXT_RECEIVING_HOSTED_QUERY"
		server.enqueueResponses("openai-official-responses", {
			type: "hosted-web-search",
			id: "ws_context_receiving_large_result",
			query,
			results: [
				{
					title: "Large provider-hosted result",
					url: "https://example.test/context-receiving-large-result",
					snippet: "R".repeat(48_000),
				},
			],
			usage: { inputTokens: 1_200, outputTokens: 800 },
			beforeUsageDelayMs: 5_000,
			afterUsageHoldMs: 20_000,
		})

		await helper.signin(sidebar)
		await selectProfile(sidebar, E2E_PROFILE_NAMES.mockOpenAiOfficialResponses)
		await sendTask(sidebar, "Use hosted search, then present the requested plan.")
		await expect(sidebar.getByText("Dline wants to search the web for:", { exact: false })).toBeVisible({ timeout: 60_000 })
		await sidebar.getByRole("contentinfo").getByText("Approve", { exact: true }).click()
		await expect(sidebar.getByTestId("web-search-card").filter({ hasText: query })).toBeVisible({ timeout: 60_000 })
		await expandTaskHeader(sidebar)

		const progress = sidebar.getByTestId("context-window-segmented-progress")
		await expect(progress).toHaveAttribute("data-phase", "receiving")
		const beforeExactUsage = await readContextWindowVisual(sidebar)
		expect(beforeExactUsage.segmentKinds).toEqual(["durable", "sending", "receiving", "environment"])
		expect(beforeExactUsage.minorFactor).toBeLessThanOrEqual(3)
		expect(beforeExactUsage.receivingTokens).toBeGreaterThan(0)
		expect(beforeExactUsage.receivingTokens).toBeLessThan(1_000)

		await expect(sidebar.getByTestId("context-window-segment-receiving")).toHaveAttribute(
			"data-authoritative-tokens",
			"800",
			{ timeout: 45_000 },
		)
		await expect(progress).toHaveAttribute("aria-valuenow", "2000")
		const calibrated = await readContextWindowVisual(sidebar)
		expect(calibrated).toMatchObject({
			phase: "receiving",
			receivingTokens: 800,
			segmentKinds: ["durable", "sending", "receiving", "environment"],
			totalTokens: 2_000,
		})
		expect(calibrated.minorFactor).toBeLessThanOrEqual(3)

		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
