import { expect, type Frame, type Page } from "@playwright/test"
import type { MockApiConsumption, MockTokenUsage } from "./fixtures/server"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { addSelectedCodeToDline, openTab, toggleNotifications } from "./utils/common"
import { E2ETestHelper, e2e } from "./utils/helpers"
import { startFooterActionStabilityObserver, stopFooterActionStabilityObserver } from "./utils/ui-stability"

const CHECKLIST_ITEMS = [
	"Read the workspace README",
	"List workspace files",
	"Review the generated report",
	"Complete Q&A",
	"Verify incomplete completion is blocked",
	"Search final workspace evidence",
] as const

const INITIAL_TASK_PROGRESS = `# E2E multi-turn thinking
## Inspect
- [ ] ${CHECKLIST_ITEMS[0]}
- [ ] ${CHECKLIST_ITEMS[1]}
## Interact
- [ ] ${CHECKLIST_ITEMS[2]}
- [ ] ${CHECKLIST_ITEMS[3]}
## Finish
- [ ] ${CHECKLIST_ITEMS[4]}
- [ ] ${CHECKLIST_ITEMS[5]}`

const completedProgress = (...indexes: number[]): string => indexes.map((index) => `- [x] ${CHECKLIST_ITEMS[index]}`).join("\n")

const REPORT_TITLE = "E2E workspace inspection report"
const REPORT_CONTENT = "E2E_REPORT_REVIEW_REQUIRED: README and workspace listing were inspected."
const REPORT_FEEDBACK = "E2E_REPORT_FEEDBACK_ACCEPTED"
const QNA_RESPONSE = "E2E_QNA_REVIEW_REQUIRED: confirm the guarded completion path."
const QNA_FEEDBACK = "E2E_QNA_FEEDBACK_ACCEPTED"

async function selectProfile(sidebar: Frame, profileName: string): Promise<void> {
	const modelSwitcher = sidebar.getByRole("button", { name: "Select model" })
	const profileListTitle = sidebar.getByText("Available Models", { exact: true })
	const profileOverlay = sidebar.locator(".fixed.inset-0.z-40")
	if ((await modelSwitcher.innerText()).trim() === profileName) {
		await expect(profileListTitle).not.toBeVisible()
		await expect(profileOverlay).not.toBeVisible()
		return
	}

	await modelSwitcher.click()
	await expect(profileListTitle).toBeVisible()
	const profileOption = sidebar.getByRole("option").filter({ has: sidebar.getByText(profileName, { exact: true }) })
	await expect(profileOption).toHaveCount(1)
	await profileOption.click()
	await expect(modelSwitcher).toHaveText(profileName)
	await expect(profileListTitle).not.toBeVisible()
	await expect(profileOverlay).not.toBeVisible()
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text).first()).toBeVisible()
}

interface StructuredApiErrorExpectation {
	message: string
	provider: string
	model: string
	status?: number
	code?: string
	requestId?: string
	details?: Readonly<Record<string, string>>
}

async function expectSingleStructuredApiError(
	sidebar: Frame,
	{ message, provider, model, status, code, requestId, details = {} }: StructuredApiErrorExpectation,
): Promise<void> {
	const cards = sidebar.locator(
		'[data-testid="api-error-box"], [data-testid="error-message-box"], [data-testid="error-presentation-box"], [data-testid="error-retry-box"]',
	)
	await expect(cards).toHaveCount(1)
	const card = cards.first()
	await expect(card).toBeVisible()
	await expect(card.locator('[data-testid$="-message"]')).toHaveText(message)
	await expect(card.locator('[data-testid$="-provider"]')).toHaveText(provider)
	await expect(card.locator('[data-testid$="-model"]')).toHaveText(model)
	if (status !== undefined) await expect(card.locator('[data-testid$="-status"]')).toHaveText(String(status))
	if (code !== undefined) await expect(card.locator('[data-testid$="-code"]')).toHaveText(code)
	if (requestId !== undefined) await expect(card.locator('[data-testid$="-request-id"]')).toHaveText(requestId)
	for (const [key, value] of Object.entries(details)) {
		await expect(card.locator(`[data-testid$="-detail-${key}"]`)).toHaveText(value)
	}

	await expect(sidebar.getByText(message, { exact: true })).toHaveCount(1)
	await expect(sidebar.getByText(/^\s*\{"message":.*"providerId":.*\}\s*$/)).toHaveCount(0)
	await expect(sidebar.getByText(/^\s*\[[A-Z0-9_-]+\]/)).toHaveCount(0)
	await expect(sidebar.getByText('(Click "Retry" below)', { exact: true })).toHaveCount(0)
}

async function submitInteractionFeedback(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled()
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(input).toHaveValue("")
	await expect(sidebar.getByText(text, { exact: true }).last()).toBeVisible()
}

async function exerciseChatAndEditorSurface(page: Page, sidebar: Frame): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeVisible()
	await expect(input).toHaveValue("")

	const actButton = sidebar.getByRole("switch", { name: "Act" })
	const planButton = sidebar.getByRole("switch", { name: "Plan" })
	await expect(actButton).toHaveAttribute("aria-checked", "true")
	await planButton.click()
	await expect(planButton).toHaveAttribute("aria-checked", "true")
	await expect(actButton).not.toHaveAttribute("aria-checked", "true")
	await actButton.click()
	await expect(actButton).toHaveAttribute("aria-checked", "true")

	await input.fill("/newt")
	await sidebar.getByText("newtask", { exact: false }).first().click()
	await expect(input).toHaveValue("/cmd:newtask ")
	await input.press("End")
	await input.pressSequentially("following text should be preserved", { delay: 10 })
	await expect(input).toHaveValue("/cmd:newtask following text should be preserved")

	await input.fill("@prob")
	await sidebar.getByText("Problems", { exact: false }).first().click()
	await expect(input).toHaveValue("@problems ")
	await input.press("End")
	await input.pressSequentially("following text should be preserved", { delay: 10 })
	await expect(input).toHaveValue("@problems following text should be preserved")
	await input.fill("")

	await input.click()
	await toggleNotifications(page)
	await expect(input).toHaveValue("")
	await openTab(page, "Explorer ")
	await page.getByRole("treeitem", { name: "index.html" }).locator("a").click()
	await expect(input).not.toBeFocused()
	await addSelectedCodeToDline(page)
	await expect(input).not.toHaveValue("")
	await expect(input).toBeFocused()
	await input.fill("")
}

function usageOf(consumption: MockApiConsumption): MockTokenUsage {
	if (!consumption.usage) throw new Error(`Missing usage for ${consumption.toolName}`)
	return consumption.usage
}

function totalInputTokens(usage: MockTokenUsage): number {
	return usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

function advertisedToolNames(consumption: MockApiConsumption): string[] {
	const body = consumption.requestBody as { tools?: Array<{ name?: string; function?: { name?: string } }> }
	return (body.tools ?? []).flatMap((tool) => {
		const name = tool.function?.name ?? tool.name
		return name ? [name] : []
	})
}

function expectInRange(actual: number, expected: number, tolerance = 0.02, minimumMargin = 2): void {
	const margin = Math.max(minimumMargin, Math.ceil(expected * tolerance))
	expect(actual).toBeGreaterThanOrEqual(Math.max(0, expected - margin))
	expect(actual).toBeLessThanOrEqual(expected + margin)
}

function parseUsageTitle(title: string): { input: number; output: number; cacheRead: number; cacheWrite: number } {
	const match = title.match(/^In: (\d+) \/ Out: (\d+) \/ Cache read: (\d+) \/ Cache write: (\d+)$/)
	if (!match) throw new Error(`Unexpected usage title: ${title}`)
	return {
		input: Number(match[1]),
		output: Number(match[2]),
		cacheRead: Number(match[3]),
		cacheWrite: Number(match[4]),
	}
}

function parseCompactTokens(text: string): number {
	const match = text.trim().match(/^(\d+(?:\.\d+)?)([kKmM])?$/)
	if (!match) throw new Error(`Unexpected compact token value: ${text}`)
	const multiplier = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1
	return Number(match[1]) * multiplier
}

function formatCompactTokens(value: number): string {
	if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}b`
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
	return String(value)
}

function expectMeasuredUsage(consumptions: readonly MockApiConsumption[]): void {
	for (const consumption of consumptions) {
		const usage = usageOf(consumption)
		const requestBytes = Buffer.byteLength(JSON.stringify(consumption.requestBody), "utf8")
		const measuredInput = totalInputTokens(usage)
		expect(measuredInput).toBeGreaterThanOrEqual(Math.ceil(requestBytes / 5))
		expect(measuredInput).toBeLessThanOrEqual(Math.ceil(requestBytes / 3))
		expect(usage.inputTokens).toBeGreaterThan(0)
		expect(usage.outputTokens).toBeGreaterThan(0)
		expect(usage.outputTokens).toBeLessThan(2_000)
		expect(usage.cacheWriteTokens ?? 0).toBeGreaterThan(0)
		expect(usage.cacheReadTokens ?? 0).toBeGreaterThanOrEqual(0)
		expect((usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)).toBeLessThan(measuredInput)
	}
	expect(usageOf(consumptions[0]).cacheReadTokens).toBe(0)
	for (const consumption of consumptions.slice(1)) {
		expect(usageOf(consumption).cacheReadTokens ?? 0).toBeGreaterThan(0)
	}
}

async function expectContextUsage(
	sidebar: Frame,
	contextWindow: number,
	consumptions: readonly MockApiConsumption[],
): Promise<void> {
	const expandTaskHeader = sidebar.getByLabel("Expand task header")
	if (await expandTaskHeader.isVisible()) await expandTaskHeader.click()

	const usages = consumptions.map(usageOf)
	const latestUsage = usages.at(-1)
	if (!latestUsage) throw new Error("No successful API usage was recorded")
	const latestTokens = totalInputTokens(latestUsage) + latestUsage.outputTokens
	const currentTokens = sidebar.locator('[title="Current tokens used in this request"]')
	await expect(currentTokens).toBeVisible()
	expectInRange(parseCompactTokens(await currentTokens.innerText()), latestTokens, 0.02, 100)

	const contextMaximum = sidebar.locator('[title="Maximum context window size for this model"]')
	await expect(contextMaximum).toHaveText(formatCompactTokens(contextWindow))

	const progress = sidebar.getByRole("progressbar", { name: "Context window usage progress" })
	await expect(progress).toBeVisible()
	const percentage = Number(await progress.getAttribute("aria-valuenow"))
	expectInRange(percentage, (latestTokens / contextWindow) * 100, 0.02, 0.05)

	const priceTag = sidebar.locator("#price-tag")
	await expect(priceTag).toBeVisible()
	const displayed = parseUsageTitle((await priceTag.getAttribute("title")) ?? "")
	const expected = usages.reduce(
		(total, usage) => ({
			input: total.input + totalInputTokens(usage),
			output: total.output + usage.outputTokens,
			cacheRead: total.cacheRead + (usage.cacheReadTokens ?? 0),
			cacheWrite: total.cacheWrite + (usage.cacheWriteTokens ?? 0),
		}),
		{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	)
	expectInRange(displayed.input, expected.input)
	expectInRange(displayed.output, expected.output)
	expectInRange(displayed.cacheRead, expected.cacheRead)
	expectInRange(displayed.cacheWrite, expected.cacheWrite)

	const hitRate = Number((await priceTag.innerText()).match(/Hit:\s*([\d.]+)%/)?.[1])
	expectInRange(hitRate, (expected.cacheRead / expected.input) * 100, 0.01, 0.2)
}

const protocolCases = [
	{
		target: "openai-compatible-chat" as const,
		profileName: E2E_PROFILE_NAMES.mockOpenAi,
		contextWindow: 131_072,
		responseText: "E2E_CHAT_USAGE_OK",
		thinking: { mode: "effort" as const, effort: "high" },
		exposesReasoningSummary: false,
		replaysReasoningInRequestBody: false,
	},
	{
		target: "openai-compatible-responses" as const,
		profileName: E2E_PROFILE_NAMES.mockOpenAiResponses,
		contextWindow: 131_072,
		responseText: "E2E_COMPATIBLE_RESPONSES_USAGE_OK",
		thinking: { mode: "effort" as const, effort: "high" },
		exposesReasoningSummary: true,
		replaysReasoningInRequestBody: true,
	},
	{
		target: "openai-official-responses" as const,
		profileName: E2E_PROFILE_NAMES.mockOpenAiOfficialResponses,
		contextWindow: 272_000,
		responseText: "E2E_NATIVE_RESPONSES_USAGE_OK",
		thinking: { mode: "effort" as const, effort: "high" },
		exposesReasoningSummary: true,
		replaysReasoningInRequestBody: true,
	},
	{
		target: "deepseek-chat" as const,
		profileName: E2E_PROFILE_NAMES.mockDeepSeek,
		contextWindow: 1_000_000,
		responseText: "E2E_DEEPSEEK_USAGE_OK",
		thinking: { mode: "effort" as const, effort: "high" },
		exposesReasoningSummary: true,
		replaysReasoningInRequestBody: true,
	},
	{
		target: "anthropic-messages" as const,
		profileName: E2E_PROFILE_NAMES.mockAnthropic,
		contextWindow: 200_000,
		responseText: "E2E_ANTHROPIC_USAGE_OK",
		thinking: { mode: "budget" as const, budget: 2_048 },
		exposesReasoningSummary: true,
		replaysReasoningInRequestBody: true,
	},
]

for (const testCase of protocolCases) {
	e2e(
		`API runtime - ${testCase.target} runs multi-turn thinking and native tools with usage`,
		async ({ helper, page, server, sidebar, userDataDir }) => {
			e2e.setTimeout(210_000)
			const toolCallIds = {
				read: `call_${testCase.target}_read`,
				list: `call_${testCase.target}_list`,
				report: `call_${testCase.target}_report`,
				qna: `call_${testCase.target}_qna`,
				blockedCompletion: `call_${testCase.target}_blocked_completion`,
				search: `call_${testCase.target}_search`,
				finalCompletion: `call_${testCase.target}_final_completion`,
			} as const
			const thinkingPrefix = `E2E_${testCase.target.toUpperCase().replaceAll("-", "_")}_THINKING`
			const thinkingTexts = [
				`${thinkingPrefix}_READ`,
				`${thinkingPrefix}_LIST`,
				`${thinkingPrefix}_REPORT`,
				`${thinkingPrefix}_QNA`,
				`${thinkingPrefix}_BLOCKED_COMPLETION`,
				`${thinkingPrefix}_FINISH_PROGRESS`,
				`${thinkingPrefix}_COMPLETE`,
			]
			const reasoningResponse = (index: number) =>
				testCase.exposesReasoningSummary ? { reasoning: thinkingTexts[index] } : { hiddenReasoning: thinkingTexts[index] }

			await helper.signin(sidebar)
			await exerciseChatAndEditorSurface(page, sidebar)
			await selectProfile(sidebar, testCase.profileName)
			server.resetOpenAiMock()
			server.enqueueResponses(
				testCase.target,
				{
					type: "tool",
					id: toolCallIds.read,
					name: "read_file",
					arguments: { path: "README.md", task_progress: INITIAL_TASK_PROGRESS },
					...reasoningResponse(0),
				},
				{
					type: "tool",
					id: toolCallIds.list,
					name: "list_files",
					arguments: { path: ".", recursive: false, task_progress: completedProgress(0) },
					expectedToolResults: [{ callId: toolCallIds.read, contentIncludes: "# Test Workspace" }],
					...reasoningResponse(1),
				},
				{
					type: "tool",
					id: toolCallIds.report,
					name: "generate_report",
					arguments: {
						title: REPORT_TITLE,
						content: REPORT_CONTENT,
						task_progress: completedProgress(1),
					},
					expectedToolResults: [{ callId: toolCallIds.list, contentIncludes: "index.html" }],
					...reasoningResponse(2),
				},
				{
					type: "tool",
					id: toolCallIds.qna,
					name: "qna_respond",
					arguments: { response: QNA_RESPONSE },
					expectedToolResults: [{ callId: toolCallIds.report, contentIncludes: REPORT_FEEDBACK }],
					...reasoningResponse(3),
				},
				{
					type: "tool",
					id: toolCallIds.blockedCompletion,
					name: "attempt_completion",
					arguments: { result: "E2E_INCOMPLETE_COMPLETION_MUST_NOT_FINISH" },
					expectedToolResults: [{ callId: toolCallIds.qna, contentIncludes: QNA_FEEDBACK }],
					...reasoningResponse(4),
				},
				{
					type: "tool",
					id: toolCallIds.search,
					name: "search_files",
					arguments: {
						path: ".",
						regex: 'name\\s*=\\s*"cline"',
						file_pattern: "test.ts",
						task_progress: completedProgress(2, 3, 4, 5),
					},
					expectedToolResults: [
						{
							callId: toolCallIds.blockedCompletion,
							contentIncludes: ["ATTEMPT_COMPLETION BLOCKED", "Current checklist"],
						},
					],
					...reasoningResponse(5),
				},
				{
					type: "tool",
					id: toolCallIds.finalCompletion,
					name: "attempt_completion",
					arguments: { result: testCase.responseText },
					expectedToolResults: [{ callId: toolCallIds.search, contentIncludes: "export const name" }],
					expectedRequestIncludes: CHECKLIST_ITEMS.slice(2).map((item) => `- [x] ${item}`),
					...reasoningResponse(6),
				},
				{
					type: "error",
					status: 500,
					code: "unexpected_additional_request",
					message: `Unexpected additional ${testCase.target} request`,
				},
			)
			await sendTask(sidebar, `Exercise ${testCase.target} usage accounting.`)
			await expect.poll(() => server.getRequestCount(testCase.target), { timeout: 60_000 }).toBeGreaterThanOrEqual(1)
			const firstConsumption = server.getMockConsumptions(testCase.target)[0]
			if (!firstConsumption) throw new Error("First API request was not recorded")
			const advertisedTools = advertisedToolNames(firstConsumption)
			for (const toolName of [
				"read_file",
				"list_files",
				"generate_report",
				"qna_respond",
				"attempt_completion",
				"search_files",
			]) {
				expect(advertisedTools).toContain(toolName)
			}
			const advertisedToolPayload = JSON.stringify((firstConsumption.requestBody as { tools?: unknown }).tools ?? [])
			expect(advertisedToolPayload).toContain("task_progress")

			await expect(sidebar.getByText(REPORT_TITLE, { exact: true })).toBeVisible({ timeout: 60_000 })
			await expect(sidebar.getByText(REPORT_CONTENT, { exact: true })).toBeVisible()
			await expect.poll(() => server.getRequestCount(testCase.target)).toBe(3)
			await page.waitForTimeout(500)
			expect(server.getRequestCount(testCase.target)).toBe(3)
			await submitInteractionFeedback(sidebar, REPORT_FEEDBACK)

			await expect(sidebar.getByText(QNA_RESPONSE, { exact: true })).toBeVisible({ timeout: 60_000 })
			await expect.poll(() => server.getRequestCount(testCase.target)).toBe(4)
			await page.waitForTimeout(500)
			expect(server.getRequestCount(testCase.target)).toBe(4)
			await submitInteractionFeedback(sidebar, QNA_FEEDBACK)

			await expect(sidebar.getByText(testCase.responseText, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			const thinkingToggles = sidebar.getByRole("button", { name: "Thinking", exact: true })
			const visibleThinkingGroups = await thinkingToggles.count()
			if (testCase.exposesReasoningSummary) {
				expect(visibleThinkingGroups).toBeGreaterThan(0)
				expect(visibleThinkingGroups).toBeLessThanOrEqual(thinkingTexts.length)
				await thinkingToggles.last().click()
				await expect(
					sidebar.getByRole("button", { name: thinkingTexts[thinkingTexts.length - 1], exact: true }),
				).toBeVisible()
			} else {
				expect(visibleThinkingGroups).toBe(0)
			}
			await expect.poll(() => server.getRequestCount(testCase.target)).toBe(7)
			await page.waitForTimeout(500)
			expect(server.getRequestCount(testCase.target)).toBe(7)
			const consumptions = server.getMockConsumptions(testCase.target)
			expect(consumptions.map((entry) => entry.responseType)).toEqual(Array(7).fill("tool"))
			expect(consumptions.map((entry) => entry.toolCallId)).toEqual(Object.values(toolCallIds))
			expect(consumptions.map((entry) => entry.toolName)).toEqual([
				"read_file",
				"list_files",
				"generate_report",
				"qna_respond",
				"attempt_completion",
				"search_files",
				"attempt_completion",
			])
			expect(consumptions.map((entry) => entry.thinking)).toEqual(Array(7).fill(testCase.thinking))
			expect(consumptions.map((entry) => entry.responseReasoning)).toEqual(
				testCase.exposesReasoningSummary ? thinkingTexts : Array(7).fill(undefined),
			)
			expect(consumptions[0].toolArguments?.task_progress).toBe(INITIAL_TASK_PROGRESS)
			expect(consumptions[1].toolArguments?.task_progress).toBe(completedProgress(0))
			expect(consumptions[2].toolArguments).toMatchObject({
				title: REPORT_TITLE,
				content: REPORT_CONTENT,
				task_progress: completedProgress(1),
			})
			expect(consumptions[3].toolArguments).toEqual({ response: QNA_RESPONSE })
			expect(consumptions[4].toolArguments).toEqual({ result: "E2E_INCOMPLETE_COMPLETION_MUST_NOT_FINISH" })
			expect(consumptions[5].toolArguments?.task_progress).toBe(completedProgress(2, 3, 4, 5))
			expect(consumptions[6].toolArguments).toEqual({ result: testCase.responseText })
			expect(consumptions[1].requestToolResults).toContainEqual(
				expect.objectContaining({ callId: toolCallIds.read, content: expect.stringContaining("# Test Workspace") }),
			)
			expect(consumptions[2].requestToolResults).toContainEqual(
				expect.objectContaining({ callId: toolCallIds.list, content: expect.stringContaining("index.html") }),
			)
			expect(consumptions[3].requestToolResults).toContainEqual(
				expect.objectContaining({ callId: toolCallIds.report, content: expect.stringContaining(REPORT_FEEDBACK) }),
			)
			expect(consumptions[4].requestToolResults).toContainEqual(
				expect.objectContaining({ callId: toolCallIds.qna, content: expect.stringContaining(QNA_FEEDBACK) }),
			)
			expect(consumptions[5].requestToolResults).toContainEqual(
				expect.objectContaining({
					callId: toolCallIds.blockedCompletion,
					content: expect.stringContaining("ATTEMPT_COMPLETION BLOCKED"),
				}),
			)
			expect(consumptions[5].requestToolResults).toContainEqual(
				expect.objectContaining({
					callId: toolCallIds.blockedCompletion,
					content: expect.stringContaining("Current checklist"),
				}),
			)
			expect(consumptions[6].requestToolResults).toContainEqual(
				expect.objectContaining({ callId: toolCallIds.search, content: expect.stringContaining("export const name") }),
			)
			if (testCase.replaysReasoningInRequestBody) {
				for (const [index, thinkingText] of thinkingTexts.slice(0, -1).entries()) {
					expect(JSON.stringify(consumptions[index + 1].requestBody)).toContain(thinkingText)
				}
			}
			expectMeasuredUsage(consumptions)
			await expectContextUsage(sidebar, testCase.contextWindow, consumptions)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		},
	)
}

for (const status of [403, 429, 502] as const) {
	e2e(
		`API recovery - renders HTTP ${status} and Retry continues the task`,
		async ({ helper, server, sidebar, userDataDir }) => {
			e2e.setTimeout(180_000)
			const marker = `E2E_HTTP_${status}`
			server.enqueueResponses(
				"openai-compatible-chat",
				...Array.from({ length: 24 }, () => ({
					type: "error" as const,
					status,
					code: `e2e_http_${status}`,
					message: marker,
				})),
			)

			await helper.signin(sidebar)
			await sendTask(sidebar, `Exercise HTTP ${status} recovery.`)
			const errorBox = sidebar.getByTestId("error-retry-box")
			await expect(errorBox).toContainText("Automatic retry stopped", { timeout: 90_000 })
			await expect(errorBox.getByTestId("error-retry-box-status")).toHaveText(String(status))
			await expect(errorBox.getByTestId("error-retry-box-code")).toHaveText(`e2e_http_${status}`)
			await expect(errorBox.getByTestId("error-retry-box-message")).toHaveText(marker)
			await expect(errorBox.getByRole("button", { name: "Copy error" })).toBeVisible()
			await expect(errorBox.getByRole("button", { name: /^(Retry|Cancel)$/ })).toHaveCount(0)

			const retryButton = sidebar.locator('vscode-button[aria-label="Retry"]')
			await expect(retryButton).toBeVisible({ timeout: 90_000 })
			await expect(sidebar.locator('vscode-button[aria-label="Start New Task"]')).toBeVisible()
			const failures = server.getMockConsumptions("openai-compatible-chat")
			expect(failures.length).toBeGreaterThan(0)
			expect(failures.every((entry) => entry.status === status)).toBe(true)

			server.clearPendingResponses("openai-compatible-chat")
			server.enqueueResponses(
				"openai-compatible-chat",
				{
					type: "tool",
					name: "attempt_completion",
					arguments: { result: `E2E_HTTP_${status}_RETRY_OK` },
				},
				{
					type: "error",
					status: 500,
					code: "unexpected_additional_request",
					message: `Unexpected additional request after HTTP ${status} retry`,
				},
			)
			await retryButton.click()
			await expect(sidebar.getByText(`E2E_HTTP_${status}_RETRY_OK`, { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await expect(retryButton).not.toBeVisible()

			const consumptions = server.getMockConsumptions("openai-compatible-chat")
			expect(consumptions.at(-1)).toMatchObject({ responseType: "tool", toolName: "attempt_completion" })
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [new RegExp(marker)])
		},
	)
}

e2e(
	"API recovery - OpenAI queue exhaustion renders one structured error and Retry recovers",
	async ({ app, helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		const message = "No scripted E2E response remains for openai-compatible-chat"
		const requestId = "req_queue_openai_compatible_chat"
		await helper.signin(sidebar)
		await sendTask(sidebar, "Exercise an exhausted OpenAI mock response queue.")

		await expect(sidebar.getByText("Automatic retry stopped", { exact: true })).toBeVisible({ timeout: 90_000 })
		await expectSingleStructuredApiError(sidebar, {
			message,
			provider: "openai",
			model: "dline-e2e-model",
			status: 500,
			code: "e2e_mock_queue_exhausted",
			requestId,
			details: { type: "e2e_mock_error", target: "openai-compatible-chat", retryable: "true" },
		})
		const copyErrorButton = sidebar.getByRole("button", { name: "Copy error" })
		await expect(copyErrorButton).toBeVisible()
		await copyErrorButton.click()
		await expect(sidebar.getByRole("button", { name: "Copied" })).toBeVisible()
		const copiedError = (await app.evaluate(({ clipboard }) => clipboard.readText())).replaceAll("\r\n", "\n")
		expect(copiedError).toBe(
			[
				"API Request Failed",
				"",
				"Message",
				message,
				"",
				"Provider: openai",
				"Model: dline-e2e-model",
				"HTTP status: 500",
				"Error code: e2e_mock_queue_exhausted",
				`Request ID: ${requestId}`,
				"",
				"Details",
				"Type: e2e_mock_error",
				"Target: openai-compatible-chat",
				"Retryable: true",
			].join("\n"),
		)

		server.enqueueResponses("openai-compatible-chat", {
			type: "tool",
			name: "attempt_completion",
			arguments: { result: "E2E_OPENAI_QUEUE_RETRY_OK" },
		})
		await sidebar.locator('vscode-button[aria-label="Retry"]').click()
		await expect(sidebar.getByText("E2E_OPENAI_QUEUE_RETRY_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect(
			sidebar.locator(
				'[data-testid="api-error-box"], [data-testid="error-message-box"], [data-testid="error-presentation-box"], [data-testid="error-retry-box"]',
			),
		).toHaveCount(0)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [new RegExp(message)])
	},
)

e2e(
	"API recovery - Anthropic connection failure renders one structured error and Retry recovers",
	async ({ helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		await helper.signin(sidebar)
		await selectProfile(sidebar, E2E_PROFILE_NAMES.mockAnthropic)
		server.enqueueResponses(
			"anthropic-messages",
			...Array.from({ length: 24 }, () => ({
				type: "error" as const,
				status: 0,
				message: "Force an Anthropic connection failure",
				disconnect: true,
			})),
		)
		await sendTask(sidebar, "Exercise an Anthropic connection failure.")

		await expect(sidebar.getByText("Automatic retry stopped", { exact: true })).toBeVisible({ timeout: 90_000 })
		await expectSingleStructuredApiError(sidebar, {
			message: "Connection error.",
			provider: "anthropic",
			model: "claude-sonnet-4-6",
		})

		server.clearPendingResponses("anthropic-messages")
		server.enqueueResponses("anthropic-messages", {
			type: "tool",
			name: "attempt_completion",
			arguments: { result: "E2E_ANTHROPIC_CONNECTION_RETRY_OK" },
		})
		await sidebar.locator('vscode-button[aria-label="Retry"]').click()
		await expect(sidebar.getByText("E2E_ANTHROPIC_CONNECTION_RETRY_OK", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect(
			sidebar.locator(
				'[data-testid="api-error-box"], [data-testid="error-message-box"], [data-testid="error-presentation-box"], [data-testid="error-retry-box"]',
			),
		).toHaveCount(0)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/Connection error|ECONNRESET|fetch failed/])
	},
)

e2e(
	"API recovery - countdown Retry overrides the pending automatic retry and clears the error box",
	async ({ helper, page, server, sidebar, userDataDir }) => {
		e2e.setTimeout(180_000)
		const firstError = "E2E_RETRY_OVERRIDE_ERROR_1"
		const secondError = "E2E_RETRY_OVERRIDE_ERROR_2"
		const completion = "E2E_RETRY_OVERRIDE_OK"
		server.enqueueResponses(
			"openai-compatible-chat",
			{ type: "error", status: 502, code: "e2e_retry_override_1", message: firstError },
			{ type: "error", status: 502, code: "e2e_retry_override_2", message: secondError },
			{ type: "tool", name: "attempt_completion", arguments: { result: completion } },
			{
				type: "error",
				status: 500,
				code: "duplicate_retry_after_override",
				message: "Automatic retry was not cancelled after manual Retry",
			},
		)

		await helper.signin(sidebar)
		await sendTask(sidebar, "Exercise the automatic retry override countdown.")

		const errorBox = sidebar.getByTestId("error-retry-box")
		await expect(errorBox).toContainText("Attempt 1 of 3", { timeout: 90_000 })
		await expect(errorBox.getByTestId("error-retry-box-status")).toHaveText("502")
		await expect(errorBox.getByTestId("error-retry-box-code")).toHaveText("e2e_retry_override_1")
		await expect(errorBox.getByTestId("error-retry-box-message")).toHaveText(firstError)
		await expect(errorBox.getByRole("button", { name: "Copy error" })).toBeVisible()
		await expect(errorBox.getByRole("button", { name: /^(Retry|Cancel)$/ })).toHaveCount(0)

		const retryButton = sidebar.locator('vscode-button[aria-label="Retry"]')
		await expect(retryButton).toBeVisible()
		await expect(sidebar.locator('vscode-button[aria-label="Cancel"]')).toBeVisible()
		await startFooterActionStabilityObserver(sidebar, ["Retry", "Cancel"])
		await expect(errorBox).toContainText("Attempt 2 of 3", { timeout: 90_000 })
		await expect(errorBox.getByTestId("error-retry-box-code")).toHaveText("e2e_retry_override_2")
		await expect(errorBox.getByTestId("error-retry-box-message")).toHaveText(secondError)
		const footerStabilityEvents = await stopFooterActionStabilityObserver(sidebar)
		expect(footerStabilityEvents).toEqual([])
		const countdown = errorBox.getByTestId("error-retry-countdown")
		const initialCountdown = await countdown.innerText()
		await expect.poll(() => countdown.innerText(), { timeout: 3_000 }).not.toBe(initialCountdown)
		const requestsBeforeManualRetry = server.getMockConsumptions("openai-compatible-chat").length
		expect(requestsBeforeManualRetry).toBe(2)
		await retryButton.click()

		await expect(sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
		await expect(sidebar.getByTestId("error-retry-box")).toHaveCount(0)
		await expect.poll(() => server.getMockConsumptions("openai-compatible-chat").length).toBe(requestsBeforeManualRetry + 1)
		await page.waitForTimeout(5_000)
		expect(server.getMockConsumptions("openai-compatible-chat")).toHaveLength(requestsBeforeManualRetry + 1)
		expect(server.getMockConsumptions("openai-compatible-chat").at(-1)).toMatchObject({
			responseType: "tool",
			toolName: "attempt_completion",
		})
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/E2E_RETRY_OVERRIDE_ERROR_/])
	},
)
