import { expect, type Frame } from "@playwright/test"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"
import { startFooterActionStabilityObserver, stopFooterActionStabilityObserver } from "./utils/ui-stability"

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

async function submitWithEnter(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled()
	await input.fill(text)
	await input.press("Enter")
	await expect(input).toHaveValue("")
	await expect(sidebar.getByText(text, { exact: true }).last()).toBeVisible()
}

async function expectSingleUserFeedback(sidebar: Frame, text: string): Promise<void> {
	const feedback = sidebar.locator("span.ph-no-capture:not(button span)").filter({ hasText: text })
	await expect(feedback).toHaveCount(1)
	await expect(feedback).toHaveText(text)
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

async function expectNoDecisionButtons(sidebar: Frame): Promise<void> {
	const taskFooter = sidebar.getByRole("contentinfo")
	for (const label of ["Resume", "Start New Task", "Approve", "Reject", "Acknowledge", "Stop"]) {
		await expect(taskFooter.getByText(label, { exact: true })).toHaveCount(0)
	}
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
	await expect(sidebar.getByText("Available Models", { exact: true })).not.toBeVisible()
}

e2e(
	"Task lifecycle - Cancel, Resume, and a post-completion turn preserve draft ownership",
	async ({ helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				name: "attempt_completion",
				arguments: { result: "E2E_CANCELLED_RESPONSE_MUST_NOT_RENDER" },
				delayMs: 30_000,
			},
			{
				type: "tool",
				name: "attempt_completion",
				arguments: { result: "E2E_RESUME_CONTINUATION_OK" },
			},
			{
				type: "tool",
				name: "attempt_completion",
				arguments: { result: "E2E_POST_COMPLETION_TURN_OK" },
			},
			{
				type: "error",
				status: 500,
				code: "unexpected_additional_request",
				message: "Unexpected request after post-completion turn",
			},
		)

		await sendTask(sidebar, "E2E_CANCEL_RESUME_TASK")
		await expect.poll(() => server.openAiRequestCount, { timeout: 60_000 }).toBe(1)
		const cancelButton = sidebar.getByRole("button", { name: "Cancel", exact: true }).first()
		await expect(cancelButton).toBeVisible({ timeout: 30_000 })
		await cancelButton.click()

		const resumeButton = sidebar.getByRole("button", { name: "Resume", exact: true }).first()
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		const input = sidebar.getByTestId("chat-input")
		await expect(input).toBeEnabled()
		await input.fill("E2E_RESUME_DRAFT")
		await resumeButton.click()
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_RESUME_DRAFT", { exact: true }).last()).toBeVisible({ timeout: 30_000 })
		await expect(sidebar.getByText("E2E_RESUME_CONTINUATION_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect(sidebar.getByText("E2E_CANCELLED_RESPONSE_MUST_NOT_RENDER", { exact: false })).toHaveCount(0)
		await expect.poll(() => server.openAiRequestCount).toBe(2)
		expect(JSON.stringify(server.getOpenAiRequestBodies()[1])).toContain("E2E_RESUME_DRAFT")
		await expect(resumeButton).not.toBeVisible()
		const taskFooter = sidebar.getByRole("contentinfo")
		await expect(taskFooter.getByText("Start New Task", { exact: true })).toBeVisible()

		await submitWithEnter(sidebar, "E2E_POST_COMPLETION_INPUT")
		await expect(sidebar.getByText("E2E_POST_COMPLETION_TURN_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect.poll(() => server.openAiRequestCount).toBe(3)
		expect(JSON.stringify(server.getOpenAiRequestBodies()[2])).toContain("E2E_POST_COMPLETION_INPUT")
		await expect(taskFooter.getByText("Start New Task", { exact: true })).toBeVisible()

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, "E2E_CANCEL_RESUME_TASK")
		await expect(taskFooter.getByText("Start New Task", { exact: true })).toBeVisible({ timeout: 30_000 })
		await expect(taskFooter.getByText("Resume", { exact: true })).toHaveCount(0)
		await expect(sidebar.getByTestId("chat-input")).toBeEnabled()
		await page.waitForTimeout(500)
		expect(server.openAiRequestCount).toBe(3)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Task lifecycle - Cancel after a visible partial stream stops it and resumes exactly once",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await selectProfile(sidebar, E2E_PROFILE_NAMES.mockDeepSeek)
		server.resetOpenAiMock()
		server.enqueueResponses(
			"deepseek-chat",
			{
				type: "tool",
				id: "call_stream_cancelled_before_delivery",
				name: "attempt_completion",
				arguments: { result: "E2E_STREAM_CANCELLED_TOOL_MUST_NOT_RENDER" },
				reasoning: "E2E_STREAM_PARTIAL_BEFORE_CANCEL",
				afterReasoningDelayMs: 30_000,
			},
			{
				type: "tool",
				id: "call_stream_cancel_resumed_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_STREAM_CANCEL_RESUME_OK" },
				expectedRequestIncludes: ["E2E_STREAM_CANCEL_RESUME_DRAFT"],
				expectedRequestExcludes: ["E2E_STREAM_CANCELLED_TOOL_MUST_NOT_RENDER"],
			},
		)

		await sendTask(sidebar, "E2E_STREAM_CANCEL_TASK")
		const partial = sidebar.getByText("E2E_STREAM_PARTIAL_BEFORE_CANCEL", { exact: false })
		await expect(partial).toHaveCount(1, { timeout: 60_000 })
		await expect.poll(() => server.getRequestCount("deepseek-chat")).toBe(1)

		const taskFooter = sidebar.getByRole("contentinfo")
		const cancelButton = taskFooter.getByText("Cancel", { exact: true })
		await expect(cancelButton).toBeVisible({ timeout: 30_000 })
		await startFooterActionStabilityObserver(sidebar, ["Cancel"])
		await sidebar.page().waitForTimeout(1_000)
		const footerStabilityEvents = await stopFooterActionStabilityObserver(sidebar)
		expect(footerStabilityEvents).toEqual([])
		await cancelButton.click()

		const resumeButton = taskFooter.getByText("Resume", { exact: true })
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await expect(cancelButton).toHaveCount(0)
		await expect(sidebar.getByText("E2E_STREAM_CANCELLED_TOOL_MUST_NOT_RENDER", { exact: false })).toHaveCount(0)
		await expect(partial).toHaveCount(1)
		expect(server.getRequestCount("deepseek-chat")).toBe(1)

		const input = sidebar.getByTestId("chat-input")
		await expect(input).toBeEnabled()
		await input.fill("E2E_STREAM_CANCEL_RESUME_DRAFT")
		await resumeButton.click()
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_STREAM_CANCEL_RESUME_DRAFT", { exact: true }).last()).toBeVisible()
		await expect(sidebar.getByText("E2E_STREAM_CANCEL_RESUME_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("deepseek-chat")).toBe(2)
		expect(server.getMockConsumptions("deepseek-chat")[1].contractError).toBeUndefined()
		await expect(partial).toHaveCount(1)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Turn-end interactions - consecutive QNA and report feedback submit with Enter",
	async ({ helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{ type: "tool", name: "qna_respond", arguments: { response: "E2E_QNA_FIRST" } },
			{ type: "tool", name: "qna_respond", arguments: { response: "E2E_QNA_SECOND" } },
			{
				type: "tool",
				name: "generate_report",
				arguments: { title: "E2E_REPORT_TITLE", content: "E2E_REPORT_CONTENT" },
			},
			{ type: "tool", name: "attempt_completion", arguments: { result: "E2E_TURN_END_INPUT_OK" } },
			{
				type: "error",
				status: 500,
				code: "unexpected_additional_request",
				message: "Unexpected request after turn-end input test",
			},
		)

		await sendTask(sidebar, "E2E_TURN_END_INPUT_TASK")
		await expect(sidebar.getByText("E2E_QNA_FIRST", { exact: true })).toBeVisible({ timeout: 60_000 })
		await expectNoDecisionButtons(sidebar)
		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, "E2E_TURN_END_INPUT_TASK")
		await expect(sidebar.getByText("E2E_QNA_FIRST", { exact: true })).toBeVisible()
		await expectNoDecisionButtons(sidebar)
		await expect(sidebar.getByTestId("chat-input")).toBeEnabled()
		expect(server.openAiRequestCount).toBe(1)
		await submitWithEnter(sidebar, "E2E_QNA_FIRST_FEEDBACK")
		await expect(sidebar.getByText("E2E_QNA_SECOND", { exact: true })).toBeVisible({ timeout: 60_000 })
		await expectNoDecisionButtons(sidebar)
		await submitWithEnter(sidebar, "E2E_QNA_SECOND_FEEDBACK")
		await expect(sidebar.getByText("E2E_REPORT_TITLE", { exact: true })).toBeVisible({ timeout: 60_000 })
		await expect(sidebar.getByText("E2E_REPORT_CONTENT", { exact: true })).toBeVisible()
		await expectNoDecisionButtons(sidebar)
		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, "E2E_TURN_END_INPUT_TASK")
		await expect(sidebar.getByText("E2E_REPORT_TITLE", { exact: true })).toBeVisible()
		await expect(sidebar.getByText("E2E_REPORT_CONTENT", { exact: true })).toBeVisible()
		await expectNoDecisionButtons(sidebar)
		await expect(sidebar.getByTestId("chat-input")).toBeEnabled()
		expect(server.openAiRequestCount).toBe(3)
		await submitWithEnter(sidebar, "E2E_REPORT_FEEDBACK")
		await expect(sidebar.getByText("E2E_TURN_END_INPUT_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect(sidebar.getByRole("contentinfo").getByText("Start New Task", { exact: true })).toBeVisible()

		await expect.poll(() => server.openAiRequestCount).toBe(4)
		const requestBodies = server.getOpenAiRequestBodies().map((body) => JSON.stringify(body))
		expect(requestBodies[1]).toContain("E2E_QNA_FIRST_FEEDBACK")
		expect(requestBodies[2]).toContain("E2E_QNA_SECOND_FEEDBACK")
		expect(requestBodies[3]).toContain("E2E_REPORT_FEEDBACK")
		await page.waitForTimeout(500)
		expect(server.openAiRequestCount).toBe(4)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Follow-up options - History restore preserves selection and combines the current draft",
	async ({ helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_followup_history",
				name: "ask_followup_question",
				arguments: {
					question: "E2E_FOLLOWUP_HISTORY_QUESTION",
					options: ["E2E_FOLLOWUP_OPTION_A", "E2E_FOLLOWUP_OPTION_B"],
				},
			},
			{
				type: "tool",
				id: "call_followup_qna",
				name: "qna_respond",
				arguments: { response: "E2E_FOLLOWUP_SELECTION_ACCEPTED" },
				expectedToolResults: [
					{
						callId: "call_followup_history",
						contentIncludes: ["E2E_FOLLOWUP_OPTION_B", "E2E_FOLLOWUP_DRAFT_NOTE"],
					},
				],
			},
			{
				type: "tool",
				id: "call_followup_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_FOLLOWUP_HISTORY_OK" },
				expectedRequestIncludes: ["E2E_FOLLOWUP_QNA_FEEDBACK"],
			},
		)

		const taskText = "E2E_FOLLOWUP_HISTORY_TASK"
		await sendTask(sidebar, taskText)
		await expect(sidebar.getByText("E2E_FOLLOWUP_HISTORY_QUESTION", { exact: true })).toBeVisible({ timeout: 60_000 })
		await expect(sidebar.getByText("E2E_FOLLOWUP_OPTION_A", { exact: true })).toBeVisible()
		await expect(sidebar.getByText("E2E_FOLLOWUP_OPTION_B", { exact: true })).toBeVisible()
		await expectNoDecisionButtons(sidebar)

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		await expect(sidebar.getByText("E2E_FOLLOWUP_HISTORY_QUESTION", { exact: true })).toBeVisible()
		await expect(sidebar.getByText("E2E_FOLLOWUP_OPTION_A", { exact: true })).toBeVisible()
		const selectedOption = sidebar.getByRole("button", { name: "E2E_FOLLOWUP_OPTION_B", exact: true })
		await expect(selectedOption).toBeEnabled()
		await expectNoDecisionButtons(sidebar)
		await expect(sidebar.getByTestId("chat-input")).toBeEnabled()
		await page.waitForTimeout(500)
		expect(server.openAiRequestCount).toBe(1)

		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_FOLLOWUP_DRAFT_NOTE")
		await selectedOption.click()
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_FOLLOWUP_SELECTION_ACCEPTED", { exact: true })).toBeVisible({ timeout: 60_000 })
		await expectSingleUserFeedback(sidebar, "E2E_FOLLOWUP_OPTION_B: E2E_FOLLOWUP_DRAFT_NOTE")
		await expect(selectedOption).toHaveAttribute("aria-pressed", "true")
		await expect.poll(() => server.openAiRequestCount).toBe(2)

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		await expectSingleUserFeedback(sidebar, "E2E_FOLLOWUP_OPTION_B: E2E_FOLLOWUP_DRAFT_NOTE")
		await expect(selectedOption).toHaveAttribute("aria-pressed", "true")
		expect(server.openAiRequestCount).toBe(2)

		await submitWithEnter(sidebar, "E2E_FOLLOWUP_QNA_FEEDBACK")
		await expect(sidebar.getByText("E2E_FOLLOWUP_HISTORY_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect.poll(() => server.openAiRequestCount).toBe(3)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Follow-up replies - option and free-text Enter render once and match tool results",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_followup_option_only",
				name: "ask_followup_question",
				arguments: {
					question: "E2E_FOLLOWUP_OPTION_ONLY_QUESTION",
					options: ["E2E_FOLLOWUP_OPTION_ONLY_A", "E2E_FOLLOWUP_OPTION_ONLY_B"],
				},
			},
			{
				type: "tool",
				id: "call_followup_free_text",
				name: "ask_followup_question",
				arguments: {
					question: "E2E_FOLLOWUP_FREE_TEXT_QUESTION",
					options: ["E2E_FOLLOWUP_FREE_TEXT_A", "E2E_FOLLOWUP_FREE_TEXT_B"],
				},
				expectedToolResults: [
					{
						callId: "call_followup_option_only",
						contentIncludes: ["E2E_FOLLOWUP_OPTION_ONLY_B"],
					},
				],
			},
			{
				type: "tool",
				id: "call_followup_visible_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_FOLLOWUP_VISIBLE_FEEDBACK_OK" },
				expectedToolResults: [
					{
						callId: "call_followup_free_text",
						contentIncludes: ["E2E_FOLLOWUP_CUSTOM_FEEDBACK"],
					},
				],
			},
		)

		const taskText = "E2E_FOLLOWUP_VISIBLE_FEEDBACK_TASK"
		await sendTask(sidebar, taskText)
		await expect(sidebar.getByText("E2E_FOLLOWUP_OPTION_ONLY_QUESTION", { exact: true })).toBeVisible({ timeout: 60_000 })

		await sidebar.getByRole("button", { name: "E2E_FOLLOWUP_OPTION_ONLY_B", exact: true }).click()
		await expect(sidebar.getByText("E2E_FOLLOWUP_FREE_TEXT_QUESTION", { exact: true })).toBeVisible({ timeout: 60_000 })
		await expectSingleUserFeedback(sidebar, "E2E_FOLLOWUP_OPTION_ONLY_B")

		await submitWithEnter(sidebar, "E2E_FOLLOWUP_CUSTOM_FEEDBACK")
		await expect(sidebar.getByText("E2E_FOLLOWUP_VISIBLE_FEEDBACK_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expectSingleUserFeedback(sidebar, "E2E_FOLLOWUP_CUSTOM_FEEDBACK")
		await expect.poll(() => server.openAiRequestCount).toBe(3)

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		await expectSingleUserFeedback(sidebar, "E2E_FOLLOWUP_OPTION_ONLY_B")
		await expectSingleUserFeedback(sidebar, "E2E_FOLLOWUP_CUSTOM_FEEDBACK")
		expect(server.getMockConsumptions("openai-compatible-chat").every((entry) => entry.contractError === undefined)).toBe(
			true,
		)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Status acknowledgment - restored Acknowledge, Enter, and Stop carry the current draft",
	async ({ helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_status_acknowledge",
				name: "status_update",
				arguments: { response: "E2E_STATUS_ACKNOWLEDGE", requires_acknowledgment: true },
			},
			{
				type: "tool",
				id: "call_status_read",
				name: "read_file",
				arguments: { path: "README.md" },
				expectedToolResults: [
					{
						callId: "call_status_acknowledge",
						contentIncludes: ["User acknowledged", "E2E_STATUS_ACK_DRAFT"],
					},
				],
			},
			{
				type: "tool",
				id: "call_status_stop",
				name: "status_update",
				arguments: { response: "E2E_STATUS_STOP", requires_acknowledgment: true },
				expectedToolResults: [{ callId: "call_status_read", contentIncludes: "# Test Workspace" }],
			},
			{
				type: "tool",
				id: "call_status_qna",
				name: "qna_respond",
				arguments: { response: "E2E_STATUS_STOP_ACCEPTED" },
				expectedToolResults: [
					{
						callId: "call_status_stop",
						contentIncludes: ["User chose to stop", "E2E_STATUS_STOP_DRAFT"],
					},
				],
			},
			{
				type: "tool",
				id: "call_status_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_STATUS_ACKNOWLEDGMENT_OK" },
				expectedRequestIncludes: ["E2E_STATUS_QNA_FEEDBACK"],
			},
		)

		const taskText = "E2E_STATUS_ACKNOWLEDGMENT_TASK"
		await sendTask(sidebar, taskText)
		await expect(sidebar.getByText("E2E_STATUS_ACKNOWLEDGE", { exact: true })).toBeVisible({ timeout: 60_000 })
		await expect(sidebar.getByRole("contentinfo").getByText("Acknowledge", { exact: true })).toBeVisible()
		await expect(sidebar.getByRole("contentinfo").getByText("Stop", { exact: true })).toBeVisible()

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		const input = sidebar.getByTestId("chat-input")
		await expect(input).toBeEnabled()
		await expect(sidebar.getByRole("contentinfo").getByText("Acknowledge", { exact: true })).toBeVisible()
		await input.fill("E2E_STATUS_ACK_DRAFT")
		await input.press("Enter")
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_STATUS_STOP", { exact: true })).toBeVisible({ timeout: 60_000 })

		await input.fill("E2E_STATUS_STOP_DRAFT")
		await sidebar.getByRole("contentinfo").getByText("Stop", { exact: true }).click()
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_STATUS_STOP_ACCEPTED", { exact: true })).toBeVisible({ timeout: 60_000 })
		await submitWithEnter(sidebar, "E2E_STATUS_QNA_FEEDBACK")
		await expect(sidebar.getByText("E2E_STATUS_ACKNOWLEDGMENT_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect.poll(() => server.openAiRequestCount).toBe(5)
		await page.waitForTimeout(500)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Thinking restore - Close stops the partial stream and History Resume starts only after explicit input",
	async ({ helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await selectProfile(sidebar, E2E_PROFILE_NAMES.mockDeepSeek)
		server.resetOpenAiMock()
		server.enqueueResponses(
			"deepseek-chat",
			{
				type: "tool",
				id: "call_thinking_closed_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_THINKING_CLOSED_RESPONSE_MUST_NOT_RENDER" },
				reasoning: "E2E_THINKING_STREAM_BEFORE_CLOSE",
				afterReasoningDelayMs: 30_000,
			},
			{
				type: "tool",
				id: "call_thinking_restored_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_THINKING_HISTORY_RESUME_OK" },
				expectedRequestIncludes: [
					"The previous task session was closed and has now been restored.",
					"E2E_THINKING_RESUME_DRAFT",
				],
			},
		)

		const taskText = "E2E_THINKING_CLOSE_HISTORY_TASK"
		await sendTask(sidebar, taskText)
		await expect(sidebar.getByText("E2E_THINKING_STREAM_BEFORE_CLOSE", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("deepseek-chat")).toBe(1)

		await closeCurrentTask(sidebar)
		await reopenTask(sidebar, taskText)
		const taskFooter = sidebar.getByRole("contentinfo")
		const resumeButton = taskFooter.getByText("Resume", { exact: true })
		await expect(resumeButton).toBeVisible({ timeout: 30_000 })
		await expect(taskFooter.getByText("Start New Task", { exact: true })).toHaveCount(0)
		await expect(sidebar.getByText("E2E_THINKING_CLOSED_RESPONSE_MUST_NOT_RENDER", { exact: false })).toHaveCount(0)
		await page.waitForTimeout(750)
		expect(server.getRequestCount("deepseek-chat")).toBe(1)

		const input = sidebar.getByTestId("chat-input")
		await expect(input).toBeEnabled()
		await input.fill("E2E_THINKING_RESUME_DRAFT")
		await resumeButton.click()
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_THINKING_HISTORY_RESUME_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("deepseek-chat")).toBe(2)
		expect(server.getMockConsumptions("deepseek-chat")[1].contractError).toBeUndefined()
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)
