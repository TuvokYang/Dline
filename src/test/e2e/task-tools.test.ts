import { mkdir, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame } from "@playwright/test"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"
import { startFooterActionStabilityObserver, stopFooterActionStabilityObserver } from "./utils/ui-stability"

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

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

e2e("Tools - auto-approves a project read and continues with its result", async ({ helper, server, sidebar }) => {
	e2e.setTimeout(120_000)
	await helper.signin(sidebar)
	server.resetOpenAiMock()
	server.enqueueOpenAiResponses(
		{ type: "tool", id: "call_auto_read", name: "read_file", arguments: { path: "README.md" } },
		{
			type: "tool",
			id: "call_auto_read_completion",
			name: "attempt_completion",
			arguments: { result: "E2E read completed after the tool result." },
			expectedToolResults: [{ callId: "call_auto_read", contentIncludes: "# Test Workspace" }],
		},
		{
			type: "error",
			status: 500,
			code: "unexpected_additional_request",
			message: "Unexpected additional request after read completion",
		},
	)

	const input = sidebar.getByTestId("chat-input")
	await input.fill("Read the project README and report that the read completed.")
	await sidebar.getByTestId("send-button").click()

	await expect(sidebar.getByText("E2E read completed after the tool result.", { exact: false }).last()).toBeVisible({
		timeout: 60_000,
	})
	expect(server.getMockConsumptions("openai-compatible-chat").map((entry) => entry.toolName)).toEqual([
		"read_file",
		"attempt_completion",
	])
	await expect(input).toBeEnabled()
})

e2e(
	"Tools - parallel read, write, replace, and command return one complete result batch",
	async ({ helper, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Read project files", true)
		await setAutoApproveAction(sidebar, "Edit project files", true)
		await setAutoApproveAction(sidebar, "Execute safe commands", true)

		const writtenRelativePath = "e2e-parallel-written.txt"
		const writtenPath = path.join(workspaceDir, writtenRelativePath)
		const replacedRelativePath = "e2e-parallel-replaced.txt"
		const replacedPath = path.join(workspaceDir, replacedRelativePath)
		await writeFile(replacedPath, "before\n", "utf8")
		const toolCalls = [
			{ id: "call_parallel_read", name: "read_file", arguments: { path: "README.md" } },
			{
				id: "call_parallel_write",
				name: "write_to_file",
				arguments: { path: writtenRelativePath, content: "parallel write persisted\n" },
			},
			{
				id: "call_parallel_replace",
				name: "replace_in_file",
				arguments: {
					path: replacedRelativePath,
					diff: "------- SEARCH\nbefore\n=======\nafter\n+++++++ REPLACE",
				},
			},
			{
				id: "call_parallel_command",
				name: "execute_command",
				arguments: {
					command: `node -e "process.stdout.write('E2E_PARALLEL_COMMAND_STDOUT')"`,
					workdirectory: ".",
					requires_approval: false,
					synchronous: true,
					timeout: 60,
				},
			},
		] as const

		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{ type: "tools", tools: toolCalls },
			{
				type: "tool",
				id: "call_parallel_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_PARALLEL_TOOL_RESULTS_OK" },
				expectedToolResultCount: 4,
				expectedToolResults: [
					{ callId: "call_parallel_read", contentIncludes: "# Test Workspace" },
					{ callId: "call_parallel_write", contentIncludes: "successfully saved" },
					{ callId: "call_parallel_replace", contentIncludes: "successfully replaced" },
					{
						callId: "call_parallel_command",
						contentIncludes: ["Command executed successfully (exit code 0).", "E2E_PARALLEL_COMMAND_STDOUT"],
					},
				],
			},
			{
				type: "error",
				status: 500,
				code: "unexpected_additional_request",
				message: "Unexpected request after parallel tools completed",
			},
		)

		await sendTask(sidebar, "Run four independent tools in one parallel response.")
		await expect(sidebar.getByText("E2E_PARALLEL_TOOL_RESULTS_OK", { exact: false }).last()).toBeVisible({
			timeout: 90_000,
		})
		expect((await readFile(writtenPath, "utf8")).replaceAll("\r\n", "\n")).toBe("parallel write persisted\n")
		expect((await readFile(replacedPath, "utf8")).replaceAll("\r\n", "\n")).toBe("after\n")

		const consumptions = server.getMockConsumptions("openai-compatible-chat")
		expect(consumptions).toHaveLength(2)
		expect(consumptions[0]).toMatchObject({ responseType: "tools", responseToolCalls: toolCalls })
		expect(consumptions[1].contractError).toBeUndefined()
		expect(consumptions[1].requestToolResults).toHaveLength(4)
		for (const tool of toolCalls) {
			expect(consumptions[1].requestToolResults.filter((result) => result.callId === tool.id)).toHaveLength(1)
		}
		await expect(sidebar.getByRole("button", { name: "Copy command" }).last()).toBeVisible()
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - project read approval carries the input draft into the continuation",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(120_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Read project files", false)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{ type: "tool", id: "call_approved_read", name: "read_file", arguments: { path: "README.md" } },
			{
				type: "tool",
				id: "call_approved_read_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_READ_APPROVAL_DRAFT_OK" },
				expectedToolResults: [{ callId: "call_approved_read", contentIncludes: "# Test Workspace" }],
				expectedRequestIncludes: ["E2E_READ_APPROVAL_NOTE"],
			},
		)

		await sendTask(sidebar, "Request an explicitly approved project read.")
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await startFooterActionStabilityObserver(sidebar, ["Approve"])
		await sidebar.page().waitForTimeout(750)
		const approvalStabilityEvents = await stopFooterActionStabilityObserver(sidebar)
		expect(approvalStabilityEvents).toEqual([])
		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_READ_APPROVAL_NOTE")
		await approveButton.click()

		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_READ_APPROVAL_NOTE", { exact: true }).last()).toBeVisible()
		await expect(sidebar.getByText("E2E_READ_APPROVAL_DRAFT_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(2)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({ callId: "call_approved_read", content: expect.stringContaining("# Test Workspace") }),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - rejected project read does not execute and carries rejection feedback",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(120_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Read project files", false)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{ type: "tool", id: "call_rejected_read", name: "read_file", arguments: { path: "README.md" } },
			{
				type: "tool",
				id: "call_rejected_read_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_READ_REJECTION_CONTINUED" },
				expectedToolResults: [{ callId: "call_rejected_read", contentIncludes: "The user denied this operation." }],
				expectedRequestIncludes: ["E2E_READ_REJECT_FEEDBACK"],
			},
		)

		await sendTask(sidebar, "Request a project read that will be rejected.")
		const rejectButton = sidebar.getByText("Reject", { exact: true })
		await expect(rejectButton).toBeVisible({ timeout: 60_000 })
		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_READ_REJECT_FEEDBACK")
		await rejectButton.click()

		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_READ_REJECTION_CONTINUED", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(2)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_rejected_read",
				content: expect.stringContaining("The user denied this operation."),
			}),
		)
		const rejectedReadResult = continuation.requestToolResults.find(({ callId }) => callId === "call_rejected_read")
		expect(rejectedReadResult?.content).toContain("E2E_READ_REJECT_FEEDBACK")
		expect(JSON.stringify(continuation.requestBody)).not.toContain("This workspace is used for testing the extension")
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - Enter rejects pending read, write, and command approvals with the current draft",
	async ({ helper, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Read project files", false)
		await setAutoApproveAction(sidebar, "Edit project files", false)
		await setAutoApproveAction(sidebar, "Execute safe commands", false)
		server.resetOpenAiMock()
		const relativePath = "e2e-enter-rejected-write.txt"
		const filePath = path.join(workspaceDir, relativePath)
		const commandMarker = "E2E_ENTER_REJECTED_COMMAND_MUST_NOT_RUN"
		server.enqueueOpenAiResponses(
			{ type: "tool", id: "call_enter_rejected_read", name: "read_file", arguments: { path: "README.md" } },
			{
				type: "tool",
				id: "call_enter_rejected_write",
				name: "write_to_file",
				arguments: { path: relativePath, content: "must be reverted\n" },
				expectedToolResults: [{ callId: "call_enter_rejected_read", contentIncludes: "The user denied this operation." }],
				expectedRequestIncludes: ["E2E_ENTER_READ_FEEDBACK"],
			},
			{
				type: "tool",
				id: "call_enter_rejected_command",
				name: "execute_command",
				arguments: {
					command: `node -e "console.log('${commandMarker}')"`,
					workdirectory: ".",
					requires_approval: true,
					synchronous: true,
					timeout: 60,
				},
				expectedToolResults: [
					{ callId: "call_enter_rejected_write", contentIncludes: "The user denied this operation." },
				],
				expectedRequestIncludes: ["E2E_ENTER_WRITE_FEEDBACK"],
			},
			{
				type: "tool",
				id: "call_enter_rejected_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_ENTER_APPROVAL_REJECTION_OK" },
				expectedToolResults: [
					{ callId: "call_enter_rejected_command", contentIncludes: "The user denied this operation." },
				],
				expectedRequestIncludes: ["E2E_ENTER_COMMAND_FEEDBACK"],
			},
		)

		await sendTask(sidebar, "Reject three approval tools by pressing Enter with feedback.")
		const input = sidebar.getByTestId("chat-input")
		await expect(sidebar.getByText("Approve", { exact: true })).toBeVisible({ timeout: 60_000 })
		await expect(input).toBeEnabled()
		await input.fill("E2E_ENTER_READ_FEEDBACK")
		await input.press("Enter")
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText(relativePath, { exact: false }).last()).toBeVisible({ timeout: 60_000 })

		await expect(input).toBeEnabled()
		await input.fill("E2E_ENTER_WRITE_FEEDBACK")
		await input.press("Enter")
		await expect(input).toHaveValue("")
		await expect(sidebar.getByRole("button", { name: "Copy command" }).last()).toBeVisible({ timeout: 60_000 })
		await expect
			.poll(() =>
				readFile(filePath, "utf8")
					.then(() => true)
					.catch(() => false),
			)
			.toBe(false)

		await expect(input).toBeEnabled()
		await input.fill("E2E_ENTER_COMMAND_FEEDBACK")
		await input.press("Enter")
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_ENTER_APPROVAL_REJECTION_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect(sidebar.getByText(commandMarker, { exact: true })).toHaveCount(0)
		await expect.poll(() => server.openAiRequestCount).toBe(4)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - approved write, rejected replace, and approved retry preserve real workspace state",
	async ({ helper, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_write_file",
				name: "write_to_file",
				arguments: { path: "e2e-tool-file.txt", content: "alpha\n" },
			},
			{
				type: "tool",
				id: "call_rejected_replace",
				name: "replace_in_file",
				arguments: {
					path: "e2e-tool-file.txt",
					diff: "------- SEARCH\nalpha\n=======\nbeta\n+++++++ REPLACE",
				},
				expectedToolResults: [{ callId: "call_write_file", contentIncludes: "successfully saved" }],
				expectedRequestIncludes: ["E2E_WRITE_APPROVAL_NOTE"],
			},
			{
				type: "tool",
				id: "call_approved_replace",
				name: "replace_in_file",
				arguments: {
					path: "e2e-tool-file.txt",
					diff: "------- SEARCH\nalpha\n=======\nbeta\n+++++++ REPLACE",
				},
				expectedToolResults: [
					{
						callId: "call_rejected_replace",
						contentIncludes: ["The user denied this operation.", "file was not updated"],
					},
				],
				expectedRequestIncludes: ["E2E_REPLACE_REJECT_FEEDBACK"],
			},
			{
				type: "tool",
				id: "call_write_replace_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_WRITE_REPLACE_OK" },
				expectedToolResults: [{ callId: "call_approved_replace", contentIncludes: "successfully replaced" }],
			},
		)

		await sendTask(sidebar, "Create and then edit a project file with explicit approval.")
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_WRITE_APPROVAL_NOTE")
		await approveButton.click()

		const filePath = path.join(workspaceDir, "e2e-tool-file.txt")
		await expect
			.poll(async () =>
				readFile(filePath, "utf8")
					.then((text) => text.replaceAll("\r\n", "\n"))
					.catch(() => ""),
			)
			.toBe("alpha\n")
		const rejectButton = sidebar.getByText("Reject", { exact: true })
		await expect(rejectButton).toBeVisible({ timeout: 60_000 })
		await input.fill("E2E_REPLACE_REJECT_FEEDBACK")
		await rejectButton.click()
		await expect(input).toHaveValue("")
		await expect.poll(async () => (await readFile(filePath, "utf8")).replaceAll("\r\n", "\n")).toBe("alpha\n")
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()
		await expect.poll(async () => (await readFile(filePath, "utf8")).replaceAll("\r\n", "\n")).toBe("beta\n")
		await expect(sidebar.getByText("E2E_WRITE_REPLACE_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })

		await expect.poll(() => server.openAiRequestCount).toBe(4)
		const consumptions = server.getMockConsumptions("openai-compatible-chat")
		expect(consumptions.map((entry) => entry.toolName)).toEqual([
			"write_to_file",
			"replace_in_file",
			"replace_in_file",
			"attempt_completion",
		])
		expect(consumptions[2].requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_rejected_replace",
				content: expect.stringContaining("file was not updated"),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - Cancel after an approved read resumes with the durable read result",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Read project files", false)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{ type: "tool", id: "call_cancel_approved_read", name: "read_file", arguments: { path: "README.md" } },
			{
				type: "tool",
				id: "call_cancel_approved_read_interrupted",
				name: "attempt_completion",
				arguments: { result: "E2E_CANCEL_APPROVED_READ_MUST_NOT_RENDER" },
				delayMs: 30_000,
				expectedToolResults: [{ callId: "call_cancel_approved_read", contentIncludes: "# Test Workspace" }],
			},
			{
				type: "tool",
				id: "call_cancel_approved_read_resumed",
				name: "attempt_completion",
				arguments: { result: "E2E_CANCEL_APPROVED_READ_RESUME_OK" },
				expectedToolResults: [{ callId: "call_cancel_approved_read", contentIncludes: "# Test Workspace" }],
				expectedRequestIncludes: ["E2E_CANCEL_APPROVED_READ_RESUME_DRAFT"],
			},
		)

		await sendTask(sidebar, "Approve a read, then cancel its in-flight continuation.")
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()
		await expect(sidebar.getByText("Dline read 1 file:", { exact: true })).toBeVisible({ timeout: 30_000 })
		await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(2)

		const taskFooter = sidebar.getByRole("contentinfo")
		const cancelButton = taskFooter.getByText("Cancel", { exact: true })
		await expect(cancelButton).toBeVisible({ timeout: 30_000 })
		await cancelButton.click()
		const resumeButton = taskFooter.getByText("Resume", { exact: true })
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("E2E_CANCEL_APPROVED_READ_MUST_NOT_RENDER", { exact: false })).toHaveCount(0)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_CANCEL_APPROVED_READ_RESUME_DRAFT")
		await resumeButton.click()
		await expect(sidebar.getByText("E2E_CANCEL_APPROVED_READ_RESUME_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(3)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[2]
		expect(continuation.contractError).toBeUndefined()
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_cancel_approved_read",
				content: expect.stringContaining("# Test Workspace"),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - Cancel after an approved write resumes without repeating the write",
	async ({ helper, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Edit project files", false)
		server.resetOpenAiMock()
		const relativePath = "e2e-cancel-approved-write.txt"
		const filePath = path.join(workspaceDir, relativePath)
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_cancel_approved_write",
				name: "write_to_file",
				arguments: { path: relativePath, content: "write survives cancellation\n" },
			},
			{
				type: "tool",
				id: "call_cancel_approved_write_interrupted",
				name: "attempt_completion",
				arguments: { result: "E2E_CANCEL_APPROVED_WRITE_MUST_NOT_RENDER" },
				delayMs: 30_000,
				expectedToolResults: [{ callId: "call_cancel_approved_write", contentIncludes: "successfully saved" }],
			},
			{
				type: "tool",
				id: "call_cancel_approved_write_resumed",
				name: "attempt_completion",
				arguments: { result: "E2E_CANCEL_APPROVED_WRITE_RESUME_OK" },
				expectedToolResults: [{ callId: "call_cancel_approved_write", contentIncludes: "successfully saved" }],
				expectedRequestIncludes: ["E2E_CANCEL_APPROVED_WRITE_RESUME_DRAFT"],
			},
		)

		await sendTask(sidebar, "Approve a write, then cancel its in-flight continuation.")
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()
		await expect
			.poll(async () =>
				readFile(filePath, "utf8")
					.then((text) => text.replaceAll("\r\n", "\n"))
					.catch(() => ""),
			)
			.toBe("write survives cancellation\n")
		await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(2)

		const taskFooter = sidebar.getByRole("contentinfo")
		const cancelButton = taskFooter.getByText("Cancel", { exact: true })
		await expect(cancelButton).toBeVisible({ timeout: 30_000 })
		await cancelButton.click()
		const resumeButton = taskFooter.getByText("Resume", { exact: true })
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("E2E_CANCEL_APPROVED_WRITE_MUST_NOT_RENDER", { exact: false })).toHaveCount(0)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_CANCEL_APPROVED_WRITE_RESUME_DRAFT")
		await resumeButton.click()
		await expect(sidebar.getByText("E2E_CANCEL_APPROVED_WRITE_RESUME_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.openAiRequestCount).toBe(3)
		expect(await readFile(filePath, "utf8")).toContain("write survives cancellation")
		const continuation = server.getMockConsumptions("openai-compatible-chat")[2]
		expect(continuation.contractError).toBeUndefined()
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_cancel_approved_write",
				content: expect.stringContaining("successfully saved"),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - approved foreground command reports output and exit status to the model",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Execute safe commands", false)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_successful_command",
				name: "execute_command",
				arguments: {
					command: `node -e "process.stdout.write('E2E_COMMAND_STDOUT')"`,
					workdirectory: ".",
					requires_approval: true,
					synchronous: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_successful_command_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_COMMAND_APPROVAL_OK" },
				expectedToolResults: [
					{
						callId: "call_successful_command",
						contentIncludes: ["Command executed successfully (exit code 0).", "E2E_COMMAND_STDOUT"],
					},
				],
				expectedRequestIncludes: ["E2E_COMMAND_APPROVAL_NOTE"],
			},
		)

		await sendTask(sidebar, "Run a foreground command with explicit approval.")
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await startFooterActionStabilityObserver(sidebar, ["Approve"])
		await sidebar.page().waitForTimeout(750)
		const approvalStabilityEvents = await stopFooterActionStabilityObserver(sidebar)
		expect(approvalStabilityEvents).toEqual([])
		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_COMMAND_APPROVAL_NOTE")
		await approveButton.click()

		await expect(sidebar.getByText("E2E_COMMAND_APPROVAL_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect.poll(() => server.openAiRequestCount).toBe(2)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[1]
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_successful_command",
				content: expect.stringContaining("E2E_COMMAND_STDOUT"),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - command-row Cancel terminates only the running foreground command and returns cancellation",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Execute safe commands", false)
		server.resetOpenAiMock()
		const command = `node -e "console.log('E2E_COMMAND_CANCEL_STARTED'); setInterval(() => {}, 1000)"`
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_cancelled_command",
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
				id: "call_cancelled_command_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_COMMAND_CANCEL_OK" },
				expectedToolResults: [
					{ callId: "call_cancelled_command", contentIncludes: "Command was cancelled by the user." },
				],
			},
		)

		await sendTask(sidebar, "Run a foreground command and wait for command-specific cancellation.")
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()

		const copyCommandButton = sidebar.getByRole("button", { name: "Copy command" }).last()
		await expect(copyCommandButton).toBeVisible({ timeout: 60_000 })
		const commandActions = copyCommandButton.locator("xpath=ancestor::div[.//button[normalize-space()='Cancel']][1]")
		const commandCancelButton = commandActions.getByRole("button", { name: "Cancel", exact: true })
		await expect(commandCancelButton).toBeVisible({ timeout: 60_000 })
		await commandCancelButton.evaluate((element) => element.setAttribute("data-e2e-footer-stability", "command-cancel"))
		await startFooterActionStabilityObserver(sidebar, ["Cancel"], '[data-e2e-footer-stability="command-cancel"]')
		await sidebar.page().waitForTimeout(750)
		const commandCancelStabilityEvents = await stopFooterActionStabilityObserver(sidebar)
		expect(commandCancelStabilityEvents).toEqual([])
		await commandCancelButton.click()

		await expect(sidebar.getByText("E2E_COMMAND_CANCEL_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		const consumptions = server.getMockConsumptions("openai-compatible-chat")
		expect(consumptions.map((entry) => entry.toolName)).toEqual(["execute_command", "attempt_completion"])
		expect(consumptions[1].requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_cancelled_command",
				content: expect.stringContaining("Command was cancelled by the user."),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - command-row Cancel stops an explicit background command and injects its final status",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Execute safe commands", false)
		server.resetOpenAiMock()
		const command = `node -e "console.log('E2E_BACKGROUND_COMMAND_STARTED'); setInterval(() => {}, 1000)"`
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_background_command",
				name: "execute_command",
				arguments: {
					command,
					workdirectory: ".",
					requires_approval: true,
					background: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_background_command_qna",
				name: "qna_respond",
				arguments: { response: "E2E_BACKGROUND_COMMAND_READY_TO_CANCEL" },
				expectedToolResults: [
					{ callId: "call_background_command", contentIncludes: "Command is running in the background." },
				],
			},
			{
				type: "tool",
				id: "call_background_command_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_BACKGROUND_COMMAND_CANCEL_OK" },
				expectedRequestIncludes: [
					"E2E_BACKGROUND_COMMAND_CANCEL_FEEDBACK",
					"# Background Results",
					"## Background Command Results",
					"E2E_BACKGROUND_COMMAND_STARTED",
					"cancelled",
				],
			},
		)

		await sendTask(sidebar, "Start an explicit background command and wait for command-specific cancellation.")
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()
		await expect(sidebar.getByText("E2E_BACKGROUND_COMMAND_READY_TO_CANCEL", { exact: true })).toBeVisible({
			timeout: 60_000,
		})

		const copyCommandButton = sidebar.getByRole("button", { name: "Copy command" }).last()
		await expect(copyCommandButton).toBeVisible()
		const commandActions = copyCommandButton.locator("xpath=ancestor::div[.//button[normalize-space()='Cancel']][1]")
		const commandCancelButton = commandActions.getByRole("button", { name: "Cancel", exact: true })
		await expect(commandCancelButton).toBeVisible({ timeout: 30_000 })
		await commandCancelButton.click()
		await expect(sidebar.getByText("Cancelled", { exact: true }).last()).toBeVisible({ timeout: 30_000 })

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_BACKGROUND_COMMAND_CANCEL_FEEDBACK")
		await input.press("Enter")
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_BACKGROUND_COMMAND_CANCEL_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})

		await expect.poll(() => server.openAiRequestCount).toBe(3)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[2]
		expect(continuation.contractError).toBeUndefined()
		const continuationRequest = JSON.stringify(continuation.requestBody)
		expect(continuationRequest).toContain("# Background Results")
		expect(continuationRequest).toContain("## Background Command Results")
		expect(continuationRequest).toContain("E2E_BACKGROUND_COMMAND_STARTED")
		expect(continuationRequest).toContain("cancelled")
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - kill_command terminates the exact background execute_command by function_id",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Execute safe commands", false)
		server.resetOpenAiMock()
		const executeFunctionId = "call_ai_kill_background_command"
		const killFunctionId = "call_ai_kill_command"
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: executeFunctionId,
				name: "execute_command",
				arguments: {
					command: `node -e "console.log('E2E_AI_KILL_STARTED'); setInterval(() => {}, 1000)"`,
					workdirectory: ".",
					requires_approval: true,
					background: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: killFunctionId,
				name: "kill_command",
				arguments: { function_id: executeFunctionId },
				expectedToolResults: [
					{
						callId: executeFunctionId,
						contentIncludes: ["Command is running in the background.", `function_id: ${executeFunctionId}`],
					},
				],
			},
			{
				type: "tool",
				id: "call_ai_kill_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_AI_KILL_COMMAND_OK" },
				expectedToolResults: [
					{ callId: killFunctionId, contentIncludes: "Termination was requested for the running command." },
				],
			},
		)

		await sendTask(sidebar, "Start a background command, then terminate it with kill_command.")
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()

		await expect(sidebar.getByText("Dline requested command termination:", { exact: true })).toBeVisible({
			timeout: 60_000,
		})
		await expect(sidebar.getByText(executeFunctionId, { exact: true })).toBeVisible()
		await expect(sidebar.getByText("Termination was requested for the running command.", { exact: true })).toBeVisible()
		await expect(sidebar.getByText("E2E_AI_KILL_COMMAND_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })

		await expect.poll(() => server.openAiRequestCount).toBe(3)
		const consumptions = server.getMockConsumptions("openai-compatible-chat")
		expect(consumptions.map((entry) => entry.toolName)).toEqual(["execute_command", "kill_command", "attempt_completion"])
		expect(consumptions[2].contractError).toBeUndefined()
		expect(consumptions[2].requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: killFunctionId,
				content: expect.stringContaining("Termination was requested for the running command."),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Tools - subagent-row Cancel stops a foreground subagent and returns its tool result",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Read project files", false)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_foreground_subagent",
				name: "use_subagent",
				arguments: {
					agent_name: "default",
					task: "E2E_FOREGROUND_SUBAGENT_CANCEL_TASK",
					context: "Remain active until the user cancels this subagent.",
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_delayed_subagent_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_CANCELLED_SUBAGENT_MUST_NOT_COMPLETE" },
				delayMs: 30_000,
			},
			{
				type: "tool",
				id: "call_foreground_subagent_cancel_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_FOREGROUND_SUBAGENT_CANCEL_OK" },
				expectedToolResults: [
					{
						callId: "call_foreground_subagent",
						contentIncludes: ["CANCELLED", "Subagent run cancelled."],
					},
				],
			},
		)

		await sendTask(sidebar, "Start a foreground subagent and wait for its row-specific cancellation.")
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()

		const subagentTask = sidebar.getByText("E2E_FOREGROUND_SUBAGENT_CANCEL_TASK", { exact: true }).last()
		await expect(subagentTask).toBeVisible({ timeout: 60_000 })
		await expect.poll(() => server.openAiRequestCount).toBe(2)
		const subagentCard = subagentTask.locator("xpath=ancestor::div[.//button[normalize-space()='Cancel']][1]")
		const cancelButton = subagentCard.getByRole("button", { name: "Cancel", exact: true })
		await expect(cancelButton).toBeVisible()
		await cancelButton.evaluate((element) => element.setAttribute("data-e2e-footer-stability", "subagent-cancel"))
		await startFooterActionStabilityObserver(sidebar, ["Cancel"], '[data-e2e-footer-stability="subagent-cancel"]')
		await sidebar.page().waitForTimeout(750)
		const subagentCancelStabilityEvents = await stopFooterActionStabilityObserver(sidebar)
		expect(subagentCancelStabilityEvents).toEqual([])
		await cancelButton.click()

		await expect(sidebar.getByText("Cancelled", { exact: true }).last()).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("E2E_CANCELLED_SUBAGENT_MUST_NOT_COMPLETE", { exact: false })).toHaveCount(0)
		await expect(sidebar.getByText("E2E_FOREGROUND_SUBAGENT_CANCEL_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})

		await expect.poll(() => server.openAiRequestCount).toBe(3)
		const consumptions = server.getMockConsumptions("openai-compatible-chat")
		expect(consumptions.map((entry) => entry.toolName)).toEqual(["use_subagent", "attempt_completion", "attempt_completion"])
		const continuation = consumptions[2]
		expect(continuation.contractError).toBeUndefined()
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_foreground_subagent",
				content: expect.stringContaining("CANCELLED"),
			}),
		)
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_foreground_subagent",
				content: expect.stringContaining("Subagent run cancelled."),
			}),
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e("Tools - batch subagent Cancel keeps siblings active before Cancel all", async ({ helper, server, sidebar, userDataDir }) => {
	e2e.setTimeout(180_000)
	await helper.signin(sidebar)
	await setAutoApproveAction(sidebar, "Read project files", false)
	server.resetOpenAiMock()
	server.enqueueOpenAiResponses(
		{
			type: "tool",
			id: "call_foreground_subagents",
			name: "use_subagents",
			arguments: {
				prompt_1: "<task>E2E_BATCH_CANCEL_ONE</task><context>Remain active until cancelled.</context>",
				prompt_2: "<task>E2E_BATCH_CANCEL_TWO</task><context>Remain active until cancelled.</context>",
				prompt_3: "<task>E2E_BATCH_CANCEL_THREE</task><context>Remain active until cancelled.</context>",
				timeout: 60,
			},
		},
		...Array.from({ length: 3 }, (_, index) => ({
			type: "tool" as const,
			id: `call_delayed_batch_subagent_${index + 1}`,
			name: "attempt_completion",
			arguments: { result: `E2E_CANCELLED_BATCH_SUBAGENT_${index + 1}_MUST_NOT_COMPLETE` },
			delayMs: 30_000,
		})),
		{
			type: "tool",
			id: "call_foreground_subagents_cancel_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_FOREGROUND_SUBAGENTS_CANCEL_OK" },
			expectedToolResults: [
				{
					callId: "call_foreground_subagents",
					contentIncludes: [
						"[1] CANCELLED - E2E_BATCH_CANCEL_ONE",
						"[2] CANCELLED - E2E_BATCH_CANCEL_TWO",
						"[3] CANCELLED - E2E_BATCH_CANCEL_THREE",
						"Subagent run cancelled.",
					],
				},
			],
		},
	)

	await sendTask(sidebar, "Start three foreground subagents and expose their cancellation controls.")
	const approveButton = sidebar.getByText("Approve", { exact: true })
	await expect(approveButton).toBeVisible({ timeout: 60_000 })
	await approveButton.click()

	const firstTask = sidebar.getByText("E2E_BATCH_CANCEL_ONE", { exact: true }).last()
	await expect(firstTask).toBeVisible({ timeout: 60_000 })
	await expect(sidebar.getByText("E2E_BATCH_CANCEL_TWO", { exact: true }).last()).toBeVisible()
	await expect(sidebar.getByText("E2E_BATCH_CANCEL_THREE", { exact: true }).last()).toBeVisible()
	await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(4)
	const batchRow = firstTask.locator(
		"xpath=ancestor::div[.//button[@aria-label='Collapse subagent status' or @aria-label='Expand subagent status']][1]",
	)
	const rowCancelButtons = batchRow.getByRole("button", { name: "Cancel", exact: true })
	await expect(rowCancelButtons).toHaveCount(3)

	const firstCard = firstTask.locator("xpath=ancestor::div[.//button[normalize-space()='Cancel']][1]")
	await firstCard.getByRole("button", { name: "Cancel", exact: true }).click()
	await expect(rowCancelButtons).toHaveCount(2)
	await expect(sidebar.getByText("E2E_BATCH_CANCEL_TWO", { exact: true }).last()).toBeVisible()
	await expect(sidebar.getByText("E2E_BATCH_CANCEL_THREE", { exact: true }).last()).toBeVisible()

	const cancelAllButton = batchRow.getByRole("button", { name: "Cancel all", exact: true })
	await expect(cancelAllButton).toBeVisible()
	await cancelAllButton.click()
	await expect(rowCancelButtons).toHaveCount(0)
	await expect(sidebar.getByText("Cancelled", { exact: true }).last()).toBeVisible({ timeout: 30_000 })
	for (const index of [1, 2, 3]) {
		await expect(sidebar.getByText(`E2E_CANCELLED_BATCH_SUBAGENT_${index}_MUST_NOT_COMPLETE`, { exact: false })).toHaveCount(
			0,
		)
	}
	await expect(sidebar.getByText("E2E_FOREGROUND_SUBAGENTS_CANCEL_OK", { exact: false }).last()).toBeVisible({
		timeout: 60_000,
	})

	await expect.poll(() => server.openAiRequestCount).toBe(5)
	const consumptions = server.getMockConsumptions("openai-compatible-chat")
	expect(consumptions.map((entry) => entry.toolName)).toEqual([
		"use_subagents",
		"attempt_completion",
		"attempt_completion",
		"attempt_completion",
		"attempt_completion",
	])
	const continuation = consumptions[4]
	expect(continuation.contractError).toBeUndefined()
	for (const marker of [
		"[1] CANCELLED - E2E_BATCH_CANCEL_ONE",
		"[2] CANCELLED - E2E_BATCH_CANCEL_TWO",
		"[3] CANCELLED - E2E_BATCH_CANCEL_THREE",
		"Subagent run cancelled.",
	]) {
		expect(continuation.requestToolResults).toContainEqual(
			expect.objectContaining({
				callId: "call_foreground_subagents",
				content: expect.stringContaining(marker),
			}),
		)
	}
	await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
})

e2e(
	"Tools - subagent-row Cancel stops a background subagent and injects its final result",
	async ({ helper, server, sidebar, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		const subagentDirectory = path.join(workspaceDir, ".agents", "subagents")
		await mkdir(subagentDirectory, { recursive: true })
		await writeFile(
			path.join(subagentDirectory, "e2e-background.yml"),
			`---
name: e2e-background
description: E2E background cancellation agent
tools: read_file
profile: ${E2E_PROFILE_NAMES.mockOpenAiResponses}
---

Remain active until cancelled.`,
			"utf8",
		)

		await helper.signin(sidebar)
		await setAutoApproveAction(sidebar, "Read project files", false)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_background_subagent",
				name: "use_subagent",
				arguments: {
					agent_name: "e2e-background",
					task: "E2E_BACKGROUND_SUBAGENT_CANCEL_TASK",
					context: "Remain active until the user cancels this background subagent.",
					background: true,
					timeout: 60,
				},
			},
			{
				type: "tool",
				id: "call_background_subagent_qna",
				name: "qna_respond",
				arguments: { response: "E2E_BACKGROUND_SUBAGENT_READY_TO_CANCEL" },
				expectedToolResults: [
					{ callId: "call_background_subagent", contentIncludes: "Started background subagent job: subagent_1" },
				],
			},
			{
				type: "tool",
				id: "call_background_subagent_cancel_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_BACKGROUND_SUBAGENT_CANCEL_OK" },
				expectedRequestIncludes: [
					"E2E_BACKGROUND_SUBAGENT_CANCEL_FEEDBACK",
					"# Background Results",
					"## Background Subagent Results",
					"subagent_1",
					"cancelled",
					"Subagent run cancelled.",
				],
			},
		)
		server.enqueueResponses("openai-compatible-responses", {
			type: "tool",
			id: "call_delayed_background_subagent_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_CANCELLED_BACKGROUND_SUBAGENT_MUST_NOT_COMPLETE" },
			delayMs: 30_000,
		})

		await sendTask(sidebar, "Start a background subagent and wait for its row-specific cancellation.")
		const approveButton = sidebar.getByText("Approve", { exact: true })
		await expect(approveButton).toBeVisible({ timeout: 60_000 })
		await approveButton.click()
		await expect(sidebar.getByText("E2E_BACKGROUND_SUBAGENT_READY_TO_CANCEL", { exact: true })).toBeVisible({
			timeout: 60_000,
		})

		const subagentTask = sidebar.getByText("E2E_BACKGROUND_SUBAGENT_CANCEL_TASK", { exact: true }).last()
		await expect(subagentTask).toBeVisible()
		const subagentCard = subagentTask.locator("xpath=ancestor::div[.//button[normalize-space()='Cancel']][1]")
		const cancelButton = subagentCard.getByRole("button", { name: "Cancel", exact: true })
		await expect(cancelButton).toBeVisible({ timeout: 30_000 })
		await expect.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 }).toBe(1)
		await cancelButton.click()
		await expect(sidebar.getByText("Cancelled", { exact: true }).last()).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("E2E_CANCELLED_BACKGROUND_SUBAGENT_MUST_NOT_COMPLETE", { exact: false })).toHaveCount(0)
		const showCancelledOutput = sidebar.getByRole("button", { name: "Show subagent output" }).last()
		await expect(showCancelledOutput).toBeVisible({ timeout: 30_000 })
		await showCancelledOutput.click()
		await expect(sidebar.getByText("Subagent run cancelled.", { exact: true }).last()).toBeVisible()

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_BACKGROUND_SUBAGENT_CANCEL_FEEDBACK")
		await input.press("Enter")
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_BACKGROUND_SUBAGENT_CANCEL_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})

		await expect.poll(() => server.openAiRequestCount).toBe(3)
		const continuation = server.getMockConsumptions("openai-compatible-chat")[2]
		expect(continuation.contractError).toBeUndefined()
		const continuationRequest = JSON.stringify(continuation.requestBody)
		expect(continuationRequest).toContain("# Background Results")
		expect(continuationRequest).toContain("## Background Subagent Results")
		expect(continuationRequest).toContain("subagent_1")
		expect(continuationRequest).toContain("cancelled")
		expect(continuationRequest).toContain("Subagent run cancelled.")
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
