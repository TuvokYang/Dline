import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame, type Page } from "@playwright/test"
import type { HistoryItem } from "@shared/HistoryItem"
import type { ElectronApplication } from "playwright"
import { E2ETestHelper, e2e } from "./utils/helpers"

const TASK_TEXT = "E2E_TASK_HISTORY_COMPLETION_STATE"
const FIRST_COMPLETION = "E2E_TASK_HISTORY_COMPLETION_FIRST"
const CONTINUATION_READY = "E2E_TASK_HISTORY_COMPLETION_CONTINUED"
const FINAL_COMPLETION = "E2E_TASK_HISTORY_COMPLETION_FINAL"
const CONTINUATION_FEEDBACK = "E2E_TASK_HISTORY_CONTINUE_AFTER_COMPLETION"

async function openSidebar(app: ElectronApplication, helper: E2ETestHelper): Promise<{ page: Page; sidebar: Frame }> {
	const page = await app.firstWindow()
	await E2ETestHelper.openClineSidebar(page)
	const sidebar = await helper.getSidebar(page)
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
	await helper.signin(sidebar)
	return { page, sidebar }
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

async function submitFeedback(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled({ timeout: 30_000 })
	await input.fill(text)
	await input.press("Enter")
	await expect(input).toHaveValue("")
	await expect(sidebar.locator("span.ph-no-capture:not(button span)").filter({ hasText: text })).toHaveCount(1)
}

async function closeTask(sidebar: Frame): Promise<void> {
	const closeButton = sidebar.getByRole("button", { name: "Close Task", exact: true })
	await expect(closeButton).toBeVisible({ timeout: 30_000 })
	await closeButton.click()
	await expect(sidebar.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 })
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
}

async function startNewTask(sidebar: Frame): Promise<void> {
	const startButton = sidebar.locator('vscode-button[aria-label="Start New Task"]')
	await expect(startButton).toBeVisible({ timeout: 30_000 })
	await startButton.click()
	await expect(sidebar.getByTestId("chat-input")).toBeVisible({ timeout: 30_000 })
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
}

function historyPreviewItem(sidebar: Frame, taskText: string) {
	return sidebar.locator(".history-preview-item").filter({ hasText: taskText })
}

async function expectHistoryCompletion(sidebar: Frame, taskText: string, completed: boolean): Promise<void> {
	const item = historyPreviewItem(sidebar, taskText)
	await expect(item).toHaveCount(1, { timeout: 30_000 })
	const completion = item.getByLabel("Completed")
	if (completed) {
		await expect(completion).toHaveCount(1, { timeout: 30_000 })
		await expect(completion).toBeVisible()
	} else {
		await expect(completion).toHaveCount(0, { timeout: 30_000 })
	}
}

async function onlyTaskId(dlineDocsDir: string): Promise<string> {
	return await E2ETestHelper.waitForValue(async () => {
		const entries = await readdir(path.join(dlineDocsDir, "tasks"), { withFileTypes: true }).catch(() => [])
		const taskIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
		return taskIds.length === 1 ? taskIds[0] : undefined
	}, 30_000)
}

async function readHistoryItem(dlineDocsDir: string, taskId: string): Promise<HistoryItem | undefined> {
	const historyPath = path.join(dlineDocsDir, "tasks", "taskHistory.jsonl")
	const content = await readFile(historyPath, "utf8").catch(() => "")
	const items = content
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => JSON.parse(line) as HistoryItem)
	return [...items].reverse().find((item) => item.id === taskId)
}

async function expectPersistedCompletion(
	dlineDocsDir: string,
	taskId: string,
	isCompleted: boolean,
	minimumRevision = 0,
): Promise<number> {
	return await E2ETestHelper.waitForValue(async () => {
		const item = await readHistoryItem(dlineDocsDir, taskId)
		if (
			item?.isCompleted !== isCompleted ||
			item.completionStateRevision === undefined ||
			item.completionStateRevision < minimumRevision
		) {
			return undefined
		}
		return item.completionStateRevision
	}, 30_000)
}

async function reopenTaskFromPreview(sidebar: Frame, taskText: string): Promise<void> {
	const item = historyPreviewItem(sidebar, taskText)
	await expect(item).toHaveCount(1, { timeout: 30_000 })
	await item.click()
	await expect(sidebar.getByText(taskText, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
	await expect(sidebar.getByRole("button", { name: "Close Task", exact: true })).toBeVisible({ timeout: 30_000 })
}

e2e(
	"Task history completed projection persists across restart and follows completion feedback",
	async ({ dlineDocsDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(300_000)
		let app: ElectronApplication | undefined

		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{ type: "tool", name: "attempt_completion", arguments: { result: FIRST_COMPLETION } },
			{ type: "tool", name: "qna_respond", arguments: { response: CONTINUATION_READY } },
			{ type: "tool", name: "attempt_completion", arguments: { result: FINAL_COMPLETION } },
		)

		try {
			app = await openVSCode(workspaceDir)
			let opened = await openSidebar(app, helper)
			await sendTask(opened.sidebar, TASK_TEXT)
			await expect(opened.sidebar.getByText(FIRST_COMPLETION, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expect(opened.sidebar.getByRole("contentinfo").getByText("Start New Task", { exact: true })).toBeVisible()

			const taskId = await onlyTaskId(dlineDocsDir)
			const completedRevision = await expectPersistedCompletion(dlineDocsDir, taskId, true)
			await startNewTask(opened.sidebar)
			await expectHistoryCompletion(opened.sidebar, TASK_TEXT, true)

			await app.close()
			helper.clearCachedFrame()
			app = undefined

			app = await openVSCode(workspaceDir)
			opened = await openSidebar(app, helper)
			await expectHistoryCompletion(opened.sidebar, TASK_TEXT, true)
			await expectPersistedCompletion(dlineDocsDir, taskId, true, completedRevision)
			await reopenTaskFromPreview(opened.sidebar, TASK_TEXT)

			await submitFeedback(opened.sidebar, CONTINUATION_FEEDBACK)
			await expect(opened.sidebar.getByText(CONTINUATION_READY, { exact: true })).toBeVisible({ timeout: 60_000 })
			await expect(opened.sidebar.getByRole("contentinfo").getByText("Start New Task", { exact: true })).toHaveCount(0)
			const continuedRevision = await expectPersistedCompletion(dlineDocsDir, taskId, false, completedRevision + 1)
			await closeTask(opened.sidebar)
			await expectHistoryCompletion(opened.sidebar, TASK_TEXT, false)

			await app.close()
			helper.clearCachedFrame()
			app = undefined

			app = await openVSCode(workspaceDir)
			opened = await openSidebar(app, helper)
			await expectHistoryCompletion(opened.sidebar, TASK_TEXT, false)
			await expectPersistedCompletion(dlineDocsDir, taskId, false, continuedRevision)
			await reopenTaskFromPreview(opened.sidebar, TASK_TEXT)

			await submitFeedback(opened.sidebar, "E2E_TASK_HISTORY_FINISH_NOW")
			await expect(opened.sidebar.getByText(FINAL_COMPLETION, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expect(opened.sidebar.getByRole("contentinfo").getByText("Start New Task", { exact: true })).toBeVisible()
			await expectPersistedCompletion(dlineDocsDir, taskId, true, continuedRevision + 1)
			await startNewTask(opened.sidebar)
			await expectHistoryCompletion(opened.sidebar, TASK_TEXT, true)

			const consumptions = server.getMockConsumptions("openai-compatible-chat")
			expect(consumptions).toHaveLength(3)
			expect(consumptions.map((entry) => entry.toolName)).toEqual([
				"attempt_completion",
				"qna_respond",
				"attempt_completion",
			])
			expect(consumptions.every((entry) => entry.contractError === undefined)).toBe(true)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app?.close()
			helper.clearCachedFrame()
		}
	},
)

e2e(
	"Task history ignores a legacy completed boolean without a runtime revision",
	async ({ dlineDocsDir, helper, openVSCode, userDataDir, workspaceDir }) => {
		const tasksDir = path.join(dlineDocsDir, "tasks")
		await mkdir(tasksDir, { recursive: true })
		const historyItem: HistoryItem = {
			id: "e2e-legacy-unrevisioned-completion",
			ts: Date.now(),
			task: "E2E_LEGACY_UNREVISIONED_COMPLETION",
			cwdOnTaskInitialization: workspaceDir,
			isCompleted: true,
		}
		await writeFile(path.join(tasksDir, "taskHistory.jsonl"), `${JSON.stringify(historyItem)}\n`, "utf8")

		const app = await openVSCode(workspaceDir)
		try {
			const opened = await openSidebar(app, helper)
			await expectHistoryCompletion(opened.sidebar, historyItem.task, false)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)
