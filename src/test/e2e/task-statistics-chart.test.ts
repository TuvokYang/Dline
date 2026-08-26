import { readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Frame, type Locator, type TestInfo } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"
import { seedTaskStatistics } from "./utils/seed-task-statistics"

const TASK_TEXT = "E2E_TASK_STATISTICS_CHART"
const COMPLETION_TEXT = "E2E_TASK_STATISTICS_CHART_READY"
const GRPC_METHOD = "getTaskRateMetrics"

interface GrpcLogEntry {
	service?: string
	method?: string
	status?: string
}

interface GrpcSessionLog {
	entries?: GrpcLogEntry[]
}

interface StoredProfile {
	name: string
	webSearchMode?: string
}

e2e.use({ grpcRecorderEnabled: true })

async function configureProfileBeforeLaunch(dlineDir: string): Promise<void> {
	const settingsDirectory = path.join(dlineDir, "data", "settings")
	const profilesPath = path.join(settingsDirectory, "api_profiles.json")
	const profiles = JSON.parse(await readFile(profilesPath, "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!profile) throw new Error(`Missing Task statistics E2E profile: ${E2E_PROFILE_NAMES.mockOpenAiResponses}`)
	profile.webSearchMode = "WEB_SEARCH_MODE_FORCE_OFF"
	await writeFile(profilesPath, `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settingsPath = path.join(settingsDirectory, "settings.json")
	const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>
	settings.actModeProfile = E2E_PROFILE_NAMES.mockOpenAiResponses
	settings.planModeProfile = E2E_PROFILE_NAMES.mockOpenAiResponses
	settings.clineWebToolsEnabled = false
	await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}

async function openSidebar(app: ElectronApplication, helper: E2ETestHelper): Promise<Frame> {
	const page = await app.firstWindow()
	await E2ETestHelper.openClineSidebar(page)
	const sidebar = await helper.getSidebar(page)
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
	await helper.signin(sidebar)
	await sidebar.evaluate(() => {
		document.documentElement.style.width = "1100px"
		document.body.style.width = "1100px"
	})
	return sidebar
}

async function onlyTaskId(dlineDocsDir: string): Promise<string> {
	return E2ETestHelper.waitForValue(async () => {
		const entries = await readdir(path.join(dlineDocsDir, "tasks"), { withFileTypes: true }).catch(() => [])
		const taskIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
		return taskIds.length === 1 ? taskIds[0] : undefined
	}, 30_000)
}

async function closeCurrentTask(sidebar: Frame): Promise<void> {
	const closeButton = sidebar.getByRole("button", { name: "Close Task", exact: true })
	await expect(closeButton).toBeVisible()
	await closeButton.click()
	await expect(sidebar.getByTestId("chat-input")).toHaveAttribute("placeholder", "Type your task here...")
}

async function reopenTaskFromHistory(app: ElectronApplication, sidebar: Frame): Promise<void> {
	const page = await app.firstWindow()
	await page.getByRole("button", { name: "History", exact: true }).click()
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
	const historyTask = sidebar.locator(".history-item").filter({ hasText: TASK_TEXT })
	await expect(historyTask).toHaveCount(1)
	await historyTask.click()
	await expect(sidebar.getByText(TASK_TEXT, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
	await expect(sidebar.getByRole("button", { name: "Close Task", exact: true })).toBeVisible({ timeout: 30_000 })
}

function grpcLogPath(testInfo: TestInfo): string {
	const fileName = E2ETestHelper.generateTestFileName(testInfo.title, testInfo.project.name)
	return path.join(E2ETestHelper.CODEBASE_ROOT_DIR, "tests", "specs", `grpc_recorded_session_${fileName}.json`)
}

async function readRateMetricsRpcCount(logPath: string): Promise<number | undefined> {
	const raw = await readFile(logPath, "utf8").catch(() => undefined)
	if (!raw) return 0
	try {
		const session = JSON.parse(raw) as GrpcSessionLog
		return (session.entries ?? []).filter(
			(entry) => entry.service === "dline.TaskService" && entry.method === GRPC_METHOD && entry.status === "completed",
		).length
	} catch (error) {
		if (error instanceof SyntaxError) return undefined
		throw error
	}
}

async function waitForRateMetricsRpcCount(logPath: string, expected: number): Promise<void> {
	await expect.poll(() => readRateMetricsRpcCount(logPath), { timeout: 30_000 }).toBe(expected)
}

async function captureDialog(dialog: Locator, testInfo: TestInfo, fileName: string): Promise<void> {
	const screenshotPath = testInfo.outputPath(fileName)
	await dialog.screenshot({ animations: "disabled", path: screenshotPath })
	await testInfo.attach(fileName, { path: screenshotPath, contentType: "image/png" })
}

async function expectTooltipWithinDialog(dialog: Locator, tooltip: Locator): Promise<void> {
	await expect
		.poll(async () => {
			const [dialogBox, tooltipBox] = await Promise.all([dialog.boundingBox(), tooltip.boundingBox()])
			if (!dialogBox || !tooltipBox) return false
			return (
				tooltipBox.x >= dialogBox.x &&
				tooltipBox.y >= dialogBox.y &&
				tooltipBox.x + tooltipBox.width <= dialogBox.x + dialogBox.width &&
				tooltipBox.y + tooltipBox.height <= dialogBox.y + dialogBox.height
			)
		})
		.toBe(true)
}

async function assertDefaultUsageCacheChart(dialog: Locator): Promise<void> {
	await expect(dialog.getByRole("tab", { name: "Round", exact: true })).toHaveAttribute("aria-selected", "true")
	await expect(dialog.getByRole("radio", { name: "Usage & Cache", exact: true })).toHaveAttribute("aria-checked", "true")
	await expect(dialog.getByRole("radiogroup", { name: "Chart type" })).toHaveCount(0)

	const chart = dialog.getByRole("img", { name: "Task usage and cache hit history chart", exact: true })
	await expect(chart).toBeVisible({ timeout: 30_000 })
	await expect(chart).toHaveAttribute("data-left-axis", "tokens")
	await expect(chart).toHaveAttribute("data-right-axis", "cache-hit-rate")
	const legendItems = dialog.getByTestId("task-usage-cache-legend-item")
	await expect(legendItems).toHaveCount(5)
	await expect(legendItems).toHaveText(["Input", "Output", "Cache Creation", "Cache Read", "Cache Hit Rate"])
	await expect(dialog.getByTestId("task-usage-cache-percentage-tick")).toHaveText(["0%", "20%", "40%", "60%", "80%", "100%"])

	for (const [key, color] of [
		["input", "--vscode-charts-blue"],
		["output", "--vscode-charts-green"],
		["cacheWrite", "--vscode-charts-orange"],
		["cacheRead", "--vscode-charts-cyan"],
	] as const) {
		const line = dialog.locator(`[data-testid^="task-usage-cache-line-${key}-"]`).first()
		await expect(line).toBeVisible()
		await expect(line).toHaveAttribute("stroke", new RegExp(color))
		await expect(line).not.toHaveAttribute("stroke-dasharray")
	}
	const cacheHitLine = dialog.locator('[data-testid^="task-usage-cache-line-cacheHit-"]').first()
	await expect(cacheHitLine).toBeVisible()
	await expect(cacheHitLine).toHaveAttribute("stroke", /--vscode-charts-purple/)
	await expect(cacheHitLine).toHaveAttribute("stroke-dasharray", "6 4")
	await expect(dialog.getByTestId("task-usage-cache-point-cacheHit-0")).toHaveAttribute("data-value", "0")
}

e2e(
	"Task statistics chart renders dual axes, accessible tooltips, and local view interactions",
	async ({ dlineDir, dlineDocsDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(240_000)
		const testInfo = e2e.info()
		const recorderPath = grpcLogPath(testInfo)
		await rm(recorderPath, { force: true })
		await configureProfileBeforeLaunch(dlineDir)
		server.resetOpenAiMock()
		server.enqueueResponses("openai-compatible-responses", {
			type: "tool",
			id: "call_task_statistics_ready",
			name: "attempt_completion",
			arguments: { result: COMPLETION_TEXT },
			usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 0 },
		})

		let app: ElectronApplication | undefined
		let reopenedApp: ElectronApplication | undefined
		try {
			app = await openVSCode(workspaceDir)
			let sidebar = await openSidebar(app, helper)
			const input = sidebar.getByTestId("chat-input")
			await input.fill(TASK_TEXT)
			await input.press("Enter")
			await expect(sidebar.getByText(COMPLETION_TEXT, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			expect(server.getMockConsumptions("openai-compatible-responses")).toHaveLength(1)
			expect(server.getMockConsumptions("openai-compatible-responses")[0]?.contractError).toBeUndefined()

			const taskId = await onlyTaskId(dlineDocsDir)
			await closeCurrentTask(sidebar)
			await app.close()
			app = undefined
			helper.clearCachedFrame()

			const seeded = await seedTaskStatistics(dlineDocsDir, taskId)
			reopenedApp = await openVSCode(workspaceDir)
			sidebar = await openSidebar(reopenedApp, helper)
			await reopenTaskFromHistory(reopenedApp, sidebar)

			const rate = sidebar.getByTestId("task-rate-metrics")
			await expect(rate).toBeVisible({ timeout: 30_000 })
			await expect(rate).toHaveAttribute("aria-label", new RegExp(`Requests per minute: ${seeded.expectedHeaderRpm}`))
			await expect(rate).toHaveAttribute("aria-label", new RegExp(`Hit: ${seeded.expectedCacheHitPercent.toFixed(1)}%`))
			expect(server.getMockConsumptions("openai-compatible-responses")).toHaveLength(1)
			await waitForRateMetricsRpcCount(recorderPath, 0)

			await rate.click()
			const dialog = sidebar.getByRole("dialog")
			await expect(dialog.getByRole("heading", { name: "API rate history", exact: true })).toBeVisible()
			await assertDefaultUsageCacheChart(dialog)
			await waitForRateMetricsRpcCount(recorderPath, 1)
			await captureDialog(dialog, testInfo, "task-statistics-round-usage-cache.png")

			const secondHitArea = dialog.getByTestId("task-usage-cache-hit-area-1")
			await secondHitArea.hover({ force: true })
			let tooltip = dialog.getByRole("tooltip")
			await expect(tooltip).toContainText(`Round: ${taskId}:e2e-statistics:provider:1`)
			await expect(tooltip).toContainText("Logical request: e2e-statistics-2")
			await expect(tooltip).toContainText("API index: 1")
			await expect(tooltip).toContainText("Task attempt: 0")
			await expect(tooltip).toContainText("Provider attempt: 1")
			await expect(tooltip).toContainText("Status: Completed")
			await expect(tooltip).toContainText("Input: 800")
			await expect(tooltip).toContainText("Output: 300")
			await expect(tooltip).toContainText("Cache Creation: 200")
			await expect(tooltip).toContainText("Cache Read: 400")
			await expect(tooltip).toContainText("Cache Hit Rate: 28.6%")
			await expect(tooltip).toContainText("Provider duration: 2,000 ms")
			await expect(tooltip).toContainText("RPM: 30")
			await expect(tooltip).toContainText("Total Tokens: 1,700")
			await expect(tooltip).toContainText("Quality: Exact")
			await expect(tooltip).toContainText("Provisional: No")
			await expect(tooltip).toContainText("History: Complete")
			await expectTooltipWithinDialog(dialog, tooltip)
			await captureDialog(dialog, testInfo, "task-statistics-round-usage-cache-hover-tooltip.png")

			await dialog.getByTestId("task-usage-cache-hit-area-2").focus()
			tooltip = dialog.getByRole("tooltip")
			await expect(tooltip).toContainText("Logical request: e2e-statistics-3")
			await expect(tooltip).toContainText("Provider attempt: 2")
			await expect(tooltip).toContainText("Cache Hit Rate: 33.3%")
			await expect(tooltip).toContainText("Provider duration: 3,000 ms")
			await expect(tooltip).toContainText("RPM: 20")
			await expectTooltipWithinDialog(dialog, tooltip)
			await captureDialog(dialog, testInfo, "task-statistics-round-usage-cache-focus-tooltip.png")

			await dialog.getByRole("radio", { name: "TPM", exact: true }).click()
			await expect(dialog.getByRole("radio", { name: "Line", exact: true })).toHaveAttribute("aria-checked", "true")
			await waitForRateMetricsRpcCount(recorderPath, 1)

			await dialog.getByRole("tab", { name: "Minute", exact: true }).click()
			await waitForRateMetricsRpcCount(recorderPath, 2)
			let singleChart = dialog.getByRole("img", { name: "API rate history chart", exact: true })
			await expect(singleChart).toHaveAttribute("data-metric", "tpm")
			await expect(singleChart).toHaveAttribute("data-chart-type", "line")
			await expect(dialog.getByTestId("task-rate-series-line")).toBeVisible()
			await captureDialog(dialog, testInfo, "task-statistics-minute-tpm-line.png")

			await dialog.getByRole("radio", { name: "Bar", exact: true }).click()
			await expect(singleChart).toHaveAttribute("data-chart-type", "bar")
			await expect(dialog.locator('[data-testid^="task-rate-bar-"]').first()).toBeVisible()
			await captureDialog(dialog, testInfo, "task-statistics-minute-tpm-bar.png")

			await dialog.getByRole("radio", { name: "RPM", exact: true }).click()
			await dialog.getByRole("radio", { name: "Line", exact: true }).click()
			singleChart = dialog.getByRole("img", { name: "API rate history chart", exact: true })
			await expect(singleChart).toHaveAttribute("data-metric", "rpm")
			await expect(singleChart).toHaveAttribute("data-chart-type", "line")
			await captureDialog(dialog, testInfo, "task-statistics-minute-rpm-line.png")

			await dialog.getByRole("radio", { name: "Total Tokens", exact: true }).click()
			await dialog.getByRole("radio", { name: "Bar", exact: true }).click()
			singleChart = dialog.getByRole("img", { name: "API rate history chart", exact: true })
			await expect(singleChart).toHaveAttribute("data-metric", "tokens")
			await expect(singleChart).toHaveAttribute("data-chart-type", "bar")
			await captureDialog(dialog, testInfo, "task-statistics-minute-total-tokens-bar.png")
			await waitForRateMetricsRpcCount(recorderPath, 2)
			expect(server.getMockConsumptions("openai-compatible-responses")).toHaveLength(1)

			await dialog.getByRole("button", { name: "Refresh", exact: true }).click()
			await waitForRateMetricsRpcCount(recorderPath, 3)
			expect(server.getMockConsumptions("openai-compatible-responses")).toHaveLength(1)

			const recorderEvidence = await readFile(recorderPath)
			await testInfo.attach("task-statistics-grpc-recording.json", {
				body: recorderEvidence,
				contentType: "application/json",
			})
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await reopenedApp?.close()
			await app?.close()
			await rm(recorderPath, { force: true })
		}
	},
)
