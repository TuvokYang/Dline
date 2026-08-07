import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { expect, type Frame } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import type { MockApiConsumption } from "./fixtures/server"
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

const COMPACT_INSTRUCTION_MARKER = "The current conversation is rapidly running out of context"
const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")
const settingsPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "settings.json")

async function configureManualCompact(dlineDir: string): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!profile?.openai?.capabilities) throw new Error("Missing configurable OpenAI Responses E2E profile")
	profile.modelId = "gpt-5.4-mini"
	profile.openai.capabilities.contextWindow = 131_072
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

function requestToolNames(consumption: MockApiConsumption): string[] {
	const body = consumption.requestBody as {
		tools?: Array<{ name?: string; function?: { name?: string } }>
	}
	return (body.tools ?? [])
		.map((tool) => tool.name ?? tool.function?.name)
		.filter((name): name is string => typeof name === "string")
}

/**
 * Extract Responses request items that reference a tool identity: function_call
 * (pairing source) and function_call_output (pairing consumer).
 */
function extractResponsesToolItems(body: unknown): {
	calls: string[]
	outputs: string[]
} {
	const input = (body as { input?: unknown[] })?.input ?? []
	const calls: string[] = []
	const outputs: string[] = []
	for (const item of input) {
		if (typeof item !== "object" || item === null) continue
		const record = item as { type?: unknown; call_id?: unknown }
		if (record.type === "function_call" && typeof record.call_id === "string") {
			calls.push(record.call_id)
		}
		if (record.type === "function_call_output" && typeof record.call_id === "string") {
			outputs.push(record.call_id)
		}
	}
	return { calls, outputs }
}

/** Every tool output must reference a call id that was actually declared. */
function assertNoOrphanToolOutputs(consumption: MockApiConsumption): void {
	const body = consumption.requestBody
	const { calls, outputs } = extractResponsesToolItems(body)
	const callIdSet = new Set(calls)
	const orphans = outputs.filter((output) => !callIdSet.has(output))
	expect(orphans).toEqual([])
	// Internal Dline function identities must never leak into a provider request.
	expect(JSON.stringify(body)).not.toContain("call_dline_")
	expect(JSON.stringify(body)).not.toContain("dline_function_")
}

e2e(
	"Manual compaction - no orphaned function_call_output leaks into the request after task compaction",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureManualCompact(dlineDir)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_condense_orphan_ready",
				name: "qna_respond",
				arguments: { response: "E2E_CONDENSE_ORPHAN_READY" },
				usage: { inputTokens: 80_000, outputTokens: 100 },
			},
			{
				type: "message",
				text: "<thinking>E2E orphan-safe summary</thinking><summarize_task><context>E2E_CONDENSE_ORPHAN_SUMMARY preserves the task and current intent.</context></summarize_task>",
				expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER, "E2E_CONDENSE_ORPHAN_TASK"],
				expectedRequestExcludes: ["__dline_mode_switch_compact__", "/compact"],
			},
			{
				type: "tool",
				id: "call_condense_orphan_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_CONDENSE_ORPHAN_DONE" },
				expectedRequestIncludes: ["E2E_CONDENSE_ORPHAN_SUMMARY"],
				expectedRequestExcludes: ["__dline_mode_switch_compact__", COMPACT_INSTRUCTION_MARKER],
				expectedToolResults: [
					{ callId: "call_condense_orphan_ready", contentIncludes: "Mode switch context compaction requested." },
				],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const sidebar = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_CONDENSE_ORPHAN_TASK")
			await expect(sidebar.getByText("E2E_CONDENSE_ORPHAN_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			// Trigger manual compaction through the task header control.
			const expandTaskHeader = sidebar.getByLabel("Expand task header")
			if (await expandTaskHeader.isVisible()) await expandTaskHeader.click()
			const compactButton = sidebar.locator("button").filter({
				has: sidebar.locator("svg.lucide-fold-vertical"),
			})
			await expect(compactButton).toBeVisible()
			await compactButton.click()
			await expect(sidebar.getByText("Compact the current task?", { exact: true })).toBeVisible()
			await sidebar.getByTitle("Yes, compact the task").click()

			await expect(sidebar.getByText("E2E_CONDENSE_ORPHAN_DONE", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(3)

			await expect(sidebar.getByText("Dline is condensing the conversation:", { exact: true }).last()).toBeVisible()
			await expect(sidebar.getByText("E2E_CONDENSE_ORPHAN_SUMMARY", { exact: false }).last()).toBeVisible()

			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requests[1]).toMatchObject({ responseType: "message" })
			expect(requestToolNames(requests[1])).toEqual(requestToolNames(requests[0]))
			expect(requestToolNames(requests[1])).not.toContain("summarize_task")
			for (const request of requests) {
				expect(request.contractError).toBeUndefined()
				// The post-condense request must not carry orphaned tool outputs.
				assertNoOrphanToolOutputs(request)
			}
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)
