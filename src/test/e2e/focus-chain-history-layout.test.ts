import { readdir, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

const TASK_TEXT = "E2E_FOCUS_CHAIN_HISTORY_LAYOUT_TASK"
const QNA_TEXT = "E2E_FOCUS_CHAIN_HISTORY_LAYOUT_READY"
const ACTIVE_ITEMS = Array.from({ length: 12 }, (_, index) => `E2E_ACTIVE_FOCUS_ITEM_${index + 1}`)
const ACTIVE_CHECKLIST = [
	"# E2E Focus Chain layout",
	"## Active work",
	...ACTIVE_ITEMS.map((item, index) => `- [${index < 2 ? "x" : " "}] ${item}`),
].join("\n")

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

async function closeCurrentTask(sidebar: Frame): Promise<void> {
	const closeButton = sidebar.getByRole("button", { name: "Close Task", exact: true })
	await expect(closeButton).toBeVisible()
	await closeButton.click()
	await expect(sidebar.getByTestId("chat-input")).toHaveAttribute("placeholder", "Type your task here...")
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
}

async function reopenTask(sidebar: Frame, taskText: string): Promise<void> {
	const historyTask = sidebar.locator(".history-preview-item").filter({ hasText: taskText })
	await expect(historyTask).toHaveCount(1)
	await historyTask.click()
	await expect(sidebar.getByRole("button", { name: "Close Task", exact: true })).toBeVisible({ timeout: 30_000 })
	await expect(sidebar.getByText(taskText, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
}

async function onlyTaskId(dlineDocsDir: string): Promise<string> {
	return E2ETestHelper.waitForValue(async () => {
		const entries = await readdir(path.join(dlineDocsDir, "tasks"), { withFileTypes: true }).catch(() => [])
		const ids = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
		return ids.length === 1 ? ids[0] : undefined
	}, 30_000)
}

function buildHistory(taskId: string): string {
	const entries = Array.from({ length: 8 }, (_, entryIndex) => {
		const sequence = entryIndex + 1
		return `## Completed — 2026-08-21 ${String(10 + sequence).padStart(2, "0")}:00:00 UTC+8
# E2E Historical Focus ${sequence}
- [x] E2E_HISTORY_ITEM_${sequence}_A
- [x] E2E_HISTORY_ITEM_${sequence}_B
- [ ] E2E_HISTORY_ITEM_${sequence}_C`
	})
	return `# Focus Chain History for Task ${taskId}\n\n${entries.join("\n\n")}\n`
}

e2e("Focus Chain - restored history shows items and stays in a bounded scroll panel above Work and Activities", async ({
	dlineDocsDir,
	helper,
	page,
	server,
	sidebar,
	userDataDir,
}) => {
	e2e.setTimeout(180_000)
	await helper.signin(sidebar)
	server.resetOpenAiMock()
	server.enqueueOpenAiResponses(
		{
			type: "tool",
			id: "call_focus_chain_seed",
			name: "read_file",
			arguments: { path: "README.md", task_progress: ACTIVE_CHECKLIST },
		},
		{
			type: "tool",
			id: "call_focus_chain_ready",
			name: "qna_respond",
			arguments: { response: QNA_TEXT },
			expectedToolResults: [{ callId: "call_focus_chain_seed", contentIncludes: "# Test Workspace" }],
		},
		{
			type: "error",
			status: 500,
			code: "unexpected_additional_request",
			message: "Unexpected request after Focus Chain layout setup",
		},
	)

	await sendTask(sidebar, TASK_TEXT)
	await expect(sidebar.getByText(QNA_TEXT, { exact: true })).toBeVisible({ timeout: 60_000 })
	await expect(sidebar.getByLabel("Expand focus chain")).toBeVisible({ timeout: 30_000 })

	const taskId = await onlyTaskId(dlineDocsDir)
	await closeCurrentTask(sidebar)
	await writeFile(
		path.join(dlineDocsDir, "tasks", taskId, `focus_chain_taskid_${taskId}_history.md`),
		buildHistory(taskId),
		"utf8",
	)
	await reopenTask(sidebar, TASK_TEXT)

	const expandFocusChain = sidebar.getByLabel("Expand focus chain")
	await expect(expandFocusChain).toBeVisible({ timeout: 30_000 })
	await expandFocusChain.click()

	const panel = sidebar.getByTestId("focus-chain-expanded-content")
	const history = sidebar.getByTestId("focus-chain-history")
	await expect(panel).toBeVisible()
	await expect(history).toBeVisible({ timeout: 30_000 })

	const firstHistoryItem = history.getByText("E2E_HISTORY_ITEM_1_A", { exact: true })
	await firstHistoryItem.scrollIntoViewIfNeeded()
	await expect(firstHistoryItem).toBeVisible()
	await expect(history.getByText("E2E Historical Focus 1", { exact: true })).toBeVisible()

	const layout = await panel.evaluate((element) => {
		const style = getComputedStyle(element)
		return {
			borderColor: style.borderColor,
			className: element.className,
			clientHeight: element.clientHeight,
			scrollHeight: element.scrollHeight,
			maxHeight: Number.parseFloat(style.maxHeight),
			overflowY: style.overflowY,
			viewportHeight: window.innerHeight,
		}
	})
	expect(layout.className).toContain("focus-chain-scrollable")
	expect(layout.overflowY).toBe("auto")
	expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight)
	expect(layout.clientHeight).toBeLessThanOrEqual(layout.viewportHeight * 0.4 + 1)
	expect(layout.maxHeight).toBeCloseTo(layout.viewportHeight * 0.4, 0)
	expect(layout.borderColor).not.toBe("rgba(0, 0, 0, 0)")

	const lastHistoryItem = history.getByText("E2E_HISTORY_ITEM_8_C", { exact: true })
	await lastHistoryItem.scrollIntoViewIfNeeded()
	await expect(lastHistoryItem).toBeVisible()
	await expect.poll(() => panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

	const workTab = sidebar.getByRole("tab", { name: "Work", exact: true })
	const activitiesTab = sidebar.getByRole("tab", { name: "Activities", exact: true })
	const tabsLayout = await workTab.evaluate((element) => {
		const rect = element.parentElement?.getBoundingClientRect() ?? element.getBoundingClientRect()
		return { bottom: rect.bottom, top: rect.top, viewportHeight: window.innerHeight }
	})
	expect(tabsLayout.top).toBeGreaterThanOrEqual(0)
	expect(tabsLayout.bottom).toBeLessThanOrEqual(tabsLayout.viewportHeight + 1)
	await expect(workTab).toBeVisible()
	await expect(activitiesTab).toBeVisible()

	await page.screenshot({ path: e2e.info().outputPath("focus-chain-history-layout.png") })
	expect(server.openAiRequestCount).toBe(2)
	await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
})
