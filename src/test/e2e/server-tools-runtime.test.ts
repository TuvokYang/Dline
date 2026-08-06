import { readFile, writeFile } from "node:fs/promises"
import * as path from "node:path"
import { expect, type Frame, type Page } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import type { MockApiConsumption, MockApiTarget } from "./fixtures/server"
import { getE2EMockProviderBaseUrl } from "./fixtures/server/api"
import { E2E_PROFILE_NAMES } from "./utils/api-profile"
import { E2ETestHelper, e2e } from "./utils/helpers"

type StoredWebSearchMode =
	| "WEB_SEARCH_MODE_AUTO"
	| "WEB_SEARCH_MODE_FORCE_LOCAL"
	| "WEB_SEARCH_MODE_FORCE_OFF"
	| "WEB_SEARCH_MODE_FORCE_REMOTE"

interface StoredProviderConfiguration {
	capabilities?: {
		maxTokens?: number
		contextWindow?: number
		supportsTools?: boolean
		tools?: string[]
	}
	[key: string]: unknown
}

interface StoredProfile {
	name: string
	provider: string
	webSearchMode?: StoredWebSearchMode
	openai?: StoredProviderConfiguration
	anthropic?: StoredProviderConfiguration
	[key: string]: unknown
}

interface SearchMechanisms {
	hosted: unknown[]
	local: unknown[]
}

const profilesPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "api_profiles.json")
const settingsPath = (dlineDir: string) => path.join(dlineDir, "data", "settings", "settings.json")

async function prepareRuntimeProfile(
	dlineDir: string,
	profileName: string,
	options: {
		apiFormat?: "OPENAI_CHAT" | "OPENAI_RESPONSES"
		baseUrl?: string
		enabled: boolean
		mode: StoredWebSearchMode
		supportsWebSearch?: boolean
	},
): Promise<void> {
	const profiles = JSON.parse(await readFile(profilesPath(dlineDir), "utf8")) as StoredProfile[]
	const profile = profiles.find((candidate) => candidate.name === profileName)
	if (!profile) throw new Error(`Missing E2E profile: ${profileName}`)

	profile.webSearchMode = options.mode
	if (options.baseUrl) profile.baseUrl = options.baseUrl
	const providerKey = profile.provider === "anthropic" ? "anthropic" : profile.provider === "deepseek" ? "deepseek" : "openai"
	const provider = (profile[providerKey] ?? {}) as StoredProviderConfiguration
	if (options.apiFormat) provider.apiFormat = options.apiFormat
	if (options.supportsWebSearch !== undefined) {
		provider.capabilities = {
			maxTokens: provider.capabilities?.maxTokens ?? 8_192,
			contextWindow: provider.capabilities?.contextWindow ?? 131_072,
			supportsTools: true,
			...provider.capabilities,
			tools: options.supportsWebSearch ? ["WEB_SEARCH"] : [],
		}
	}
	profile[providerKey] = provider
	await writeFile(profilesPath(dlineDir), `${JSON.stringify(profiles, null, 2)}\n`, "utf8")

	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	settings.actModeProfile = profileName
	settings.planModeProfile = profileName
	settings.clineWebToolsEnabled = options.enabled
	await writeFile(settingsPath(dlineDir), `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}

async function openSidebar(
	openVSCode: (workspacePath: string) => Promise<ElectronApplication>,
	workspaceDir: string,
	helper: E2ETestHelper,
): Promise<{ app: ElectronApplication; page: Page; sidebar: Frame }> {
	const app = await openVSCode(workspaceDir)
	const page = await app.firstWindow()
	await E2ETestHelper.openClineSidebar(page)
	const sidebar = await helper.getSidebar(page)
	await E2ETestHelper.dismissWhatsNewModal(sidebar)
	await helper.signin(sidebar)
	return { app, page, sidebar }
}

async function configureSearxngSearch(dlineDir: string, serverBaseUrl: string): Promise<void> {
	const settings = JSON.parse(await readFile(settingsPath(dlineDir), "utf8")) as Record<string, unknown>
	settings.clineWebToolsEnabled = true
	settings.localWebSearchEngine = "searxng"
	settings.searxngSearchUrl = `${serverBaseUrl}/mock/searxng`
	await writeFile(settingsPath(dlineDir), `${JSON.stringify(settings, null, 2)}\n`, "utf8")
}

async function sendTask(sidebar: Frame, text: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(text, { exact: true }).first()).toBeVisible()
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

function searchMechanisms(consumption: MockApiConsumption): SearchMechanisms {
	const body = consumption.requestBody as { tools?: Array<Record<string, unknown>> }
	const hosted: unknown[] = []
	const local: unknown[] = []
	for (const tool of body.tools ?? []) {
		const type = tool.type
		const name = tool.name
		const functionName = (tool.function as { name?: unknown } | undefined)?.name
		if (type === "web_search" || type === "web_search_20250305") hosted.push(tool)
		if (
			(type === "function" && (functionName === "web_search" || name === "web_search")) ||
			(type === undefined && name === "web_search")
		) {
			local.push(tool)
		}
	}
	return { hosted, local }
}

function expectSingleSearchRoute(consumption: MockApiConsumption, expected: "hosted" | "local" | "none"): void {
	const mechanisms = searchMechanisms(consumption)
	expect(mechanisms.hosted).toHaveLength(expected === "hosted" ? 1 : 0)
	expect(mechanisms.local).toHaveLength(expected === "local" ? 1 : 0)
	expect(mechanisms.hosted.length + mechanisms.local.length).toBeLessThanOrEqual(1)
}

function expectIsolatedDirectories(dlineDir: string, dlineHomeDir: string, dlineDocsDir: string): void {
	expect(path.resolve(dlineHomeDir)).toBe(path.resolve(dlineDir))
	expect(path.resolve(dlineDocsDir)).not.toBe(path.resolve(dlineDir))
}

async function expectHostedLifecycle(sidebar: Frame, query: string): Promise<void> {
	await expect(sidebar.getByText("Dline searched the web for:", { exact: true })).toBeVisible({ timeout: 60_000 })
	const queryDisplay = sidebar.locator("span.ph-no-capture").filter({ hasText: query })
	await expect(queryDisplay).toHaveCount(1)
	await expect(queryDisplay).toContainText(query)
}

e2e(
	"ServerTool runtime - OpenAI built-in Responses metadata uses one hosted Web Search and renders its lifecycle",
	async ({ dlineDir, dlineDocsDir, dlineHomeDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		expectIsolatedDirectories(dlineDir, dlineHomeDir, dlineDocsDir)
		await prepareRuntimeProfile(dlineDir, E2E_PROFILE_NAMES.mockOpenAiOfficialResponses, {
			enabled: true,
			mode: "WEB_SEARCH_MODE_AUTO",
		})
		const query = "Dline OpenAI hosted search"
		const completion = "E2E_OPENAI_HOSTED_WEB_SEARCH_OK"
		server.enqueueResponses("openai-official-responses", {
			type: "hosted-web-search",
			id: "ws_openai_e2e",
			query,
			results: [{ title: "OpenAI hosted result", url: "https://example.test/openai-hosted" }],
			followupTools: [{ id: "call_openai_hosted_done", name: "attempt_completion", arguments: { result: completion } }],
		})

		let app: ElectronApplication | undefined
		try {
			const opened = await openSidebar(openVSCode, workspaceDir, helper)
			app = opened.app
			await sendTask(opened.sidebar, "Use OpenAI provider-hosted search and finish the task.")
			await expectHostedLifecycle(opened.sidebar, query)
			await expect(opened.sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 60_000 })

			const [firstRequest] = server.getMockConsumptions("openai-official-responses")
			expect(firstRequest).toBeDefined()
			expectSingleSearchRoute(firstRequest, "hosted")
			expect(server.getSearxngSearchRequests()).toHaveLength(0)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app?.close()
		}
	},
)

e2e(
	"ServerTool runtime - Force Remote on OpenAI Responses uses hosted Web Search without a local duplicate",
	async ({ dlineDir, dlineDocsDir, dlineHomeDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		expectIsolatedDirectories(dlineDir, dlineHomeDir, dlineDocsDir)
		await prepareRuntimeProfile(dlineDir, E2E_PROFILE_NAMES.mockOpenAiResponses, {
			enabled: true,
			mode: "WEB_SEARCH_MODE_FORCE_REMOTE",
			supportsWebSearch: true,
		})
		const query = "Dline forced remote hosted search"
		const completion = "E2E_FORCE_REMOTE_HOSTED_WEB_SEARCH_OK"
		server.enqueueResponses("openai-compatible-responses", {
			type: "hosted-web-search",
			id: "ws_openai_force_remote_e2e",
			query,
			results: [{ title: "Forced remote result", url: "https://example.test/forced-remote" }],
			followupTools: [{ id: "call_force_remote_done", name: "attempt_completion", arguments: { result: completion } }],
		})

		let app: ElectronApplication | undefined
		try {
			const opened = await openSidebar(openVSCode, workspaceDir, helper)
			app = opened.app
			await sendTask(opened.sidebar, "Use forced remote web search and finish the task.")
			await expectHostedLifecycle(opened.sidebar, query)
			await expect(opened.sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 60_000 })

			const [firstRequest] = server.getMockConsumptions("openai-compatible-responses")
			expect(firstRequest).toBeDefined()
			expectSingleSearchRoute(firstRequest, "hosted")
			expect(server.getSearxngSearchRequests()).toHaveLength(0)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app?.close()
		}
	},
)

e2e(
	"ServerTool runtime - DeepSeek Responses Auto projects built-in Web Search metadata and renders its lifecycle",
	async ({ dlineDir, dlineDocsDir, dlineHomeDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		expectIsolatedDirectories(dlineDir, dlineHomeDir, dlineDocsDir)
		await prepareRuntimeProfile(dlineDir, E2E_PROFILE_NAMES.mockDeepSeek, {
			apiFormat: "OPENAI_RESPONSES",
			baseUrl: getE2EMockProviderBaseUrl(server.baseUrl, "deepseek-responses"),
			enabled: true,
			mode: "WEB_SEARCH_MODE_AUTO",
		})
		const query = "Dline DeepSeek hosted search"
		const completion = "E2E_DEEPSEEK_HOSTED_WEB_SEARCH_OK"
		server.enqueueResponses("deepseek-responses", {
			type: "hosted-web-search",
			id: "ws_deepseek_e2e",
			query,
			results: [{ title: "DeepSeek hosted result", url: "https://example.test/deepseek-hosted" }],
			followupTools: [{ id: "call_deepseek_hosted_done", name: "attempt_completion", arguments: { result: completion } }],
		})

		let app: ElectronApplication | undefined
		try {
			const opened = await openSidebar(openVSCode, workspaceDir, helper)
			app = opened.app
			await sendTask(opened.sidebar, "Use DeepSeek provider-hosted search and finish the task.")
			await expectHostedLifecycle(opened.sidebar, query)
			await expect(opened.sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 60_000 })

			const [firstRequest] = server.getMockConsumptions("deepseek-responses")
			expect(firstRequest).toBeDefined()
			expectSingleSearchRoute(firstRequest, "hosted")
			expect(server.getSearxngSearchRequests()).toHaveLength(0)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app?.close()
		}
	},
)

e2e(
	"ServerTool runtime - Anthropic Auto uses one hosted Web Search and renders its lifecycle",
	async ({ dlineDir, dlineDocsDir, dlineHomeDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		expectIsolatedDirectories(dlineDir, dlineHomeDir, dlineDocsDir)
		await prepareRuntimeProfile(dlineDir, E2E_PROFILE_NAMES.mockAnthropic, {
			enabled: true,
			mode: "WEB_SEARCH_MODE_AUTO",
			supportsWebSearch: true,
		})
		const query = "Dline Anthropic hosted search"
		const completion = "E2E_ANTHROPIC_HOSTED_WEB_SEARCH_OK"
		server.enqueueResponses("anthropic-messages", {
			type: "hosted-web-search",
			id: "srv_web_anthropic_e2e",
			query,
			results: [{ title: "Anthropic hosted result", url: "https://example.test/anthropic-hosted" }],
			followupTools: [{ id: "call_anthropic_hosted_done", name: "attempt_completion", arguments: { result: completion } }],
		})

		let app: ElectronApplication | undefined
		try {
			const opened = await openSidebar(openVSCode, workspaceDir, helper)
			app = opened.app
			await sendTask(opened.sidebar, "Use Anthropic hosted search and finish the task.")
			await expectHostedLifecycle(opened.sidebar, query)
			await expect(opened.sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 60_000 })

			const [firstRequest] = server.getMockConsumptions("anthropic-messages")
			expect(firstRequest).toBeDefined()
			expectSingleSearchRoute(firstRequest, "hosted")
			expect(server.getSearxngSearchRequests()).toHaveLength(0)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app?.close()
		}
	},
)

e2e(
	"ServerTool runtime - Auto falls back to local Web Search and returns its result to the provider",
	async ({ dlineDir, dlineDocsDir, dlineHomeDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		expectIsolatedDirectories(dlineDir, dlineHomeDir, dlineDocsDir)
		await prepareRuntimeProfile(dlineDir, E2E_PROFILE_NAMES.mockOpenAi, {
			enabled: true,
			mode: "WEB_SEARCH_MODE_AUTO",
			supportsWebSearch: true,
		})
		await configureSearxngSearch(dlineDir, server.baseUrl)
		const query = "Dline local fallback search"
		const resultMarker = `E2E local result for ${query}`
		const completion = "E2E_LOCAL_WEB_SEARCH_RESULT_REPLAYED"
		server.enqueueResponses(
			"openai-compatible-chat",
			{ type: "tool", id: "call_local_web_search", name: "web_search", arguments: { query } },
			{
				type: "tool",
				id: "call_local_web_search_done",
				name: "attempt_completion",
				arguments: { result: completion },
				expectedToolResults: [{ callId: "call_local_web_search", contentIncludes: resultMarker }],
			},
		)

		let app: ElectronApplication | undefined
		try {
			const opened = await openSidebar(openVSCode, workspaceDir, helper)
			app = opened.app
			await sendTask(opened.sidebar, "Search locally when hosted search is unavailable, then finish.")
			await expect(opened.sidebar.getByText("Dline wants to search the web for:", { exact: true })).toBeVisible({
				timeout: 60_000,
			})
			await opened.sidebar.getByText("Approve", { exact: true }).click()
			await expect(opened.sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 60_000 })

			const consumptions = server.getMockConsumptions("openai-compatible-chat")
			expect(consumptions).toHaveLength(2)
			expectSingleSearchRoute(consumptions[0], "local")
			const [searchRequest] = server.getSearxngSearchRequests()
			expect(searchRequest).toMatchObject({ query, format: "json" })
			expect(searchRequest.authorization).toBeUndefined()
			expect(JSON.stringify(consumptions[1].requestBody)).toContain(resultMarker)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app?.close()
		}
	},
)

e2e(
	"ServerTool runtime - pending local Web Search remains executable after closing and reopening the task",
	async ({ dlineDir, dlineDocsDir, dlineHomeDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		expectIsolatedDirectories(dlineDir, dlineHomeDir, dlineDocsDir)
		await prepareRuntimeProfile(dlineDir, E2E_PROFILE_NAMES.mockOpenAi, {
			enabled: true,
			mode: "WEB_SEARCH_MODE_AUTO",
			supportsWebSearch: true,
		})
		await configureSearxngSearch(dlineDir, server.baseUrl)
		const query = "Dline restored local search"
		const resultMarker = `E2E local result for ${query}`
		const completion = "E2E_RESTORED_LOCAL_WEB_SEARCH_OK"
		server.enqueueResponses(
			"openai-compatible-chat",
			{ type: "tool", id: "call_restored_local_search", name: "web_search", arguments: { query } },
			{
				type: "tool",
				id: "call_restored_local_search_done",
				name: "attempt_completion",
				arguments: { result: completion },
				expectedToolResults: [{ callId: "call_restored_local_search", contentIncludes: resultMarker }],
			},
		)

		let app: ElectronApplication | undefined
		try {
			const opened = await openSidebar(openVSCode, workspaceDir, helper)
			app = opened.app
			const taskText = "Search locally only after I reopen and approve this task."
			await sendTask(opened.sidebar, taskText)
			await expect(opened.sidebar.getByText("Approve", { exact: true })).toBeVisible({ timeout: 60_000 })
			expect(server.getSearxngSearchRequests()).toHaveLength(0)

			await closeCurrentTask(opened.sidebar)
			await reopenTask(opened.sidebar, taskText)
			const approveButton = opened.sidebar.getByRole("contentinfo").getByText("Approve", { exact: true })
			await expect(approveButton).toBeVisible({ timeout: 30_000 })
			await approveButton.click()

			await expect(opened.sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
			await expect.poll(() => server.getSearxngSearchRequests().length, { timeout: 30_000 }).toBe(1)
			const consumptions = server.getMockConsumptions("openai-compatible-chat")
			expect(consumptions).toHaveLength(2)
			expect(consumptions[1].contractError).toBeUndefined()
			expect(JSON.stringify(consumptions[1].requestBody)).toContain(resultMarker)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app?.close()
		}
	},
)

e2e(
	"ServerTool runtime - Force Local on OpenAI Responses executes local Web Search instead of hosted search",
	async ({ dlineDir, dlineDocsDir, dlineHomeDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
		e2e.setTimeout(180_000)
		expectIsolatedDirectories(dlineDir, dlineHomeDir, dlineDocsDir)
		await prepareRuntimeProfile(dlineDir, E2E_PROFILE_NAMES.mockOpenAiResponses, {
			enabled: true,
			mode: "WEB_SEARCH_MODE_FORCE_LOCAL",
			supportsWebSearch: true,
		})
		await configureSearxngSearch(dlineDir, server.baseUrl)
		const query = "Dline forced local search"
		const resultMarker = `E2E local result for ${query}`
		const completion = "E2E_FORCE_LOCAL_WEB_SEARCH_RESULT_REPLAYED"
		server.enqueueResponses(
			"openai-compatible-responses",
			{ type: "tool", id: "call_force_local_web_search", name: "web_search", arguments: { query } },
			{
				type: "tool",
				id: "call_force_local_web_search_done",
				name: "attempt_completion",
				arguments: { result: completion },
				expectedToolResults: [{ callId: "call_force_local_web_search", contentIncludes: resultMarker }],
			},
		)

		let app: ElectronApplication | undefined
		try {
			const opened = await openSidebar(openVSCode, workspaceDir, helper)
			app = opened.app
			await sendTask(opened.sidebar, "Force local web search even though hosted search is available, then finish.")
			await expect(opened.sidebar.getByText("Dline wants to search the web for:", { exact: true })).toBeVisible({
				timeout: 60_000,
			})
			await opened.sidebar.getByText("Approve", { exact: true }).click()
			await expect(opened.sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 60_000 })

			const consumptions = server.getMockConsumptions("openai-compatible-responses")
			expect(consumptions).toHaveLength(2)
			expectSingleSearchRoute(consumptions[0], "local")
			const [searchRequest] = server.getSearxngSearchRequests()
			expect(searchRequest).toMatchObject({ query, format: "json" })
			expect(searchRequest.authorization).toBeUndefined()
			expect(JSON.stringify(consumptions[1].requestBody)).toContain(resultMarker)
			await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
		} finally {
			await app?.close()
		}
	},
)

const webFetchCases = [
	{
		title: "OpenAI Chat",
		profileName: E2E_PROFILE_NAMES.mockOpenAi,
		target: "openai-compatible-chat" as MockApiTarget,
	},
	{
		title: "OpenAI Responses",
		profileName: E2E_PROFILE_NAMES.mockOpenAiResponses,
		target: "openai-compatible-responses" as MockApiTarget,
	},
] as const

for (const testCase of webFetchCases) {
	e2e(
		`ServerTool runtime - ${testCase.title} executes local Web Fetch without a Cline login`,
		async ({ dlineDir, dlineDocsDir, dlineHomeDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
			e2e.setTimeout(180_000)
			expectIsolatedDirectories(dlineDir, dlineHomeDir, dlineDocsDir)
			await prepareRuntimeProfile(dlineDir, testCase.profileName, {
				enabled: true,
				mode: "WEB_SEARCH_MODE_AUTO",
				supportsWebSearch: true,
			})
			const url = `${server.baseUrl}/mock/web-fetch/page`
			const prompt = "Extract the local Web Fetch marker"
			const completion = `E2E_${testCase.target.toUpperCase().replaceAll("-", "_")}_WEB_FETCH_OK`
			server.enqueueResponses(
				testCase.target,
				{ type: "tool", id: `call_${testCase.target}_web_fetch`, name: "web_fetch", arguments: { url, prompt } },
				{
					type: "tool",
					id: `call_${testCase.target}_web_fetch_done`,
					name: "attempt_completion",
					arguments: { result: completion },
					expectedToolResults: [
						{
							callId: `call_${testCase.target}_web_fetch`,
							contentIncludes: ["Dline local Web Fetch", prompt],
						},
					],
					expectedRequestExcludes: ["REMOVE_NAVIGATION", "REMOVE_SCRIPT"],
				},
			)

			let app: ElectronApplication | undefined
			try {
				const opened = await openSidebar(openVSCode, workspaceDir, helper)
				app = opened.app
				await sendTask(opened.sidebar, `Use ${testCase.title} local Web Fetch without signing in to Cline.`)
				await expect(
					opened.sidebar.getByText("Dline wants to fetch content from this URL:", { exact: true }),
				).toBeVisible({
					timeout: 60_000,
				})
				await opened.sidebar.getByText("Approve", { exact: true }).click()
				await expect(opened.sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 90_000 })

				const consumptions = server.getMockConsumptions(testCase.target)
				expect(consumptions).toHaveLength(2)
				expect(consumptions[1].contractError).toBeUndefined()
				const [pageRequest] = server.getWebFetchPageRequests()
				expect(pageRequest).toBeDefined()
				expect(pageRequest.authorization).toBeUndefined()
				expect(server.getWebFetchPageRequests()).toHaveLength(1)
				await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
			} finally {
				await app?.close()
			}
		},
	)
}

const disabledCases = [
	{
		title: "the global Web Tools switch is off",
		profileName: E2E_PROFILE_NAMES.mockOpenAiResponses,
		target: "openai-compatible-responses" as MockApiTarget,
		enabled: false,
		mode: "WEB_SEARCH_MODE_AUTO" as StoredWebSearchMode,
	},
	{
		title: "the provider mode is Off",
		profileName: E2E_PROFILE_NAMES.mockOpenAi,
		target: "openai-compatible-chat" as MockApiTarget,
		enabled: true,
		mode: "WEB_SEARCH_MODE_FORCE_OFF" as StoredWebSearchMode,
	},
	{
		title: "Force Remote is selected for an unsupported transport",
		profileName: E2E_PROFILE_NAMES.mockOpenAi,
		target: "openai-compatible-chat" as MockApiTarget,
		enabled: true,
		mode: "WEB_SEARCH_MODE_FORCE_REMOTE" as StoredWebSearchMode,
	},
] as const

for (const testCase of disabledCases) {
	e2e(
		`ServerTool runtime - exposes no search mechanism when ${testCase.title}`,
		async ({ dlineDir, dlineDocsDir, dlineHomeDir, helper, openVSCode, server, userDataDir, workspaceDir }) => {
			e2e.setTimeout(150_000)
			expectIsolatedDirectories(dlineDir, dlineHomeDir, dlineDocsDir)
			await prepareRuntimeProfile(dlineDir, testCase.profileName, {
				enabled: testCase.enabled,
				mode: testCase.mode,
				supportsWebSearch: true,
			})
			const completion = `E2E_NO_SEARCH_${testCase.mode}_${testCase.enabled ? "ON" : "OFF"}`
			server.enqueueResponses(testCase.target, {
				type: "tool",
				id: `call_${testCase.mode.toLowerCase()}_done`,
				name: "attempt_completion",
				arguments: { result: completion },
			})

			let app: ElectronApplication | undefined
			try {
				const opened = await openSidebar(openVSCode, workspaceDir, helper)
				app = opened.app
				await sendTask(opened.sidebar, `Finish without web search because ${testCase.title}.`)
				await expect(opened.sidebar.getByText(completion, { exact: false }).last()).toBeVisible({ timeout: 60_000 })

				const [firstRequest] = server.getMockConsumptions(testCase.target)
				expect(firstRequest).toBeDefined()
				expectSingleSearchRoute(firstRequest, "none")
				expect(server.getSearxngSearchRequests()).toHaveLength(0)
				await expect(opened.sidebar.getByText(/search(ed)? the web for:/i)).toHaveCount(0)
				await E2ETestHelper.expectNoUnexpectedDlineErrors(userDataDir)
			} finally {
				await app?.close()
			}
		},
	)
}
