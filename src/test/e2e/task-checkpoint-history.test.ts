import { access, readdir, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame } from "@playwright/test"
import { E2ETestHelper, e2e } from "./utils/helpers"

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

async function setAutoApproveAction(sidebar: Frame, label: string, enabled: boolean): Promise<void> {
	await sidebar.getByLabel("Open auto-approve settings").click()
	const checkbox = sidebar.locator("vscode-checkbox").filter({ hasText: label })
	await expect(checkbox).toHaveCount(1)
	const isChecked = () => checkbox.evaluate((element) => Boolean((element as HTMLInputElement).checked))
	if ((await isChecked()) !== enabled) {
		await sidebar.getByText(label, { exact: true }).click()
	}
	await expect.poll(isChecked).toBe(enabled)
	await sidebar.getByLabel("Close auto-approve settings").click()
}

async function closeCurrentTask(sidebar: Frame): Promise<void> {
	const closeButton = sidebar.getByRole("button", { name: "Close Task", exact: true })
	await expect(closeButton).toBeVisible()
	await closeButton.click()
	await expect(sidebar.getByTestId("chat-input")).toBeVisible()
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
}

async function reopenTask(sidebar: Frame, taskText: string): Promise<void> {
	const historyTask = sidebar.getByText(taskText, { exact: true }).last()
	await expect(historyTask).toBeVisible({ timeout: 30_000 })
	await historyTask.click()
	await expect(sidebar.getByText(taskText, { exact: true }).first()).toBeVisible()
}

async function taskDirectoryIds(dlineDocsDir: string): Promise<string[]> {
	const tasksDir = path.join(dlineDocsDir, "tasks")
	return readdir(tasksDir, { withFileTypes: true })
		.then((entries) =>
			entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort(),
		)
		.catch(() => [])
}

async function pathExists(filePath: string): Promise<boolean> {
	return access(filePath)
		.then(() => true)
		.catch(() => false)
}

async function readTaskSnapshot(
	dlineDocsDir: string,
	taskId: string,
): Promise<{
	interaction?: { interactionId: string; turnId: string; kind: string }
	turn?: { turnId: string; blocks: Array<{ dlineTid: string }> }
}> {
	return JSON.parse(await readFile(path.join(dlineDocsDir, "tasks", taskId, "snapshot.json"), "utf8"))
}

e2e(
	"Checkpoint - Compare opens the real diff and Restore All stops at Resume before continuing",
	async ({ helper, page, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(240_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				name: "write_to_file",
				arguments: { path: "checkpoint-e2e.txt", content: "checkpoint content\n" },
			},
			{
				type: "tool",
				name: "attempt_completion",
				arguments: { result: "E2E_CHECKPOINT_WRITE_COMPLETE" },
			},
			{
				type: "tool",
				name: "attempt_completion",
				arguments: { result: "E2E_CHECKPOINT_RESUME_OK" },
			},
		)

		await sendTask(sidebar, "Create a file so checkpoint Compare and Restore can be exercised.")
		await sidebar.getByText("Approve", { exact: true }).click()
		const filePath = path.join(workspaceDir, "checkpoint-e2e.txt")
		await expect.poll(() => pathExists(filePath)).toBe(true)
		await expect(sidebar.getByText("E2E_CHECKPOINT_WRITE_COMPLETE", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await page.waitForTimeout(1_000)

		const checkpointLabels = sidebar.getByText("Checkpoint", { exact: true })
		await expect.poll(() => checkpointLabels.count()).toBeGreaterThan(0)
		const firstCheckpointControl = checkpointLabels.first().locator("..").locator("..")
		await firstCheckpointControl.hover()
		const restoreButton = firstCheckpointControl.getByRole("button", { name: "Restore", exact: true })
		await restoreButton.click()
		const restoreAllButton = sidebar.getByRole("button", { name: "Restore Files & Task", exact: true })
		await expect(restoreAllButton).toBeVisible()
		await sidebar.getByTestId("chat-input").hover()
		await page.waitForTimeout(500)
		await expect(restoreAllButton).toBeVisible()
		await sidebar.getByTestId("chat-input").click()
		await expect(restoreAllButton).not.toBeVisible()

		await firstCheckpointControl.hover()
		const compareButton = firstCheckpointControl.getByRole("button", { name: "Compare", exact: true })
		await expect(compareButton).toBeVisible()
		await compareButton.click()
		await expect(page.getByRole("tab", { name: /Changes since snapshot/ })).toBeVisible({ timeout: 30_000 })
		await expect
			.poll(
				async () => {
					const output = await E2ETestHelper.readDlineOutput(userDataDir)
					return output.includes("presentMultifileDiff")
				},
				{ timeout: 30_000 },
			)
			.toBe(true)
		await expect(compareButton).toBeEnabled()
		await page.waitForTimeout(500)

		await firstCheckpointControl.hover()
		await restoreButton.click()
		await expect(restoreAllButton).toBeVisible()
		await restoreAllButton.click()
		await expect.poll(() => pathExists(filePath)).toBe(false)

		const resumeButton = sidebar.getByText("Resume", { exact: true })
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await page.waitForTimeout(500)
		expect(server.openAiRequestCount).toBe(2)
		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_CHECKPOINT_RESUME_DRAFT")
		await resumeButton.click()
		await expect(sidebar.getByText("E2E_CHECKPOINT_RESUME_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect.poll(() => server.openAiRequestCount).toBe(3)
		expect(JSON.stringify(server.getOpenAiRequestBodies()[2])).toContain("E2E_CHECKPOINT_RESUME_DRAFT")
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"History - approved read survives Close and Resume with its durable tool result",
	async ({ helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Read project files", false)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_history_resume_read",
				name: "read_file",
				arguments: { path: "README.md" },
			},
			{
				type: "tool",
				id: "call_history_interrupted_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_CLOSED_RESPONSE_MUST_NOT_RENDER" },
				delayMs: 30_000,
				expectedToolResults: [{ callId: "call_history_resume_read", contentIncludes: "# Test Workspace" }],
			},
			{
				type: "tool",
				id: "call_history_resume_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_HISTORY_RESUME_OK" },
				expectedToolResults: [{ callId: "call_history_resume_read", contentIncludes: "# Test Workspace" }],
				expectedRequestIncludes: [
					"The previous task session was closed and has now been restored.",
					"E2E_HISTORY_RESUME_DRAFT",
				],
			},
		)

		const taskText = "E2E_CLOSE_RUNNING_HISTORY_TASK"
		await sendTask(sidebar, taskText)
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()
		await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(2)
		await expect(sidebar.getByText("Dline read 1 file:", { exact: true })).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByRole("button", { name: /README\.md/ }).last()).toBeVisible()
		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)

		const resumeButton = sidebar.getByText("Resume", { exact: true })
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("Dline read 1 file:", { exact: true })).toBeVisible()
		await expect(sidebar.getByRole("button", { name: /README\.md/ }).last()).toBeVisible()
		await expect(sidebar.getByText("Approve", { exact: true })).toHaveCount(0)
		await expect(sidebar.getByText("Reject", { exact: true })).toHaveCount(0)
		await page.waitForTimeout(750)
		expect(server.openAiRequestCount).toBe(2)
		await expect(sidebar.getByText("E2E_CLOSED_RESPONSE_MUST_NOT_RENDER", { exact: false })).toHaveCount(0)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_HISTORY_RESUME_DRAFT")
		await resumeButton.click()
		await expect(sidebar.getByText("E2E_HISTORY_RESUME_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect.poll(() => server.openAiRequestCount).toBe(3)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[2]
		expect(continuation.contractError).toBeUndefined()
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_history_resume_read",
				content: expect.stringContaining("# Test Workspace"),
			}),
		)
		const continuationRequest = JSON.stringify(continuation.requestBody)
		expect(continuationRequest).toContain("The previous task session was closed and has now been restored.")
		expect(continuationRequest).toContain("E2E_HISTORY_RESUME_DRAFT")
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"History - pending tool approval survives close and reopen with its original actions",
	async ({ dlineDocsDir, helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Read project files", false)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{ type: "tool", name: "read_file", arguments: { path: "README.md" } },
			{
				type: "tool",
				name: "attempt_completion",
				arguments: { result: "E2E_RESTORED_APPROVAL_OK" },
			},
		)

		const taskText = "E2E_PENDING_APPROVAL_HISTORY_TASK"
		await sendTask(sidebar, taskText)
		await expect(sidebar.getByText("Approve", { exact: true })).toBeVisible({ timeout: 60_000 })
		const [taskId] = await E2ETestHelper.waitForValue(async () => {
			const ids = await taskDirectoryIds(dlineDocsDir)
			return ids.length === 1 ? ids : undefined
		})
		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		const restoredSnapshot = await E2ETestHelper.waitForValue(async () => {
			const snapshot = await readTaskSnapshot(dlineDocsDir, taskId)
			return snapshot.interaction?.kind === "tool_approval" ? snapshot : undefined
		})
		expect(restoredSnapshot.turn, "restored approval must retain its canonical assistant turn").toBeDefined()
		expect(restoredSnapshot.turn?.turnId).toBe(restoredSnapshot.interaction?.turnId)
		expect(
			restoredSnapshot.turn?.blocks.some((block) => block.dlineTid === restoredSnapshot.interaction?.interactionId),
		).toBe(true)

		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("Reject", { exact: true })).toBeVisible()
		await page.waitForTimeout(750)
		expect(server.openAiRequestCount).toBe(1)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_RESTORED_APPROVAL_DRAFT")
		await approveButton.click()
		await expect.poll(() => server.openAiRequestCount, { timeout: 30_000 }).toBe(2)
		await expect(sidebar.getByText("E2E_RESTORED_APPROVAL_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		const continuation = JSON.stringify(server.getOpenAiRequestBodies()[1])
		expect(continuation).toContain("# Test Workspace")
		expect(continuation).toContain("E2E_RESTORED_APPROVAL_DRAFT")
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"History - pending command approval survives close and resumes with the original command",
	async ({ dlineDocsDir, helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Execute safe commands", false)
		server.resetOpenAiMock()
		const command = `node -e "process.stdout.write('E2E_RESTORED_PENDING_COMMAND_STDOUT')"`
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_history_pending_command",
				name: "execute_command",
				arguments: {
					command,
					workdirectory: ".",
					requires_approval: true,
					synchronous: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_history_pending_command_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_RESTORED_PENDING_COMMAND_OK" },
				expectedToolResults: [
					{
						callId: "call_history_pending_command",
						contentIncludes: ["Command executed successfully (exit code 0).", "E2E_RESTORED_PENDING_COMMAND_STDOUT"],
					},
				],
				expectedRequestIncludes: ["E2E_RESTORED_PENDING_COMMAND_DRAFT"],
			},
		)

		const taskText = "E2E_PENDING_COMMAND_APPROVAL_HISTORY_TASK"
		await sendTask(sidebar, taskText)
		await expect(sidebar.getByText("Approve", { exact: true })).toBeVisible({ timeout: 60_000 })
		await expect(sidebar.getByRole("button", { name: "Copy command" }).last()).toBeVisible()
		const [taskId] = await E2ETestHelper.waitForValue(async () => {
			const ids = await taskDirectoryIds(dlineDocsDir)
			return ids.length === 1 ? ids : undefined
		})

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		const restoredSnapshot = await E2ETestHelper.waitForValue(async () => {
			const snapshot = await readTaskSnapshot(dlineDocsDir, taskId)
			return snapshot.interaction?.kind === "command_approval" ? snapshot : undefined
		})
		expect(restoredSnapshot.turn?.turnId).toBe(restoredSnapshot.interaction?.turnId)
		expect(
			restoredSnapshot.turn?.blocks.some((block) => block.dlineTid === restoredSnapshot.interaction?.interactionId),
		).toBe(true)

		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("Reject", { exact: true })).toBeVisible()
		await expect(sidebar.getByRole("button", { name: "Copy command" }).last()).toBeVisible()
		await page.waitForTimeout(750)
		expect(server.openAiRequestCount).toBe(1)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_RESTORED_PENDING_COMMAND_DRAFT")
		await approveButton.click()
		await expect(sidebar.getByText("E2E_RESTORED_PENDING_COMMAND_STDOUT", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect(sidebar.getByText("E2E_RESTORED_PENDING_COMMAND_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(2)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(continuation.contractError).toBeUndefined()
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_history_pending_command",
				content: expect.stringContaining("E2E_RESTORED_PENDING_COMMAND_STDOUT"),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"History - completed approved command stays terminal after close and Resume",
	async ({ helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Execute safe commands", false)
		server.resetOpenAiMock()
		const command = `node -e "process.stdout.write('E2E_HISTORY_COMPLETED_COMMAND_STDOUT')"`
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_history_completed_command",
				name: "execute_command",
				arguments: {
					command,
					workdirectory: ".",
					requires_approval: true,
					synchronous: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_history_completed_command_interrupted_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_HISTORY_COMPLETED_COMMAND_CLOSED_MUST_NOT_RENDER" },
				delayMs: 30_000,
				expectedToolResults: [
					{
						callId: "call_history_completed_command",
						contentIncludes: ["Command executed successfully (exit code 0).", "E2E_HISTORY_COMPLETED_COMMAND_STDOUT"],
					},
				],
			},
			{
				type: "tool",
				id: "call_history_completed_command_resume_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_HISTORY_COMPLETED_COMMAND_RESUME_OK" },
				expectedToolResults: [
					{
						callId: "call_history_completed_command",
						contentIncludes: ["Command executed successfully (exit code 0).", "E2E_HISTORY_COMPLETED_COMMAND_STDOUT"],
					},
				],
				expectedRequestIncludes: [
					"The previous task session was closed and has now been restored.",
					"E2E_HISTORY_COMPLETED_COMMAND_RESUME_DRAFT",
				],
			},
		)

		const taskText = "E2E_COMPLETED_COMMAND_HISTORY_TASK"
		await sendTask(sidebar, taskText)
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()
		await expect(sidebar.getByText("E2E_HISTORY_COMPLETED_COMMAND_STDOUT", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(2)

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		const taskFooter = sidebar.getByRole("contentinfo")
		const resumeButton = taskFooter.getByText("Resume", { exact: true })
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("E2E_HISTORY_COMPLETED_COMMAND_STDOUT", { exact: false }).last()).toBeVisible()
		await expect(sidebar.getByRole("button", { name: "Copy command" }).last()).toBeVisible()
		await expect(taskFooter.getByText("Approve", { exact: true })).toHaveCount(0)
		await expect(taskFooter.getByText("Reject", { exact: true })).toHaveCount(0)
		await page.waitForTimeout(750)
		expect(server.openAiRequestCount).toBe(2)
		await expect(sidebar.getByText("E2E_HISTORY_COMPLETED_COMMAND_CLOSED_MUST_NOT_RENDER", { exact: false })).toHaveCount(0)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_HISTORY_COMPLETED_COMMAND_RESUME_DRAFT")
		await resumeButton.click()
		await expect(sidebar.getByText("E2E_HISTORY_COMPLETED_COMMAND_RESUME_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(3)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[2]
		expect(continuation.contractError).toBeUndefined()
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_history_completed_command",
				content: expect.stringContaining("E2E_HISTORY_COMPLETED_COMMAND_STDOUT"),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"History - pending write approval survives Close and executes only after restored approval",
	async ({ dlineDocsDir, helper, page, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Edit project files", false)
		server.resetOpenAiMock()
		const relativePath = "e2e-pending-write-history.txt"
		const filePath = path.join(workspaceDir, relativePath)
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_history_pending_write",
				name: "write_to_file",
				arguments: { path: relativePath, content: "pending write restored\n" },
			},
			{
				type: "tool",
				id: "call_history_pending_write_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_RESTORED_PENDING_WRITE_OK" },
				expectedToolResults: [{ callId: "call_history_pending_write", contentIncludes: "successfully saved" }],
				expectedRequestIncludes: ["E2E_RESTORED_PENDING_WRITE_DRAFT"],
			},
		)

		const taskText = "E2E_PENDING_WRITE_APPROVAL_HISTORY_TASK"
		await sendTask(sidebar, taskText)
		await expect(sidebar.getByText("Approve", { exact: true })).toBeVisible({ timeout: 60_000 })
		expect(server.openAiRequestCount).toBe(1)
		const [taskId] = await E2ETestHelper.waitForValue(async () => {
			const ids = await taskDirectoryIds(dlineDocsDir)
			return ids.length === 1 ? ids : undefined
		})

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		const restoredSnapshot = await E2ETestHelper.waitForValue(async () => {
			const snapshot = await readTaskSnapshot(dlineDocsDir, taskId)
			return snapshot.interaction?.kind === "tool_approval" ? snapshot : undefined
		})
		expect(restoredSnapshot.turn?.turnId).toBe(restoredSnapshot.interaction?.turnId)

		const taskFooter = sidebar.getByRole("contentinfo")
		const approveButton = taskFooter.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 30_000 })
		await expect(taskFooter.getByText("Reject", { exact: true })).toBeVisible()
		await expect(taskFooter.getByText("Resume", { exact: true })).toHaveCount(0)
		await page.waitForTimeout(500)
		expect(server.openAiRequestCount).toBe(1)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_RESTORED_PENDING_WRITE_DRAFT")
		await approveButton.click()
		await expect.poll(() => pathExists(filePath)).toBe(true)
		await expect(sidebar.getByText("E2E_RESTORED_PENDING_WRITE_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(2)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(continuation.contractError).toBeUndefined()
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_history_pending_write",
				content: expect.stringContaining("successfully saved"),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"History - approved write survives Close and Resume without reopening approval",
	async ({ helper, page, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Edit project files", false)
		server.resetOpenAiMock()
		const relativePath = "e2e-approved-write-history.txt"
		const filePath = path.join(workspaceDir, relativePath)
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_history_approved_write",
				name: "write_to_file",
				arguments: { path: relativePath, content: "approved write persisted\n" },
			},
			{
				type: "tool",
				id: "call_history_approved_write_interrupted_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_HISTORY_APPROVED_WRITE_CLOSED_MUST_NOT_RENDER" },
				delayMs: 30_000,
				expectedToolResults: [{ callId: "call_history_approved_write", contentIncludes: "successfully saved" }],
			},
			{
				type: "tool",
				id: "call_history_approved_write_resume_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_HISTORY_APPROVED_WRITE_RESUME_OK" },
				expectedToolResults: [{ callId: "call_history_approved_write", contentIncludes: "successfully saved" }],
				expectedRequestIncludes: [
					"The previous task session was closed and has now been restored.",
					"E2E_HISTORY_APPROVED_WRITE_RESUME_DRAFT",
				],
			},
		)

		const taskText = "E2E_APPROVED_WRITE_HISTORY_TASK"
		await sendTask(sidebar, taskText)
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()
		await expect.poll(() => pathExists(filePath)).toBe(true)
		await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(2)

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		const taskFooter = sidebar.getByRole("contentinfo")
		const resumeButton = taskFooter.getByText("Resume", { exact: true })
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await expect(taskFooter.getByText("Approve", { exact: true })).toHaveCount(0)
		await expect(taskFooter.getByText("Reject", { exact: true })).toHaveCount(0)
		await expect(sidebar.getByText("E2E_HISTORY_APPROVED_WRITE_CLOSED_MUST_NOT_RENDER", { exact: false })).toHaveCount(0)
		await page.waitForTimeout(500)
		expect(server.openAiRequestCount).toBe(2)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_HISTORY_APPROVED_WRITE_RESUME_DRAFT")
		await resumeButton.click()
		await expect(sidebar.getByText("E2E_HISTORY_APPROVED_WRITE_RESUME_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(3)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[2]
		expect(continuation.contractError).toBeUndefined()
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_history_approved_write",
				content: expect.stringContaining("successfully saved"),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"History - replace survives both pending approval and completed-result Close boundaries",
	async ({ helper, page, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(240_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Edit project files", false)
		const relativePath = "e2e-replace-history.txt"
		const filePath = path.join(workspaceDir, relativePath)
		await writeFile(filePath, "before\n", "utf8")
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_history_replace",
				name: "replace_in_file",
				arguments: {
					path: relativePath,
					diff: "------- SEARCH\nbefore\n=======\nafter\n+++++++ REPLACE",
				},
			},
			{
				type: "tool",
				id: "call_history_replace_interrupted_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_HISTORY_REPLACE_CLOSED_MUST_NOT_RENDER" },
				delayMs: 30_000,
				expectedToolResults: [{ callId: "call_history_replace", contentIncludes: "successfully replaced" }],
			},
			{
				type: "tool",
				id: "call_history_replace_resumed_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_HISTORY_REPLACE_RESUME_OK" },
				expectedToolResults: [{ callId: "call_history_replace", contentIncludes: "successfully replaced" }],
				expectedRequestIncludes: [
					"The previous task session was closed and has now been restored.",
					"E2E_HISTORY_REPLACE_RESUME_DRAFT",
				],
			},
		)

		const taskText = "E2E_REPLACE_HISTORY_TASK"
		await sendTask(sidebar, taskText)
		await expect(sidebar.getByText("Approve", { exact: true })).toBeVisible({ timeout: 60_000 })
		expect((await readFile(filePath, "utf8")).replaceAll("\r\n", "\n")).toBe("before\n")

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		const taskFooter = sidebar.getByRole("contentinfo")
		const restoredApprove = taskFooter.getByText("Approve", { exact: true })
		await expect(restoredApprove).toBeVisible({ timeout: 30_000 })
		await expect(taskFooter.getByText("Reject", { exact: true })).toBeVisible()
		await expect(taskFooter.getByText("Resume", { exact: true })).toHaveCount(0)
		await page.waitForTimeout(500)
		expect(server.openAiRequestCount).toBe(1)

		await restoredApprove.click()
		await expect.poll(async () => (await readFile(filePath, "utf8")).replaceAll("\r\n", "\n")).toBe("after\n")
		await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(2)
		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)

		const resumeButton = taskFooter.getByText("Resume", { exact: true })
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await expect(taskFooter.getByText("Approve", { exact: true })).toHaveCount(0)
		await expect(taskFooter.getByText("Reject", { exact: true })).toHaveCount(0)
		await expect(sidebar.getByText("E2E_HISTORY_REPLACE_CLOSED_MUST_NOT_RENDER", { exact: false })).toHaveCount(0)
		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_HISTORY_REPLACE_RESUME_DRAFT")
		await resumeButton.click()
		await expect(sidebar.getByText("E2E_HISTORY_REPLACE_RESUME_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(3)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[2]
		expect(continuation.contractError).toBeUndefined()
		expect(continuation.requestToolResults.filter((result) => result.callId === "call_history_replace")).toHaveLength(1)
		expect((await readFile(filePath, "utf8")).replaceAll("\r\n", "\n")).toBe("after\n")
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"History - closing a running command restores one interrupted result without rerunning it",
	async ({ helper, page, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(240_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Execute safe commands", false)
		const markerPath = path.join(workspaceDir, "e2e-running-command-should-not-finish.txt")
		const command = `node -e "const fs=require('fs'); console.log(['E2E','RUNNING','COMMAND','STARTED'].join('_')); setTimeout(()=>fs.writeFileSync('e2e-running-command-should-not-finish.txt','unexpected'),8000)"`
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_history_running_command",
				name: "execute_command",
				arguments: {
					command,
					workdirectory: ".",
					requires_approval: true,
					synchronous: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_history_running_command_resumed_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_HISTORY_RUNNING_COMMAND_RESUME_OK" },
				expectedRequestIncludes: [
					"The previous task session was closed and has now been restored.",
					"E2E_HISTORY_RUNNING_COMMAND_RESUME_DRAFT",
				],
			},
		)

		const taskText = "E2E_RUNNING_COMMAND_CLOSE_HISTORY_TASK"
		await sendTask(sidebar, taskText)
		await sidebar.getByText("Approve", { exact: true }).click()
		await expect(sidebar.getByText("E2E_RUNNING_COMMAND_STARTED", { exact: true }).last()).toBeVisible({ timeout: 60_000 })
		await expect(sidebar.getByRole("contentinfo").getByText("Approve", { exact: true })).toHaveCount(0)
		await expect.poll(() => server.openAiRequestCount).toBe(1)
		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)

		const taskFooter = sidebar.getByRole("contentinfo")
		const resumeButton = taskFooter.getByText("Resume", { exact: true })
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await expect(taskFooter.getByText("Approve", { exact: true })).toHaveCount(0)
		await expect(taskFooter.getByText("Reject", { exact: true })).toHaveCount(0)
		await expect(sidebar.getByRole("button", { name: "Copy command" }).last()).toBeVisible()
		await page.waitForTimeout(9_000)
		expect(await pathExists(markerPath)).toBe(false)
		expect(server.openAiRequestCount).toBe(1)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_HISTORY_RUNNING_COMMAND_RESUME_DRAFT")
		await resumeButton.click()
		await expect(sidebar.getByText("E2E_HISTORY_RUNNING_COMMAND_RESUME_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(2)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(continuation.contractError).toBeUndefined()
		const results = continuation.requestToolResults.filter((result) => result.callId === "call_history_running_command")
		expect(results).toHaveLength(1)
		expect(results[0].content).toMatch(/interrupted|cancelled|terminated/i)
		expect(await pathExists(markerPath)).toBe(false)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Task deletion - header delete removes the active task directory",
	async ({ dlineDocsDir, helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(120_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses({
			type: "tool",
			name: "attempt_completion",
			arguments: { result: "E2E_HEADER_DELETE_READY" },
		})

		await sendTask(sidebar, "E2E_HEADER_DELETE_TASK")
		await expect(sidebar.getByText("E2E_HEADER_DELETE_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		const [taskId] = await E2ETestHelper.waitForValue(async () => {
			const ids = await taskDirectoryIds(dlineDocsDir)
			return ids.length === 1 ? ids : undefined
		})

		const expandHeader = sidebar.getByLabel("Expand task header")
		if (await expandHeader.isVisible()) await expandHeader.click()
		await sidebar
			.locator("button")
			.filter({ has: sidebar.locator("svg.lucide-trash") })
			.first()
			.click()
		await expect(sidebar.getByRole("dialog")).toContainText("Delete Task")
		await sidebar.getByText("Delete", { exact: true }).click()

		await expect.poll(async () => (await taskDirectoryIds(dlineDocsDir)).includes(taskId)).toBe(false)
		await expect(sidebar.getByText("E2E_HEADER_DELETE_TASK", { exact: true })).toHaveCount(0)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Task deletion - History delete removes the selected task directory",
	async ({ dlineDocsDir, helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(120_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses({
			type: "tool",
			name: "attempt_completion",
			arguments: { result: "E2E_HISTORY_DELETE_READY" },
		})

		const taskText = "E2E_HISTORY_DELETE_TASK"
		await sendTask(sidebar, taskText)
		await expect(sidebar.getByText("E2E_HISTORY_DELETE_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		const [taskId] = await E2ETestHelper.waitForValue(async () => {
			const ids = await taskDirectoryIds(dlineDocsDir)
			return ids.length === 1 ? ids : undefined
		})
		await closeCurrentTask(sidebar)

		await page.getByRole("button", { name: "History", exact: true }).click()
		await expect(sidebar.getByText("History", { exact: true }).first()).toBeVisible()
		const historyItem = sidebar.locator(".history-item").filter({ hasText: taskText })
		await expect(historyItem).toHaveCount(1)
		await historyItem.hover()
		await historyItem.getByRole("button", { name: "Delete", exact: true }).click()

		await expect.poll(async () => (await taskDirectoryIds(dlineDocsDir)).includes(taskId)).toBe(false)
		await expect(historyItem).toHaveCount(0)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
