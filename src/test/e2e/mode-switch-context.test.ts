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
	webSearchMode?: "WEB_SEARCH_MODE_FORCE_OFF"
	openai?: {
		capabilities?: {
			contextWindow?: number
		}
	}
}

const COMPACT_SIGNAL = "__dline_mode_switch_compact__"
const COMPACT_INSTRUCTION_MARKER = "The current conversation is rapidly running out of context"
const INTERNAL_MODE_RESPONSE = "PLAN_MODE_TOGGLE_RESPONSE"
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
		profile.webSearchMode = "WEB_SEARCH_MODE_FORCE_OFF"
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
				useAutoCondense: enabled,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
}

async function configureDeepSeekAutoCompact(dlineDir: string, useAutoCondense = true): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === E2E_PROFILE_NAMES.mockDeepSeek)
	if (!profile) throw new Error("Missing configurable DeepSeek E2E profile")
	profile.webSearchMode = "WEB_SEARCH_MODE_FORCE_OFF"
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	await writeFile(
		settingsPath(dlineDir),
		`${JSON.stringify(
			{
				...settings,
				actModeProfile: E2E_PROFILE_NAMES.mockDeepSeek,
				planModeProfile: E2E_PROFILE_NAMES.mockDeepSeek,
				useAutoCondense,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
}

async function configureTaskProfileSwitch(dlineDir: string): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const targetProfile = profiles.find((profile) => profile.name === E2E_PROFILE_NAMES.mockOpenAiResponses)
	if (!targetProfile?.openai?.capabilities) throw new Error("Missing configurable OpenAI Responses E2E profile")
	targetProfile.modelId = "gpt-5.6-sol"
	targetProfile.openai.capabilities.contextWindow = 372_000
	targetProfile.webSearchMode = "WEB_SEARCH_MODE_FORCE_OFF"
	const sourceProfile = profiles.find((profile) => profile.name === E2E_PROFILE_NAMES.mockDeepSeek)
	if (!sourceProfile) throw new Error("Missing configurable DeepSeek E2E profile")
	sourceProfile.webSearchMode = "WEB_SEARCH_MODE_FORCE_OFF"
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	await writeFile(
		settingsPath(dlineDir),
		`${JSON.stringify(
			{
				...settings,
				planActSeparateModelsSetting: false,
				actModeProfile: E2E_PROFILE_NAMES.mockDeepSeek,
				planModeProfile: E2E_PROFILE_NAMES.mockDeepSeek,
				useAutoCondense: true,
				autoCondenseTriggerPercent: 97,
				autoCondenseMaxContextTokens: 0,
			},
			null,
			2,
		)}\n`,
		"utf8",
	)
}

async function clickProfileOption(sidebar: Frame, profileName: string): Promise<void> {
	const modelSwitcher = sidebar.getByRole("button", { name: "Select model" })
	if ((await modelSwitcher.innerText()).trim() === profileName) return
	await modelSwitcher.click()
	const profileOption = sidebar.getByRole("option").filter({ has: sidebar.getByText(profileName, { exact: true }) })
	await expect(profileOption).toHaveCount(1)
	await profileOption.click()
}

async function selectProfile(sidebar: Frame, profileName: string): Promise<void> {
	await clickProfileOption(sidebar, profileName)
	await expect(sidebar.getByRole("button", { name: "Select model" })).toHaveText(profileName)
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

async function sendTask(sidebar: Frame, text: string, timeout = 5_000): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled({ timeout })
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

async function expectNoInternalCompactionEcho(sidebar: Frame): Promise<void> {
	const visibleText = await sidebar.locator("body").innerText()
	expect(visibleText).not.toContain(COMPACT_SIGNAL)
	expect(visibleText).not.toContain(INTERNAL_MODE_RESPONSE)
	expect(visibleText).not.toContain("The current conversation is rapidly running out of context")
}

async function expectCompactionSummary(sidebar: Frame, summary: string): Promise<void> {
	await expect(sidebar.getByText(summary, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
	await expectNoInternalCompactionEcho(sidebar)
}

async function confirmManualCompaction(sidebar: Frame, summary: string): Promise<void> {
	await expect(sidebar.getByText(summary, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
	const confirmButton = sidebar.locator('vscode-button[aria-label="Condense Conversation"]')
	await expect(confirmButton).toBeVisible({ timeout: 60_000 })
	await expectNoInternalCompactionEcho(sidebar)
	await confirmButton.click()
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
	"Task-local profile switch - DeepSeek 160K to GPT-5.6 does not inject compaction below 372K",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureTaskProfileSwitch(dlineDir)

		server.enqueueResponses("deepseek-chat", {
			type: "tool",
			id: "call_profile_switch_deepseek_ready",
			name: "attempt_completion",
			arguments: { result: "E2E_PROFILE_SWITCH_DEEPSEEK_READY" },
			usage: { inputTokens: 160_000, outputTokens: 100 },
			expectedRequestIncludes: ["E2E_PROFILE_SWITCH_DEEPSEEK_TASK"],
		})
		server.enqueueResponses("openai-compatible-responses", {
			type: "tool",
			id: "call_profile_switch_gpt_continue",
			name: "attempt_completion",
			arguments: { result: "E2E_PROFILE_SWITCH_GPT_CONTINUE_OK" },
			expectedRequestIncludes: ["E2E_PROFILE_SWITCH_GPT_CONTINUE"],
			expectedRequestExcludes: [COMPACT_INSTRUCTION_MARKER],
		})

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_PROFILE_SWITCH_DEEPSEEK_TASK", 60_000)
			await expect(sidebar.getByText("E2E_PROFILE_SWITCH_DEEPSEEK_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			// Reproduce the real task-local profile race: the selection RPC is
			// intentionally still in flight when the next user turn is submitted.
			await clickProfileOption(sidebar, E2E_PROFILE_NAMES.mockOpenAiResponses)

			const input = sidebar.getByTestId("chat-input")
			await expect(input).toBeEnabled()
			await input.fill("E2E_PROFILE_SWITCH_GPT_CONTINUE")
			await input.press("Enter")
			await expect(sidebar.getByText("E2E_PROFILE_SWITCH_GPT_CONTINUE_OK", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(1)
			const targetRequest = server.getMockConsumptions("openai-compatible-responses")[0]
			expect(targetRequest).toMatchObject({ provider: "openai", protocol: "openai-responses" })
			expect(targetRequest.requestBody).toMatchObject({ model: "gpt-5.6-sol" })
			expect(JSON.stringify(targetRequest.requestBody)).not.toContain(COMPACT_INSTRUCTION_MARKER)
			expect(targetRequest.contractError).toBeUndefined()
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Mode switch context - welcome draft stays local until configured Enter submits it",
	async ({ dlineDocsDir, helper, server, sidebar, userDataDir }) => {
		e2e.setTimeout(120_000)
		await helper.signin(sidebar)
		server.enqueueResponses("openai-compatible-chat", {
			type: "tool",
			id: "call_welcome_mode_enter",
			name: "make_plan",
			arguments: { response: "E2E_WELCOME_MODE_ENTER_SENT", needs_more_exploration: false },
			expectedRequestIncludes: ["E2E_WELCOME_MODE_DRAFT", "PLAN MODE"],
		})

		const input = sidebar.getByTestId("chat-input")
		await expect(sidebar.getByRole("switch", { name: "Act" })).toHaveAttribute("aria-checked", "true")
		await input.fill("E2E_WELCOME_MODE_DRAFT")
		await sidebar.getByTestId("mode-switch").click()

		await expectPlanMode(sidebar)
		await expect(input).toHaveValue("E2E_WELCOME_MODE_DRAFT")
		expect(await taskDirectoryIds(dlineDocsDir)).toEqual([])
		expect(server.getRequestCount("openai-compatible-chat")).toBe(0)
		expect(server.getRequestCount("openai-compatible-responses")).toBe(0)

		await input.press("Enter")
		await expect(input).toHaveValue("")
		await expect(sidebar.getByText("E2E_WELCOME_MODE_DRAFT", { exact: true }).last()).toBeVisible()
		await expect(sidebar.getByText("E2E_WELCOME_MODE_ENTER_SENT", { exact: false }).last()).toBeVisible({
			timeout: 60_000,
		})
		await expect.poll(() => server.getRequestCount("openai-compatible-chat")).toBe(1)
		expect(server.getRequestCount("openai-compatible-responses")).toBe(0)
		expect(await taskDirectoryIds(dlineDocsDir)).toHaveLength(1)
		expect(server.getMockConsumptions("openai-compatible-chat")[0].contractError).toBeUndefined()
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
		await sidebar.getByTestId("mode-switch").click()

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
	"Mode switch interaction - an awaiting plan continues in Act without internal response echo",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(120_000)
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
				id: "call_awaiting_plan",
				name: "make_plan",
				arguments: { response: "E2E_AWAITING_PLAN_READY", needs_more_exploration: false },
				expectedRequestIncludes: ["E2E_AWAITING_PLAN_TASK", "PLAN MODE"],
			},
			{
				type: "tool",
				id: "call_awaiting_plan_continued",
				name: "attempt_completion",
				arguments: { result: "E2E_AWAITING_PLAN_CONTINUED" },
				expectedRequestIncludes: ["ACT MODE"],
				expectedRequestExcludes: [INTERNAL_MODE_RESPONSE],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sidebar.getByTestId("mode-switch").click()
			await expectPlanMode(sidebar)
			await sendTask(sidebar, "E2E_AWAITING_PLAN_TASK")
			await expect(sidebar.getByText("E2E_AWAITING_PLAN_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const input = sidebar.getByTestId("chat-input")
			await expect(input).toBeEnabled()
			await expect(input).toHaveValue("")
			await startInputValueObserver(sidebar)
			await sidebar.getByTestId("mode-switch").evaluate((element) => element.click())
			await expect(sidebar.getByRole("switch", { name: "Act" })).toHaveAttribute("aria-checked", "true", {
				timeout: 60_000,
			})

			const observedValues = await stopInputValueObserver(sidebar)
			expect.soft(observedValues).not.toContain(INTERNAL_MODE_RESPONSE)
			expect.soft(await sidebar.locator("body").innerText()).not.toContain(INTERNAL_MODE_RESPONSE)
			await expect.poll(() => server.getRequestCount("openai-compatible-chat"), { timeout: 20_000 }).toBe(2)
			await expect(sidebar.getByText("E2E_AWAITING_PLAN_CONTINUED", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const continuationRequest = server.getMockConsumptions("openai-compatible-chat")[1]
			expect(JSON.stringify(continuationRequest.requestBody)).not.toContain(INTERNAL_MODE_RESPONSE)
			expect(continuationRequest.contractError).toBeUndefined()
			await expectNoInternalCompactionEcho(sidebar)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Mode switch interaction - an awaiting Act question continues in Plan",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(120_000)
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
				id: "call_awaiting_act_question",
				name: "qna_respond",
				arguments: { response: "E2E_AWAITING_ACT_QUESTION" },
				expectedRequestIncludes: ["E2E_AWAITING_ACT_TASK", "ACT MODE"],
			},
			{
				type: "tool",
				id: "call_awaiting_act_question_continued",
				name: "make_plan",
				arguments: { response: "E2E_AWAITING_ACT_PLAN_CONTINUED", needs_more_exploration: false },
				expectedRequestIncludes: ["PLAN MODE"],
				expectedRequestExcludes: [INTERNAL_MODE_RESPONSE],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_AWAITING_ACT_TASK")
			await expect(sidebar.getByText("E2E_AWAITING_ACT_QUESTION", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const input = sidebar.getByTestId("chat-input")
			await expect(input).toBeEnabled()
			await expect(input).toHaveValue("")
			await sidebar.getByTestId("mode-switch").evaluate((element) => element.click())
			await expectPlanMode(sidebar)
			await expect.poll(() => server.getRequestCount("openai-compatible-chat"), { timeout: 20_000 }).toBe(2)
			await expect(sidebar.getByText("E2E_AWAITING_ACT_PLAN_CONTINUED", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const continuationRequest = server.getMockConsumptions("openai-compatible-chat")[1]
			expect(JSON.stringify(continuationRequest.requestBody)).not.toContain(INTERNAL_MODE_RESPONSE)
			expect(continuationRequest.contractError).toBeUndefined()
			await expectNoInternalCompactionEcho(sidebar)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Mode switch interaction - an awaiting Act question consumes its Plan-switch draft once",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(120_000)
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
				id: "call_reverse_draft_question",
				name: "qna_respond",
				arguments: { response: "E2E_REVERSE_DRAFT_QUESTION" },
			},
			{
				type: "tool",
				id: "call_reverse_draft_plan",
				name: "make_plan",
				arguments: { response: "E2E_REVERSE_DRAFT_PLAN_READY", needs_more_exploration: false },
				expectedRequestIncludes: ["E2E_REVERSE_SWITCH_DRAFT", "PLAN MODE"],
				expectedRequestExcludes: [INTERNAL_MODE_RESPONSE],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_REVERSE_DRAFT_TASK")
			await expect(sidebar.getByText("E2E_REVERSE_DRAFT_QUESTION", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const input = sidebar.getByTestId("chat-input")
			await input.fill("E2E_REVERSE_SWITCH_DRAFT")
			await sidebar.getByTestId("mode-switch").evaluate((element) => element.click())
			await expectPlanMode(sidebar)
			await expect(input).toHaveValue("")
			await expect.poll(() => server.getRequestCount("openai-compatible-chat"), { timeout: 20_000 }).toBe(2)
			await expect(sidebar.getByText("E2E_REVERSE_DRAFT_PLAN_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			await expect(sidebar.getByText("E2E_REVERSE_SWITCH_DRAFT", { exact: true })).toHaveCount(1)
			const continuationRequest = server.getMockConsumptions("openai-compatible-chat")[1]
			const continuationText = JSON.stringify(continuationRequest.requestBody)
			expect(continuationText.match(/E2E_REVERSE_SWITCH_DRAFT/g)).toHaveLength(1)
			expect(continuationRequest.contractError).toBeUndefined()
			await expectNoInternalCompactionEcho(sidebar)
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
			await expectNoInternalCompactionEcho(sidebar)
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
			await expectNoInternalCompactionEcho(sidebar)
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
				id: "call_mode_switch_summary",
				name: "summarize_task",
				arguments: { context: "E2E_MODE_SWITCH_SUMMARY preserves E2E_SMALLER_TARGET_TASK and the pending plan draft." },
				expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER],
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
			const sourceRequests = server.getMockConsumptions("openai-compatible-responses")
			const summaryRequest = sourceRequests[1]
			expect(summaryRequest).toMatchObject({ responseType: "tool", toolName: "summarize_task" })
			expect(requestToolNames(summaryRequest)).toEqual(requestToolNames(sourceRequests[0]))
			expect(requestToolNames(summaryRequest)).not.toContain("summarize_task")
			expect(summaryRequest.contractError).toBeUndefined()
			const targetRequest = server.getMockConsumptions("openai-compatible-chat")[0]
			expect(requestToolNames(targetRequest)).toContain("make_plan")
			expect(requestToolNames(targetRequest)).not.toContain("act_mode_respond")
			expect(requestToolNames(targetRequest)).not.toEqual(["summarize_task"])
			expect(targetRequest.contractError).toBeUndefined()
			await expectCompactionSummary(
				sidebar,
				"E2E_MODE_SWITCH_SUMMARY preserves E2E_SMALLER_TARGET_TASK and the pending plan draft.",
			)
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
				arguments: { context: "E2E_OVER_LIMIT_SUMMARY preserves E2E_OVER_LIMIT_TASK and E2E_OVER_LIMIT_LATE_TURN." },
				expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER, "E2E_OVER_LIMIT_TASK", "E2E_OVER_LIMIT_LATE_TURN"],
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
				expect(requestToolNames(request)).toEqual(requestToolNames(sourceRequests[3]))
				expect(requestToolNames(request)).not.toContain("summarize_task")
				expect(requestText).toContain("E2E_OVER_LIMIT_TASK")
				expect(requestText).toContain("E2E_OVER_LIMIT_LATE_TURN")
				expect(requestText).not.toContain("E2E_OVER_LIMIT_MIDDLE_ONE")
				expect(requestText).not.toContain("E2E_OVER_LIMIT_MIDDLE_TWO")
			}
			expect(firstSummary).toMatchObject({ responseType: "error" })
			expect(retriedSummary).toMatchObject({ responseType: "tool", toolName: "summarize_task" })
			expect(retriedSummary.contractError).toBeUndefined()
			expect(sidebar.getByText("E2E_OVER_LIMIT_TASK", { exact: true }).first()).toBeVisible()
			await expectCompactionSummary(
				sidebar,
				"E2E_OVER_LIMIT_SUMMARY preserves E2E_OVER_LIMIT_TASK and E2E_OVER_LIMIT_LATE_TURN.",
			)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/context length/i])
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Automatic compaction - enabled renders the API summary without internal instruction echo",
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
				expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER],
				expectedRequestExcludes: [COMPACT_SIGNAL, "E2E_AUTO_COMPACT_CONTINUE"],
			},
			{
				type: "tool",
				id: "call_auto_compact_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_AUTO_COMPACT_OK" },
				expectedRequestIncludes: ["E2E_AUTO_COMPACT_SUMMARY", "E2E_AUTO_COMPACT_CONTINUE"],
				expectedRequestExcludes: [COMPACT_SIGNAL, COMPACT_INSTRUCTION_MARKER],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_AUTO_COMPACT_TASK")
			await expect(sidebar.getByText("E2E_AUTO_COMPACT_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await sendTask(sidebar, "E2E_AUTO_COMPACT_CONTINUE")
			await expect(
				sidebar
					.getByText("E2E_AUTO_COMPACT_SUMMARY preserves the task and latest user request.", { exact: false })
					.last(),
			).toBeVisible({ timeout: 60_000 })
			await expect(sidebar.locator('vscode-button[aria-label="Condense Conversation"]')).toHaveCount(0)
			await expect(sidebar.locator('vscode-button[aria-label="Regenerate Summary"]')).toHaveCount(0)

			await expect.poll(() => server.getRequestCount("openai-compatible-responses"), { timeout: 60_000 }).toBe(3)
			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requests[1]).toMatchObject({ responseType: "tool", toolName: "summarize_task" })
			expect(requestToolNames(requests[1])).toEqual(requestToolNames(requests[0]))
			expect(requestToolNames(requests[1])).not.toContain("summarize_task")
			expect(requests[1].contractError).toBeUndefined()
			expect(requests[2].contractError).toBeUndefined()
			await expect(sidebar.getByText("E2E_AUTO_COMPACT_OK", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expectCompactionSummary(sidebar, "E2E_AUTO_COMPACT_SUMMARY preserves the task and latest user request.")
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Manual compaction - explicit /compact takes priority over an enabled automatic trigger",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(210_000)
		await configureAutoCompact(dlineDir, true)
		server.resetOpenAiMock()
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_manual_priority_ready",
				name: "qna_respond",
				arguments: { response: "E2E_MANUAL_PRIORITY_READY" },
				usage: { inputTokens: 70_000, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_manual_priority_summary",
				name: "summarize_task",
				arguments: { context: "E2E_MANUAL_PRIORITY_SUMMARY preserves the latest manual guidance." },
				expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER, "E2E_MANUAL_PRIORITY_GUIDANCE"],
				expectedRequestExcludes: ["/compact"],
			},
			{
				type: "tool",
				id: "call_manual_priority_done",
				name: "attempt_completion",
				arguments: { result: "E2E_MANUAL_PRIORITY_DONE" },
				expectedRequestIncludes: ["E2E_MANUAL_PRIORITY_SUMMARY"],
				expectedRequestExcludes: [COMPACT_INSTRUCTION_MARKER],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_MANUAL_PRIORITY_TASK")
			await expect(sidebar.getByText("E2E_MANUAL_PRIORITY_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			await sendTask(sidebar, "/compact E2E_MANUAL_PRIORITY_GUIDANCE")
			await confirmManualCompaction(sidebar, "E2E_MANUAL_PRIORITY_SUMMARY preserves the latest manual guidance.")
			await expect(sidebar.getByText("E2E_MANUAL_PRIORITY_DONE", { exact: false }).last()).toBeVisible({ timeout: 60_000 })

			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(3)
			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requests[1]).toMatchObject({ responseType: "tool", toolName: "summarize_task" })
			expect(requestToolNames(requests[1])).toEqual(requestToolNames(requests[0]))
			expect(requestToolNames(requests[1])).not.toContain("summarize_task")
			expect(requests.slice(1).every((request) => request.contractError === undefined)).toBe(true)
			await expectCompactionSummary(sidebar, "E2E_MANUAL_PRIORITY_SUMMARY preserves the latest manual guidance.")
			await expect(sidebar.locator('vscode-button[aria-label="Condense Conversation"]')).toHaveCount(0)
			await expect(sidebar.locator('vscode-button[aria-label="Regenerate Summary"]')).toHaveCount(0)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Manual compaction - applies a returned summary without starting a second automatic compaction",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(210_000)
		await configureAutoCompact(dlineDir, true)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_manual_accept_ready",
				name: "qna_respond",
				arguments: { response: "E2E_MANUAL_ACCEPT_READY" },
				usage: { inputTokens: 70_000, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_manual_accept_summary",
				name: "summarize_task",
				arguments: { context: "E2E_MANUAL_ACCEPT_SUMMARY replaces the original high-context history." },
				usage: { inputTokens: 75_000, outputTokens: 100 },
				expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER, "E2E_MANUAL_ACCEPT_GUIDANCE"],
				expectedRequestExcludes: ["/compact"],
			},
			{
				type: "tool",
				id: "call_manual_accept_done",
				name: "attempt_completion",
				arguments: { result: "E2E_MANUAL_ACCEPT_DONE" },
				expectedRequestIncludes: ["E2E_MANUAL_ACCEPT_SUMMARY"],
				expectedRequestExcludes: [COMPACT_INSTRUCTION_MARKER],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_MANUAL_ACCEPT_TASK")
			await expect(sidebar.getByText("E2E_MANUAL_ACCEPT_READY", { exact: false }).last()).toBeVisible({ timeout: 60_000 })

			await sendTask(sidebar, "/compact E2E_MANUAL_ACCEPT_GUIDANCE")
			await confirmManualCompaction(sidebar, "E2E_MANUAL_ACCEPT_SUMMARY replaces the original high-context history.")
			await expect(sidebar.getByText("E2E_MANUAL_ACCEPT_DONE", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(3)
			const requests = server.getMockConsumptions("openai-compatible-responses")

			expect(requests.slice(1).every((request) => request.contractError === undefined)).toBe(true)
			expect(requestToolNames(requests[2])).toEqual(requestToolNames(requests[1]))
			expect(requestToolNames(requests[2])).not.toContain("summarize_task")
			await expectCompactionSummary(sidebar, "E2E_MANUAL_ACCEPT_SUMMARY replaces the original high-context history.")
			await expect(sidebar.locator('vscode-button[aria-label="Condense Conversation"]')).toHaveCount(0)
			await expect(sidebar.locator('vscode-button[aria-label="Regenerate Summary"]')).toHaveCount(0)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Manual compaction - incomplete summary shows failure without exposing a partial preview",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(150_000)
		await configureAutoCompact(dlineDir, false)
		const partialSummary = "E2E_MANUAL_INCOMPLETE_PARTIAL_MUST_NOT_RENDER"
		const serializedArguments = JSON.stringify({ context: partialSummary })
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_manual_incomplete_ready",
				name: "qna_respond",
				arguments: { response: "E2E_MANUAL_INCOMPLETE_READY" },
				usage: { inputTokens: 70_000, outputTokens: 100 },
			},
			{
				type: "truncated-tool",
				id: "call_manual_incomplete_summary",
				name: "summarize_task",
				arguments: { context: partialSummary },
				truncateAfter: serializedArguments.length - 1,
				expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER, "E2E_MANUAL_INCOMPLETE_GUIDANCE"],
				expectedRequestExcludes: ["/compact"],
			},
			{
				type: "tool",
				id: "call_manual_incomplete_recovered",
				name: "attempt_completion",
				arguments: { result: "E2E_MANUAL_INCOMPLETE_RECOVERED" },
				expectedRequestIncludes: ["E2E_MANUAL_INCOMPLETE_CONTINUE"],
				expectedRequestExcludes: [COMPACT_INSTRUCTION_MARKER, "E2E_MANUAL_INCOMPLETE_GUIDANCE", partialSummary],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_MANUAL_INCOMPLETE_TASK")
			await expect(sidebar.getByText("E2E_MANUAL_INCOMPLETE_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "/compact E2E_MANUAL_INCOMPLETE_GUIDANCE")

			await expect(sidebar.getByText("Conversation compaction failed:", { exact: true }).last()).toBeVisible({
				timeout: 60_000,
			})
			await expect(sidebar.getByText(partialSummary, { exact: false })).toHaveCount(0)
			await expect(sidebar.locator('vscode-button[aria-label="Condense Conversation"]')).toHaveCount(0)
			await expect(sidebar.locator('vscode-button[aria-label="Regenerate Summary"]')).toHaveCount(0)
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(2)
			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requests[1].responseType).toBe("truncated-tool")
			expect(requests[1].contractError).toBeUndefined()
			expect(requests[1].requestToolResults).not.toContainEqual(
				expect.objectContaining({ callId: "call_manual_incomplete_summary" }),
			)

			await sendTask(sidebar, "E2E_MANUAL_INCOMPLETE_CONTINUE")
			await expect(sidebar.getByText("E2E_MANUAL_INCOMPLETE_RECOVERED", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(3)
			const recoveryRequest = server.getMockConsumptions("openai-compatible-responses")[2]
			expect(recoveryRequest.contractError).toBeUndefined()
			expect(recoveryRequest.requestToolResults).not.toContainEqual(
				expect.objectContaining({ callId: "call_manual_incomplete_summary" }),
			)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/max_output_tokens/])
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
			await expectNoInternalCompactionEcho(sidebar)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Manual compaction - header control dispatches once and reduces context usage",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureAutoCompact(dlineDir, false)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_manual_compact_ready",
				name: "qna_respond",
				arguments: { response: "E2E_MANUAL_COMPACT_READY" },
				usage: { inputTokens: 80_000, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_manual_compact_summary",
				name: "summarize_task",
				arguments: { context: "E2E_MANUAL_COMPACT_SUMMARY preserves the task and current intent." },
				delayMs: 1_500,
				expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER, "E2E_MANUAL_COMPACT_TASK"],
				expectedRequestExcludes: [COMPACT_SIGNAL, "/compact"],
			},
			{
				type: "tool",
				id: "call_manual_compact_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_MANUAL_COMPACT_DONE" },
				usage: { inputTokens: 1_200, outputTokens: 100 },
				expectedRequestIncludes: ["E2E_MANUAL_COMPACT_SUMMARY"],
				expectedRequestExcludes: [COMPACT_SIGNAL, COMPACT_INSTRUCTION_MARKER, "E2E_MANUAL_COMPACT_PRESERVED_DRAFT"],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_MANUAL_COMPACT_TASK")
			await expect(sidebar.getByText("E2E_MANUAL_COMPACT_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const input = sidebar.getByTestId("chat-input")
			await input.fill("E2E_MANUAL_COMPACT_PRESERVED_DRAFT")
			const expandTaskHeader = sidebar.getByLabel("Expand task header")
			if (await expandTaskHeader.isVisible()) await expandTaskHeader.click()
			const progress = sidebar.getByRole("progressbar", { name: "Context window usage progress" })
			await expect.poll(async () => Number(await progress.getAttribute("aria-valuenow"))).toBeGreaterThan(60)
			const beforeCompact = Number(await progress.getAttribute("aria-valuenow"))

			const compactButton = sidebar.locator("button").filter({
				has: sidebar.locator("svg.lucide-fold-vertical"),
			})
			await expect(compactButton).toBeVisible()
			await compactButton.click()
			await expect(sidebar.getByText("Compact the current task?", { exact: true })).toBeVisible()
			await sidebar.getByTitle("Yes, compact the task").click()
			await expect(compactButton).toBeVisible()
			await expect(compactButton).toHaveAttribute("aria-disabled", "true")
			await confirmManualCompaction(sidebar, "E2E_MANUAL_COMPACT_SUMMARY preserves the task and current intent.")

			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBeGreaterThanOrEqual(3)
			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requests[1]).toMatchObject({ responseType: "tool", toolName: "summarize_task" })
			expect(requestToolNames(requests[1])).toEqual(requestToolNames(requests[0]))
			expect(requestToolNames(requests[1])).not.toContain("summarize_task")
			expect(requests[1].contractError).toBeUndefined()
			expect(requests[2]).toBeDefined()
			expect(requests[2].contractError).toBeUndefined()
			await expect(sidebar.getByText("E2E_MANUAL_COMPACT_DONE", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(3)
			await expectCompactionSummary(sidebar, "E2E_MANUAL_COMPACT_SUMMARY preserves the task and current intent.")
			await expect(sidebar.getByText("/compact", { exact: true })).toHaveCount(0)
			await expect.poll(async () => Number(await progress.getAttribute("aria-valuenow"))).toBeLessThan(beforeCompact)
			await expect(input).toHaveValue("E2E_MANUAL_COMPACT_PRESERVED_DRAFT")
			await expect(compactButton).toBeVisible()
			await expect(compactButton).toHaveAttribute("aria-disabled", "false")
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"Manual compaction - /compact applies once and the next Enter is a normal user turn",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(210_000)
		await configureAutoCompact(dlineDir, false)
		server.enqueueResponses(
			"openai-compatible-responses",
			{
				type: "tool",
				id: "call_manual_followup_ready",
				name: "qna_respond",
				arguments: { response: "E2E_MANUAL_FOLLOWUP_READY" },
			},
			{
				type: "tool",
				id: "call_manual_followup_summary",
				name: "summarize_task",
				arguments: { context: "E2E_MANUAL_FOLLOWUP_SUMMARY keeps the command decisions and unresolved failures." },
				expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER, "E2E_MANUAL_FOLLOWUP_GUIDANCE"],
				expectedRequestExcludes: ["/compact"],
			},
			{
				type: "tool",
				id: "call_manual_followup_applied",
				name: "qna_respond",
				arguments: { response: "E2E_MANUAL_FOLLOWUP_APPLIED" },
				expectedRequestIncludes: ["E2E_MANUAL_FOLLOWUP_SUMMARY"],
				expectedRequestExcludes: [COMPACT_INSTRUCTION_MARKER],
			},
			{
				type: "tool",
				id: "call_manual_followup_done",
				name: "attempt_completion",
				arguments: { result: "E2E_MANUAL_FOLLOWUP_DONE" },
				expectedRequestIncludes: ["E2E_MANUAL_FOLLOWUP_SUMMARY", "E2E_MANUAL_FOLLOWUP_MESSAGE"],
				expectedRequestExcludes: [COMPACT_INSTRUCTION_MARKER],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_MANUAL_FOLLOWUP_TASK")
			await expect(sidebar.getByText("E2E_MANUAL_FOLLOWUP_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			await sendTask(sidebar, "/compact E2E_MANUAL_FOLLOWUP_GUIDANCE")
			await confirmManualCompaction(
				sidebar,
				"E2E_MANUAL_FOLLOWUP_SUMMARY keeps the command decisions and unresolved failures.",
			)
			await expect(sidebar.getByText("E2E_MANUAL_FOLLOWUP_APPLIED", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await expectCompactionSummary(
				sidebar,
				"E2E_MANUAL_FOLLOWUP_SUMMARY keeps the command decisions and unresolved failures.",
			)
			await expect(sidebar.locator('vscode-button[aria-label="Condense Conversation"]')).toHaveCount(0)
			await expect(sidebar.locator('vscode-button[aria-label="Regenerate Summary"]')).toHaveCount(0)

			const input = sidebar.getByTestId("chat-input")
			await input.fill("E2E_MANUAL_FOLLOWUP_MESSAGE")
			await input.press("Enter")
			await expect(input).toHaveValue("")
			await expect(sidebar.getByText("E2E_MANUAL_FOLLOWUP_MESSAGE", { exact: true }).last()).toBeVisible()
			await expect(sidebar.getByText("E2E_MANUAL_FOLLOWUP_DONE", { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expect.poll(() => server.getRequestCount("openai-compatible-responses")).toBe(4)
			const requests = server.getMockConsumptions("openai-compatible-responses")
			expect(requests.slice(1).every((request) => request.contractError === undefined)).toBe(true)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"DeepSeek context - 630K usage remains at 63 percent of 1M without an early recovery truncation",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureDeepSeekAutoCompact(dlineDir)
		server.enqueueResponses(
			"deepseek-chat",
			{
				type: "tool",
				id: "call_deepseek_context_round_one",
				name: "qna_respond",
				arguments: { response: "E2E_DEEPSEEK_CONTEXT_ROUND_ONE" },
			},
			{
				type: "tool",
				id: "call_deepseek_context_round_two",
				name: "qna_respond",
				arguments: { response: "E2E_DEEPSEEK_CONTEXT_ROUND_TWO" },
				expectedRequestIncludes: ["E2E_DEEPSEEK_CONTEXT_MIDDLE_ONE"],
			},
			{
				type: "tool",
				id: "call_deepseek_context_ready",
				name: "qna_respond",
				arguments: { response: "E2E_DEEPSEEK_CONTEXT_READY" },
				usage: { inputTokens: 630_000, outputTokens: 100 },
				expectedRequestIncludes: ["E2E_DEEPSEEK_CONTEXT_LATE_TURN"],
			},
			{
				type: "tool",
				id: "call_deepseek_context_direct_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_DEEPSEEK_CONTEXT_DIRECT_OK" },
				expectedRequestIncludes: ["E2E_DEEPSEEK_CONTEXT_CONTINUE"],
			},
			{
				type: "tool",
				id: "call_deepseek_context_unexpected_recovery",
				name: "attempt_completion",
				arguments: { result: "E2E_DEEPSEEK_CONTEXT_UNEXPECTED_RECOVERY" },
				expectedRequestIncludes: ["E2E_DEEPSEEK_CONTEXT_TASK", "E2E_DEEPSEEK_CONTEXT_CONTINUE"],
				expectedRequestExcludes: ["E2E_DEEPSEEK_CONTEXT_MIDDLE_ONE"],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { page, sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_DEEPSEEK_CONTEXT_TASK")
			await expect(sidebar.getByText("E2E_DEEPSEEK_CONTEXT_ROUND_ONE", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_DEEPSEEK_CONTEXT_MIDDLE_ONE")
			await expect(sidebar.getByText("E2E_DEEPSEEK_CONTEXT_ROUND_TWO", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_DEEPSEEK_CONTEXT_LATE_TURN")
			await expect(sidebar.getByText("E2E_DEEPSEEK_CONTEXT_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const expandTaskHeader = sidebar.getByLabel("Expand task header")
			if (await expandTaskHeader.isVisible()) await expandTaskHeader.click()
			await expect(sidebar.locator('[title="Current tokens used in this request"]')).toHaveText("630.1k")
			await expect(sidebar.locator('[title="Maximum context window size for this model"]')).toHaveText("1.0m")
			const progress = sidebar.getByRole("progressbar", { name: "Context window usage progress" })
			await expect(progress).toHaveAttribute("aria-valuenow", "63.01")
			await expect(progress).toHaveAttribute("aria-valuetext", "63%")
			const screenshotPath = e2e.info().outputPath("deepseek-context-630k.png")
			await page.screenshot({ path: screenshotPath })
			await e2e.info().attach("deepseek-context-630k", { path: screenshotPath, contentType: "image/png" })

			await sendTask(sidebar, "E2E_DEEPSEEK_CONTEXT_CONTINUE")
			await expect(
				sidebar.getByText(/E2E_DEEPSEEK_CONTEXT_(?:DIRECT_OK|UNEXPECTED_RECOVERY)/, { exact: false }).last(),
			).toBeVisible({ timeout: 60_000 })

			const requests = server.getMockConsumptions("deepseek-chat")
			expect(requests).toHaveLength(4)
			expect(requests[3]).toMatchObject({ responseType: "tool", toolName: "attempt_completion" })
			await expect(sidebar.getByText("E2E_DEEPSEEK_CONTEXT_DIRECT_OK", { exact: false }).last()).toBeVisible()
			await expect(sidebar.getByText("E2E_DEEPSEEK_CONTEXT_UNEXPECTED_RECOVERY", { exact: false })).toHaveCount(0)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"DeepSeek context - usage near 1M auto condenses with enough output budget for the summary",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureDeepSeekAutoCompact(dlineDir)
		server.enqueueResponses(
			"deepseek-chat",
			{
				type: "tool",
				id: "call_deepseek_near_limit_ready",
				name: "qna_respond",
				arguments: { response: "E2E_DEEPSEEK_NEAR_LIMIT_READY" },
				usage: { inputTokens: 980_000, outputTokens: 100 },
			},
			{
				type: "tool",
				id: "call_deepseek_near_limit_summary",
				name: "summarize_task",
				arguments: { context: "E2E_DEEPSEEK_NEAR_LIMIT_SUMMARY preserves the task and latest request." },
				expectedRequestIncludes: [COMPACT_INSTRUCTION_MARKER],
				expectedRequestExcludes: [COMPACT_SIGNAL, "E2E_DEEPSEEK_NEAR_LIMIT_CONTINUE"],
			},
			{
				type: "tool",
				id: "call_deepseek_near_limit_completion",
				name: "attempt_completion",
				arguments: { result: "E2E_DEEPSEEK_NEAR_LIMIT_OK" },
				expectedRequestIncludes: ["E2E_DEEPSEEK_NEAR_LIMIT_SUMMARY", "E2E_DEEPSEEK_NEAR_LIMIT_CONTINUE"],
				expectedRequestExcludes: [COMPACT_SIGNAL, COMPACT_INSTRUCTION_MARKER],
				expectedToolResults: [
					{ callId: "call_deepseek_near_limit_ready", contentIncludes: "E2E_DEEPSEEK_NEAR_LIMIT_CONTINUE" },
				],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_DEEPSEEK_NEAR_LIMIT_TASK")
			await expect(sidebar.getByText("E2E_DEEPSEEK_NEAR_LIMIT_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})

			const expandTaskHeader = sidebar.getByLabel("Expand task header")
			if (await expandTaskHeader.isVisible()) await expandTaskHeader.click()
			await expect(sidebar.locator('[title="Current tokens used in this request"]')).toHaveText("980.1k")
			await expect(sidebar.locator('[title="Maximum context window size for this model"]')).toHaveText("1.0m")
			await expect(sidebar.getByRole("progressbar", { name: "Context window usage progress" })).toHaveAttribute(
				"aria-valuenow",
				"98.00999999999999",
			)

			await sendTask(sidebar, "E2E_DEEPSEEK_NEAR_LIMIT_CONTINUE")
			await expect.poll(() => server.getRequestCount("deepseek-chat"), { timeout: 60_000 }).toBeGreaterThanOrEqual(2)
			const requests = server.getMockConsumptions("deepseek-chat")
			const summaryRequest = requests[1]
			const summaryBody = summaryRequest.requestBody as { max_completion_tokens?: number }
			// The model output ceiling is independent from the input-context compaction trigger.
			expect(summaryBody.max_completion_tokens).toBe(384_000)
			expect(summaryRequest).toMatchObject({ responseType: "tool", toolName: "summarize_task" })
			expect(requestToolNames(summaryRequest)).toEqual(requestToolNames(requests[0]))
			expect(requestToolNames(summaryRequest)).not.toContain("summarize_task")

			await expect(sidebar.getByText("E2E_DEEPSEEK_NEAR_LIMIT_OK", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await expect.poll(() => server.getRequestCount("deepseek-chat")).toBe(3)
			await expectCompactionSummary(sidebar, "E2E_DEEPSEEK_NEAR_LIMIT_SUMMARY preserves the task and latest request.")
			await expect
				.poll(async () =>
					Number(
						await sidebar
							.getByRole("progressbar", { name: "Context window usage progress" })
							.getAttribute("aria-valuenow"),
					),
				)
				.toBeLessThan(98.00999999999999)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app.close()
		}
	},
)

e2e(
	"DeepSeek context - context-limit recovery tells the model that history was truncated",
	async ({ dlineDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		await configureDeepSeekAutoCompact(dlineDir, false)
		server.enqueueResponses(
			"deepseek-chat",
			{
				type: "tool",
				id: "call_deepseek_truncation_round_one",
				name: "qna_respond",
				arguments: { response: "E2E_DEEPSEEK_TRUNCATION_ROUND_ONE" },
			},
			{
				type: "tool",
				id: "call_deepseek_truncation_round_two",
				name: "qna_respond",
				arguments: { response: "E2E_DEEPSEEK_TRUNCATION_ROUND_TWO" },
				expectedRequestIncludes: ["E2E_DEEPSEEK_TRUNCATION_MIDDLE"],
			},
			{
				type: "tool",
				id: "call_deepseek_truncation_ready",
				name: "qna_respond",
				arguments: { response: "E2E_DEEPSEEK_TRUNCATION_READY" },
				expectedRequestIncludes: ["E2E_DEEPSEEK_TRUNCATION_LATE"],
			},
			{
				type: "error",
				status: 400,
				code: "context_length_exceeded",
				message: "The DeepSeek request exceeded its context window.",
				requestId: "req_deepseek_truncation_notice",
			},
			{
				type: "tool",
				id: "call_deepseek_truncation_recovered",
				name: "attempt_completion",
				arguments: { result: "E2E_DEEPSEEK_TRUNCATION_RECOVERED" },
				expectedRequestIncludes: [
					"E2E_DEEPSEEK_TRUNCATION_TASK",
					"E2E_DEEPSEEK_TRUNCATION_CONTINUE",
					"[NOTE] Some previous conversation history with the user has been removed",
				],
				expectedRequestExcludes: ["E2E_DEEPSEEK_TRUNCATION_MIDDLE"],
			},
		)

		const app = await openVSCode(workspaceDir)
		try {
			const { sidebar } = await openSidebar(app, helper)
			await sendTask(sidebar, "E2E_DEEPSEEK_TRUNCATION_TASK")
			await expect(sidebar.getByText("E2E_DEEPSEEK_TRUNCATION_ROUND_ONE", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_DEEPSEEK_TRUNCATION_MIDDLE")
			await expect(sidebar.getByText("E2E_DEEPSEEK_TRUNCATION_ROUND_TWO", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_DEEPSEEK_TRUNCATION_LATE")
			await expect(sidebar.getByText("E2E_DEEPSEEK_TRUNCATION_READY", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await sendTask(sidebar, "E2E_DEEPSEEK_TRUNCATION_CONTINUE")

			await expect.poll(() => server.getRequestCount("deepseek-chat"), { timeout: 60_000 }).toBeGreaterThanOrEqual(5)
			const recoveryRequest = server.getMockConsumptions("deepseek-chat")[4]
			expect(JSON.stringify(recoveryRequest.requestBody)).toContain(
				"[NOTE] Some previous conversation history with the user has been removed",
			)
			expect(recoveryRequest).toMatchObject({ responseType: "tool", toolName: "attempt_completion" })
			await expect(sidebar.getByText("E2E_DEEPSEEK_TRUNCATION_RECOVERED", { exact: false }).last()).toBeVisible({
				timeout: 60_000,
			})
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir, [/context window/i])
		} finally {
			await app.close()
		}
	},
)
