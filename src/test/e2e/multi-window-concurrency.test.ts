import { access, readFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
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

async function setAutoApproveAction(frame: Frame, label: string, enabled: boolean): Promise<void> {
	await frame.getByLabel("Open auto-approve settings").click()
	const checkbox = frame.locator("vscode-checkbox").filter({ hasText: label })
	await expect(checkbox).toHaveCount(1)
	const isChecked = () => checkbox.evaluate((element) => Boolean((element as HTMLInputElement).checked))
	if ((await isChecked()) !== enabled) {
		await frame.getByText(label, { exact: true }).click()
	}
	await expect.poll(isChecked).toBe(enabled)
	await frame.getByLabel("Close auto-approve settings").click()
}

async function pathExists(filePath: string): Promise<boolean> {
	return access(filePath)
		.then(() => true)
		.catch(() => false)
}

function normalizeNewlines(value: string): string {
	return value.replaceAll("\r\n", "\n")
}

function dlineEditorGroups(page: Page) {
	return page.locator(".editor-group-container").filter({
		has: page.locator('.tabs-container > .tab[aria-label*="Dline"]'),
	})
}

async function activateDlinePanel(tab: Locator, frame: Frame): Promise<void> {
	await tab.click()
	await expect(tab).toHaveClass(/\bactive\b/)
	const frameElement = await frame.frameElement()
	await frameElement.waitForElementState("visible")
	await expect(frame.locator("#root")).toBeVisible()
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
	"Concurrent edit panels isolate checkpoint writes and restores in one workspace",
	async ({ helper, page, server, sidebar, userDataDir, workspaceDir }, testInfo) => {
		e2e.setTimeout(300_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Edit project files", true)

		const panelA = await createDlinePanelFromTitleAction(page)
		await E2ETestHelper.dismissWhatsNewModal(panelA)
		await dismissExtensionsDisabledNotification(page)
		const panelB = await createDlinePanelFromTitleAction(page)
		await E2ETestHelper.dismissWhatsNewModal(panelB)

		const dlineGroups = dlineEditorGroups(page)
		await expect(dlineGroups).toHaveCount(1)
		const dlineGroupIndex = await dlineGroups
			.first()
			.evaluate((element) => Array.from(document.querySelectorAll(".editor-group-container")).indexOf(element))
		const dlineGroup = page.locator(".editor-group-container").nth(dlineGroupIndex)
		await expect(dlineGroup).toHaveClass(/\blocked\b/)
		const panelTabs = dlineGroup.locator(".tabs-container > .tab")
		await expect(panelTabs).toHaveCount(2)

		const panelATask = "E2E_CONCURRENT_CHECKPOINT_PANEL_A"
		const panelBTask = "E2E_CONCURRENT_CHECKPOINT_PANEL_B"
		const panelAFollowUp = "E2E_CONCURRENT_PANEL_A_RESTORED"
		const panelBFollowUp = "E2E_CONCURRENT_PANEL_B_CONTINUES"
		const panelARelativePath = "panel-a-checkpoint.txt"
		const panelBRelativePath = "panel-b-checkpoint.txt"
		const panelAPath = path.join(workspaceDir, panelARelativePath)
		const panelBPath = path.join(workspaceDir, panelBRelativePath)

		server.resetOpenAiMock()
		server.enqueueResponses(
			"openai-compatible-chat",
			{
				type: "tool",
				id: "call_concurrent_panel_a_write",
				name: "write_to_file",
				arguments: { path: panelARelativePath, content: "panel A checkpoint content\n" },
				expectedRequestIncludes: [panelATask],
			},
			{
				type: "tool",
				id: "call_concurrent_panel_a_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_CONCURRENT_PANEL_A_DONE" },
				expectedToolResults: [{ callId: "call_concurrent_panel_a_write", contentIncludes: "successfully saved" }],
			},
		)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_concurrent_panel_b_write",
				name: "write_to_file",
				arguments: { path: panelBRelativePath, content: "panel B checkpoint content\n" },
				expectedRequestIncludes: [panelBTask],
			},
			{
				type: "tool",
				id: "call_concurrent_panel_b_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_CONCURRENT_PANEL_B_DONE" },
				expectedToolResults: [{ callId: "call_concurrent_panel_b_write", contentIncludes: "successfully saved" }],
			},
		)

		await activateDlinePanel(panelTabs.first(), panelA)
		await expect(panelA.getByTestId("chat-input")).toBeVisible()
		await selectProfile(panelA, E2E_PROFILE_NAMES.mockOpenAi)
		await panelA.getByTestId("chat-input").fill(panelATask)
		const panelASubmittedAtMs = Date.now()
		await panelA.getByTestId("send-button").click()
		await expect(panelA.getByTestId("chat-input")).toHaveValue("")
		await expect(panelA.getByText(panelATask, { exact: true }).first()).toBeVisible()
		await activateDlinePanel(panelTabs.last(), panelB)
		await expect(panelB.getByTestId("chat-input")).toBeVisible()
		await selectProfile(panelB, E2E_PROFILE_NAMES.mockOpenAiResponses)
		await panelB.getByTestId("chat-input").fill(panelBTask)
		const panelBSubmittedAtMs = Date.now()
		await panelB.getByTestId("send-button").click()
		await expect(panelB.getByTestId("chat-input")).toHaveValue("")
		await expect(panelB.getByText(panelBTask, { exact: true }).first()).toBeVisible()

		await Promise.all([
			expect.poll(() => server.getRequestCount("openai-compatible-chat"), { timeout: 60_000 }).toBe(2),
			expect.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 }).toBe(2),
		])
		const chatRequests = server.getMockConsumptions("openai-compatible-chat")
		const responsesRequests = server.getMockConsumptions("openai-compatible-responses")
		const performance = {
			panelAInitializationMs: chatRequests[0].receivedAtMs - panelASubmittedAtMs,
			panelBInitializationMs: responsesRequests[0].receivedAtMs - panelBSubmittedAtMs,
			panelACommitMs: chatRequests[1].receivedAtMs - chatRequests[0].receivedAtMs,
			panelBCommitMs: responsesRequests[1].receivedAtMs - responsesRequests[0].receivedAtMs,
			firstRequestDeltaMs: Math.abs(chatRequests[0].receivedAtMs - responsesRequests[0].receivedAtMs),
		}
		await testInfo.attach("concurrent-checkpoint-performance.json", {
			body: Buffer.from(JSON.stringify(performance, null, 2)),
			contentType: "application/json",
		})
		expect(performance.panelAInitializationMs).toBeLessThan(20_000)
		expect(performance.panelBInitializationMs).toBeLessThan(20_000)
		expect(performance.panelACommitMs).toBeLessThan(20_000)
		expect(performance.panelBCommitMs).toBeLessThan(20_000)
		expect(performance.firstRequestDeltaMs).toBeLessThan(10_000)

		await activateDlinePanel(panelTabs.first(), panelA)
		await expect(panelA.getByText(panelATask, { exact: true }).first()).toBeVisible()
		await expect(panelA.locator('vscode-button[aria-label="Start New Task"]')).toBeVisible({ timeout: 60_000 })
		await activateDlinePanel(panelTabs.last(), panelB)
		await expect(panelB.getByText(panelBTask, { exact: true }).first()).toBeVisible()
		await expect(panelB.locator('vscode-button[aria-label="Start New Task"]')).toBeVisible({ timeout: 60_000 })
		await expect.poll(() => pathExists(panelAPath)).toBe(true)
		await expect.poll(() => pathExists(panelBPath)).toBe(true)
		expect(normalizeNewlines(await readFile(panelAPath, "utf8"))).toBe("panel A checkpoint content\n")
		expect(normalizeNewlines(await readFile(panelBPath, "utf8"))).toBe("panel B checkpoint content\n")

		await activateDlinePanel(panelTabs.first(), panelA)
		const checkpointLabels = panelA.getByText("Checkpoint", { exact: true })
		await expect.poll(() => checkpointLabels.count()).toBeGreaterThan(0)
		const initialCheckpoint = checkpointLabels.first().locator("..").locator("..")
		await initialCheckpoint.hover()
		await initialCheckpoint.getByRole("button", { name: "Restore", exact: true }).click()
		const restoreAllButton = panelA.getByRole("button", { name: "Restore Files & Task", exact: true })
		await expect(restoreAllButton).toBeVisible()
		await restoreAllButton.click()
		await expect.poll(() => pathExists(panelAPath)).toBe(false)
		await expect.poll(() => pathExists(panelBPath)).toBe(true)
		expect(normalizeNewlines(await readFile(panelBPath, "utf8"))).toBe("panel B checkpoint content\n")
		await expect(panelA.locator('vscode-button[aria-label="Resume"]')).toBeVisible({ timeout: 30_000 })

		await activateDlinePanel(panelTabs.last(), panelB)
		await expect(panelB.getByText(panelBTask, { exact: true }).first()).toBeVisible()
		await expect(panelB.locator('vscode-button[aria-label="Start New Task"]')).toBeVisible()
		await expect(panelB.getByRole("button", { name: "Select model" })).toHaveText(E2E_PROFILE_NAMES.mockOpenAiResponses)
		server.enqueueResponses("openai-compatible-responses", {
			type: "tool",
			id: "call_concurrent_panel_b_follow_up",
			name: "attempt_completion",
			arguments: { result: "E2E_CONCURRENT_PANEL_B_STILL_WORKS" },
			expectedToolResults: [{ callId: "call_concurrent_panel_b_completion", contentIncludes: panelBFollowUp }],
		})
		await panelB.getByTestId("chat-input").fill(panelBFollowUp)
		await panelB.getByTestId("send-button").click()
		await expect(panelB.getByText("E2E_CONCURRENT_PANEL_B_STILL_WORKS", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => pathExists(panelBPath)).toBe(true)
		expect(normalizeNewlines(await readFile(panelBPath, "utf8"))).toBe("panel B checkpoint content\n")

		await activateDlinePanel(panelTabs.first(), panelA)
		const panelAResume = panelA.locator('vscode-button[aria-label="Resume"]')
		server.enqueueResponses("openai-compatible-chat", {
			type: "tool",
			id: "call_concurrent_panel_a_follow_up",
			name: "attempt_completion",
			arguments: { result: "E2E_CONCURRENT_PANEL_A_RESTORE_CONTINUES" },
			expectedRequestIncludes: [panelAFollowUp],
		})
		const panelAInput = panelA.getByTestId("chat-input")
		await panelAInput.fill(panelAFollowUp)
		await expect(panelAInput).toHaveValue(panelAFollowUp)
		await expect(panelAResume).toBeVisible()
		await panelAResume.click()
		await expect(panelA.getByText("E2E_CONCURRENT_PANEL_A_RESTORE_CONTINUES", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

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
