import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Frame } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

interface StoredProfile {
	name: string
	modelId?: string
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

function estimateTokens(value: unknown): number {
	return Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4))
}

const TRUNCATED_SUMMARY_MARKER = "E2E_CHAT_COMPACTION_TRUNCATED_RESPONSE_SHOULD_NOT_SURVIVE"

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

async function configureChatAutoCompaction(dlineDir: string): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAi)
	if (!profile?.openai?.capabilities) throw new Error("Missing configurable OpenAI Chat E2E profile")
	profile.modelId = "gpt-5.6-sol"
	profile.openai.capabilities.contextWindow = 131_072
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	await writeFile(
		settingsPath(dlineDir),
		`${JSON.stringify(
			{
				...settings,
				actModeProfile: E2E_PROFILE_NAMES.mockOpenAi,
				planModeProfile: E2E_PROFILE_NAMES.mockOpenAi,
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
				text: "<thinking>E2E summary analysis</thinking><summarize_task><context>E2E_CHAT_COMPACTION_SUMMARY preserves the task and latest user request.</context></summarize_task>",
				expectedRequestIncludes: [
					"The current conversation is rapidly running out of context",
					"# Compaction Window Budget",
					"Estimated available context-window remainder:",
					"Hard limit for the complete response:",
					"Recommended total response range:",
					"E2E_CHAT_COMPACTION_CONTINUE",
				],
				expectedRequestExcludes: ["<compaction_window_budget />"],
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
			expect(JSON.stringify(finalBody)).toContain("E2E_CHAT_COMPACTION_SUMMARY")

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
