import { randomUUID } from "node:crypto"
import { access, readFile, writeFile } from "node:fs/promises"
import { createServer, get as httpGet, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import * as path from "node:path"
import { expect, type Frame, type Locator, type Page } from "@playwright/test"
import type { ElectronApplication } from "playwright"
import { getOpenAiCodexProfileAuthFileName } from "../../core/storage/secrets/OpenAiCodexProfileAuthPath"
import { E2ETestHelper, e2e } from "./utils/helpers"
import { MultiInstanceLauncher } from "./utils/multi-instance"

interface OAuthScenario {
	accountId: string
	accessToken: string
	refreshToken: string
	responseText: string
}

interface CodexRequest {
	authorization?: string
	accountId?: string
}

interface StoredProfile {
	id: string
	name: string
	provider: string
	modelId: string
	usedFor: string[]
	enabled: boolean
	webSearchMode?: string
}

class CodexOAuthE2EServer {
	private readonly server: Server
	private readonly scenarios: OAuthScenario[] = []
	private readonly exchanges = new Map<string, OAuthScenario>()
	private readonly callbackByState = new Map<string, string>()
	private readonly callbacks: string[] = []
	readonly authorizationRequests: string[] = []
	readonly callbackDeliveryErrors: string[] = []
	readonly callbackDeliveryStatuses: number[] = []
	readonly codexRequests: CodexRequest[] = []
	tokenRequestCount = 0
	baseUrl = ""

	constructor() {
		this.server = createServer((request, response) => void this.handle(request, response))
	}

	async start(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			this.server.once("error", reject)
			this.server.listen(0, "127.0.0.1", () => resolve())
		})
		const address = this.server.address() as AddressInfo
		this.baseUrl = `http://127.0.0.1:${address.port}`
	}

	async stop(): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			this.server.close((error) => (error ? reject(error) : resolve()))
		})
	}

	enqueue(scenario: OAuthScenario): void {
		this.scenarios.push(scenario)
	}

	latestCallback(): string | undefined {
		return this.callbacks.at(-1)
	}

	allCallbacks(): readonly string[] {
		return [...this.callbacks]
	}

	private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		try {
			const url = new URL(request.url ?? "/", this.baseUrl)
			if (request.method === "GET" && url.pathname.startsWith("/oauth/authorize/")) {
				this.authorize(url, response)
				return
			}
			if (request.method === "POST" && url.pathname === "/oauth/token") {
				await this.token(request, response)
				return
			}
			if (request.method === "POST" && url.pathname === "/codex/responses") {
				this.codex(request, response)
				return
			}
			if (request.method === "GET" && url.pathname === "/usage") {
				this.json(response, 200, { rate_limit: {}, credits: { balance: 0 } })
				return
			}
			this.json(response, 404, { error: "not_found" })
		} catch {
			this.json(response, 500, { error: "mock_failure" })
		}
	}

	private authorize(url: URL, response: ServerResponse): void {
		this.authorizationRequests.push(url.toString())
		const redirectUri = url.searchParams.get("redirect_uri")
		const state = url.searchParams.get("state")
		if (!redirectUri || !state || !url.searchParams.get("code_challenge")) {
			this.json(response, 400, { error: "invalid_authorization_request" })
			return
		}

		let callbackUri = this.callbackByState.get(state)
		if (!callbackUri) {
			const scenario = this.scenarios.shift()
			if (!scenario) {
				this.json(response, 400, { error: "missing_oauth_scenario" })
				return
			}
			const code = randomUUID()
			this.exchanges.set(code, scenario)
			const callback = new URL(redirectUri)
			callback.searchParams.set("code", code)
			callback.searchParams.set("state", state)
			callbackUri = callback.toString()
			this.callbackByState.set(state, callbackUri)
			this.callbacks.push(callbackUri)
		}

		if (url.pathname.endsWith("/manual")) {
			response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
			response.end(
				`<!doctype html><title>OAuth callback</title><p>Copy this callback URI into Dline:</p><code>${callbackUri}</code>`,
			)
			return
		}
		this.deliverCallback(callbackUri)
		response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
		response.end("<!doctype html><title>OAuth complete</title><p>Authorization completed. You can close this window.</p>")
	}

	private deliverCallback(callbackUri: string): void {
		const request = httpGet(callbackUri, (response) => {
			this.callbackDeliveryStatuses.push(response.statusCode ?? 0)
			response.resume()
		})
		request.on("error", (error) => this.callbackDeliveryErrors.push(error.message))
	}

	private async token(request: IncomingMessage, response: ServerResponse): Promise<void> {
		this.tokenRequestCount += 1
		const body = new URLSearchParams(await this.readBody(request))
		const scenario = this.exchanges.get(body.get("code") ?? "")
		if (!scenario || body.get("grant_type") !== "authorization_code" || !body.get("code_verifier")) {
			this.json(response, 400, { error: "invalid_grant" })
			return
		}
		this.exchanges.delete(body.get("code")!)
		this.json(response, 200, {
			access_token: scenario.accessToken,
			refresh_token: scenario.refreshToken,
			expires_in: 3600,
			id_token: this.jwt({ chatgpt_account_id: scenario.accountId }),
		})
	}

	private codex(request: IncomingMessage, response: ServerResponse): void {
		const authorization = typeof request.headers.authorization === "string" ? request.headers.authorization : undefined
		const accountId =
			typeof request.headers["chatgpt-account-id"] === "string" ? request.headers["chatgpt-account-id"] : undefined
		this.codexRequests.push({ authorization, accountId })
		const text = accountId ? `CODEX_E2E_${accountId}` : "CODEX_E2E_MISSING_ACCOUNT"
		response.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		})
		response.write(`data: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`)
		response.write(
			`data: ${JSON.stringify({ type: "response.completed", response: { usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
		)
		response.end("data: [DONE]\n\n")
	}

	private jwt(payload: Record<string, unknown>): string {
		return `e2e.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`
	}

	private readBody(request: IncomingMessage): Promise<string> {
		return new Promise((resolve, reject) => {
			let body = ""
			request.setEncoding("utf8")
			request.on("data", (chunk) => (body += chunk))
			request.on("end", () => resolve(body))
			request.on("error", reject)
		})
	}

	private json(response: ServerResponse, status: number, body: unknown): void {
		response.writeHead(status, { "Content-Type": "application/json" })
		response.end(JSON.stringify(body))
	}
}

function scenario(label: string): OAuthScenario {
	return {
		accountId: `account-${label}`,
		accessToken: randomUUID(),
		refreshToken: randomUUID(),
		responseText: `CODEX_E2E_account-${label}`,
	}
}

async function pathExists(filePath: string): Promise<boolean> {
	return access(filePath)
		.then(() => true)
		.catch(() => false)
}

async function addCodexProfiles(dlineDir: string, profiles: readonly StoredProfile[]): Promise<void> {
	const profilesPath = path.join(dlineDir, "data", "settings", "api_profiles.json")
	const current = JSON.parse(await readFile(profilesPath, "utf8")) as StoredProfile[]
	await writeFile(profilesPath, `${JSON.stringify([...current, ...profiles], null, 2)}\n`, "utf8")
}

function codexProfile(id: string, name: string): StoredProfile {
	return {
		id,
		name,
		provider: "openai-codex",
		modelId: "gpt-5.6-sol",
		usedFor: ["act", "plan"],
		enabled: true,
		webSearchMode: "WEB_SEARCH_MODE_FORCE_OFF",
	}
}

function profileCard(sidebar: Frame, name: string): Locator {
	const escapedName = name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
	const cards = sidebar.getByTestId("api-profile-card")
	const expanded = cards.filter({
		has: sidebar.locator(`input[aria-label="Profile name"][value="${escapedName}"]`),
	})
	return expanded.or(cards.filter({ hasText: name }))
}

async function openSettings(page: Page, sidebar: Frame): Promise<void> {
	await page.getByRole("button", { name: "Settings", exact: true }).click()
	await expect(sidebar.getByRole("heading", { name: "API Configuration" })).toBeVisible()
}

async function expandProfile(sidebar: Frame, name: string): Promise<Locator> {
	let card = profileCard(sidebar, name)
	await expect(card).toHaveCount(1)
	const expand = card.getByRole("button", { name: `Expand ${name}` })
	if (await expand.isVisible()) await expand.click()
	card = profileCard(sidebar, name)
	await expect(card.getByRole("combobox", { name: "Provider", exact: true })).toBeVisible()
	return card
}

async function signInProfile(sidebar: Frame, name: string, server: CodexOAuthE2EServer): Promise<void> {
	const authorizationCount = server.authorizationRequests.length
	const callbackCount = server.allCallbacks().length
	const tokenRequestCount = server.tokenRequestCount
	const card = await expandProfile(sidebar, name)
	await card.getByRole("button", { name: "Sign in with ChatGPT" }).click()
	await expect.poll(() => server.authorizationRequests.length, { timeout: 30_000 }).toBeGreaterThan(authorizationCount)
	await expect.poll(() => server.allCallbacks().length, { timeout: 30_000 }).toBeGreaterThan(callbackCount)
	try {
		await expect.poll(() => server.tokenRequestCount, { timeout: 30_000 }).toBeGreaterThan(tokenRequestCount)
	} catch (error) {
		throw new Error(
			`OAuth callback did not reach token exchange; statuses=${JSON.stringify(server.callbackDeliveryStatuses)} deliveryErrors=${JSON.stringify(server.callbackDeliveryErrors)}`,
			{ cause: error },
		)
	}
	await expect(card.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 30_000 })
	expect(server.callbackDeliveryErrors).toEqual([])
}

async function selectProfile(sidebar: Frame, name: string): Promise<void> {
	const switcher = sidebar.getByRole("button", { name: "Select model" })
	for (let attempt = 1; attempt <= 3; attempt++) {
		if ((await switcher.innerText()).trim() === name) return
		await switcher.click()
		const option = sidebar.getByRole("option").filter({ has: sidebar.getByText(name, { exact: true }) })
		await expect(option).toHaveCount(1)
		await option.click()
		try {
			await expect(switcher).toHaveText(name, { timeout: 15_000 })
			return
		} catch (error) {
			if (attempt === 3) throw error
		}
	}
}

async function send(sidebar: Frame, text: string, expected: string): Promise<void> {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeEnabled({ timeout: 60_000 })
	await input.fill(text)
	await sidebar.getByTestId("send-button").click()
	await expect(sidebar.getByText(expected, { exact: false }).last()).toBeVisible({ timeout: 60_000 })
}

async function openReadySidebar(
	openVSCode: (
		workspacePath: string,
		environmentOverrides?: Readonly<Record<string, string>>,
		launchOptions?: { recordVideo?: boolean },
	) => Promise<ElectronApplication>,
	workspaceDir: string,
	helper: E2ETestHelper,
	environment: Readonly<Record<string, string>>,
): Promise<{ app: ElectronApplication; page: Page; sidebar: Frame }> {
	let first: ElectronApplication | undefined
	try {
		first = await openVSCode(workspaceDir, environment, { recordVideo: false })
		const page = await first.firstWindow()
		await E2ETestHelper.openClineSidebar(page)
		return { app: first, page, sidebar: await helper.getSidebar(page) }
	} catch {
		await first?.close().catch(() => undefined)
		helper.clearCachedFrame()
		const app = await openVSCode(workspaceDir, environment, { recordVideo: false })
		const page = await app.firstWindow()
		await E2ETestHelper.openClineSidebar(page)
		return { app, page, sidebar: await helper.getSidebar(page) }
	}
}

function codexEnvironment(server: CodexOAuthE2EServer, mode: "automatic" | "manual"): Readonly<Record<string, string>> {
	return {
		DLINE_E2E_OPENAI_CODEX_OAUTH_BASE_URL: `${server.baseUrl}/oauth`,
		DLINE_E2E_OPENAI_CODEX_API_BASE_URL: `${server.baseUrl}/codex`,
		DLINE_E2E_OPENAI_CODEX_USAGE_URL: `${server.baseUrl}/usage`,
		DLINE_E2E_OPENAI_CODEX_OAUTH_MODE: mode,
	}
}

function assertNoRuntimeSecrets(value: string, scenarios: readonly OAuthScenario[], callbacks: readonly string[]): void {
	for (const item of scenarios) {
		expect(value).not.toContain(item.accessToken)
		expect(value).not.toContain(item.refreshToken)
	}
	for (const callback of callbacks) {
		expect(value).not.toContain(callback)
		const parsed = new URL(callback)
		for (const name of ["code", "state"] as const) {
			const secret = parsed.searchParams.get(name)
			if (secret) expect(value).not.toContain(secret)
		}
	}
}

e2e(
	"OpenAI Codex OAuth keeps two Profiles isolated across restart, requests and targeted lifecycle changes",
	async ({ dlineDir, helper, openVSCode, userDataDir, workspaceDir }) => {
		e2e.setTimeout(240_000)
		const server = new CodexOAuthE2EServer()
		await server.start()
		const profileA = codexProfile("codex-profile-a", "Codex Profile A")
		const profileB = codexProfile("codex-profile-b", "Codex Profile B")
		const authA = scenario("a")
		const authB = scenario("b")
		const authA2 = scenario("a2")
		server.enqueue(authA)
		server.enqueue(authB)
		server.enqueue(authA2)
		await addCodexProfiles(dlineDir, [profileA, profileB])
		const environment = codexEnvironment(server, "automatic")
		let app: ElectronApplication | undefined
		let reopened: ElectronApplication | undefined

		try {
			const initial = await openReadySidebar(openVSCode, workspaceDir, helper, environment)
			app = initial.app
			const page = initial.page
			let sidebar = initial.sidebar
			await helper.signin(sidebar)
			await openSettings(page, sidebar)
			await signInProfile(sidebar, profileA.name, server)
			await signInProfile(sidebar, profileB.name, server)

			const secretsDir = path.join(dlineDir, "data", "secrets")
			const authPathA = path.join(secretsDir, getOpenAiCodexProfileAuthFileName(profileA.id))
			const authPathB = path.join(secretsDir, getOpenAiCodexProfileAuthFileName(profileB.id))
			await expect.poll(() => pathExists(authPathA)).toBe(true)
			await expect.poll(() => pathExists(authPathB)).toBe(true)
			const storedA = JSON.parse(await readFile(authPathA, "utf8")) as Record<string, unknown>
			const storedB = JSON.parse(await readFile(authPathB, "utf8")) as Record<string, unknown>
			expect(storedA.accountId).toBe(authA.accountId)
			expect(storedB.accountId).toBe(authB.accountId)
			expect(storedA.access_token).not.toBe(storedB.access_token)

			await app.close()
			app = undefined
			helper.clearCachedFrame()
			const restarted = await openReadySidebar(openVSCode, workspaceDir, helper, environment)
			reopened = restarted.app
			const reopenedPage = restarted.page
			sidebar = restarted.sidebar
			await helper.signin(sidebar)
			await openSettings(reopenedPage, sidebar)
			for (const profile of [profileA, profileB]) {
				await expandProfile(sidebar, profile.name)
				await expect(profileCard(sidebar, profile.name).getByText("Signed in", { exact: true })).toBeVisible()
			}
			await sidebar.getByRole("button", { name: "Done", exact: true }).click()

			await selectProfile(sidebar, profileA.name)
			await send(sidebar, "Run Codex Profile A", authA.responseText)
			await sidebar.getByRole("button", { name: "Close Task", exact: true }).click()
			await selectProfile(sidebar, profileB.name)
			await send(sidebar, "Run Codex Profile B", authB.responseText)
			await expect.poll(() => server.codexRequests.length).toBe(2)
			expect(server.codexRequests).toEqual([
				{ authorization: `Bearer ${authA.accessToken}`, accountId: authA.accountId },
				{ authorization: `Bearer ${authB.accessToken}`, accountId: authB.accountId },
			])

			await sidebar.getByRole("button", { name: "Close Task", exact: true }).click()
			await openSettings(reopenedPage, sidebar)
			await expandProfile(sidebar, profileA.name)
			const renamedA = "Codex Profile A Renamed"
			const profileName = profileCard(sidebar, profileA.name).getByRole("textbox", { name: "Profile name" })
			await profileName.fill(renamedA)
			await profileName.blur()
			await expect(profileCard(sidebar, renamedA)).toHaveCount(1)
			expect(await pathExists(authPathA)).toBe(true)

			await profileCard(sidebar, renamedA).getByRole("button", { name: "Sign out" }).click()
			await expect.poll(() => pathExists(authPathA)).toBe(false)
			expect(await pathExists(authPathB)).toBe(true)
			await signInProfile(sidebar, renamedA, server)
			await expect.poll(() => pathExists(authPathA)).toBe(true)

			await sidebar.getByRole("button", { name: "Manage profiles" }).click()
			await sidebar.getByRole("checkbox", { name: `Select ${renamedA}` }).check()
			await sidebar.getByRole("button", { name: "Delete selected (1)" }).click()
			await sidebar.getByRole("button", { name: "Confirm delete (1)" }).click()
			await expect.poll(() => pathExists(authPathA)).toBe(false)
			expect(await pathExists(authPathB)).toBe(true)
			await sidebar.getByRole("button", { name: "Done managing profiles" }).click()

			await expandProfile(sidebar, profileB.name)
			await profileCard(sidebar, profileB.name)
				.getByRole("combobox", { name: "Provider", exact: true })
				.selectOption("anthropic")
			await expect.poll(() => pathExists(authPathB)).toBe(false)

			const profileCatalog = await readFile(path.join(dlineDir, "data", "settings", "api_profiles.json"), "utf8")
			const settings = await readFile(path.join(dlineDir, "data", "settings", "settings.json"), "utf8")
			await reopened.close()
			reopened = undefined
			const output = E2ETestHelper.readDlineOutputIfPresent(userDataDir) ?? ""
			assertNoRuntimeSecrets(`${profileCatalog}\n${settings}\n${output}`, [authA, authB, authA2], server.allCallbacks())
		} finally {
			await reopened?.close().catch(() => undefined)
			await app?.close().catch(() => undefined)
			await server.stop()
		}
	},
)

e2e(
	"OpenAI Codex OAuth flow lease prevents a second VS Code instance from stealing the active Profile flow",
	async ({ dlineDir, dlineDocsDir, extensionsDir, server: apiServer, workspaceDir }, testInfo) => {
		e2e.setTimeout(240_000)
		const oauthServer = new CodexOAuthE2EServer()
		await oauthServer.start()
		const ownerProfile = codexProfile("codex-profile-lease-owner", "Codex Lease Owner")
		const contenderProfile = codexProfile("codex-profile-lease-contender", "Codex Lease Contender")
		const auth = scenario("lease-owner")
		oauthServer.enqueue(auth)
		await addCodexProfiles(dlineDir, [ownerProfile, contenderProfile])
		const launcher = new MultiInstanceLauncher({
			dlineDir,
			dlineDocsDir,
			environment: codexEnvironment(oauthServer, "manual"),
			extensionsDir,
			recordVideo: false,
			server: apiServer,
			testInfo,
			workspaceDir,
		})

		try {
			const owner = await launcher.launch("codex-oauth-owner")
			const contender = await launcher.launch("codex-oauth-contender")
			await Promise.all([openSettings(owner.page, owner.sidebar), openSettings(contender.page, contender.sidebar)])

			const ownerCard = await expandProfile(owner.sidebar, ownerProfile.name)
			await ownerCard.getByRole("button", { name: "Sign in with ChatGPT" }).click()
			await expect(ownerCard.getByText("Browser sign-in in progress", { exact: true })).toBeVisible()
			const callback = await E2ETestHelper.waitForValue(() => oauthServer.latestCallback(), 30_000)
			const leasePath = path.join(dlineDir, "data", "oauth", "local-oauth-flow.json")
			await expect.poll(() => pathExists(leasePath)).toBe(true)

			const contenderCard = await expandProfile(contender.sidebar, contenderProfile.name)
			await contenderCard.getByRole("button", { name: "Sign in with ChatGPT" }).click()
			await expect(contenderCard.getByText("Could not start OpenAI Codex sign-in. Please try again.")).toBeVisible()
			await expect(ownerCard.getByText("Browser sign-in in progress", { exact: true })).toBeVisible()
			expect(oauthServer.authorizationRequests).toHaveLength(1)
			expect(await pathExists(leasePath)).toBe(true)

			await ownerCard.getByRole("button", { name: "Use callback URI fallback" }).click()
			await ownerCard.getByRole("textbox", { name: "Authorization callback URI" }).fill(callback)
			await ownerCard.getByRole("button", { name: "Complete sign-in" }).click()
			await expect(ownerCard.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 30_000 })
			await expect.poll(() => pathExists(leasePath)).toBe(false)

			const secretsDir = path.join(dlineDir, "data", "secrets")
			const ownerAuthPath = path.join(secretsDir, getOpenAiCodexProfileAuthFileName(ownerProfile.id))
			const contenderAuthPath = path.join(secretsDir, getOpenAiCodexProfileAuthFileName(contenderProfile.id))
			await expect.poll(() => pathExists(ownerAuthPath)).toBe(true)
			expect(await pathExists(contenderAuthPath)).toBe(false)
			expect(oauthServer.tokenRequestCount).toBe(1)

			await Promise.all([launcher.close(owner), launcher.close(contender)])
			const profileCatalog = await readFile(path.join(dlineDir, "data", "settings", "api_profiles.json"), "utf8")
			const outputs = [owner.userDataDir, contender.userDataDir]
				.map((userDataDir) => E2ETestHelper.readDlineOutputIfPresent(userDataDir) ?? "")
				.join("\n")
			assertNoRuntimeSecrets(`${profileCatalog}\n${outputs}`, [auth], [callback])
		} finally {
			await launcher.dispose()
			await oauthServer.stop()
		}
	},
)

e2e(
	"OpenAI Codex OAuth manual fallback accepts only the full active localhost callback URI",
	async ({ dlineDir, helper, openVSCode, userDataDir, workspaceDir }) => {
		e2e.setTimeout(150_000)
		const server = new CodexOAuthE2EServer()
		await server.start()
		const profile = codexProfile("codex-profile-manual", "Codex Profile Manual")
		const auth = scenario("manual")
		server.enqueue(auth)
		await addCodexProfiles(dlineDir, [profile])
		const environment = codexEnvironment(server, "manual")
		let app: ElectronApplication | undefined

		try {
			const ready = await openReadySidebar(openVSCode, workspaceDir, helper, environment)
			app = ready.app
			const page = ready.page
			const sidebar = ready.sidebar
			await helper.signin(sidebar)
			await openSettings(page, sidebar)
			const card = await expandProfile(sidebar, profile.name)
			await card.getByRole("button", { name: "Sign in with ChatGPT" }).click()
			await expect(card.getByText("Browser sign-in in progress", { exact: true })).toBeVisible()
			const callback = await E2ETestHelper.waitForValue(() => server.latestCallback(), 30_000)
			await card.getByRole("button", { name: "Use callback URI fallback" }).click()
			const input = card.getByRole("textbox", { name: "Authorization callback URI" })
			await input.fill("http://localhost:1455/auth/callback?code=wrong&state=wrong")
			await card.getByRole("button", { name: "Complete sign-in" }).click()
			await expect(
				card.getByText("Could not complete OpenAI Codex sign-in. Check the callback URI and try again."),
			).toBeVisible()
			await input.fill(callback)
			await card.getByRole("button", { name: "Complete sign-in" }).click()
			await expect(card.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 30_000 })

			const authPath = path.join(dlineDir, "data", "secrets", getOpenAiCodexProfileAuthFileName(profile.id))
			await expect.poll(() => pathExists(authPath)).toBe(true)
			const profileCatalog = await readFile(path.join(dlineDir, "data", "settings", "api_profiles.json"), "utf8")
			await app.close()
			app = undefined
			const output = E2ETestHelper.readDlineOutputIfPresent(userDataDir) ?? ""
			assertNoRuntimeSecrets(`${profileCatalog}\n${output}`, [auth], [callback])
		} finally {
			await app?.close().catch(() => undefined)
			await server.stop()
		}
	},
)
