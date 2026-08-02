import { readdir, readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
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

const COMPACT_SIGNAL = "__dline_mode_switch_compact__"
const COMPACT_INSTRUCTION_MARKER = '<explicit_instructions type="summarize_task">'
const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")
const settingsPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "settings.json")

async function configureModeProfiles(
	dlineDir: string,
	options: {
		actProfile: string
		actContextWindow: number
		planProfile: string
		planContextWindow: number
	},
): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	for (const [name, contextWindow] of [
		[options.actProfile, options.actContextWindow],
		[options.planProfile, options.planContextWindow],
	] as const) {
		const profile = profiles.find((candidate) => candidate.name === name)
		if (!profile?.openai?.capabilities) throw new Error(`Missing configurable E2E profile: ${name}`)
		profile.openai.capabilities.contextWindow = contextWindow
	}
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	await writeFile(
		settingsPath(dlineDir),
		`${JSON.stringify(
			{
				...settings,
				planActSeparateModelsSetting: true,
				actModeProfile: options.actProfile,
				planModeProfile: options.planProfile,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
}

async function configureAutoCompact(dlineDir: string, enabled: boolean): Promise<void> {
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
				useAutoCondense: enabled,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
}

async function openSidebar(
	app: ElectronApplication,
	helper: E2ETestHelper,
): Promise<{ page: Awaited<ReturnType<ElectronApplication["firstWindow"]>>; sidebar: Frame }> {
	const page = await app.firstWindow()
	await E2ETestHelper.openClineSidebar(page)
	const sidebar = await helper.getSidebar(page)
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
	await helper.signin(sidebar)
	return { page, sidebar }
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled()
	await input.fill(text)
	await input.press("Enter")
	await expect(input).toHaveValue("")
	await expect(sidebar.getByText(text, { exact: true }).last()).toBeVisible()
}

async function startInputValueObserver(sidebar: Frame): Promise<void> {
	await sidebar.evaluate(() => {
		const root = globalThis as typeof globalThis & {
			__dlineModeSwitchInputObserver?: { timer: number; values: string[] }
		}
		if (root.__dlineModeSwitchInputObserver) window.clearInterval(root.__dlineModeSwitchInputObserver.timer)
		const values: string[] = []
		const read = () => {
			const input = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]')
			if (input) values.push(input.value)
		}
		read()
		const timer = window.setInterval(read, 5)
		root.__dlineModeSwitchInputObserver = { timer, values }
	})
}

async function stopInputValueObserver(sidebar: Frame): Promise<string[]> {
	return sidebar.evaluate(() => {
		const root = globalThis as typeof globalThis & {
			__dlineModeSwitchInputObserver?: { timer: number; values: string[] }
		}
		const observer = root.__dlineModeSwitchInputObserver
		if (!observer) return []
		window.clearInterval(observer.timer)
		delete root.__dlineModeSwitchInputObserver
		return [...observer.values]
	})
}

function requestToolNames(consumption: MockApiConsumption): string[] {
	const body = consumption.requestBody as {
		tools?: Array<{ name?: string; function?: { name?: string } }>
	}
	return (body.tools ?? [])
		.map((tool) => tool.name ?? tool.function?.name)
		.filter((name): name is string => typeof name === "string")
}

async function expectPlanMode(sidebar: Frame): Promise<void> {
	await expect(sidebar.getByRole("switch", { name: "Plan" })).toHaveAttribute("aria-checked", "true", {
		timeout: 60_000,
	})
}

async function expectNoCompactionEcho(sidebar: Frame, hiddenMarkers: readonly string[] = []): Promise<void> {
	const visibleText = await sidebar.locator("body").innerText()
	expect(visibleText).not.toContain(COMPACT_SIGNAL)
	expect(visibleText).not.toContain("The current conversation is rapidly running out of context")
	for (const marker of hiddenMarkers) expect(visibleText).not.toContain(marker)
}

async function taskDirectoryIds(dlineDocsDir: string): Promise<string[]> {
	try {
		return (await readdir(path.join(dlineDocsDir, "tasks"), { withFileTypes: true }))
			.filter((entry) => entry.isDirectory())
			.map((entry) => entry.name)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
		throw error
	}
}

e2e(
	"Mode switch context - welcome draft stays local and does not create a task",
	async ({ dlineDocsDir, helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(90_000)
		await helper.signin(sidebar)

		const input = sidebar.getByTestId("chat-input")
		await expect(sidebar.getByRole("switch", { name: "Act" })).toHaveAttribute("aria-checked", "true")
		await input.fill("E2E_WELCOME_MODE_DRAFT")
		await sidebar.getByTestId("mode-switch").evaluate((element) => element.click())

		await expectPlanMode(sidebar)
		await expect(input).toHaveValue("E2E_WELCOME_MODE_DRAFT")
		expect(await taskDirectoryIds(dlineDocsDir)).toEqual([])
		expect(server.getRequestCount("openai-compatible-chat")).toBe(0)
		expect(server.getRequestCount("openai-compatible-responses")).toBe(0)
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Mode switch context - returning to Welcome cannot submit a draft until Send is clicked",
	async ({ dlineDocsDir, helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(150_000)
		await helper.signin(sidebar)
		server.enqueueResponses(
			"openai-compatible-chat",
			{
				type: "tool",
				id: "call_welcome_after_close_ready",
				name: "attempt_completion",
				arguments: { result: "E2E_WELCOME_AFTER_CLOSE_READY" },
			},
			{
				type: "tool",
				id: "call_welcome_after_close_explicit_send",
				name: "make_plan",
				arguments: { response: "E2E_WELCOME_AFTER_CLOSE_SENT", needs_more_exploration: false },
				expectedRequestIncludes: ["E2E_WELCOME_AFTER_CLOSE_DRAFT", "PLAN MODE"],
			},
		)

		await sendTask(sidebar, "E2E_WELCOME_AFTER_CLOSE_TASK")
		await expect(sidebar.getByText("E2E_WELCOME_AFTER_CLOSE_READY", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(1)
		expect(await taskDirectoryIds(dlineDocsDir)).toHaveLength(1)

		await sidebar.getByRole("button", { name: "Close Task", exact: true }).click()
		const input = sidebar.getByTestId("chat-input")
		await expect(input).toHaveAttribute("placeholder", "Type your task here...")
		await E2ETestHelper.dismissWhatsNewModal(sidebar)
		await input.fill("E2E_WELCOME_AFTER_CLOSE_DRAFT")
		await sidebar.getByTestId("mode-switch").evaluate((element) => element.click())

		await expectPlanMode(sidebar)
		await expect(input).toHaveValue("E2E_WELCOME_AFTER_CLOSE_DRAFT")
		await sidebar.page().waitForTimeout(1_000)
		expect(await taskDirectoryIds(dlineDocsDir)).toHaveLength(1)
		expect(server.getRequestCount("openai-compatible-chat")).toBe(1)

		await sidebar.getByTestId("send-button").click()
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_WELCOME_AFTER_CLOSE_SENT", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(2)
		expect(await taskDirectoryIds(dlineDocsDir)).toHaveLength(2)
		expect(server.getMockConsumptions("openai-compatible-chat")[1].contractError).toBeUndefined()
		await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
	},
)

e2e(
	"Mode switch context - same profile switches directly without compaction",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(150_000)
		await configureModeProfiles(dlineDir, {
			actProfile: E2E_PROFILE_NAMES.mockOpenAi,
			actContextWindow: 131_072,
			planProfile: E2E_PROFILE_NAMES.mockOpenAi,
			planContextWindow: 131_072,
		})
		server.enqueueResponses(
			"openai-compatible-chat",
			{
				type: "tool",
				id: "call_same_profile_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_SAME_PROFILE_READY" },
				usage: { inputTokens: 128_000, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_same_profile_plan",
				name: "make_plan",
				arguments: { response: "E2E_SAME_PROFILE_PLAN_OK", needs_more_exploration: false },
				expectedRequestIncludes: ["E2E_SAME_PROFILE_PLAN_DRAFT", "PLAN MODE"],
				expectedRequestExcludes: [COMPACT_SIGNAL],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_SAME_PROFILE_TASK")
			await expect(sidebar.getByText("E2E_SAME_PROFILE_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const input = sidebar.getByTestId("chat-input")
			await input.fill("E2E_SAME_PROFILE_PLAN_DRAFT")
			await startInputValueObserver(sidebar)
			await sidebar.getByTestId("mode-switch").evaluate((element) => element.click())
			await expectPlanMode(sidebar)
			await expect(sidebar.getByRole("heading", { name: "Switch to a smaller context window?" })).toHaveCount(0)
			await expect(sidebar.getByText("E2E_SAME_PROFILE_PLAN_OK", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			const observedValues = await stopInputValueObserver(sidebar)
			expect(observedValues).not.toContain(COMPACT_SIGNAL)
			await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(2)
			const planRequest = server.getMockConsumptions("openai-compatible-chat")[1]
			expect(requestToolNames(planRequest)).toContain("make_plan")
			expect(requestToolNames(planRequest)).not.toContain("act_mode_respond")
			expect(planRequest.contractError).toBeUndefined()
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Mode switch context - a smaller target switches directly when current usage fits",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(150_000)
		await configureModeProfiles(dlineDir, {
			actProfile: E2E_PROFILE_NAMES.mockOpenAiResponses,
			actContextWindow: 272_000,
			planProfile: E2E_PROFILE_NAMES.mockOpenAi,
			planContextWindow: 131_072,
		})
		server.enqueueResponses("openai-compatible-responses", {
			type: "tool",
			id: "call_smaller_fits_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_SMALLER_FITS_READY" },
			usage: { inputTokens: 50_000, outputTokens: 100 },
		})
		server.enqueueResponses("openai-compatible-chat", {
			type: "tool",
			id: "call_smaller_fits_plan",
			name: "make_plan",
			arguments: { response: "E2E_SMALLER_FITS_PLAN_OK", needs_more_exploration: false },
			expectedRequestIncludes: ["E2E_SMALLER_FITS_PLAN_DRAFT", "PLAN MODE"],
			expectedRequestExcludes: [COMPACT_SIGNAL, COMPACT_INSTRUCTION_MARKER],
		})

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_SMALLER_FITS_TASK")
			await expect(sidebar.getByText("E2E_SMALLER_FITS_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })

			await sidebar.getByTestId("chat-input").fill("E2E_SMALLER_FITS_PLAN_DRAFT")
			await sidebar.getByTestId("mode-switch").evaluate((element) => element.click())
			await expectPlanMode(sidebar)
			await expect(sidebar.getByRole("heading", { name: "Switch to a smaller context window?" })).toHaveCount(0)
			await expect(sidebar.getByText("E2E_SMALLER_FITS_PLAN_OK", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(1)
			await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(1)
			const targetRequest = server.getMockConsumptions("openai-compatible-chat")[0]
			expect(requestToolNames(targetRequest)).not.toEqual(["summarize_task"])
			expect(targetRequest.contractError).toBeUndefined()
			await expectNoCompactionEcho(sidebar)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Mode switch context - cancelling required compaction keeps the source mode and draft",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(150_000)
		await configureModeProfiles(dlineDir, {
			actProfile: E2E_PROFILE_NAMES.mockOpenAiResponses,
			actContextWindow: 272_000,
			planProfile: E2E_PROFILE_NAMES.mockOpenAi,
			planContextWindow: 131_072,
		})
		server.enqueueResponses("openai-compatible-responses", {
			type: "tool",
			id: "call_cancel_compaction_completion",
			name: "attempt_completion",
			arguments: { result: "E2E_CANCEL_COMPACTION_READY" },
			usage: { inputTokens: 125_000, outputTokens: 100 },
		})

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_CANCEL_COMPACTION_TASK")
			await expect(sidebar.getByText("E2E_CANCEL_COMPACTION_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const input = sidebar.getByTestId("chat-input")
			await input.fill("E2E_CANCEL_COMPACTION_DRAFT")
			await sidebar.getByTestId("mode-switch").evaluate((element) => element.click())
			const dialog = sidebar.getByRole("dialog")
			await expect(dialog.getByRole("heading", { name: "Switch to a smaller context window?" })).toBeVisible()
			await dialog.getByRole("button", { name: "Cancel" }).click()

			await expect(dialog).toHaveCount(0)
			await expect(sidebar.getByRole("switch", { name: "Act" })).toHaveAttribute("aria-checked", "true")
			await expect(sidebar.getByRole("switch", { name: "Plan" })).toHaveAttribute("aria-checked", "false")
			await expect(input).toHaveValue("E2E_CANCEL_COMPACTION_DRAFT")
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(1)
			await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(0)
			await expectNoCompactionEcho(sidebar)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Mode switch context - smaller target confirms, compacts, and continues with the target mode",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureModeProfiles(dlineDir, {
			actProfile: E2E_PROFILE_NAMES.mockOpenAiResponses,
			actContextWindow: 272_000,
			planProfile: E2E_PROFILE_NAMES.mockOpenAi,
			planContextWindow: 131_072,
		})
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_smaller_target_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_SMALLER_TARGET_READY" },
				usage: { inputTokens: 125_000, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_smaller_target_summary",
				name: "summarize_task",
				arguments: {
					context: "E2E_MODE_SWITCH_SUMMARY preserves E2E_SMALLER_TARGET_TASK and the pending plan draft.",
				},
				expectedRequestExcludes: [COMPACT_SIGNAL, "E2E_SMALLER_TARGET_PLAN_DRAFT"],
			},
		)
		server.enqueueResponses("openai-compatible-chat", {
			type: "tool",
			id: "call_smaller_target_plan",
			name: "make_plan",
			arguments: { response: "E2E_SMALLER_TARGET_PLAN_OK", needs_more_exploration: false },
			expectedRequestIncludes: ["E2E_MODE_SWITCH_SUMMARY", "E2E_SMALLER_TARGET_PLAN_DRAFT", "PLAN MODE"],
			expectedRequestExcludes: [COMPACT_SIGNAL],
		})

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_SMALLER_TARGET_TASK")
			await expect(sidebar.getByText("E2E_SMALLER_TARGET_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const input = sidebar.getByTestId("chat-input")
			await input.fill("E2E_SMALLER_TARGET_PLAN_DRAFT")
			await startInputValueObserver(sidebar)
			await sidebar.getByTestId("mode-switch").evaluate((element) => element.click())
			const dialog = sidebar.getByRole("dialog")
			await expect(dialog.getByRole("heading", { name: "Switch to a smaller context window?" })).toBeVisible()
			await expect(input).toHaveValue("E2E_SMALLER_TARGET_PLAN_DRAFT")
			await expect(sidebar.getByRole("switch", { name: "Act" })).toHaveAttribute("aria-checked", "true")
			await dialog.getByRole("button", { name: "Compact & Switch" }).click()

			await expectPlanMode(sidebar)
			await expect(sidebar.getByText("E2E_SMALLER_TARGET_PLAN_OK", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			const observedValues = await stopInputValueObserver(sidebar)
			expect(observedValues).not.toContain(COMPACT_SIGNAL)
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(2)
			await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(1)
			const summaryRequest = server.getMockConsumptions("openai-compatible-responses")[1]
			expect(requestToolNames(summaryRequest)).toEqual(["summarize_task"])
			expect(summaryRequest.contractError).toBeUndefined()
			const targetRequest = server.getMockConsumptions("openai-compatible-chat")[0]
			expect(requestToolNames(targetRequest)).toContain("make_plan")
			expect(requestToolNames(targetRequest)).not.toContain("act_mode_respond")
			expect(requestToolNames(targetRequest)).not.toEqual(["summarize_task"])
			expect(targetRequest.contractError).toBeUndefined()
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Mode switch context - an over-limit summary truncates safely and retries before switching",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(210_000)
		await configureModeProfiles(dlineDir, {
			actProfile: E2E_PROFILE_NAMES.mockOpenAiResponses,
			actContextWindow: 272_000,
			planProfile: E2E_PROFILE_NAMES.mockOpenAi,
			planContextWindow: 131_072,
		})
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_over_limit_round_one",
				name: "qna_respond",
				arguments: { response: "E2E_OVER_LIMIT_ROUND_ONE" },
			},
			{
				type: "tool",
				id: "call_over_limit_middle_one",
				name: "qna_respond",
				arguments: { response: "E2E_OVER_LIMIT_MIDDLE_ONE_RESPONSE" },
			},
			{
				type: "tool",
				id: "call_over_limit_middle_two",
				name: "qna_respond",
				arguments: { response: "E2E_OVER_LIMIT_MIDDLE_TWO_RESPONSE" },
			},
			{
				type: "tool",
				id: "call_over_limit_late_turn",
				name: "qna_respond",
				arguments: { response: "E2E_OVER_LIMIT_LATE_RESPONSE" },
				usage: { inputTokens: 299_000, outputTokens: 1_000 },
				expectedRequestIncludes: ["E2E_OVER_LIMIT_LATE_TURN"],
			},
			{
				type: "error",
				status: 400,
				code: "context_length_exceeded",
				message: "Maximum context length is 272000 tokens; this request contains 300000 tokens.",
				requestId: "req_mode_switch_context_limit",
			},
			{
				type: "tool",
				id: "call_over_limit_summary",
				name: "summarize_task",
				arguments: {
					context: "E2E_OVER_LIMIT_SUMMARY preserves E2E_OVER_LIMIT_TASK and E2E_OVER_LIMIT_LATE_TURN.",
				},
				expectedRequestIncludes: ["E2E_OVER_LIMIT_TASK", "E2E_OVER_LIMIT_LATE_TURN"],
				expectedRequestExcludes: [
					COMPACT_SIGNAL,
					"E2E_OVER_LIMIT_PLAN_DRAFT",
					"E2E_OVER_LIMIT_MIDDLE_ONE",
					"E2E_OVER_LIMIT_MIDDLE_TWO",
				],
			},
		)
		server.enqueueResponses("openai-compatible-chat", {
			type: "tool",
			id: "call_over_limit_plan",
			name: "make_plan",
			arguments: { response: "E2E_OVER_LIMIT_PLAN_OK", needs_more_exploration: false },
			expectedRequestIncludes: [
				"E2E_OVER_LIMIT_SUMMARY",
				"E2E_OVER_LIMIT_LATE_TURN",
				"E2E_OVER_LIMIT_PLAN_DRAFT",
				"PLAN MODE",
			],
			expectedRequestExcludes: [COMPACT_SIGNAL],
		})

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_OVER_LIMIT_TASK")
			await expect(sidebar.getByText("E2E_OVER_LIMIT_ROUND_ONE", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_OVER_LIMIT_MIDDLE_ONE")
			await expect(sidebar.getByText("E2E_OVER_LIMIT_MIDDLE_ONE_RESPONSE", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_OVER_LIMIT_MIDDLE_TWO")
			await expect(sidebar.getByText("E2E_OVER_LIMIT_MIDDLE_TWO_RESPONSE", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_OVER_LIMIT_LATE_TURN")
			await expect(sidebar.getByText("E2E_OVER_LIMIT_LATE_RESPONSE", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const input = sidebar.getByTestId("chat-input")
			await input.fill("E2E_OVER_LIMIT_PLAN_DRAFT")
			await startInputValueObserver(sidebar)
			await sidebar.getByTestId("mode-switch").evaluate((element) => element.click())
			const dialog = sidebar.getByRole("dialog")
			await expect(dialog.getByRole("heading", { name: "Switch to a smaller context window?" })).toBeVisible()
			await dialog.getByRole("button", { name: "Compact & Switch" }).click()

			await expectPlanMode(sidebar)
			await expect(sidebar.getByText("E2E_OVER_LIMIT_PLAN_OK", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			const observedValues = await stopInputValueObserver(sidebar)
			expect(observedValues).not.toContain(COMPACT_SIGNAL)
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(6)
			await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(1)
			const sourceRequests = server.getMockConsumptions("openai-compatible-responses")
			const firstSummary = sourceRequests[4]
			const retriedSummary = sourceRequests[5]
			for (const request of [firstSummary, retriedSummary]) {
				const requestText = JSON.stringify(request.requestBody)
				expect(requestToolNames(request)).toEqual(["summarize_task"])
				expect(requestText).toContain("E2E_OVER_LIMIT_TASK")
				expect(requestText).toContain("E2E_OVER_LIMIT_LATE_TURN")
				expect(requestText).not.toContain("E2E_OVER_LIMIT_MIDDLE_ONE")
				expect(requestText).not.toContain("E2E_OVER_LIMIT_MIDDLE_TWO")
			}
			expect(requestToolNames(retriedSummary)).toEqual(["summarize_task"])
			expect(retriedSummary.contractError).toBeUndefined()
			expect(sidebar.getByText("E2E_OVER_LIMIT_TASK", { exact: true }).first()).toBeVisible()
			await expectNoCompactionEcho(sidebar, ["E2E_OVER_LIMIT_SUMMARY"])
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/context length/i])
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Automatic compaction - enabled injects summarize_task into the API without ChatArea echo",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureAutoCompact(dlineDir, true)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_auto_compact_ready",
				name: "qna_respond",
				arguments: { response: "E2E_AUTO_COMPACT_READY" },
				usage: { inputTokens: 125_000, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_auto_compact_summary",
				name: "summarize_task",
				arguments: { context: "E2E_AUTO_COMPACT_SUMMARY preserves the task and latest user request." },
				expectedRequestIncludes: ["The current conversation is rapidly running out of context"],
				expectedRequestExcludes: [COMPACT_SIGNAL, "E2E_AUTO_COMPACT_CONTINUE"],
			},
			{
				type: "tool",
				id: "call_auto_compact_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_AUTO_COMPACT_OK" },
				expectedRequestIncludes: ["E2E_AUTO_COMPACT_SUMMARY", "E2E_AUTO_COMPACT_CONTINUE"],
				expectedRequestExcludes: [COMPACT_SIGNAL, COMPACT_INSTRUCTION_MARKER],
				expectedToolResults: [{ callId: "call_auto_compact_ready", contentIncludes: "E2E_AUTO_COMPACT_CONTINUE" }],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_AUTO_COMPACT_TASK")
			await expect(sidebar.getByText("E2E_AUTO_COMPACT_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_AUTO_COMPACT_CONTINUE")
			await expect(sidebar.getByText("E2E_AUTO_COMPACT_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })

			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(3)
			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requestToolNames(requests[1])).toEqual(["summarize_task"])
			expect(requests[1].contractError).toBeUndefined()
			expect(requests[2].contractError).toBeUndefined()
			await expectNoCompactionEcho(sidebar, ["E2E_AUTO_COMPACT_SUMMARY"])
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Automatic compaction - disabled sends the next turn directly",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(150_000)
		await configureAutoCompact(dlineDir, false)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_auto_compact_disabled_ready",
				name: "qna_respond",
				arguments: { response: "E2E_AUTO_COMPACT_DISABLED_READY" },
				usage: { inputTokens: 125_000, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_auto_compact_disabled_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_AUTO_COMPACT_DISABLED_OK" },
				expectedRequestIncludes: ["E2E_AUTO_COMPACT_DISABLED_CONTINUE"],
				expectedRequestExcludes: [COMPACT_SIGNAL, COMPACT_INSTRUCTION_MARKER],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_AUTO_COMPACT_DISABLED_TASK")
			await expect(sidebar.getByText("E2E_AUTO_COMPACT_DISABLED_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_AUTO_COMPACT_DISABLED_CONTINUE")
			await expect(sidebar.getByText("E2E_AUTO_COMPACT_DISABLED_OK", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(2)
			const secondRequest = server.getMockConsumptions("openai-compatible-responses")[1]
			expect(requestToolNames(secondRequest)).not.toEqual(["summarize_task"])
			expect(secondRequest.contractError).toBeUndefined()
			await expectNoCompactionEcho(sidebar)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)
