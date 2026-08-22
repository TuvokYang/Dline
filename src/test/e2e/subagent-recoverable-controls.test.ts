import { mkdir, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame, type Locator, type TestInfo } from "@playwright/test"
import type { MockApiConsumption } from "./fixtures/server"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled()
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
}

async function writeResponsesSubagent(workspaceDir: string, name: string, description: string): Promise<void> {
	const directory = path.join(workspaceDir, ".agents", "subagents")
	await mkdir(directory, { recursive: true })
	await writeFile(
		path.join(directory, `${name}.yml`),
		`---
name: ${name}
description: ${description}
tools:
  - read_file
  - attempt_completion
profile: ${E2E_PROFILE_NAMES.mockOpenAiResponses}
---

Preserve useful findings and finish only through attempt_completion.`,
		"utf8",
	)
}

async function attachLocatorScreenshot(locator: Locator, testInfo: TestInfo, name: string): Promise<void> {
	const screenshotPath = testInfo.outputPath(`${name}.png`)
	await locator.screenshot({ path: screenshotPath })
	await testInfo.attach(name, { path: screenshotPath, contentType: "image/png" })
}

function requestToolNames(consumption: MockApiConsumption): string[] {
	const body = consumption.requestBody as {
		tools?: Array<{ name?: string; function?: { name?: string } }>
	}
	return (body.tools ?? [])
		.map((tool) => tool.name ?? tool.function?.name)
		.filter((name): name is string => typeof name === "string")
}

function countOccurrences(text: string, marker: string): number {
	return text.split(marker).length - 1
}

e2e(
	"Subagent recovery controls - Finish renders in Work and Activities and enforces completion-only recovery",
	async ({ helper, server, sidebar, userDataDir, workspaceDir }, testInfo) => {
		e2e.setTimeout(240_000)
		const agentName = "e2e-recoverable-finish"
		const childTask = "E2E_SUBAGENT_FINISH_TASK"
		const childResult = "E2E_SUBAGENT_FINISH_CHILD_DONE"
		const evidenceFileName = "e2e-subagent-finish-evidence.txt"
		const evidenceMarker = "E2E_SUBAGENT_FINISH_TOOL_RESULT"
		const readToolCount = 12
		await writeResponsesSubagent(workspaceDir, agentName, "E2E soft Finish lifecycle agent")
		await writeFile(path.join(workspaceDir, evidenceFileName), evidenceMarker, "utf8")

		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_recoverable_finish_subagent",
				name: "use_subagent",
				arguments: {
					agent_name: agentName,
					task: childTask,
					context: "Keep the current findings and wait for the user to request Finish.",
					timeout: 120,
				},
			},
			{
				type: "tool",
				id: "call_recoverable_finish_parent_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_SUBAGENT_FINISH_PARENT_DONE" },
				expectedToolResults: [{ callId: "call_recoverable_finish_subagent", contentIncludes: childResult }],
			},
		)
		server.enqueueResponses(
			"openai-compatible-responses",
			...Array.from({ length: readToolCount }, (_, index) => ({
				type: "tool" as const,
				id: `call_recoverable_finish_read_${index + 1}`,
				name: "read_file",
				arguments: { path: evidenceFileName },
			})),
			{
				type: "tool",
				id: "call_recoverable_finish_interrupted_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_SUBAGENT_FINISH_INTERRUPTED_MUST_NOT_RENDER" },
				expectedToolResults: [
					{ callId: `call_recoverable_finish_read_${readToolCount}`, contentIncludes: evidenceMarker },
				],
				delayMs: 30_000,
			},
			{
				type: "tool",
				id: "call_recoverable_finish_child_complete",
				name: "attempt_completion",
				arguments: { result: childResult },
				expectedRequestIncludes: [
					"The user requested that the subagent finish now.",
					"Stop all further exploration.",
					"call attempt_completion with a non-empty result",
				],
			},
		)

		await sendTask(sidebar, "Start a subagent, then preserve its findings when Finish is requested.")

		const taskHeading = sidebar.getByRole("heading", { name: childTask, exact: true }).last()
		await expect(taskHeading).toBeVisible({ timeout: 60_000 })
		await expect
			.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 })
			.toBe(readToolCount + 1)
		const subagentCard = sidebar.getByTestId("subagent-item").filter({ hasText: agentName })
		await expect(subagentCard).toHaveCount(1)
		const workFinish = subagentCard.getByRole("button", { name: "Finish", exact: true })
		const workCancel = subagentCard.getByRole("button", { name: "Cancel", exact: true })
		const workMetrics = subagentCard.getByTestId("subagent-metrics")
		const workBody = subagentCard.getByTestId("subagent-item-body")
		const workTaskScroll = subagentCard.getByTestId("subagent-task-scroll")
		const workToolsScroll = subagentCard.getByTestId("subagent-tools-scroll")
		await expect(workFinish).toBeVisible()
		await expect(workCancel).toBeVisible()
		await expect(subagentCard.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0)
		await expect(workMetrics).toContainText(`${readToolCount} tools`)
		await expect(workMetrics).toContainText(/In:\S+/)
		await expect(workMetrics).toContainText(/Out:\S+/)
		await expect(workMetrics).toContainText(/\$/)
		await expect(subagentCard.getByTestId("subagent-tool-step")).toHaveCount(readToolCount)
		const workToolButton = subagentCard.getByTestId("subagent-tool-step").first().getByRole("button")
		await expect(workToolButton).toBeDisabled()
		await expect(workToolButton).not.toHaveAttribute("aria-expanded")
		await expect(subagentCard.getByText(evidenceMarker, { exact: false })).toHaveCount(0)
		const workLayout = await subagentCard.evaluate((element) => {
			const style = getComputedStyle(element)
			const body = element.querySelector<HTMLElement>('[data-testid="subagent-item-body"]')
			if (!body) throw new Error("Subagent Work body is missing")
			const taskScroll = element.querySelector<HTMLElement>('[data-testid="subagent-task-scroll"]')
			const toolsScroll = element.querySelector<HTMLElement>('[data-testid="subagent-tools-scroll"]')
			if (!taskScroll || !toolsScroll) throw new Error("Subagent Work sections are missing")
			return {
				maxHeight: Number.parseFloat(style.maxHeight),
				overflow: style.overflow,
				viewportHeight: window.innerHeight,
				bodyOverflowY: getComputedStyle(body).overflowY,
				taskOverflowY: getComputedStyle(taskScroll).overflowY,
				toolsOverflowY: getComputedStyle(toolsScroll).overflowY,
				toolsClientHeight: toolsScroll.clientHeight,
				toolsScrollHeight: toolsScroll.scrollHeight,
			}
		})
		expect(Math.abs(workLayout.maxHeight - workLayout.viewportHeight * 0.3)).toBeLessThanOrEqual(2)
		expect(workLayout.overflow).toBe("hidden")
		expect(workLayout.bodyOverflowY).toBe("hidden")
		expect(workLayout.taskOverflowY).toBe("auto")
		expect(workLayout.toolsOverflowY).toBe("auto")
		expect(workLayout.toolsScrollHeight).toBeGreaterThan(workLayout.toolsClientHeight)
		await attachLocatorScreenshot(subagentCard, testInfo, "subagent-finish-work-card")

		await subagentCard.getByRole("button", { name: "Collapse subagent task" }).click()
		await expect(workTaskScroll).toHaveCount(0)
		await expect(workToolsScroll).toBeVisible()
		await subagentCard.getByRole("button", { name: "Expand subagent task" }).click()
		await expect(workTaskScroll).toBeVisible()
		await subagentCard.getByRole("button", { name: "Collapse subagent tools" }).click()
		await expect(workToolsScroll).toHaveCount(0)
		await expect(workTaskScroll).toBeVisible()
		await attachLocatorScreenshot(subagentCard, testInfo, "subagent-finish-work-sections-collapsed")
		await subagentCard.getByRole("button", { name: "Expand subagent tools" }).click()
		await expect(workToolsScroll).toBeVisible()

		await subagentCard.getByRole("button", { name: `Collapse subagent ${agentName}` }).click()
		await expect(workBody).toHaveCount(0)
		await expect(workMetrics).toBeVisible()
		await expect(workFinish).toBeVisible()
		await expect(workCancel).toBeVisible()
		await attachLocatorScreenshot(subagentCard, testInfo, "subagent-finish-work-card-collapsed")
		await subagentCard.getByRole("button", { name: `Expand subagent ${agentName}` }).click()
		await expect(workBody).toBeVisible()

		await sidebar.getByRole("tab", { name: /^Activities(?: \d+)?$/ }).click()
		await sidebar.getByRole("button", { name: "All", exact: true }).first().click()
		const activity = sidebar.getByTestId("activity-item").filter({ hasText: agentName })
		await expect(activity).toHaveCount(1)
		await expect(activity).toHaveAttribute("data-activity-status", "running")
		const activityFinish = activity.getByRole("button", { name: "Finish", exact: true })
		const activityCancel = activity.getByRole("button", { name: "Cancel", exact: true })
		const activityMetrics = activity.getByTestId("subagent-metrics")
		await expect(activityFinish).toBeVisible()
		await expect(activityCancel).toBeVisible()
		await expect(activity.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0)
		await expect(activityMetrics).toContainText(`${readToolCount} tools`)
		await expect(activityMetrics).toContainText(/In:\S+/)
		await expect(activityMetrics).toContainText(/Out:\S+/)
		await expect(activityMetrics).toContainText(/\$/)
		expect(await activityCancel.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(196, 43, 43)")
		await activity.getByTestId("activity-toggle").click()
		const activityToolSteps = activity.getByTestId("subagent-tool-step")
		await expect(activityToolSteps).toHaveCount(readToolCount)
		const activityToolButton = activityToolSteps.first().getByRole("button")
		await expect(activityToolButton).toBeEnabled()
		await expect(activityToolButton).toHaveAttribute("aria-expanded", "false")
		await activityToolButton.click()
		await expect(activity.getByTestId("subagent-tool-step-details").first()).toContainText(evidenceMarker)
		await attachLocatorScreenshot(activity, testInfo, "subagent-finish-activity-card")

		await activityFinish.click()
		await expect(sidebar.getByText("E2E_SUBAGENT_FINISH_INTERRUPTED_MUST_NOT_RENDER", { exact: false })).toHaveCount(0)
		await expect
			.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 })
			.toBe(readToolCount + 2)
		await expect(activity).toHaveAttribute("data-activity-status", "completed", { timeout: 60_000 })
		await expect(activity.getByRole("button", { name: "Finish", exact: true })).toHaveCount(0)
		await expect(activity.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0)

		await sidebar.getByRole("tab", { name: "Work", exact: true }).click()
		await expect(sidebar.getByText("E2E_SUBAGENT_FINISH_PARENT_DONE", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await subagentCard.getByRole("button", { name: "Show subagent output" }).click()
		const workOutputScroll = subagentCard.getByTestId("subagent-output-scroll")
		await expect(workOutputScroll).toBeVisible()
		await expect(subagentCard.getByTestId("subagent-output")).toContainText(childResult)
		const outputLayout = await subagentCard.evaluate((element) => {
			const body = element.querySelector<HTMLElement>('[data-testid="subagent-item-body"]')
			const tools = element.querySelector<HTMLElement>('[data-testid="subagent-tools-scroll"]')
			const output = element.querySelector<HTMLElement>('[data-testid="subagent-output-scroll"]')
			if (!body || !tools || !output) throw new Error("Expected independent Work sections after completion")
			const task = element.querySelector<HTMLElement>('[data-testid="subagent-task-scroll"]')
			if (!task) throw new Error("Expected Task section after completion")
			return {
				bodyOverflowY: getComputedStyle(body).overflowY,
				cardHeight: element.getBoundingClientRect().height,
				viewportHeight: window.innerHeight,
				taskClientHeight: task.clientHeight,
				toolsClientHeight: tools.clientHeight,
				outputClientHeight: output.clientHeight,
				outputOverflowY: getComputedStyle(output).overflowY,
				toolsContainsOutput: tools.contains(output),
				outputContainsTools: output.contains(tools),
			}
		})
		expect(outputLayout.bodyOverflowY).toBe("hidden")
		expect(Math.abs(outputLayout.cardHeight - outputLayout.viewportHeight * 0.3)).toBeLessThanOrEqual(2)
		expect(outputLayout.taskClientHeight).toBeGreaterThan(0)
		expect(outputLayout.toolsClientHeight).toBeGreaterThan(0)
		expect(outputLayout.outputClientHeight).toBeGreaterThan(0)
		expect(outputLayout.outputOverflowY).toBe("auto")
		expect(outputLayout.toolsContainsOutput).toBe(false)
		expect(outputLayout.outputContainsTools).toBe(false)
		await attachLocatorScreenshot(subagentCard, testInfo, "subagent-finish-work-output")
		const childConsumptions = server.getMockConsumptions("openai-compatible-responses")
		expect(childConsumptions).toHaveLength(readToolCount + 2)
		expect(childConsumptions[readToolCount].abortedAtMs).toBeDefined()
		expect(childConsumptions.every((consumption) => consumption.contractError === undefined)).toBe(true)
		expect(requestToolNames(childConsumptions[readToolCount + 1])).toEqual(["attempt_completion"])
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Subagent recovery controls - retryable exhaustion renders Retry and injects the recovered result once",
	async ({ helper, server, sidebar, userDataDir, workspaceDir }, testInfo) => {
		e2e.setTimeout(360_000)
		const agentName = "e2e-recoverable-retry"
		const childTask = "E2E_SUBAGENT_RETRY_TASK"
		const recoveredResult = "E2E_SUBAGENT_RETRY_CHILD_RECOVERED"
		const sensitiveDiagnostic = "E2E_SENSITIVE_PROVIDER_DIAGNOSTIC_MUST_NOT_REACH_PARENT"
		await writeResponsesSubagent(workspaceDir, agentName, "E2E retryable failure recovery agent")

		await helper.signin(sidebar)
		server.resetOpenAiMock()
		server.enqueueOpenAiResponses(
			{
				type: "tool",
				id: "call_recoverable_retry_subagent",
				name: "use_subagent",
				arguments: {
					agent_name: agentName,
					task: childTask,
					context: "Retry after bounded provider failures and return the recovered finding.",
					timeout: 180,
				},
			},
			{
				type: "tool",
				id: "call_recoverable_retry_ready",
				name: "qna_respond",
				arguments: { response: "E2E_SUBAGENT_RETRY_READY" },
				expectedToolResults: [
					{
						callId: "call_recoverable_retry_subagent",
						contentIncludes: "Subagent paused after a retryable API failure",
					},
				],
				expectedRequestIncludes: [
					"The user can restart it with the Retry control",
					"do not treat this failure as a completed result",
				],
				expectedRequestExcludes: [sensitiveDiagnostic],
			},
			{
				type: "tool",
				id: "call_recoverable_retry_parent_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_SUBAGENT_RETRY_PARENT_DONE" },
				expectedRequestIncludes: [
					"E2E_SUBAGENT_RETRY_FEEDBACK",
					"# Background Results",
					"## Background Subagent Results",
					recoveredResult,
				],
				expectedRequestExcludes: [sensitiveDiagnostic],
			},
			{
				type: "tool",
				id: "call_recoverable_retry_second_parent_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_SUBAGENT_RETRY_SECOND_PARENT_DONE" },
				expectedRequestIncludes: ["E2E_SUBAGENT_RETRY_SECOND_FEEDBACK"],
				expectedRequestExcludes: [sensitiveDiagnostic],
			},
		)
		server.enqueueResponses(
			"openai-compatible-responses",
			...Array.from({ length: 6 }, (_, index) => ({
				type: "error" as const,
				status: 408,
				code: "e2e_subagent_retryable_failure",
				message: sensitiveDiagnostic,
				requestId: `req_subagent_retry_${index + 1}`,
			})),
			{
				type: "tool",
				id: "call_recoverable_retry_child_complete",
				name: "attempt_completion",
				arguments: { result: recoveredResult },
				delayMs: 2_000,
			},
		)

		await sendTask(sidebar, "Start a subagent that must expose Retry after bounded provider failures.")

		await expect(sidebar.getByText("E2E_SUBAGENT_RETRY_READY", { exact: true })).toBeVisible({ timeout: 180_000 })
		await expect.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 180_000 }).toBe(6)
		const taskHeading = sidebar.getByRole("heading", { name: childTask, exact: true }).last()
		const subagentCard = taskHeading.locator("xpath=ancestor::*[@data-testid='subagent-item'][1]")
		await expect(taskHeading).toBeVisible()
		const workRetry = subagentCard.getByRole("button", { name: "Retry", exact: true })
		await expect(workRetry).toBeVisible()
		await expect(subagentCard.getByRole("button", { name: "Finish", exact: true })).toHaveCount(0)
		await subagentCard.getByRole("button", { name: "Show subagent output" }).click()
		const workRetryOutput = subagentCard.getByTestId("subagent-output-scroll")
		await expect(workRetryOutput.getByTestId("subagent-retry-attempt")).toHaveCount(5)
		await expect(workRetryOutput).toContainText("Retry 1/5")
		await expect(workRetryOutput).toContainText("wait 5s")
		await expect(workRetryOutput).toContainText("Retry 5/5")
		await expect(workRetryOutput).toContainText("wait 17s")
		await expect(workRetryOutput).toContainText("total 55s")
		await attachLocatorScreenshot(subagentCard, testInfo, "subagent-retry-work-card")

		await sidebar.getByRole("tab", { name: /^Activities(?: \d+)?$/ }).click()
		await sidebar.getByRole("button", { name: "All", exact: true }).first().click()
		const activity = sidebar.getByTestId("activity-item").filter({ hasText: agentName })
		await expect(activity).toHaveCount(1)
		await expect(activity).toHaveAttribute("data-activity-status", "failed")
		const activityRetry = activity.getByRole("button", { name: "Retry", exact: true })
		await expect(activityRetry).toBeVisible()
		await expect(activity.getByRole("button", { name: "Finish", exact: true })).toHaveCount(0)
		await activity.getByTestId("activity-toggle").click()
		const activityRetryTimeline = activity.getByTestId("subagent-retry-timeline")
		await expect(activityRetryTimeline.getByTestId("subagent-retry-attempt")).toHaveCount(5)
		await expect(activityRetryTimeline).toContainText("Retry 5/5")
		await expect(activityRetryTimeline).toContainText("total 55s")
		await attachLocatorScreenshot(activity, testInfo, "subagent-retry-activity-card")

		await activityRetry.click()
		await expect(activity).toHaveAttribute("data-activity-status", "running", { timeout: 30_000 })
		await expect(activity.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0)
		await expect(activity.getByRole("button", { name: "Finish", exact: true })).toBeVisible()
		await attachLocatorScreenshot(activity, testInfo, "subagent-retry-running-activity-card")
		await expect.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 }).toBe(7)
		await expect(activity).toHaveAttribute("data-activity-status", "completed", { timeout: 60_000 })
		await expect(activity.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0)
		await expect(activity.getByRole("button", { name: "Finish", exact: true })).toHaveCount(0)

		await sidebar.getByRole("tab", { name: "Work", exact: true }).click()
		const input = sidebar.getByTestId("chat-input")
		await input.fill("E2E_SUBAGENT_RETRY_FEEDBACK")
		await input.press("Enter")
		await expect(sidebar.getByText("E2E_SUBAGENT_RETRY_PARENT_DONE", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await input.fill("E2E_SUBAGENT_RETRY_SECOND_FEEDBACK")
		await input.press("Enter")
		await expect(sidebar.getByText("E2E_SUBAGENT_RETRY_SECOND_PARENT_DONE", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})

		const parentConsumptions = server.getMockConsumptions("openai-compatible-chat")
		expect(parentConsumptions).toHaveLength(4)
		const firstInjectionRequest = JSON.stringify(parentConsumptions[2].requestBody)
		const secondInjectionRequest = JSON.stringify(parentConsumptions[3].requestBody)
		expect(countOccurrences(firstInjectionRequest, "# Background Results")).toBe(1)
		expect(countOccurrences(secondInjectionRequest, "# Background Results")).toBe(1)
		expect(countOccurrences(secondInjectionRequest, recoveredResult)).toBe(1)
		expect(firstInjectionRequest).not.toContain(sensitiveDiagnostic)
		expect(secondInjectionRequest).not.toContain(sensitiveDiagnostic)
		const childConsumptions = server.getMockConsumptions("openai-compatible-responses")
		expect(childConsumptions).toHaveLength(7)
		expect(childConsumptions.slice(0, 6).every((entry) => entry.responseType === "error" && entry.status === 408)).toBe(true)
		expect(childConsumptions[6]).toMatchObject({ responseType: "tool", toolName: "attempt_completion" })
		expect(childConsumptions.every((entry) => entry.contractError === undefined)).toBe(true)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [
			/E2E_SENSITIVE_PROVIDER_DIAGNOSTIC_MUST_NOT_REACH_PARENT/,
		])
	},
)
