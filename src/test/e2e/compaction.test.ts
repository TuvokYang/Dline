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
	anthropic?: {
		capabilities?: {
			contextWindow?: number
		}
	}
	deepseek?: {
		capabilities?: {
			contextWindow?: number
		}
	}
}

interface RollingMergeProviderCase {
	label: string
	profileName: string
	target: "openai-compatible-chat" | "openai-compatible-responses" | "anthropic-messages" | "deepseek-chat"
	modelId: string
	providerConfigKey: "openai" | "anthropic" | "deepseek"
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
const ROLLING_MERGE_PROVIDER_CASES: readonly RollingMergeProviderCase[] = [
	{
		label: "OpenAI Chat Completion",
		profileName: E2E_PROFILE_NAMES.mockOpenAi,
		target: "openai-compatible-chat",
		modelId: "gpt-5.6-sol",
		providerConfigKey: "openai",
	},
	{
		label: "OpenAI Responses",
		profileName: E2E_PROFILE_NAMES.mockOpenAiResponses,
		target: "openai-compatible-responses",
		modelId: "gpt-5.6-sol",
		providerConfigKey: "openai",
	},
	{
		label: "Anthropic Messages",
		profileName: E2E_PROFILE_NAMES.mockAnthropic,
		target: "anthropic-messages",
		modelId: "claude-sonnet-4-6",
		providerConfigKey: "anthropic",
	},
	{
		label: "DeepSeek Chat",
		profileName: E2E_PROFILE_NAMES.mockDeepSeek,
		target: "deepseek-chat",
		modelId: "deepseek-v4-flash",
		providerConfigKey: "deepseek",
	},
]

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

async function configureTriggerBoundary(
	dlineDir: string,
	contextWindow: number,
	maxContextTokens: number,
	minReserveTokens = 5_000,
	maxReserveTokens = 30_000,
): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!profile?.openai?.capabilities) throw new Error("Missing configurable OpenAI Responses E2E profile")
	profile.modelId = "gpt-5.6-sol"
	profile.openai.capabilities.contextWindow = contextWindow
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
				useAutoCondense: true,
				autoCondenseTriggerPercent: 97,
				autoCondenseMinReserveTokens: minReserveTokens,
				autoCondenseMaxReserveTokens: maxReserveTokens,
				autoCondenseMaxContextTokens: maxContextTokens,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
}

async function configureRollingMergeTarget(dlineDir: string, providerCase: RollingMergeProviderCase): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === providerCase.profileName)
	if (!profile) throw new Error(`Missing configurable E2E profile: ${providerCase.profileName}`)
	profile.modelId = providerCase.modelId
	const providerConfig = profile[providerCase.providerConfigKey] ?? {}
	profile[providerCase.providerConfigKey] = {
		...providerConfig,
		capabilities: {
			...(providerConfig.capabilities ?? {}),
			contextWindow: 1_000_000,
		},
	}
	profile.webSearchMode = "WEB_SEARCH_MODE_FORCE_OFF"
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	await writeFile(
		settingsPath(dlineDir),
		`${JSON.stringify(
			{
				...settings,
				actModeProfile: providerCase.profileName,
				planModeProfile: providerCase.profileName,
				useAutoCondense: true,
				autoCondenseTriggerPercent: 97,
				autoCondenseMaxContextTokens: 272_000,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
}

async function configureReducedCapScenario(dlineDir: string): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!profile?.openai?.capabilities) throw new Error("Missing configurable OpenAI Responses E2E profile")
	profile.modelId = "gpt-5.6-sol"
	profile.openai.capabilities.contextWindow = 1_000_000
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
				useAutoCondense: true,
				autoCondenseTriggerPercent: 60,
				autoCondenseMaxContextTokens: 272_000,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
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
	expect(budget.recommendedMax).toBe(Math.min(Math.floor(budget.availableRemainder * 0.9), 30_000))
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
			expect(normalizedCommonMessageCount).toBeGreaterThanOrEqual(1)
			expect(normalizedSummaryMessages[0]).toEqual(normalizedInitialMessages[0])
			expect(JSON.stringify(summaryBody)).not.toContain("<environment_details>")
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
	"Context compaction - terminal hidden Pass failure stops the task and explains the outcome",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureReducedCapScenario(dlineDir)
		const turnAMarker = "E2E_TERMINAL_FAILURE_TURN_A"
		const turnBMarker = "E2E_TERMINAL_FAILURE_TURN_B"
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_terminal_failure_turn_a",
				name: "qna_respond",
				arguments: { response: `${turnAMarker}:${"A".repeat(20_000)}` },
				usage: { inputTokens: 120_000, outputTokens: 100 },
				matchRequestContract: true,
			},
			{
				type: "tool",
				id: "call_terminal_failure_turn_b",
				name: "qna_respond",
				arguments: { response: `${turnBMarker}:${"B".repeat(20_000)}` },
				usage: { inputTokens: 300_000, outputTokens: 100 },
				matchRequestContract: true,
			},
			// First hidden Pass attempt plus all ordinary Pass retries fail; the terminal
			// branch must explain the stop without recovering the ordinary continuation.
			{ type: "error", status: 400, message: "E2E_TERMINAL_FAILURE_ATTEMPT_0" },
			{ type: "error", status: 400, message: "E2E_TERMINAL_FAILURE_RETRY_1" },
			{ type: "error", status: 400, message: "E2E_TERMINAL_FAILURE_RETRY_2" },
			{ type: "error", status: 400, message: "E2E_TERMINAL_FAILURE_RETRY_3" },
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_TERMINAL_FAILURE_TASK")
			await expect(sidebar.getByText(turnAMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_TERMINAL_FAILURE_USER_TURN_B")
			await expect(sidebar.getByText(turnBMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_TERMINAL_FAILURE_CONTINUE")

			// The terminal hidden-Pass failure is presented by the api-request error
			// rendering: the exhausted retry card shows the complete error and the
			// retry count, and the compaction row no longer shows a red error detail.
			await expect(sidebar.getByText("Automatic retry stopped", { exact: false }).last()).toBeVisible({
				timeout: 120_000,
			})
			await expect(sidebar.getByText(/All .* automatic attempts were used\./).last()).toBeVisible()
			await expect(sidebar.getByText("E2E_TERMINAL_FAILURE_RETRY_3", { exact: false }).last()).toBeVisible()

			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(6)
			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requests.slice(2).every((request) => request.responseType === "error")).toBe(true)
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
			const firstRequestBody = requests[1].requestBody as Record<string, unknown>
			const retryRequestBody = requests[2].requestBody as Record<string, unknown>
			expect(retryRequestBody.max_output_tokens).toBe(Math.floor(Number(firstRequestBody.max_output_tokens) * 0.9))
			expect({ ...retryRequestBody, max_output_tokens: firstRequestBody.max_output_tokens }).toEqual(firstRequestBody)
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
	"Auto compact trigger - equal maximum context uses percentage reserve and the shared 2K tolerance",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureTriggerBoundary(dlineDir, 272_000, 272_000)
		const belowFeedback = "E2E_EQUAL_CAP_BELOW_CONTINUE"
		const triggerFeedback = "E2E_EQUAL_CAP_TRIGGER_CONTINUE"
		const compactTriggerTokens = 261_340
		// Keep the first complete candidate outside the shared 2K tolerance, then
		// place the second baseline well inside it. The real Provider request delta
		// includes the complete tool-result envelope, not only the feedback text.
		const belowPreviousTokens = compactTriggerTokens - 3_000
		const triggerPreviousTokens = compactTriggerTokens - 1_000
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_equal_cap_below",
				name: "qna_respond",
				arguments: { response: "E2E_EQUAL_CAP_BELOW_READY" },
				usage: { inputTokens: belowPreviousTokens - 100, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_equal_cap_exact",
				name: "qna_respond",
				arguments: { response: "E2E_EQUAL_CAP_EXACT_READY" },
				usage: { inputTokens: triggerPreviousTokens - 100, outputTokens: 100 },
				expectedRequestExcludes: ["The current conversation is rapidly running out of context"],
			},
			{
				type: "tool",
				id: "call_equal_cap_summary",
				name: "summarize_task",
				arguments: { context: "E2E_EQUAL_CAP_SUMMARY" },
				expectedRequestIncludes: ["The current conversation is rapidly running out of context"],
				expectedRequestExcludes: [triggerFeedback],
			},
			{
				type: "tool",
				id: "call_equal_cap_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_EQUAL_CAP_OK" },
				expectedRequestIncludes: ["E2E_EQUAL_CAP_SUMMARY", triggerFeedback],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_EQUAL_CAP_TASK")
			await expect(sidebar.getByText("E2E_EQUAL_CAP_BELOW_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, belowFeedback)
			await expect(sidebar.getByText("E2E_EQUAL_CAP_EXACT_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, triggerFeedback)
			await expect(sidebar.getByText("E2E_EQUAL_CAP_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(4)
			expect(
				server.getMockConsumptions("openai-compatible-responses").every((request) => request.contractError === undefined),
			).toBe(true)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Auto compact trigger - absolute cap applies the shared 2K tolerance",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureTriggerBoundary(dlineDir, 1_000_000, 272_000)
		const belowFeedback = "E2E_ABSOLUTE_BELOW_CONTINUE"
		const triggerFeedback = "E2E_ABSOLUTE_TRIGGER_CONTINUE"
		const compactTriggerTokens = 272_000
		// Keep the first complete candidate outside the shared 2K tolerance, then
		// place the second baseline well inside it. The real Provider request delta
		// includes the complete tool-result envelope, not only the feedback text.
		const belowPreviousTokens = compactTriggerTokens - 3_000
		const triggerPreviousTokens = compactTriggerTokens - 1_000
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_absolute_below",
				name: "qna_respond",
				arguments: { response: "E2E_ABSOLUTE_BELOW_READY" },
				usage: { inputTokens: belowPreviousTokens - 100, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_absolute_exact",
				name: "qna_respond",
				arguments: { response: "E2E_ABSOLUTE_EXACT_READY" },
				usage: { inputTokens: triggerPreviousTokens - 100, outputTokens: 100 },
				expectedRequestExcludes: ["The current conversation is rapidly running out of context"],
			},
			{
				type: "tool",
				id: "call_absolute_summary",
				name: "summarize_task",
				arguments: { context: "E2E_ABSOLUTE_TOLERANCE_SUMMARY" },
				expectedRequestIncludes: ["The current conversation is rapidly running out of context"],
				expectedRequestExcludes: [triggerFeedback],
			},
			{
				type: "tool",
				id: "call_absolute_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_ABSOLUTE_TOLERANCE_OK" },
				expectedRequestIncludes: ["E2E_ABSOLUTE_TOLERANCE_SUMMARY", triggerFeedback],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_ABSOLUTE_TRIGGER_TASK")
			await expect(sidebar.getByText("E2E_ABSOLUTE_BELOW_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, belowFeedback)
			await expect(sidebar.getByText("E2E_ABSOLUTE_EXACT_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, triggerFeedback)
			await expect(sidebar.getByText("E2E_ABSOLUTE_TOLERANCE_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(4)
			expect(
				server.getMockConsumptions("openai-compatible-responses").every((request) => request.contractError === undefined),
			).toBe(true)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Auto compact trigger - first over-cap request exposes the local no-turn failure before Provider admission",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureTriggerBoundary(dlineDir, 752_000, 1)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_NO_COMPLETE_TURN_TASK")

			await expect(sidebar.getByText("API Request Failed", { exact: true }).last()).toBeVisible({ timeout: 60_000 })
			await expect(
				sidebar.getByText("No complete logical turn is available for context compaction.", { exact: false }).last(),
			).toBeVisible()
			expect(server.getRequestCount("openai-compatible-responses")).toBe(0)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/No complete logical turn/i])
		} finally {
			await app.close()
		}
	},
)

e2e(
	"OpenAI compaction - iterates until the projected context is below 80 percent",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(240_000)
		await configureResponsesAutoCompaction(dlineDir)
		const turnAMarker = "E2E_ITERATIVE_TURN_A"
		const turnBMarker = "E2E_ITERATIVE_TURN_B"
		const protectedTurnMarker = "E2E_ITERATIVE_PROTECTED_TURN_C"
		const continuationMarker = "E2E_ITERATIVE_CONTINUE"
		const firstSummary = "E2E_ITERATIVE_SUMMARY_ONE covers only turn A."
		const secondSummary = "E2E_ITERATIVE_SUMMARY_TWO cumulatively covers turns A and B."
		const turnAResponse = `${turnAMarker}:${"A".repeat(220_000)}`
		const turnBResponse = `${turnBMarker}:${"B".repeat(220_000)}`
		const protectedTurnResponse = `${protectedTurnMarker}:${"C".repeat(80_000)}`

		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_iterative_turn_a",
				name: "qna_respond",
				arguments: { response: turnAResponse },
				usage: { inputTokens: 20_000, outputTokens: 100 },
				expectedRequestIncludes: ["E2E_ITERATIVE_TASK"],
				matchRequestContract: true,
			},
			{
				type: "tool",
				id: "call_iterative_turn_b",
				name: "qna_respond",
				arguments: { response: turnBResponse },
				usage: { inputTokens: 40_000, outputTokens: 100 },
				expectedRequestIncludes: [turnAMarker, "E2E_ITERATIVE_USER_TURN_B"],
				matchRequestContract: true,
			},
			{
				type: "tool",
				id: "call_iterative_protected_turn_c",
				name: "qna_respond",
				arguments: { response: protectedTurnResponse },
				usage: { inputTokens: 125_000, outputTokens: 100 },
				expectedRequestIncludes: [turnBMarker, "E2E_ITERATIVE_USER_TURN_C"],
				matchRequestContract: true,
			},
			{
				type: "tool",
				id: "call_iterative_summary_one",
				name: "summarize_task",
				arguments: { context: firstSummary },
				usage: { inputTokens: 112_000, outputTokens: 100 },
				expectedRequestIncludes: ["The current conversation is rapidly running out of context", turnAMarker],
				expectedRequestExcludes: [turnBMarker, protectedTurnMarker, continuationMarker, "<environment_details>"],
				matchRequestContract: true,
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
					firstSummary,
					turnBMarker,
				],
				expectedRequestExcludes: [turnAMarker, protectedTurnMarker, continuationMarker, "<environment_details>"],
				matchRequestContract: true,
			},
			{
				type: "tool",
				id: "call_iterative_complete",
				name: "attempt_completion",
				arguments: { result: "E2E_ITERATIVE_OK" },
				expectedRequestIncludes: [secondSummary, protectedTurnMarker, continuationMarker, "<environment_details>"],
				expectedRequestExcludes: [
					"The current conversation is rapidly running out of context",
					firstSummary,
					turnAMarker,
					turnBMarker,
				],
				matchRequestContract: true,
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_ITERATIVE_TASK")
			await expect(sidebar.getByText(turnAMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_ITERATIVE_USER_TURN_B")
			await expect(sidebar.getByText(turnBMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_ITERATIVE_USER_TURN_C")
			await expect(sidebar.getByText(protectedTurnMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, continuationMarker)

			await expect
				.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 })
				.toBeGreaterThanOrEqual(4)
			const firstPass = server.getMockConsumptions("openai-compatible-responses")[3]
			expect(firstPass?.contractError).toBeUndefined()
			expect(firstPass).toMatchObject({ responseType: "tool", toolName: "summarize_task" })

			await expect
				.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 })
				.toBeGreaterThanOrEqual(5)
			const secondPass = server.getMockConsumptions("openai-compatible-responses")[4]
			expect(secondPass?.contractError).toBeUndefined()
			expect(secondPass).toMatchObject({ responseType: "tool", toolName: "summarize_task" })

			await expect(sidebar.getByText("E2E_ITERATIVE_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(6)
			const requests = server.getMockConsumptions("openai-compatible-responses")
			const finalRequest = requests[5]
			expect(finalRequest?.contractError).toBeUndefined()
			expect(finalRequest).toMatchObject({ responseType: "tool", toolName: "attempt_completion" })
			expect(estimateTokens(finalRequest?.requestBody)).toBeLessThan(80_000)
			expect(requests.slice(3).every((request) => request.contractError === undefined)).toBe(true)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

for (const providerCase of ROLLING_MERGE_PROVIDER_CASES) {
	e2e(
		`Context compaction - ${providerCase.label} rolling merge fits a 1M provider into a 272k target without summarizing environment details`,
		async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
			e2e.setTimeout(300_000)
			await configureRollingMergeTarget(dlineDir, providerCase)

			const turnAMarker = "E2E_ROLLING_TURN_A"
			const turnBMarker = "E2E_ROLLING_TURN_B"
			const protectedTurnMarker = "E2E_ROLLING_PROTECTED_TURN_C"
			const continuationMarker = "E2E_ROLLING_CONTINUATION"
			const firstSummary = "E2E_ROLLING_SUMMARY_ONE covers only turn A."
			const secondSummary = "E2E_ROLLING_SUMMARY_TWO cumulatively covers turns A and B."
			const turnAResponse = `${turnAMarker}:${"A".repeat(520_000)}`
			const turnBResponse = `${turnBMarker}:${"B".repeat(520_000)}`
			const protectedTurnResponse = `${protectedTurnMarker}:${"C".repeat(300_000)}`

			server.enqueueResponses(
				providerCase.target,
				{
					type: "tool",
					id: "call_rolling_turn_a",
					name: "qna_respond",
					arguments: { response: turnAResponse },
					usage: { inputTokens: 120_000, outputTokens: 100 },
					expectedRequestIncludes: ["E2E_ROLLING_TASK"],
					matchRequestContract: true,
				},
				{
					type: "tool",
					id: "call_rolling_turn_b",
					name: "qna_respond",
					arguments: { response: turnBResponse },
					usage: { inputTokens: 130_000, outputTokens: 100 },
					expectedRequestIncludes: [turnAMarker, "E2E_ROLLING_USER_TURN_B"],
					matchRequestContract: true,
				},
				{
					type: "tool",
					id: "call_rolling_protected_turn_c",
					name: "qna_respond",
					arguments: { response: protectedTurnResponse },
					usage: { inputTokens: 270_000, outputTokens: 100 },
					expectedRequestIncludes: [turnBMarker, "E2E_ROLLING_USER_TURN_C"],
					matchRequestContract: true,
				},
				{
					type: "tool",
					id: "call_rolling_summary_one",
					name: "summarize_task",
					arguments: { context: firstSummary },
					usage: { inputTokens: 700_000, outputTokens: 100 },
					expectedRequestIncludes: ["The current conversation is rapidly running out of context", turnAMarker],
					expectedRequestExcludes: [turnBMarker, protectedTurnMarker, continuationMarker, "<environment_details>"],
					matchRequestContract: true,
				},
				{
					type: "tool",
					id: "call_rolling_summary_two",
					name: "summarize_task",
					arguments: { context: secondSummary },
					usage: { inputTokens: 217_600, outputTokens: 100 },
					expectedRequestIncludes: [
						"The current conversation is rapidly running out of context",
						firstSummary,
						turnBMarker,
					],
					expectedRequestExcludes: [turnAMarker, protectedTurnMarker, continuationMarker, "<environment_details>"],
					matchRequestContract: true,
				},
				{
					type: "tool",
					id: "call_rolling_complete",
					name: "attempt_completion",
					arguments: { result: "E2E_ROLLING_MERGE_OK" },
					expectedRequestIncludes: [secondSummary, protectedTurnMarker, continuationMarker, "<environment_details>"],
					expectedRequestExcludes: [
						"The current conversation is rapidly running out of context",
						firstSummary,
						turnAMarker,
						turnBMarker,
					],
					matchRequestContract: true,
				},
			)

			const app = await openVSCode(workspaceDir)
			try {
				const sidebar = await openSidebar(app, helper)
				await sendTask(sidebar, "E2E_ROLLING_TASK")
				await expect(sidebar.getByText(turnAMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
				await sendTask(sidebar, "E2E_ROLLING_USER_TURN_B")
				await expect(sidebar.getByText(turnBMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
				await sendTask(sidebar, "E2E_ROLLING_USER_TURN_C")
				await expect(sidebar.getByText(protectedTurnMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
				await sendTask(sidebar, continuationMarker)

				await expect
					.poll(() => server.getRequestCount(providerCase.target), { timeout: 60_000 })
					.toBeGreaterThanOrEqual(4)
				const firstPass = server.getMockConsumptions(providerCase.target)[3]
				expect(firstPass?.contractError).toBeUndefined()
				expect(firstPass).toMatchObject({ responseType: "tool", toolName: "summarize_task" })

				await expect
					.poll(() => server.getRequestCount(providerCase.target), { timeout: 60_000 })
					.toBeGreaterThanOrEqual(5)
				const secondPass = server.getMockConsumptions(providerCase.target)[4]
				expect(secondPass?.contractError).toBeUndefined()
				expect(secondPass).toMatchObject({ responseType: "tool", toolName: "summarize_task" })

				await expect(sidebar.getByText("E2E_ROLLING_MERGE_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
				await expect.poll(() => server.getRequestCount(providerCase.target)).toBe(6)
				const requests = server.getMockConsumptions(providerCase.target)
				const finalRequest = requests[5]
				expect(finalRequest?.contractError).toBeUndefined()
				expect(finalRequest).toMatchObject({ responseType: "tool", toolName: "attempt_completion" })
				expect(estimateTokens(finalRequest?.requestBody)).toBeLessThan(217_600)
				expect(requests.slice(3).every((request) => request.contractError === undefined)).toBe(true)
				await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
			} finally {
				await app.close()
			}
		},
	)
}

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
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(120_000)
		await configureResponsesContextPressure(dlineDir)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_pressure_boundary_ready",
				name: "qna_respond",
				arguments: { response: "E2E_PRESSURE_BOUNDARY_READY" },
				usage: { inputTokens: 89_612, outputTokens: 100 },
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
			await expect
				.poll(async () => E2ETestHelper.readDlineOutput(userDataDir), { timeout: 10_000 })
				.toContain('"projectedUsageTokens":90000')
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

e2e(
	"Context compaction - hidden Pass keeps the reduced output cap when a normal retry follows the OpenAI max-output replay",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureReducedCapScenario(dlineDir)
		const turnAMarker = "E2E_REDUCED_CAP_TURN_A"
		const turnBMarker = "E2E_REDUCED_CAP_TURN_B"
		const damagedSummary = "E2E_REDUCED_CAP_DAMAGED_SUMMARY"
		const recoveredSummary = "E2E_REDUCED_CAP_RECOVERED_SUMMARY"
		const serializedArguments = JSON.stringify({ context: damagedSummary })
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_reduced_cap_turn_a",
				name: "qna_respond",
				arguments: { response: `${turnAMarker}:${"A".repeat(20_000)}` },
				usage: { inputTokens: 120_000, outputTokens: 100 },
				matchRequestContract: true,
			},
			{
				type: "tool",
				id: "call_reduced_cap_turn_b",
				name: "qna_respond",
				arguments: { response: `${turnBMarker}:${"B".repeat(20_000)}` },
				usage: { inputTokens: 300_000, outputTokens: 100 },
				matchRequestContract: true,
			},
			{
				type: "truncated-tool",
				id: "call_reduced_cap_max_output",
				name: "summarize_task",
				arguments: { context: damagedSummary },
				truncateAfter: serializedArguments.length - 1,
				expectedRequestIncludes: ["The current conversation is rapidly running out of context"],
				usage: { inputTokens: 500_000, outputTokens: 100 },
			},
			{
				type: "error",
				status: 400,
				message: "E2E_REDUCED_CAP_NETWORK_FAILURE",
			},
			{
				type: "tool",
				id: "call_reduced_cap_recovered",
				name: "summarize_task",
				arguments: { context: recoveredSummary },
				expectedRequestIncludes: ["The current conversation is rapidly running out of context"],
				usage: { inputTokens: 400_000, outputTokens: 100 },
			},
			{
				type: "message",
				text: "E2E_REDUCED_CAP_OK",
				expectedRequestIncludes: [recoveredSummary, "E2E_REDUCED_CAP_CONTINUE"],
				usage: { inputTokens: 100_000, outputTokens: 100 },
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_REDUCED_CAP_TASK")
			await expect(sidebar.getByText(turnAMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_REDUCED_CAP_USER_TURN_B")
			await expect(sidebar.getByText(turnBMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_REDUCED_CAP_CONTINUE")

			// The retried hidden Pass is request #5: attempt 0 (truncated) -> max-output replay ->
			// normal retry after the replay -> successful summary. Assert the cap sequence there.
			await expect
				.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 120_000 })
				.toBeGreaterThanOrEqual(5)
			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requests[2].responseType).toBe("truncated-tool")
			expect(requests[3].responseType).toBe("error")
			expect(requests[4]).toMatchObject({ responseType: "tool", toolName: "summarize_task" })
			const initialPassBody = requests[2].requestBody as { max_output_tokens?: unknown }
			const replayBody = requests[3].requestBody as { max_output_tokens?: unknown }
			const retryBody = requests[4].requestBody as { max_output_tokens?: unknown }
			expect(typeof initialPassBody.max_output_tokens).toBe("number")
			expect(typeof replayBody.max_output_tokens).toBe("number")
			expect(typeof retryBody.max_output_tokens).toBe("number")
			expect(replayBody.max_output_tokens).toBe(Math.floor((initialPassBody.max_output_tokens as number) * 0.9))
			// D1 contract: a normal retry after the OpenAI max-output replay must keep the reduced cap.
			expect(retryBody.max_output_tokens).toBe(replayBody.max_output_tokens)
			expect(JSON.stringify(requests[4].requestBody)).not.toContain(damagedSummary)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Context compaction - automatic failure does not truncate until Force Truncate is confirmed",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureReducedCapScenario(dlineDir)
		const turnAMarker = "E2E_FORCE_TRUNCATE_TURN_A"
		const turnBMarker = "E2E_FORCE_TRUNCATE_TURN_B"
		const middleMarker = "E2E_FORCE_TRUNCATE_MIDDLE"
		const continueMarker = "E2E_FORCE_TRUNCATE_CONTINUE"
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_force_truncate_turn_a",
				name: "qna_respond",
				arguments: { response: `${turnAMarker}:${"A".repeat(20_000)}` },
				usage: { inputTokens: 120_000, outputTokens: 100 },
				matchRequestContract: true,
			},
			{
				type: "tool",
				id: "call_force_truncate_turn_b",
				name: "qna_respond",
				arguments: { response: `${turnBMarker}:${"B".repeat(20_000)}` },
				usage: { inputTokens: 300_000, outputTokens: 100 },
				matchRequestContract: true,
			},
			{ type: "error", status: 400, message: "E2E_FORCE_TRUNCATE_COMPACTION_ATTEMPT_0" },
			{ type: "error", status: 400, message: "E2E_FORCE_TRUNCATE_COMPACTION_RETRY_1" },
			{ type: "error", status: 400, message: "E2E_FORCE_TRUNCATE_COMPACTION_RETRY_2" },
			{ type: "error", status: 400, message: "E2E_FORCE_TRUNCATE_COMPACTION_RETRY_3" },
			{
				type: "tool",
				id: "call_force_truncate_recovered",
				name: "attempt_completion",
				arguments: { result: "E2E_FORCE_TRUNCATE_RECOVERED" },
				expectedRequestIncludes: [
					continueMarker,
					"[NOTE] Some previous conversation history with the user has been removed",
				],
				expectedRequestExcludes: [middleMarker],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_FORCE_TRUNCATE_TASK")
			await expect(sidebar.getByText(turnAMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, middleMarker)
			await expect(sidebar.getByText(turnBMarker, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, continueMarker)

			await expect(sidebar.getByText("Automatic retry stopped", { exact: false }).last()).toBeVisible({
				timeout: 120_000,
			})
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(6)
			const failedRequests = server.getMockConsumptions("openai-compatible-responses")
			expect(failedRequests.slice(2).every((request) => request.responseType === "error")).toBe(true)
			expect(JSON.stringify(failedRequests[5].requestBody)).not.toContain(
				"[NOTE] Some previous conversation history with the user has been removed",
			)

			const expandTaskHeader = sidebar.getByLabel("Expand task header")
			if (await expandTaskHeader.isVisible()) await expandTaskHeader.click()
			const moreContextActions = sidebar.getByRole("button", { name: "More context actions" })
			await expect(moreContextActions).toBeVisible()
			await moreContextActions.click()
			const forceTruncateMenuItem = sidebar.getByRole("button", {
				name: "Force truncate conversation history",
				exact: true,
			})
			await expect(forceTruncateMenuItem).toBeVisible()
			await forceTruncateMenuItem.click()
			await expect(sidebar.getByText("Force truncate conversation history?", { exact: true })).toBeVisible()
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(6)
			const forceTruncateConfirmation = sidebar.getByLabel("Type TRUNCATE to confirm")
			await forceTruncateConfirmation.fill("TRUNCATE")
			await sidebar.getByText("Force truncate conversation history", { exact: true }).last().click()
			await expect(sidebar.getByRole("dialog")).not.toBeVisible()
			await sidebar.getByRole("button", { name: "Retry", exact: true }).last().click()

			await expect(sidebar.getByText("E2E_FORCE_TRUNCATE_RECOVERED", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(7)
			const recoveredRequest = server.getMockConsumptions("openai-compatible-responses")[6]
			expect(recoveredRequest.contractError).toBeUndefined()
			expect(recoveredRequest.responseType).toBe("tool")
			expect(JSON.stringify(recoveredRequest.requestBody)).toContain(
				"[NOTE] Some previous conversation history with the user has been removed",
			)
			expect(JSON.stringify(recoveredRequest.requestBody)).not.toContain(middleMarker)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/context window/i])
		} finally {
			await app.close()
		}
	},
)
