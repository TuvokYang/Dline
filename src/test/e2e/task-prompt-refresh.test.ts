import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Frame } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface TaskPromptContext {
	systemPrompt?: {
		frozen?: {
			refreshedAt: number
			refreshReason: string
		}
	}
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

async function onlyTaskId(dlineDocsDir: string): Promise<string> {
	const entries = await readdir(path.join(dlineDocsDir, "tasks"), { withFileTypes: true })
	const taskIds = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
	expect(taskIds).toHaveLength(1)
	return taskIds[0]
}

async function readPromptContext(dlineDocsDir: string, taskId: string): Promise<TaskPromptContext> {
	return JSON.parse(await readFile(path.join(dlineDocsDir, "tasks", taskId, "context.json"), "utf8"))
}

e2e(
	"Task header - manual prompt refresh confirms durable context without starting an API turn",
	async ({ dlineDocsDir, helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses({
			type: "tool",
			name: "attempt_completion",
			arguments: { result: "E2E_PROMPT_REFRESH_READY" },
		})

		await sendTask(sidebar, "Create a completed task for manual prompt refresh.")
		await expect(sidebar.getByText("E2E_PROMPT_REFRESH_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		const taskId = await onlyTaskId(dlineDocsDir)
		await expect.poll(async () => Boolean((await readPromptContext(dlineDocsDir, taskId)).systemPrompt?.frozen)).toBe(true)
		const initialContext = await readPromptContext(dlineDocsDir, taskId)
		const before = initialContext.systemPrompt!.frozen!
		const requestCount = server.openAiRequestCount
		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_PROMPT_REFRESH_DRAFT")

		const refreshButton = sidebar.locator("button:has(svg.lucide-refresh-cw)").first()
		await expect(refreshButton).toBeVisible()
		await refreshButton.click()
		const dialog = sidebar.getByRole("dialog")
		await expect(dialog.getByRole("heading", { name: "Refresh Prompt Cache", exact: true })).toBeVisible()
		await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
		await expect(sidebar.getByRole("heading", { name: "Refresh Prompt Cache", exact: true })).not.toBeVisible()
		await expect(input).toHaveValue("E2E_PROMPT_REFRESH_DRAFT")
		const afterCancel = await readPromptContext(dlineDocsDir, taskId)
		expect(afterCancel.systemPrompt?.frozen?.refreshedAt).toBe(before.refreshedAt)
		expect(server.openAiRequestCount).toBe(requestCount)

		await refreshButton.click()
		await dialog.getByRole("button", { name: "Confirm", exact: true }).click()
		await expect(sidebar.getByRole("heading", { name: "Refresh Prompt Cache", exact: true })).not.toBeVisible()
		await expect
			.poll(async () => {
				const context = await readPromptContext(dlineDocsDir, taskId)
				return context.systemPrompt?.frozen
			})
			.toMatchObject({ refreshReason: "manual" })
		const afterConfirm = await readPromptContext(dlineDocsDir, taskId)
		expect(afterConfirm.systemPrompt!.frozen!.refreshedAt).toBeGreaterThan(before.refreshedAt)
		await expect(input).toHaveValue("E2E_PROMPT_REFRESH_DRAFT")
		await page.waitForTimeout(500)
		expect(server.openAiRequestCount).toBe(requestCount)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
