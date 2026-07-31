import { expect, type Frame, type Page } from "@playwright/test"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

async function selectProfile(frame: Frame, profileName: string): Promise<void> {
	const modelSwitcher = frame.getByRole("button", { name: "Select model" })
	if ((await modelSwitcher.innerText()).trim() === profileName) return
	await modelSwitcher.click()
	const profileOption = frame.getByRole("option").filter({ has: frame.getByText(profileName, { exact: true }) })
	await expect(profileOption).toHaveCount(1)
	await profileOption.click()
	await expect(modelSwitcher).toHaveText(profileName)
}

async function findAdditionalDlineFrame(page: Page, existingFrames: ReadonlySet<Frame>): Promise<Frame> {
	let resolved: Frame | undefined
	await expect
		.poll(
			async () => {
				for (const frame of page.frames()) {
					if (existingFrames.has(frame) || frame.isDetached() || !frame.url().startsWith("vscode-webview://")) {
						continue
					}
					if ((await frame.locator("#root").count()) > 0) {
						resolved = frame
						return true
					}
				}
				return false
			},
			{ timeout: 30_000 },
		)
		.toBe(true)
	if (!resolved) throw new Error("Dline editor panel frame was not created")
	return resolved
}

async function createDlinePanelFromTitleAction(page: Page): Promise<Frame> {
	const existingFrames = new Set(page.frames())
	await page.getByRole("button", { name: "New Task", exact: true }).click()
	return findAdditionalDlineFrame(page, existingFrames)
}

async function dismissExtensionsDisabledNotification(page: Page): Promise<void> {
	const notification = page.getByRole("dialog").filter({ hasText: "All installed extensions are temporarily disabled." })
	const clearButton = notification.getByRole("button", { name: "Clear Notification (Del)", exact: true })
	if (await clearButton.isVisible()) await clearButton.click()
}

function dlineEditorGroups(page: Page) {
	return page.locator(".editor-group-container").filter({
		has: page.locator('.tabs-container > .tab[aria-label*="Dline"]'),
	})
}

e2e("Dline task panels share one locked editor group", async ({ helper, page, server, sidebar, userDataDir }) => {
	e2e.setTimeout(180_000)
	await helper.signin(sidebar)

	const firstTask = "E2E_PANEL_ONE_GROUP"
	server.resetOpenAiMock()
	server.enqueueResponses("openai-compatible-chat", {
		type: "tool",
		id: "call_dline_group_panel_one_completion",
		name: "attempt_completion",
		arguments: { result: "E2E_DLINE_GROUP_PANEL_ONE_DONE" },
		expectedRequestIncludes: [firstTask],
	})

	const firstPanel = await createDlinePanelFromTitleAction(page)
	await E2ETestHelper.dismissWhatsNewModal(firstPanel)
	await dismissExtensionsDisabledNotification(page)
	await firstPanel.getByTestId("chat-input").fill(firstTask)
	await firstPanel.getByTestId("send-button").click()
	await expect(firstPanel.getByText("E2E_DLINE_GROUP_PANEL_ONE_DONE", { exact: false }).last()).toBeVisible({
		timeout: 60_000,
	})

	const secondPanel = await createDlinePanelFromTitleAction(page)
	await E2ETestHelper.dismissWhatsNewModal(secondPanel)
	const dlineGroups = dlineEditorGroups(page)
	await expect(dlineGroups).toHaveCount(1)
	const dlineGroupIndex = await dlineGroups
		.first()
		.evaluate((element) => Array.from(document.querySelectorAll(".editor-group-container")).indexOf(element))
	const dlineGroup = page.locator(".editor-group-container").nth(dlineGroupIndex)
	await expect(dlineGroup).toHaveClass(/\blocked\b/)
	await expect(dlineGroup.locator(".tabs-container > .tab")).toHaveCount(2)

	const secondTask = "E2E_PANEL_TWO_GROUP"
	server.resetOpenAiMock()
	server.enqueueResponses("openai-compatible-chat", {
		type: "tool",
		id: "call_dline_group_panel_two_completion",
		name: "attempt_completion",
		arguments: { result: "E2E_DLINE_GROUP_PANEL_TWO_DONE" },
		expectedRequestIncludes: [secondTask],
	})
	await secondPanel.getByTestId("chat-input").fill(secondTask)
	await secondPanel.getByTestId("send-button").click()
	await expect(secondPanel.getByText("E2E_DLINE_GROUP_PANEL_TWO_DONE", { exact: false }).last()).toBeVisible({
		timeout: 60_000,
	})

	const editorFrameCount = page
		.frames()
		.filter((frame) => frame.url().startsWith("vscode-webview://") && frame !== sidebar).length
	await dlineGroup.locator(`.tab[aria-label*="${firstTask.slice(0, 16)}"]`).click()
	await firstPanel.locator('vscode-button[aria-label="Start New Task"]').click()
	await expect(firstPanel.getByTestId("chat-input")).toBeEnabled()
	await expect(dlineGroup.locator(".tabs-container > .tab")).toHaveCount(2)
	await expect
		.poll(() => page.frames().filter((frame) => frame.url().startsWith("vscode-webview://") && frame !== sidebar).length)
		.toBe(editorFrameCount)
	await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
})

e2e(
	"Multi-window tasks - sidebar and restored panel run independent conversations concurrently",
	async ({ helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)

		const panelTask = "E2E_MULTI_WINDOW_PANEL_TASK"
		server.resetOpenAiMock()
		server.enqueueResponses("openai-compatible-chat", {
			type: "tool",
			id: "call_multi_window_setup_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_MULTI_WINDOW_PANEL_READY" },
			expectedRequestIncludes: [panelTask],
		})

		const sidebarInput = sidebar.getByTestId("chat-input")
		await sidebarInput.fill(panelTask)
		await sidebar.getByTestId("send-button").click()
		await expect(sidebar.getByText("E2E_MULTI_WINDOW_PANEL_READY", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})

		await sidebar.getByRole("button", { name: "Close Task", exact: true }).click()
		await page.getByRole("button", { name: "History", exact: true }).click()
		await E2ETestHelper.dismissWhatsNewModal(sidebar)
		const historyItem = sidebar.locator(".history-item").filter({ hasText: panelTask })
		await expect(historyItem).toHaveCount(1)
		await historyItem.hover()

		const existingFrames = new Set(page.frames())
		await historyItem.getByRole("button", { name: "Open in New Window", exact: true }).click()
		const panel = await findAdditionalDlineFrame(page, existingFrames)
		await E2ETestHelper.dismissWhatsNewModal(panel)
		await expect(panel.getByText(panelTask, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
		await expect(panel.getByTestId("chat-input")).toBeEnabled()
		await selectProfile(panel, E2E_PROFILE_NAMES.mockOpenAiResponses)

		await sidebar.getByRole("button", { name: "Done", exact: true }).click()
		const sidebarModelSwitcher = sidebar.getByRole("button", { name: "Select model" })
		await expect(sidebarModelSwitcher).toHaveText(E2E_PROFILE_NAMES.mockOpenAi)
		await expect(panel.getByRole("button", { name: "Select model" })).toHaveText(E2E_PROFILE_NAMES.mockOpenAiResponses)

		const sidebarTask = "E2E_MULTI_WINDOW_SIDEBAR_TASK"
		server.resetOpenAiMock()
		server.enqueueResponses("openai-compatible-chat", {
			type: "tool",
			id: "call_multi_window_sidebar_setup_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_MULTI_WINDOW_SIDEBAR_READY" },
			expectedRequestIncludes: [`<task>\\n${sidebarTask}\\n</task>`],
		})
		const concurrentSidebarInput = sidebar.locator('[data-testid="chat-input"]:visible')
		await concurrentSidebarInput.fill(sidebarTask)
		await sidebar.locator('[data-testid="send-button"]:visible').click()
		await expect(sidebar.getByText("E2E_MULTI_WINDOW_SIDEBAR_READY", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect(sidebarModelSwitcher).toHaveText(E2E_PROFILE_NAMES.mockOpenAi)

		const sidebarTurn = "E2E_MULTI_WINDOW_SIDEBAR_TURN"
		const panelTurn = "E2E_MULTI_WINDOW_PANEL_TURN"
		const responseDelayMs = 3_000
		server.resetOpenAiMock()
		server.enqueueResponses("openai-compatible-chat", {
			type: "tool",
			id: "call_multi_window_sidebar_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_MULTI_WINDOW_SIDEBAR_OK" },
			delayMs: responseDelayMs,
			expectedToolResultCount: 1,
			expectedToolResults: [{ callId: "call_multi_window_sidebar_setup_completion", contentIncludes: sidebarTurn }],
		})
		server.enqueueResponses("openai-compatible-responses", {
			type: "tool",
			id: "call_multi_window_panel_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_MULTI_WINDOW_PANEL_OK" },
			delayMs: responseDelayMs,
			expectedToolResultCount: 1,
			expectedToolResults: [{ callId: "call_multi_window_setup_completion", contentIncludes: panelTurn }],
		})

		const panelInput = panel.locator('[data-testid="chat-input"]:visible')
		await concurrentSidebarInput.fill(sidebarTurn)
		await panelInput.fill(panelTurn)
		await expect(concurrentSidebarInput).toHaveValue(sidebarTurn)
		await expect(panelInput).toHaveValue(panelTurn)
		await dismissExtensionsDisabledNotification(page)
		const submittedAtMs = Date.now()
		await sidebar.locator('[data-testid="send-button"]:visible').click()
		await expect(concurrentSidebarInput).toHaveValue("")
		await panel.locator('[data-testid="send-button"]:visible').click()
		await expect(panelInput).toHaveValue("")

		await Promise.all([
			expect.poll(() => server.getRequestCount("openai-compatible-chat"), { timeout: 10_000 }).toBe(1),
			expect.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 10_000 }).toBe(1),
		])
		const chatRequest = server.getMockConsumptions("openai-compatible-chat")[0]
		const responsesRequest = server.getMockConsumptions("openai-compatible-responses")[0]
		expect(chatRequest.contractError).toBeUndefined()
		expect(responsesRequest.contractError).toBeUndefined()
		expect(chatRequest.requestToolResults[0]?.content).not.toContain(panelTurn)
		expect(responsesRequest.requestToolResults[0]?.content).not.toContain(sidebarTurn)
		expect(Math.abs(chatRequest.receivedAtMs - responsesRequest.receivedAtMs)).toBeLessThan(2_000)

		const [sidebarRenderedAtMs, panelRenderedAtMs] = await Promise.all([
			(async () => {
				await expect(sidebar.getByText("E2E_MULTI_WINDOW_SIDEBAR_OK", { exact: false }).last()).toBeVisible({
					timeout: 10_000,
				})
				return Date.now()
			})(),
			(async () => {
				await expect(panel.getByText("E2E_MULTI_WINDOW_PANEL_OK", { exact: false }).last()).toBeVisible({
					timeout: 10_000,
				})
				return Date.now()
			})(),
		])
		expect(sidebarRenderedAtMs - submittedAtMs).toBeLessThan(8_000)
		expect(panelRenderedAtMs - submittedAtMs).toBeLessThan(8_000)
		expect(Math.abs(sidebarRenderedAtMs - panelRenderedAtMs)).toBeLessThan(2_500)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
