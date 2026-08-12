import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Frame } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredProfile {
	name: string
	modelId?: string
	webSearchMode?: "WEB_SEARCH_MODE_FORCE_OFF"
	openai?: {
		capabilities?: {
			contextWindow?: number
		}
	}
}

interface OpenAiChatRequestBody {
	messages?: unknown[]
	tools?: Array<{ function?: { name?: string } }>
	prompt_cache_key?: string
	prompt_cache_options?: unknown
}

interface ParsedCompactionBudget {
	availableRemainder: number
	hardLimit: number
	recommendedMin: number
	recommendedMax: number
}

function estimateTokens(value: unknown): number {
	return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4))
}

const TRUNCATED_SUMMARY_MARKER = "E2E_CHAT_COMPACTION_TRUNCATED_RESPONSE_SHOULD_NOT_SURVIVE"
const HIGH_CONTEXT_PRESSURE_MARKER = "# High Context Pressure"

function estimateCommonPrefixTokens(left: unknown, right: unknown): number {
	const leftText = JSON.stringify(left)
	const rightText = JSON.stringify(right)
	const limit = Math.min(leftText.length, rightText.length)
	let index = 0
	while (index < limit && leftText[index] === rightText[index]) index++
	return Math.ceil(Buffer.byteLength(leftText.slice(0, index), "utf8") / 4)
}

function getToolNames(body: OpenAiChatRequestBody): string[] {
	return (body.tools ?? []).flatMap((tool) => (tool.function?.name ? [tool.function.name] : []))
}

function stripPromptCacheAnnotations(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stripPromptCacheAnnotations)
	}
	if (typeof value !== "object" || value === null) {
		return value
	}

	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => key !== "cache_control" && key !== "prompt_cache_breakpoint")
			.map(([key, nested]) => [key, stripPromptCacheAnnotations(nested)]),
	)
}

function commonMessageCount(left: readonly unknown[], right: readonly unknown[]): number {
	const limit = Math.min(left.length, right.length)
	let index = 0
	while (index < limit && JSON.stringify(left[index]) === JSON.stringify(right[index])) index++
	return index
}

const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")
const settingsPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "settings.json")

async function configureAutoCompaction(dlineDir: string, profileName: string): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === profileName)
	if (!profile?.openai?.capabilities) throw new Error(`Missing configurable OpenAI E2E profile: ${profileName}`)
	profile.modelId = "gpt-5.6-sol"
	profile.openai.capabilities.contextWindow = 131_072
	profile.webSearchMode = "WEB_SEARCH_MODE_FORCE_OFF"
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	await writeFile(
		settingsPath(dlineDir),
		`${JSON.stringify(
			{
				...settings,
				actModeProfile: profileName,
				planModeProfile: profileName,
				useAutoCondense: true,
				autoCondenseTriggerPercent: 60,
				autoCondenseMaxContextTokens: 100_000,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
}

async function configureChatAutoCompaction(dlineDir: string): Promise<void> {
	await configureAutoCompaction(dlineDir, E2E_PROFILE_NAMES.mockOpenAi)
}

async function configureResponsesAutoCompaction(dlineDir: string): Promise<void> {
	await configureAutoCompaction(dlineDir, E2E_PROFILE_NAMES.mockOpenAiResponses)
}

async function configureResponsesContextPressure(dlineDir: string): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!profile?.openai?.capabilities) throw new Error("Missing configurable OpenAI Responses E2E profile")
	profile.modelId = "gpt-5.6-sol"
	profile.openai.capabilities.contextWindow = 100_000
	profile.webSearchMode = "WEB_SEARCH_MODE_FORCE_OFF"
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	await writeFile(
		settingsPath(dlineDir),
		`${JSON.stringify(
			{
				...settings,
				actModeProfile: E2E_PROFILE_NAMES.mockOpenAiResponses,
				planModeProfile: E2E_PROFILE_NAMES.mockOpenAiResponses,
				useAutoCondense: false,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
}

function countOccurrences(text: string, marker: string): number {
	return text.split(marker).length - 1
}

function parseCompactionBudget(requestBody: unknown): ParsedCompactionBudget {
	const requestText = JSON.stringify(requestBody)
	const available = requestText.match(/Estimated available context-window remainder: ([0-9]+) tokens/)
	const hardLimit = requestText.match(/Hard limit for the complete response: ([0-9]+) tokens/)
	const recommended = requestText.match(/Recommended total response range: ([0-9]+)[–-]([0-9]+) tokens/)
	if (!available || !hardLimit || !recommended) {
		throw new Error("Compaction request is missing the complete window-budget guidance")
	}
	return {
		availableRemainder: Number(available[1]),
		hardLimit: Number(hardLimit[1]),
		recommendedMin: Number(recommended[1]),
		recommendedMax: Number(recommended[2]),
	}
}

function expectCompactionBudgetFormula(requestBody: unknown): ParsedCompactionBudget {
	const requestText = JSON.stringify(requestBody)
	const budget = parseCompactionBudget(requestBody)
	const declaredMaxOutput = (requestBody as { max_output_tokens?: unknown }).max_output_tokens
	const expectedHardLimit =
		typeof declaredMaxOutput === "number" && declaredMaxOutput > 0
			? Math.min(budget.availableRemainder, Math.floor(declaredMaxOutput))
			: budget.availableRemainder

	expect(budget.availableRemainder).toBeGreaterThan(0)
	expect(budget.hardLimit).toBe(expectedHardLimit)
	expect(budget.recommendedMin).toBe(Math.min(Math.floor(budget.availableRemainder * 0.8), 5_000))
	expect(budget.recommendedMax).toBe(Math.min(Math.floor(budget.availableRemainder * 0.9), 20_000))
	expect(budget.recommendedMin).toBeLessThanOrEqual(budget.recommendedMax)
	expect(budget.recommendedMax).toBeLessThanOrEqual(budget.availableRemainder)
	expect(requestText).toContain("The recommended range is guidance, not a quota or a minimum output requirement")
	expect(requestText).toContain("Do not expand the analysis or summary merely to fill the available range")
	expect(requestText).toContain("Preserve all information required to continue the task accurately and completely")
	expect(requestText).not.toContain("<compaction_window_budget />")
	expect(requestText).not.toMatch(/estimated (?:compaction request )?input/i)
	return budget
}

async function openSidebar(app: ElectronApplication, helper: E2ETestHelper): Promise<Frame> {
	const page = await app.firstWindow()
	await E2ETestHelper.openClineSidebar(page)
	const sidebar = await helper.getSidebar(page)
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
	await helper.signin(sidebar)
	return sidebar
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled()
	await input.fill(text)
	await input.press("Enter")
	await expect(input).toHaveValue("")
	await expect(sidebar.getByText(text, { exact: true }).last()).toBeVisible()
}

e2e(
	"OpenAI compaction - Chat request after summarize_task has no orphan tool output",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }, testInfo) => {
		e2e.setTimeout(180_000)
		await configureChatAutoCompaction(dlineDir)
		const summaryMarker = "E2E_CHAT_SUMMARY_AFTER_LITERAL_CLOSE"
		const summaryText =
			`E2E_CHAT_COMPACTION_SUMMARY preserves the task and latest user request. ` +
			`The literal payload \`</context></summarize_task>\` is part of the summary. ${summaryMarker}`
		server.enqueueResponses(
			"openai-compatible-chat",
			{
				type: "tool",
				id: "call_chat_compaction_ready",
				name: "qna_respond",
				arguments: { response: "E2E_CHAT_COMPACTION_READY" },
				usage: { inputTokens: 125_000, outputTokens: 100 },
			},
			{
				type: "message",
				text: `<thinking>E2E summary analysis</thinking><summarize_task><context>${summaryText}</context></summarize_task>`,
				expectedRequestIncludes: [
					"The current conversation is rapidly running out of context",
					"# Compaction Window Budget",
					"Estimated available context-window remainder:",
					"Hard limit for the complete response:",
					"Recommended total response range:",
				],
				expectedRequestExcludes: ["<compaction_window_budget />", "E2E_CHAT_COMPACTION_CONTINUE"],
			},
			{
				type: "tool",
				id: "call_chat_compaction_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_CHAT_COMPACTION_OK" },
				expectedRequestIncludes: ["E2E_CHAT_COMPACTION_SUMMARY", "E2E_CHAT_COMPACTION_CONTINUE"],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_CHAT_COMPACTION_TASK")
			await expect(sidebar.getByText("E2E_CHAT_COMPACTION_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_CHAT_COMPACTION_CONTINUE")
			await expect(sidebar.getByText("E2E_CHAT_COMPACTION_OK", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const summaryToggle = sidebar.getByRole("button", { name: "Expand summary" }).filter({ hasText: summaryMarker })
			await expect(summaryToggle).toBeVisible()
			await summaryToggle.click()
			const summaryScrollContainer = sidebar.getByTestId("summary-scroll-container").filter({ hasText: summaryMarker })
			await expect(summaryScrollContainer).toContainText(summaryText)
			await expect(sidebar.getByText(summaryMarker, { exact: false })).toHaveCount(1)

			await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(3)
			const requests = server.getMockConsumptions("openai-compatible-chat")
			expect(requests[1].contractError).toBeUndefined()
			expect(requests[2].contractError).toBeUndefined()

			const initialBody = requests[0].requestBody as OpenAiChatRequestBody
			const summaryBody = requests[1].requestBody as OpenAiChatRequestBody
			const initialRequestTokens = estimateTokens(initialBody)
			const summaryRequestTokens = estimateTokens(summaryBody)
			const initialMessageTokens = estimateTokens(initialBody.messages ?? [])
			const summaryMessageTokens = estimateTokens(summaryBody.messages ?? [])
			const initialToolTokens = estimateTokens(initialBody.tools ?? [])
			const summaryToolTokens = estimateTokens(summaryBody.tools ?? [])
			const messagePrefixTokens = estimateCommonPrefixTokens(initialBody.messages ?? [], summaryBody.messages ?? [])
			const normalizedInitialMessages = stripPromptCacheAnnotations(initialBody.messages ?? []) as unknown[]
			const normalizedSummaryMessages = stripPromptCacheAnnotations(summaryBody.messages ?? []) as unknown[]
			const normalizedCommonMessageCount = commonMessageCount(normalizedInitialMessages, normalizedSummaryMessages)
			const projectedSummaryTokens = 350_600 + summaryRequestTokens - initialRequestTokens
			const cacheEvidence = {
				actual: {
					initialRequestTokens,
					summaryRequestTokens,
					initialMessageTokens,
					summaryMessageTokens,
					initialToolTokens,
					summaryToolTokens,
					messagePrefixTokens,
					initialMessageCount: initialBody.messages?.length ?? 0,
					summaryMessageCount: summaryBody.messages?.length ?? 0,
					normalizedCommonMessageCount,
					initialMessageTokensByIndex: (initialBody.messages ?? []).map(estimateTokens),
					summaryMessageTokensByIndex: (summaryBody.messages ?? []).map(estimateTokens),
				},
				projected: {
					initialRequestTokens: 350_600,
					summaryRequestTokens: projectedSummaryTokens,
				},
				initialToolNames: getToolNames(initialBody),
				summaryToolNames: getToolNames(summaryBody),
				initialPromptCacheKey: initialBody.prompt_cache_key,
				summaryPromptCacheKey: summaryBody.prompt_cache_key,
			}
			const evidencePath = testInfo.outputPath("openai-compaction-cache-evidence.json")
			await writeFile(evidencePath, `${JSON.stringify(cacheEvidence, null, 2)}\n`, "utf8")
			await testInfo.attach("openai-compaction-cache-evidence.json", {
				path: evidencePath,
				contentType: "application/json",
			})

			expect(summaryMessageTokens).toBeGreaterThan(initialMessageTokens)
			expect(normalizedCommonMessageCount).toBe(initialBody.messages?.length ?? 0)
			expect(summaryBody.tools).toEqual(initialBody.tools)
			expect(getToolNames(summaryBody)).toEqual(getToolNames(initialBody))
			expect(getToolNames(summaryBody)).not.toContain("summarize_task")
			expect(summaryBody.prompt_cache_key).toBe(initialBody.prompt_cache_key)
			expect(projectedSummaryTokens).toBeGreaterThan(350_600)
			const summaryRequestText = JSON.stringify(summaryBody)
			expect(summaryRequestText).toMatch(/Estimated available context-window remainder: [1-9][0-9]* tokens/)
			expect(summaryRequestText).toMatch(/Hard limit for the complete response: [1-9][0-9]* tokens/)
			expect(summaryRequestText).toMatch(/Recommended total response range: [0-9]+[–-][1-9][0-9]* tokens/)
			expect(summaryRequestText).not.toContain("<compaction_window_budget />")

			const finalBody = requests[2].requestBody as {
				messages?: Array<{ role?: string; tool_call_id?: string; content?: unknown }>
			}
			const orphanSummaryOutputs = (finalBody.messages ?? []).filter(
				(message) => message.role === "tool" && JSON.stringify(message.content).includes("E2E_CHAT_COMPACTION_SUMMARY"),
			)
			expect(orphanSummaryOutputs).toEqual([])
			expect(JSON.stringify(finalBody)).toContain(summaryText)

			for (const request of requests) {
				expect(request.requestBody?.prompt_cache_key).toBeTruthy()
				expect(request.requestBody?.prompt_cache_options).toBeUndefined()
				expect(JSON.stringify(request.requestBody)).not.toContain("prompt_cache_breakpoint")
			}
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"OpenAI compaction - Responses retry removes the interrupted summary and its thinking",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureResponsesAutoCompaction(dlineDir)
		const damagedSummary = "E2E_RESPONSES_DAMAGED_SUMMARY_MUST_NOT_SURVIVE"
		const interruptedThinking = "E2E_RESPONSES_INTERRUPTED_THINKING_MUST_NOT_SURVIVE"
		const recoveredSummary = "E2E_RESPONSES_RETRIED_SUMMARY preserves the original continuation."
		const serializedArguments = JSON.stringify({ context: damagedSummary })
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_responses_retry_ready",
				name: "qna_respond",
				arguments: { response: "E2E_RESPONSES_RETRY_READY" },
				usage: { inputTokens: 125_000, outputTokens: 100 },
			},
			{
				type: "truncated-tool",
				id: "call_responses_damaged_summary",
				name: "summarize_task",
				arguments: { context: damagedSummary },
				reasoning: interruptedThinking,
				truncateAfter: serializedArguments.length - 1,
				expectedRequestIncludes: ["The current conversation is rapidly running out of context"],
				expectedRequestExcludes: ["E2E_RESPONSES_RETRY_CONTINUE"],
			},
			{
				type: "tool",
				id: "call_responses_recovered_summary",
				name: "summarize_task",
				arguments: { context: recoveredSummary },
				expectedRequestIncludes: ["The current conversation is rapidly running out of context"],
				expectedRequestExcludes: [damagedSummary, interruptedThinking, "E2E_RESPONSES_RETRY_CONTINUE"],
			},
			{
				type: "message",
				text: "E2E_RESPONSES_CONTINUATION_MUST_WAIT_FOR_RECOVERED_SUMMARY",
				delayMs: 120_000,
				expectedRequestIncludes: [recoveredSummary, "E2E_RESPONSES_RETRY_CONTINUE"],
				expectedRequestExcludes: [damagedSummary, interruptedThinking],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_RESPONSES_RETRY_TASK")
			await expect(sidebar.getByText("E2E_RESPONSES_RETRY_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_RESPONSES_RETRY_CONTINUE")
			await expect(sidebar.getByText("Compaction was interrupted; retrying:", { exact: true })).toBeVisible({
				timeout: 60_000,
			})
			await expect
				.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 })
				.toBeGreaterThanOrEqual(4)
			await expect(
				sidebar.getByText("E2E_RESPONSES_CONTINUATION_MUST_WAIT_FOR_RECOVERED_SUMMARY", { exact: false }),
			).toHaveCount(0)

			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requests[1]).toMatchObject({
				responseType: "truncated-tool",
				responseReasoning: interruptedThinking,
			})
			expect(requests[2]).toMatchObject({ responseType: "tool", toolName: "summarize_task" })
			expect(requests[1].contractError).toBeUndefined()
			expect(requests[2].contractError).toBeUndefined()
			expect(requests[2].requestBody).toEqual(requests[1].requestBody)
			expect(JSON.stringify(requests[2].requestBody)).not.toContain(damagedSummary)
			expect(JSON.stringify(requests[2].requestBody)).not.toContain(interruptedThinking)
			expect(JSON.stringify(requests[3].requestBody)).toContain(recoveredSummary)
			expect(JSON.stringify(requests[3].requestBody)).toContain("E2E_RESPONSES_RETRY_CONTINUE")
			expect(JSON.stringify(requests[3].requestBody)).not.toContain(damagedSummary)
			expect(JSON.stringify(requests[3].requestBody)).not.toContain(interruptedThinking)
			await expect(sidebar.getByText(damagedSummary, { exact: false })).toHaveCount(0)
			await expect(sidebar.getByText(interruptedThinking, { exact: false })).toHaveCount(0)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/max_output_tokens/])
		} finally {
			await app.close()
		}
	},
)

e2e(
	"OpenAI compaction - iterates until the projected context is below 80 percent",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureResponsesAutoCompaction(dlineDir)
		const firstSummary = "E2E_ITERATIVE_SUMMARY_ONE preserves the established task state."
		const secondSummary = "E2E_ITERATIVE_SUMMARY_TWO replaces the first summary after fitting the target window."
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_iterative_ready",
				name: "qna_respond",
				arguments: { response: "E2E_ITERATIVE_READY" },
				usage: { inputTokens: 125_000, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_iterative_summary_one",
				name: "summarize_task",
				arguments: { context: firstSummary },
				usage: { inputTokens: 112_000, outputTokens: 100 },
				expectedRequestIncludes: ["The current conversation is rapidly running out of context"],
				expectedRequestExcludes: ["E2E_ITERATIVE_CONTINUE"],
			},
			{
				type: "tool",
				id: "call_iterative_summary_two",
				name: "summarize_task",
				arguments: { context: secondSummary },
				delayMs: 2_000,
				usage: { inputTokens: 75_000, outputTokens: 100 },
				expectedRequestIncludes: [
					"The current conversation is rapidly running out of context",
					"E2E_ITERATIVE_TASK",
					firstSummary,
					"E2E_ITERATIVE_CONTINUE",
				],
			},
			{
				type: "tool",
				id: "call_iterative_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_ITERATIVE_OK" },
				expectedRequestIncludes: ["E2E_ITERATIVE_TASK", secondSummary, "E2E_ITERATIVE_CONTINUE"],
				expectedRequestExcludes: ["The current conversation is rapidly running out of context", firstSummary],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_ITERATIVE_TASK")
			await expect(sidebar.getByText("E2E_ITERATIVE_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_ITERATIVE_CONTINUE")

			await expect
				.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 })
				.toBeGreaterThanOrEqual(3)
			const requestsDuringSecondPass = server.getMockConsumptions("openai-compatible-responses")
			const secondPassBody = JSON.stringify(requestsDuringSecondPass[2].requestBody)
			expect(secondPassBody).toContain("The current conversation is rapidly running out of context")
			expect(secondPassBody).toContain("E2E_ITERATIVE_TASK")
			expect(secondPassBody).toContain(firstSummary)
			expect(secondPassBody).toContain("E2E_ITERATIVE_CONTINUE")

			await expect(sidebar.getByText("E2E_ITERATIVE_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(4)
			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requests[1]).toMatchObject({ responseType: "tool", toolName: "summarize_task" })
			expect(requests[2]).toMatchObject({ responseType: "tool", toolName: "summarize_task" })
			expect(requests[3]).toMatchObject({ responseType: "tool", toolName: "attempt_completion" })
			expect(requests.slice(1).every((request) => request.contractError === undefined)).toBe(true)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"OpenAI compaction budget - automatic request follows the available-remainder formula",
	async ({ dlineDir, helper, openVSCode, server, workspaceDir }) => {
		e2e.setTimeout(120_000)
		await configureResponsesAutoCompaction(dlineDir)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_auto_budget_ready",
				name: "qna_respond",
				arguments: { response: "E2E_AUTO_BUDGET_READY" },
				usage: { inputTokens: 125_000, outputTokens: 100 },
			},
			{
				type: "message",
				text: "E2E_AUTO_BUDGET_PENDING",
				delayMs: 120_000,
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_AUTO_BUDGET_TASK")
			await expect(sidebar.getByText("E2E_AUTO_BUDGET_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_AUTO_BUDGET_CONTINUE")
			await expect
				.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 })
				.toBeGreaterThanOrEqual(2)

			const compactionRequest = server.getMockConsumptions("openai-compatible-responses")[1]
			expectCompactionBudgetFormula(compactionRequest.requestBody)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"OpenAI compaction budget - manual request uses the same formula and preserves feedback",
	async ({ dlineDir, helper, openVSCode, server, workspaceDir }) => {
		e2e.setTimeout(120_000)
		await configureResponsesContextPressure(dlineDir)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_manual_budget_ready",
				name: "qna_respond",
				arguments: { response: "E2E_MANUAL_BUDGET_READY" },
				usage: { inputTokens: 50_000, outputTokens: 100 },
			},
			{
				type: "message",
				text: "E2E_MANUAL_BUDGET_PENDING",
				delayMs: 120_000,
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_MANUAL_BUDGET_TASK")
			await expect(sidebar.getByText("E2E_MANUAL_BUDGET_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "/compact E2E_MANUAL_BUDGET_FEEDBACK")
			await expect
				.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 })
				.toBeGreaterThanOrEqual(2)

			const compactionRequest = server.getMockConsumptions("openai-compatible-responses")[1]
			const requestText = JSON.stringify(compactionRequest.requestBody)
			expectCompactionBudgetFormula(compactionRequest.requestBody)
			expect(requestText).toContain("E2E_MANUAL_BUDGET_FEEDBACK")
			expect(requestText).not.toContain("/compact")
		} finally {
			await app.close()
		}
	},
)

e2e(
	"OpenAI context pressure - below 10 percent remaining injects one environment warning",
	async ({ dlineDir, helper, openVSCode, server, workspaceDir }) => {
		e2e.setTimeout(120_000)
		await configureResponsesContextPressure(dlineDir)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_pressure_below_ready",
				name: "qna_respond",
				arguments: { response: "E2E_PRESSURE_BELOW_READY" },
				usage: { inputTokens: 89_901, outputTokens: 100 },
			},
			{
				type: "message",
				text: "E2E_PRESSURE_BELOW_PENDING",
				delayMs: 120_000,
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_PRESSURE_BELOW_TASK")
			await expect(sidebar.getByText("E2E_PRESSURE_BELOW_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_PRESSURE_BELOW_CONTINUE")
			await expect
				.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 })
				.toBeGreaterThanOrEqual(2)

			const requestText = JSON.stringify(server.getMockConsumptions("openai-compatible-responses")[1].requestBody)
			expect(countOccurrences(requestText, HIGH_CONTEXT_PRESSURE_MARKER)).toBe(1)
			expect(requestText).toContain("Avoid launching too many parallel tool calls that may produce large results")
			expect(requestText).toContain("Do not skip information or verification required to complete the current task")
		} finally {
			await app.close()
		}
	},
)

e2e(
	"OpenAI context pressure - exactly 10 percent remaining does not inject the environment warning",
	async ({ dlineDir, helper, openVSCode, server, workspaceDir }) => {
		e2e.setTimeout(120_000)
		await configureResponsesContextPressure(dlineDir)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_pressure_boundary_ready",
				name: "qna_respond",
				arguments: { response: "E2E_PRESSURE_BOUNDARY_READY" },
				usage: { inputTokens: 89_900, outputTokens: 100 },
			},
			{
				type: "message",
				text: "E2E_PRESSURE_BOUNDARY_PENDING",
				delayMs: 120_000,
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_PRESSURE_BOUNDARY_TASK")
			await expect(sidebar.getByText("E2E_PRESSURE_BOUNDARY_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_PRESSURE_BOUNDARY_CONTINUE")
			await expect
				.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 })
				.toBeGreaterThanOrEqual(2)

			const requestText = JSON.stringify(server.getMockConsumptions("openai-compatible-responses")[1].requestBody)
			expect(requestText).not.toContain(HIGH_CONTEXT_PRESSURE_MARKER)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"OpenAI compaction - interrupted summary response is removed before retry",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureChatAutoCompaction(dlineDir)
		server.enqueueResponses(
			"openai-compatible-chat",
			{
				type: "tool",
				id: "call_chat_compaction_retry_ready",
				name: "qna_respond",
				arguments: { response: "E2E_CHAT_COMPACTION_RETRY_READY" },
				usage: { inputTokens: 125_000, outputTokens: 100 },
			},
			{
				type: "truncated-message",
				text: `<thinking>incomplete summary</thinking><summarize_task><context>${TRUNCATED_SUMMARY_MARKER}`,
				usage: { inputTokens: 125_000, outputTokens: 100 },
				expectedRequestIncludes: [
					"The current conversation is rapidly running out of context",
					"Hard limit for the complete response:",
				],
				expectedRequestExcludes: ["<compaction_window_budget />"],
			},
			{
				type: "message",
				text: "<thinking>recovered summary</thinking><summarize_task><context>E2E_CHAT_COMPACTION_RETRY_SUMMARY is complete.</context></summarize_task>",
				usage: { inputTokens: 125_000, outputTokens: 100 },
				expectedRequestIncludes: [
					"The current conversation is rapidly running out of context",
					"Hard limit for the complete response:",
				],
				expectedRequestExcludes: [TRUNCATED_SUMMARY_MARKER, "<compaction_window_budget />"],
			},
			{
				type: "tool",
				id: "call_chat_compaction_retry_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_CHAT_COMPACTION_RETRY_OK" },
				expectedRequestIncludes: ["E2E_CHAT_COMPACTION_RETRY_SUMMARY", "E2E_CHAT_COMPACTION_RETRY_CONTINUE"],
				expectedRequestExcludes: [TRUNCATED_SUMMARY_MARKER],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_CHAT_COMPACTION_RETRY_TASK")
			await expect(sidebar.getByText("E2E_CHAT_COMPACTION_RETRY_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_CHAT_COMPACTION_RETRY_CONTINUE")
			await expect(sidebar.getByText("Compaction was interrupted; retrying:", { exact: true })).toBeVisible({
				timeout: 60_000,
			})
			await expect(sidebar.locator("div.text-description.mb-2").filter({ hasText: /^Attempt 1 of 3$/ })).toBeVisible()
			await expect(sidebar.getByText("E2E_CHAT_COMPACTION_RETRY_OK", { exact: false }).last()).toBeVisible({
				timeout: 90_000,
			})

			await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(4)
			const requests = server.getMockConsumptions("openai-compatible-chat")
			expect(requests[1].contractError).toBeUndefined()
			expect(requests[1].responseType).toBe("truncated-message")
			expect(requests[1].abortedAtMs).toBeTruthy()
			expect(requests[2].contractError).toBeUndefined()
			expect(requests[2].responseType).toBe("message")
			expect(requests[3].contractError).toBeUndefined()
			expect(JSON.stringify(requests[2].requestBody)).not.toContain(TRUNCATED_SUMMARY_MARKER)
			expect(JSON.stringify(requests[3].requestBody)).not.toContain(TRUNCATED_SUMMARY_MARKER)
			await expect(sidebar.getByText(TRUNCATED_SUMMARY_MARKER, { exact: false })).toHaveCount(0)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/Connection error|ECONNRESET|fetch failed/])
		} finally {
			await app.close()
		}
	},
)
