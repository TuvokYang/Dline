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
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
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
				type: "tool",
				id: "call_chat_compaction_summary",
				name: "summarize_task",
				arguments: { context: "E2E_CHAT_COMPACTION_SUMMARY preserves the task and latest user request." },
				expectedRequestIncludes: ["The current conversation is rapidly running out of context"],
				expectedRequestExcludes: ["E2E_CHAT_COMPACTION_CONTINUE"],
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

			const finalBody = requests[2].requestBody as {
				messages?: Array<{ role?: string; tool_call_id?: string; content?: unknown }>
			}
			const orphanSummaryOutputs = (finalBody.messages ?? []).filter(
				(message) => message.role === "tool" && message.tool_call_id === "call_chat_compaction_summary",
			)
			expect(orphanSummaryOutputs).toEqual([])
			expect(JSON.stringify(finalBody)).toContain("E2E_CHAT_COMPACTION_SUMMARY")

			for (const request of requests) {
				expect(request.requestBody?.prompt_cache_key).toBeTruthy()
				expect(request.requestBody?.prompt_cache_options).toEqual({ mode: "explicit" })
			}
			expect(JSON.stringify(requests[0].requestBody)).toContain("prompt_cache_breakpoint")
			expect(JSON.stringify(requests[2].requestBody)).toContain("prompt_cache_breakpoint")
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)
