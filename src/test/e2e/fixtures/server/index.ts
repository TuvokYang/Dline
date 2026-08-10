import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo, Socket } from "node:net"
import { v4 as uuidv4 } from "uuid"
import type { BalanceResponse, OrganizationBalanceResponse, UserResponse } from "../../../../shared/ClineAccount"
import {
	E2E_MOCK_API_RESPONSES,
	E2E_MOCK_PROVIDER_ROUTES,
	E2E_REGISTERED_MOCK_ENDPOINTS,
	type E2EMockApiProtocol,
	type E2EMockProviderTarget,
} from "./api"
import { ClineDataMock } from "./data"
import { type MockCacheDiagnostic, type MockCacheWarning, OpenAiCacheDiagnostics } from "./openai-cache-diagnostics"

const E2E_API_SERVER_HOST = "127.0.0.1"

const useVerboseLogging = process.env.DLINE_E2E_TESTS_VERBOSE === "true"
function log(...args: unknown[]) {
	if (useVerboseLogging) {
		console.log("[ClineApiServerMock]", ...args)
	}
}

export type MockApiProtocol = E2EMockApiProtocol
export type MockApiTarget = E2EMockProviderTarget
export type { MockCacheDiagnostic, MockCacheWarning, MockCacheWarningCode } from "./openai-cache-diagnostics"

export interface MockTokenUsage {
	/** Input tokens excluding cache reads and writes. */
	inputTokens: number
	outputTokens: number
	cacheReadTokens?: number
	cacheWriteTokens?: number
	reasoningTokens?: number
}

export interface MockToolResultExpectation {
	callId?: string
	contentIncludes: string | readonly string[]
}

export interface MockObservedToolResult {
	callId?: string
	content: string
}

export interface MockToolCall {
	id?: string
	name: string
	arguments: Record<string, unknown>
}

export interface MockHostedWebSearchResult {
	title: string
	url: string
	snippet?: string
}

export interface MockSearxngSearchRequest {
	receivedAtMs: number
	query: string
	format?: string
	authorization?: string
}

export interface MockWebFetchPageRequest {
	receivedAtMs: number
	closedAtMs?: number
	authorization?: string
}

interface MockResponseOptions {
	reasoning?: string
	hiddenReasoning?: string
	delayMs?: number
	afterReasoningDelayMs?: number
	usage?: MockTokenUsage
	expectedToolResults?: readonly MockToolResultExpectation[]
	expectedToolResultCount?: number
	expectedRequestIncludes?: readonly string[]
	expectedRequestExcludes?: readonly string[]
}

export type OpenAiMockResponse =
	| ({ type: "message"; text: string } & MockResponseOptions)
	| ({ type: "truncated-message"; text: string; truncateAfter?: number } & MockResponseOptions)
	| ({ type: "tool" } & MockToolCall & MockResponseOptions)
	| ({ type: "tool-with-completion-snapshots" } & MockToolCall & MockResponseOptions)
	| ({ type: "truncated-tool"; truncateAfter: number } & MockToolCall & MockResponseOptions)
	| ({ type: "tools"; tools: readonly MockToolCall[] } & MockResponseOptions)
	| ({
			type: "hosted-web-search"
			id?: string
			query: string
			results: readonly MockHostedWebSearchResult[]
			followupTools?: readonly MockToolCall[]
	  } & MockResponseOptions)
	| {
			type: "error"
			status: number
			message: string
			code?: string
			delayMs?: number
			disconnect?: boolean
			requestId?: string
			details?: Readonly<Record<string, string | number | boolean>>
	  }

export type MockThinkingConfig = { mode: "effort"; effort: string } | { mode: "budget"; budget: number }

export interface MockApiConsumption {
	receivedAtMs: number
	abortedAtMs?: number
	target: MockApiTarget
	provider: string
	protocol: MockApiProtocol
	path: string
	requestBody: unknown
	requestToolResults: MockObservedToolResult[]
	responseType: OpenAiMockResponse["type"]
	toolName?: string
	toolCallId?: string
	toolArguments?: Record<string, unknown>
	responseToolCalls?: readonly MockToolCall[]
	status?: number
	contractError?: string
	thinking?: MockThinkingConfig
	responseReasoning?: string
	usage?: MockTokenUsage
	cacheDiagnostic?: MockCacheDiagnostic
}

export interface MockModelListRequest {
	receivedAtMs: number
	target: MockApiTarget
	path: string
	authorization?: string
}

function createResponseQueues(): Record<MockApiTarget, OpenAiMockResponse[]> {
	return Object.fromEntries(Object.keys(E2E_MOCK_PROVIDER_ROUTES).map((target) => [target, []])) as Record<
		MockApiTarget,
		OpenAiMockResponse[]
	>
}

function estimateTokens(text: string): number {
	return Math.max(1, Math.ceil(Buffer.byteLength(text, "utf8") / 4))
}

function commonPrefixLength(left: string, right: string): number {
	const limit = Math.min(left.length, right.length)
	let index = 0
	while (index < limit && left[index] === right[index]) index++
	return index
}

function getResponseUsage(
	response: Exclude<OpenAiMockResponse, { type: "error" }>,
	requestText: string,
	previousRequestText?: string,
): MockTokenUsage {
	if (response.usage) return response.usage

	const totalInputTokens = estimateTokens(requestText)
	const sharedPrefix = previousRequestText ? requestText.slice(0, commonPrefixLength(previousRequestText, requestText)) : ""
	const cacheReadTokens = sharedPrefix ? Math.min(Math.max(0, totalInputTokens - 2), estimateTokens(sharedPrefix)) : 0
	const uncachedTokens = totalInputTokens - cacheReadTokens
	const cacheWriteTokens = uncachedTokens > 2 ? Math.max(1, Math.floor(uncachedTokens * 0.4)) : 0
	const inputTokens = Math.max(1, totalInputTokens - cacheReadTokens - cacheWriteTokens)
	const reasoningText = response.reasoning ?? response.hiddenReasoning ?? ""
	const reasoningTokens = reasoningText ? estimateTokens(reasoningText) : 0
	const responseText =
		response.type === "message" || response.type === "truncated-message"
			? response.text
			: getResponseToolCalls(response)
					.map((tool) => `${tool.name}\n${JSON.stringify(tool.arguments)}`)
					.join("\n")
	const outputTokens = estimateTokens(`${reasoningText}\n${responseText}`)

	return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens }
}

function getResponseToolCalls(response: Exclude<OpenAiMockResponse, { type: "error" }>): readonly MockToolCall[] {
	if (response.type === "tool" || response.type === "tool-with-completion-snapshots" || response.type === "truncated-tool") {
		return [response]
	}
	if (response.type === "tools") return response.tools
	if (response.type === "hosted-web-search") return response.followupTools ?? []
	return []
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function stringifyToolResultContent(value: unknown): string {
	if (typeof value === "string") return value
	if (Array.isArray(value)) {
		return value
			.map((item) => {
				const record = asRecord(item)
				return typeof record?.text === "string" ? record.text : JSON.stringify(item)
			})
			.join("\n")
	}
	return value === undefined ? "" : JSON.stringify(value)
}

function extractRequestToolResults(requestBody: unknown): MockObservedToolResult[] {
	const body = asRecord(requestBody)
	if (!body) return []
	const results: MockObservedToolResult[] = []

	for (const value of Array.isArray(body.messages) ? body.messages : []) {
		const message = asRecord(value)
		if (!message) continue
		if (message.role === "tool") {
			results.push({
				...(typeof message.tool_call_id === "string" ? { callId: message.tool_call_id } : {}),
				content: stringifyToolResultContent(message.content),
			})
		}
		for (const contentValue of Array.isArray(message.content) ? message.content : []) {
			const content = asRecord(contentValue)
			if (content?.type !== "tool_result") continue
			results.push({
				...(typeof content.tool_use_id === "string" ? { callId: content.tool_use_id } : {}),
				content: stringifyToolResultContent(content.content),
			})
		}
	}

	for (const value of Array.isArray(body.input) ? body.input : []) {
		const item = asRecord(value)
		if (item?.type !== "function_call_output") continue
		results.push({
			...(typeof item.call_id === "string" ? { callId: item.call_id } : {}),
			content: stringifyToolResultContent(item.output),
		})
	}

	return results
}

function validateMockRequestContract(
	response: Exclude<OpenAiMockResponse, { type: "error" }>,
	requestText: string,
	toolResults: readonly MockObservedToolResult[],
): string | undefined {
	for (const marker of response.expectedRequestIncludes ?? []) {
		if (!requestText.includes(marker)) return `Request is missing required text: ${marker}`
	}
	for (const marker of response.expectedRequestExcludes ?? []) {
		if (requestText.includes(marker)) return `Request contains forbidden text: ${marker}`
	}
	if (response.expectedToolResultCount !== undefined && toolResults.length !== response.expectedToolResultCount) {
		return `Expected ${response.expectedToolResultCount} tool results, observed ${toolResults.length}`
	}

	for (const expectation of response.expectedToolResults ?? []) {
		const markers = Array.isArray(expectation.contentIncludes) ? expectation.contentIncludes : [expectation.contentIncludes]
		const candidates = expectation.callId ? toolResults.filter((result) => result.callId === expectation.callId) : toolResults
		if (candidates.length === 0) {
			const observedIds = toolResults.map((result) => result.callId ?? "<missing>").join(", ") || "<none>"
			return `Tool result ${expectation.callId ?? "<any>"} was not observed; observed call IDs: ${observedIds}`
		}
		for (const marker of markers) {
			if (!candidates.some((candidate) => candidate.content.includes(marker))) {
				return `Tool result ${expectation.callId ?? "<any>"} is missing required text: ${marker}`
			}
		}
	}
	return undefined
}

function getRequestThinking(requestBody: unknown): MockThinkingConfig | undefined {
	const body = asRecord(requestBody)
	if (!body) return undefined

	const anthropicThinking = asRecord(body.thinking)
	if (typeof anthropicThinking?.budget_tokens === "number") {
		return { mode: "budget", budget: anthropicThinking.budget_tokens }
	}
	if (typeof body.thinking_budget === "number") {
		return { mode: "budget", budget: body.thinking_budget }
	}

	const responsesReasoning = asRecord(body.reasoning)
	if (typeof responsesReasoning?.effort === "string") {
		return { mode: "effort", effort: responsesReasoning.effort }
	}
	if (typeof body.reasoning_effort === "string") {
		return { mode: "effort", effort: body.reasoning_effort }
	}

	const outputConfig = asRecord(body.output_config)
	if (typeof outputConfig?.effort === "string") {
		return { mode: "effort", effort: outputConfig.effort }
	}
	return undefined
}

function toOpenAiUsage(usage: MockTokenUsage) {
	const cacheReadTokens = usage.cacheReadTokens ?? 0
	const cacheWriteTokens = usage.cacheWriteTokens ?? 0
	const promptTokens = usage.inputTokens + cacheReadTokens + cacheWriteTokens
	return {
		prompt_tokens: promptTokens,
		completion_tokens: usage.outputTokens,
		total_tokens: promptTokens + usage.outputTokens,
		prompt_tokens_details: {
			cached_tokens: cacheReadTokens,
			cache_miss_tokens: cacheWriteTokens,
		},
		completion_tokens_details: {
			reasoning_tokens: usage.reasoningTokens ?? 0,
		},
	}
}

export class ClineApiServerMock {
	static globalSharedServer: ClineApiServerMock | null = null
	static globalSockets: Set<Socket> = new Set()

	private currentUser: UserResponse | null = null
	private userBalance = 100.5 // Default sufficient balance
	private orgBalance = 500.0
	private userHasOrganization = false
	private spendLimitExceeded = false
	private mockResponses = createResponseQueues()
	private mockConsumptions: MockApiConsumption[] = []
	private mockModelListRequests: MockModelListRequest[] = []
	private mockSearxngSearchRequests: MockSearxngSearchRequest[] = []
	private mockWebFetchPageRequests: MockWebFetchPageRequest[] = []
	private previousSuccessfulRequestText = new Map<MockApiTarget, string>()
	private readonly openAiCacheDiagnostics = new OpenAiCacheDiagnostics()
	public generationCounter = 0

	public readonly API_USER = new ClineDataMock("personal")

	constructor(
		public readonly server: Server,
		public readonly baseUrl: string,
	) {}

	// Test helper methods
	public setUserBalance(balance: number) {
		this.userBalance = balance
	}

	public setUserHasOrganization(hasOrg: boolean) {
		this.userHasOrganization = hasOrg
		const user = this.currentUser
		if (!user) {
			return
		}
		user.organizations[0].active = hasOrg
		this.setCurrentUser(user)
	}

	public setOrgBalance(balance: number) {
		this.orgBalance = balance
	}

	/**
	 * Puts the mock server into "spend limit exceeded" mode.
	 * While true, POST /api/v1/chat/completions returns 429 SPEND_LIMIT_EXCEEDED
	 * instead of a normal streaming response.
	 * Toggle off to resume normal behaviour.
	 */
	public setSpendLimitExceeded(exceeded: boolean) {
		this.spendLimitExceeded = exceeded
	}

	public enqueueOpenAiResponses(...responses: OpenAiMockResponse[]): void {
		this.enqueueResponses("openai-compatible-chat", ...responses)
	}

	public enqueueResponses(target: MockApiTarget, ...responses: OpenAiMockResponse[]): void {
		this.mockResponses[target].push(...responses)
	}

	public clearPendingResponses(target: MockApiTarget): void {
		this.mockResponses[target] = []
	}

	public resetOpenAiMock(): void {
		this.mockResponses = createResponseQueues()
		this.mockConsumptions = []
		this.mockModelListRequests = []
		this.mockSearxngSearchRequests = []
		this.mockWebFetchPageRequests = []
		this.previousSuccessfulRequestText.clear()
		this.openAiCacheDiagnostics.reset()
	}

	public getModelListRequests(): readonly MockModelListRequest[] {
		return this.mockModelListRequests
	}

	public getSearxngSearchRequests(): readonly MockSearxngSearchRequest[] {
		return this.mockSearxngSearchRequests
	}

	public getWebFetchPageRequests(): readonly MockWebFetchPageRequest[] {
		return this.mockWebFetchPageRequests
	}

	public get openAiRequestCount(): number {
		return this.getRequestCount("openai-compatible-chat")
	}

	public getOpenAiRequestBodies(): readonly unknown[] {
		return this.mockConsumptions
			.filter((consumption) => consumption.target === "openai-compatible-chat")
			.map((consumption) => consumption.requestBody)
	}

	public getRequestCount(target: MockApiTarget): number {
		return this.mockConsumptions.filter((consumption) => consumption.target === target).length
	}

	public getMockConsumptions(target?: MockApiTarget): readonly MockApiConsumption[] {
		return target ? this.mockConsumptions.filter((consumption) => consumption.target === target) : this.mockConsumptions
	}

	public getCacheWarnings(target?: MockApiTarget): readonly MockCacheWarning[] {
		return this.openAiCacheDiagnostics.getWarnings(target)
	}

	public setCurrentUser(user: UserResponse | null) {
		this.API_USER.setCurrentUser(user)
		this.currentUser = user
	}

	private consumeMockResponse(target: MockApiTarget, path: string, requestBody: unknown) {
		const receivedAtMs = Date.now()
		const route = E2E_MOCK_PROVIDER_ROUTES[target]
		const scriptedResponse = this.mockResponses[target].shift() ?? {
			type: "error",
			status: 500,
			code: "e2e_mock_queue_exhausted",
			message: `No scripted E2E response remains for ${target}`,
			requestId: `req_queue_${target.replaceAll("-", "_")}`,
			details: { target, retryable: true },
		}
		const thinking = getRequestThinking(requestBody)
		const requestText = JSON.stringify(requestBody)
		const requestToolResults = extractRequestToolResults(requestBody)
		const contractError =
			scriptedResponse.type === "error"
				? undefined
				: validateMockRequestContract(scriptedResponse, requestText, requestToolResults)
		const contractedResponse: OpenAiMockResponse = contractError
			? {
					type: "error",
					status: 500,
					code: "e2e_tool_result_contract_failed",
					message: contractError,
				}
			: scriptedResponse
		const scriptedToolCall = scriptedResponse.type === "error" ? undefined : getResponseToolCalls(scriptedResponse)[0]
		log(
			"Mock provider consumption:",
			JSON.stringify({
				target,
				scriptedResponseType: scriptedResponse.type,
				scriptedToolName: scriptedToolCall?.name,
				scriptedToolCallId: scriptedToolCall?.id,
				contractError,
				remainingResponses: this.mockResponses[target].length,
				requestBytes: Buffer.byteLength(requestText, "utf8"),
			}),
		)
		const response = contractedResponse
		const usage =
			response.type === "error"
				? undefined
				: getResponseUsage(response, requestText, this.previousSuccessfulRequestText.get(target))
		const cacheDiagnostic = usage
			? this.openAiCacheDiagnostics.observe(target, route.protocol, requestBody, usage)
			: undefined
		if (response.type !== "error") this.previousSuccessfulRequestText.set(target, requestText)
		const responseToolCalls = response.type === "error" ? [] : getResponseToolCalls(response)
		const consumption: MockApiConsumption = {
			receivedAtMs,
			target,
			provider: route.provider,
			protocol: route.protocol,
			path,
			requestBody,
			requestToolResults,
			responseType: response.type,
			...(response.type === "tool" ? { toolName: response.name } : {}),
			...(response.type === "tool" && response.id ? { toolCallId: response.id } : {}),
			...(response.type === "tool" ? { toolArguments: response.arguments } : {}),
			...(responseToolCalls.length > 0
				? {
						responseToolCalls: responseToolCalls.map((tool) => ({
							...(tool.id ? { id: tool.id } : {}),
							name: tool.name,
							arguments: tool.arguments,
						})),
					}
				: {}),
			...(response.type === "error" ? { status: response.status } : {}),
			...(contractError ? { contractError } : {}),
			...(thinking ? { thinking } : {}),
			...(route.protocol !== "openai-chat" && response.type !== "error" && response.reasoning
				? { responseReasoning: response.reasoning }
				: {}),
			...(usage ? { usage } : {}),
			...(cacheDiagnostic ? { cacheDiagnostic } : {}),
		}
		this.mockConsumptions.push(consumption)
		return { response, usage, consumption }
	}

	// Helper to match routes against registered endpoints and extract parameters
	private static matchRoute(
		path: string,
		method: string,
	): {
		matched: boolean
		baseRoute?: string
		endpoint?: string
		params?: Record<string, string>
	} {
		for (const [baseRoute, methods] of Object.entries(E2E_REGISTERED_MOCK_ENDPOINTS)) {
			const methodEndpoints = methods[method as keyof typeof methods]
			if (!methodEndpoints) {
				continue
			}

			for (const endpoint of methodEndpoints) {
				const fullPattern = `${baseRoute}${endpoint}`
				const params: Record<string, string> = {}

				// Convert pattern like "/users/{userId}/balance" to a regex
				const regexPattern = fullPattern.replace(/\{([^}]+)\}/g, () => {
					return "([^/]+)"
				})

				const regex = new RegExp(`^${regexPattern}$`)
				const match = path.match(regex)

				if (match) {
					// Extract parameter names from the pattern
					const paramNames: string[] = []
					const paramRegex = /\{([^}]+)\}/g
					let paramMatch: RegExpExecArray | null = paramRegex.exec(fullPattern)
					while (paramMatch !== null) {
						paramNames.push(paramMatch[1])
						paramMatch = paramRegex.exec(fullPattern)
					}

					// Map captured groups to parameter names
					for (let i = 0; i < paramNames.length; i++) {
						params[paramNames[i]] = match[i + 1]
					}

					return {
						matched: true,
						baseRoute,
						endpoint,
						params,
					}
				}
			}
		}

		return { matched: false }
	}

	private static matchMockProviderRoute(path: string, method: string) {
		if (method !== "POST") return undefined
		for (const target of Object.keys(E2E_MOCK_PROVIDER_ROUTES) as MockApiTarget[]) {
			const route = E2E_MOCK_PROVIDER_ROUTES[target]
			if (path === `${route.basePath}${route.endpoint}`) return { target, route }
		}
		return undefined
	}

	private static matchMockModelListRoute(path: string, method: string): MockApiTarget | undefined {
		if (method !== "GET") return undefined
		for (const target of Object.keys(E2E_MOCK_PROVIDER_ROUTES) as MockApiTarget[]) {
			const route = E2E_MOCK_PROVIDER_ROUTES[target]
			if (route.provider === "openai" && path === `${route.basePath}/models`) return target
		}
		return undefined
	}

	// Starts the global shared server
	public static async startGlobalServer(): Promise<ClineApiServerMock> {
		log("=== SERVER FIXTURE CALLED ===")
		if (ClineApiServerMock.globalSharedServer) {
			log("Using existing global server")
			return ClineApiServerMock.globalSharedServer
		}

		log("Starting global server...")
		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			// Parse URL and method
			const parsedUrl = new URL(req.url || "/", `http://${req.headers.host ?? E2E_API_SERVER_HOST}`)
			const path = parsedUrl.pathname
			const query = Object.fromEntries(parsedUrl.searchParams.entries())
			const method = req.method || "GET"

			// Helper to read request body
			const readBody = (): Promise<string> => {
				return new Promise((resolve) => {
					let body = ""
					req.on("data", (chunk) => {
						body += chunk.toString()
					})
					req.on("end", () => resolve(body))
				})
			}

			// Helper to send JSON response
			const sendJson = (data: unknown, status = 200, headers: Record<string, string> = {}) => {
				res.writeHead(status, { "Content-Type": "application/json", ...headers })
				res.end(JSON.stringify(data))
			}

			// Helper to send API response
			const sendApiResponse = (data: unknown, status = 200) => {
				log(`API Response: ${JSON.stringify(data)}`)
				sendJson({ success: true, data }, status)
			}

			const sendApiError = (error: string, status = 400) => {
				sendJson({ success: false, error }, status)
			}

			// Authentication middleware
			const authHeader = req.headers.authorization
			const hasApiCredential = authHeader?.startsWith("Bearer ") || typeof req.headers["x-api-key"] === "string"
			const isAuthRequired =
				!path.startsWith("/.test/") &&
				!path.startsWith("/mock/searxng/") &&
				!path.startsWith("/mock/web-fetch/") &&
				path !== "/health" &&
				path !== "/api/v1/auth/token"

			if (isAuthRequired && !hasApiCredential) {
				return sendApiError("Unauthorized", 401)
			}

			const authToken = authHeader?.substring(7) // Remove "Bearer " prefix

			// Authenticate the token and set current user
			if (path.startsWith("/api/v1") && isAuthRequired && authToken) {
				log(`Authenticating token: ${authToken}`)
				const user = ClineApiServerMock.globalSharedServer?.API_USER.getUserByToken(authToken)
				if (!user) {
					return sendApiError("Invalid token", 401)
				}
				ClineApiServerMock.globalSharedServer?.setCurrentUser(user)
			}

			log("=== MOCK SERVER REQUEST ===")
			log("Method:", method)
			log("Path:", path)
			log("Query:", JSON.stringify(query))
			log("Headers:", JSON.stringify(req.headers))
			log("===============")

			// Route handling
			const handleRequest = async () => {
				const mockProviderRoute = ClineApiServerMock.matchMockProviderRoute(path, method)
				const mockModelListTarget = ClineApiServerMock.matchMockModelListRoute(path, method)
				const routeMatch = ClineApiServerMock.matchRoute(path, method)

				if (!mockProviderRoute && !mockModelListTarget && !routeMatch.matched) {
					return sendJson({ error: "Not found" }, 404)
				}

				const { baseRoute, endpoint, params = {} } = routeMatch
				const controller = ClineApiServerMock.globalSharedServer!

				if (baseRoute === "/mock/web-fetch" && endpoint === "/page" && method === "GET") {
					const pageRequest: MockWebFetchPageRequest = {
						receivedAtMs: Date.now(),
						...(authHeader ? { authorization: authHeader } : {}),
					}
					controller.mockWebFetchPageRequests.push(pageRequest)
					const delayMs = Number.parseInt(parsedUrl.searchParams.get("delayMs") ?? "0", 10)
					if (Number.isFinite(delayMs) && delayMs > 0) {
						await new Promise<void>((resolve) => {
							const onClose = () => {
								pageRequest.closedAtMs = Date.now()
								clearTimeout(timer)
								resolve()
							}
							const timer = setTimeout(() => {
								res.off("close", onClose)
								resolve()
							}, delayMs)
							res.once("close", onClose)
						})
						if (res.destroyed || res.writableEnded) return
					}
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
					const longContent = Array.from(
						{ length: 32 },
						(_, index) => `<p>E2E_WEB_FETCH_PAGE_CONTENT_${index.toString().padStart(2, "0")}</p>`,
					).join("")
					res.end(
						`<!doctype html><html><body><nav>REMOVE_NAVIGATION</nav><main><h1>Dline local Web Fetch</h1>${longContent}</main><script>REMOVE_SCRIPT</script></body></html>`,
					)
					return
				}

				if (baseRoute === "/mock/searxng" && endpoint === "/search" && method === "GET") {
					const searchQuery = parsedUrl.searchParams.get("q")?.trim()
					if (!searchQuery) return sendJson({ error: "Search query is required" }, 400)
					controller.mockSearxngSearchRequests.push({
						receivedAtMs: Date.now(),
						query: searchQuery,
						...(parsedUrl.searchParams.get("format") ? { format: parsedUrl.searchParams.get("format")! } : {}),
						...(authHeader ? { authorization: authHeader } : {}),
					})
					return sendJson({
						results: Array.from({ length: 24 }, (_, index) => ({
							title:
								index === 0
									? `E2E local result for ${searchQuery}`
									: `E2E local result ${index} for ${searchQuery}`,
							url:
								index === 0
									? "https://example.test/dline-local-search"
									: `https://example.test/dline-local-search/${index}`,
							content: `E2E local snippet ${index} for ${searchQuery}`,
						})),
					})
				}

				if (mockModelListTarget) {
					controller.mockModelListRequests.push({
						receivedAtMs: Date.now(),
						target: mockModelListTarget,
						path,
						...(authHeader ? { authorization: authHeader } : {}),
					})
					return sendJson({
						object: "list",
						data: [
							{ id: "dline-e2e-model", object: "model" },
							{ id: "dline-e2e-discovered-model", object: "model" },
						],
					})
				}

				if (mockProviderRoute) {
					const { target, route } = mockProviderRoute
					const protocol = route.protocol
					if (route.auth === "bearer" && !authHeader?.startsWith("Bearer ")) {
						return sendJson({ error: { message: "Bearer authentication required" } }, 401)
					}
					if (route.auth === "x-api-key") {
						if (typeof req.headers["x-api-key"] !== "string") {
							return sendJson(
								{ type: "error", error: { type: "authentication_error", message: "x-api-key required" } },
								401,
							)
						}
						if (typeof req.headers["anthropic-version"] !== "string") {
							return sendJson(
								{
									type: "error",
									error: { type: "invalid_request_error", message: "anthropic-version required" },
								},
								400,
							)
						}
					}
					const body = await readBody()
					const parsed = JSON.parse(body) as Record<string, unknown> & { model?: string; stream?: boolean }
					const hasMessages = Array.isArray(parsed.messages)
					const hasResponsesInput = typeof parsed.input === "string" || Array.isArray(parsed.input)
					const validRequest =
						((protocol === "openai-chat" || protocol === "deepseek-chat") && hasMessages) ||
						(protocol === "openai-responses" && hasResponsesInput) ||
						(protocol === "anthropic-messages" && hasMessages && typeof parsed.max_tokens === "number")
					if (!validRequest) {
						return sendJson({ error: { message: `Invalid ${target} request shape` } }, 400)
					}
					const {
						response: scriptedResponse,
						usage,
						consumption,
					} = controller.consumeMockResponse(target, path, parsed)
					const markAborted = () => {
						if (!res.writableFinished) consumption.abortedAtMs ??= Date.now()
					}
					req.once("aborted", markAborted)
					res.once("close", markAborted)
					const generationId = `e2e_${++controller.generationCounter}_${Date.now()}`
					const model = parsed.model ?? "dline-e2e-model"

					if (scriptedResponse.delayMs) {
						await new Promise<void>((resolve) => {
							const timer = setTimeout(resolve, scriptedResponse.delayMs)
							res.once("close", () => {
								clearTimeout(timer)
								resolve()
							})
						})
						if (res.destroyed || res.writableEnded) return
					}
					if (res.destroyed || res.writableEnded) return

					if (scriptedResponse.type === "error") {
						if (scriptedResponse.disconnect) {
							res.destroy()
							return
						}
						const code = scriptedResponse.code ?? `http_${scriptedResponse.status}`
						const requestMetadata = scriptedResponse.requestId
							? { request_id: scriptedResponse.requestId }
							: undefined
						const headers = {
							...(scriptedResponse.status === 429 ? { "Retry-After": "0" } : {}),
							...(scriptedResponse.requestId ? { "x-request-id": scriptedResponse.requestId } : {}),
						}
						return sendJson(
							protocol === "anthropic-messages"
								? {
										type: "error",
										error: { type: code, message: scriptedResponse.message, ...scriptedResponse.details },
										...requestMetadata,
									}
								: {
										error: {
											message: scriptedResponse.message,
											type: "e2e_mock_error",
											code,
											...scriptedResponse.details,
										},
										...requestMetadata,
									},
							scriptedResponse.status,
							Object.keys(headers).length > 0 ? headers : undefined,
						)
					}

					if (!usage) throw new Error(`Successful ${target} response is missing usage`)
					const openAiUsage = toOpenAiUsage(usage)
					const chatUsage =
						protocol === "deepseek-chat"
							? {
									...openAiUsage,
									prompt_cache_hit_tokens: usage.cacheReadTokens ?? 0,
									prompt_cache_miss_tokens: usage.cacheWriteTokens ?? 0,
								}
							: openAiUsage
					const messageText =
						scriptedResponse.type === "message" || scriptedResponse.type === "truncated-message"
							? scriptedResponse.text
							: ""
					const responseToolCalls = getResponseToolCalls(scriptedResponse)
					const writeSse = (data: unknown, event?: string) => {
						if (res.destroyed || res.writableEnded) return
						res.write(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`)
					}
					const waitAfterReasoning = async (): Promise<boolean> => {
						const delayMs = scriptedResponse.afterReasoningDelayMs
						if (!delayMs) return !(res.destroyed || res.writableEnded)
						await new Promise<void>((resolve) => {
							const onClose = () => {
								clearTimeout(timer)
								resolve()
							}
							const timer = setTimeout(() => {
								res.off("close", onClose)
								resolve()
							}, delayMs)
							res.once("close", onClose)
						})
						return !(res.destroyed || res.writableEnded)
					}

					if (protocol === "openai-chat" || protocol === "deepseek-chat") {
						const toolCalls = responseToolCalls.map((tool, index) => ({
							index,
							id: tool.id ?? `call_${generationId}_${index}`,
							type: "function",
							function: {
								name: tool.name,
								arguments: JSON.stringify(tool.arguments),
							},
						}))
						const reasoningContent = protocol === "deepseek-chat" ? scriptedResponse.reasoning : undefined
						const streamedMessageText =
							scriptedResponse.type === "truncated-message"
								? messageText.slice(0, scriptedResponse.truncateAfter ?? messageText.length)
								: messageText
						const responseDelta = {
							role: "assistant",
							...(toolCalls.length > 0 ? { tool_calls: toolCalls } : { content: streamedMessageText }),
						}
						if (parsed.stream !== false) {
							res.writeHead(200, {
								"Content-Type": "text/event-stream",
								"Cache-Control": "no-cache",
								Connection: "keep-alive",
							})
							const writeChunk = (choices: unknown, chunkUsage?: unknown) =>
								writeSse({
									id: generationId,
									object: "chat.completion.chunk",
									created: Math.floor(Date.now() / 1000),
									model,
									choices,
									...(chunkUsage ? { usage: chunkUsage } : {}),
								})
							if (reasoningContent && scriptedResponse.afterReasoningDelayMs) {
								writeChunk([
									{
										index: 0,
										delta: { role: "assistant", reasoning_content: reasoningContent },
										finish_reason: null,
									},
								])
								if (!(await waitAfterReasoning())) return
								writeChunk([{ index: 0, delta: responseDelta, finish_reason: null }])
							} else {
								writeChunk([
									{
										index: 0,
										delta: {
											...responseDelta,
											...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
										},
										finish_reason: null,
									},
								])
							}
							if (scriptedResponse.type === "truncated-message") {
								res.destroy()
								return
							}
							writeChunk(
								[
									{
										index: 0,
										delta: {},
										finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
									},
								],
								chatUsage,
							)
							res.end("data: [DONE]\n\n")
							return
						}

						return sendJson({
							id: generationId,
							object: "chat.completion",
							created: Math.floor(Date.now() / 1000),
							model,
							choices: [
								{
									index: 0,
									message: {
										role: "assistant",
										content: toolCalls.length > 0 ? null : messageText,
										...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
										...(toolCalls.length > 0
											? { tool_calls: toolCalls.map(({ index: _, ...tool }) => tool) }
											: {}),
									},
									finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
								},
							],
							usage: chatUsage,
						})
					}

					if (protocol === "openai-responses") {
						const reasoningItemId = `reasoning_${generationId}`
						const reasoningItem = scriptedResponse.reasoning
							? {
									id: reasoningItemId,
									type: "reasoning",
									status: "completed",
									summary: [{ type: "summary_text", text: scriptedResponse.reasoning }],
								}
							: undefined
						const outputOffset = reasoningItem ? 1 : 0
						const toolOutputItems = responseToolCalls.map((tool, index) => ({
							id: `item_${generationId}_${index}`,
							type: "function_call",
							status: "completed",
							call_id: tool.id ?? `call_${generationId}_${index}`,
							name: tool.name,
							arguments: JSON.stringify(tool.arguments),
						}))
						const messageOutputItem = {
							id: `item_${generationId}`,
							type: "message",
							status: "completed",
							role: "assistant",
							content: [{ type: "output_text", text: messageText, annotations: [] }],
						}
						const hostedSearchOutputItem =
							scriptedResponse.type === "hosted-web-search"
								? {
										id: scriptedResponse.id ?? `ws_${generationId}`,
										type: "web_search_call",
										status: "completed",
										action: {
											type: "search",
											query: scriptedResponse.query,
										},
										results: scriptedResponse.results.map(({ title, url, snippet }) => ({
											title,
											url,
											...(snippet ? { snippet } : {}),
										})),
									}
								: undefined
						const ordinaryOutputItems = toolOutputItems.length > 0 ? toolOutputItems : [messageOutputItem]
						const outputItems = hostedSearchOutputItem
							? [hostedSearchOutputItem, ...ordinaryOutputItems]
							: ordinaryOutputItems
						const response = {
							id: generationId,
							object: "response",
							created_at: Math.floor(Date.now() / 1000),
							status: "completed",
							model,
							output: reasoningItem ? [reasoningItem, ...outputItems] : outputItems,
							output_text: scriptedResponse.type === "message" ? scriptedResponse.text : "",
							usage: {
								input_tokens: openAiUsage.prompt_tokens,
								input_tokens_details: openAiUsage.prompt_tokens_details,
								output_tokens: usage.outputTokens,
								output_tokens_details: openAiUsage.completion_tokens_details,
								total_tokens: openAiUsage.total_tokens,
							},
						}
						if (parsed.stream === false) return sendJson(response)

						res.writeHead(200, {
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache",
							Connection: "keep-alive",
						})
						if (reasoningItem) {
							writeSse(
								{
									type: "response.output_item.added",
									output_index: 0,
									item: { ...reasoningItem, status: "in_progress", summary: [] },
								},
								"response.output_item.added",
							)
							writeSse(
								{
									type: "response.reasoning_summary_part.added",
									item_id: reasoningItemId,
									output_index: 0,
									summary_index: 0,
									part: { type: "summary_text", text: "" },
								},
								"response.reasoning_summary_part.added",
							)
							writeSse(
								{
									type: "response.reasoning_summary_text.delta",
									item_id: reasoningItemId,
									output_index: 0,
									summary_index: 0,
									delta: scriptedResponse.reasoning,
								},
								"response.reasoning_summary_text.delta",
							)
							writeSse(
								{
									type: "response.reasoning_summary_part.done",
									item_id: reasoningItemId,
									output_index: 0,
									summary_index: 0,
									part: reasoningItem.summary[0],
								},
								"response.reasoning_summary_part.done",
							)
							writeSse(
								{ type: "response.output_item.done", output_index: 0, item: reasoningItem },
								"response.output_item.done",
							)
							if (!(await waitAfterReasoning())) return
						}
						if (hostedSearchOutputItem) {
							const outputIndex = outputOffset
							const startedItem = {
								...hostedSearchOutputItem,
								status: "in_progress",
								action: { type: "search", query: scriptedResponse.query },
							}
							writeSse(
								{ type: "response.output_item.added", output_index: outputIndex, item: startedItem },
								"response.output_item.added",
							)
							for (const type of [
								"response.web_search_call.in_progress",
								"response.web_search_call.searching",
								"response.web_search_call.completed",
							]) {
								writeSse({ type, item_id: hostedSearchOutputItem.id, output_index: outputIndex }, type)
							}
							writeSse(
								{ type: "response.output_item.done", output_index: outputIndex, item: hostedSearchOutputItem },
								"response.output_item.done",
							)
						}
						if (toolOutputItems.length > 0) {
							for (const [index, outputItem] of toolOutputItems.entries()) {
								const outputIndex = outputOffset + (hostedSearchOutputItem ? 1 : 0) + index
								writeSse(
									{
										type: "response.output_item.added",
										output_index: outputIndex,
										item: { ...outputItem, arguments: "" },
									},
									"response.output_item.added",
								)
								const deltaArguments =
									scriptedResponse.type === "truncated-tool"
										? outputItem.arguments.slice(0, scriptedResponse.truncateAfter)
										: outputItem.arguments
								writeSse(
									{
										type: "response.function_call_arguments.delta",
										item_id: outputItem.id,
										output_index: outputIndex,
										delta: deltaArguments,
									},
									"response.function_call_arguments.delta",
								)
								if (scriptedResponse.type === "tool-with-completion-snapshots") {
									writeSse(
										{
											type: "response.function_call_arguments.done",
											item_id: outputItem.id,
											output_index: outputIndex,
											name: outputItem.name,
											arguments: outputItem.arguments,
										},
										"response.function_call_arguments.done",
									)
									writeSse(
										{ type: "response.output_item.done", output_index: outputIndex, item: outputItem },
										"response.output_item.done",
									)
								}
							}
						} else {
							const outputIndex = outputOffset + (hostedSearchOutputItem ? 1 : 0)
							writeSse(
								{
									type: "response.output_item.added",
									output_index: outputIndex,
									item: messageOutputItem,
								},
								"response.output_item.added",
							)
							writeSse(
								{
									type: "response.output_text.delta",
									item_id: messageOutputItem.id,
									output_index: outputIndex,
									content_index: 0,
									delta: messageText,
								},
								"response.output_text.delta",
							)
						}
						if (scriptedResponse.type === "truncated-tool") {
							writeSse(
								{
									type: "response.incomplete",
									response: {
										...response,
										status: "incomplete",
										incomplete_details: { reason: "max_output_tokens" },
									},
								},
								"response.incomplete",
							)
							res.end()
							return
						}
						writeSse({ type: "response.completed", response }, "response.completed")
						res.end()
						return
					}

					const messageUsage = {
						input_tokens: usage.inputTokens,
						output_tokens: 0,
						cache_creation_input_tokens: usage.cacheWriteTokens ?? 0,
						cache_read_input_tokens: usage.cacheReadTokens ?? 0,
						...(scriptedResponse.type === "hosted-web-search"
							? { server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } }
							: {}),
					}
					const ordinaryContentBlocks =
						responseToolCalls.length > 0
							? responseToolCalls.map((tool, index) => ({
									id: tool.id ?? `toolu_${generationId}_${index}`,
									type: "tool_use",
									name: tool.name,
									input: tool.arguments,
								}))
							: [{ type: "text", text: messageText }]
					const hostedSearchId =
						scriptedResponse.type === "hosted-web-search"
							? (scriptedResponse.id ?? `srv_web_${generationId}`)
							: undefined
					const hostedContentBlocks =
						scriptedResponse.type === "hosted-web-search" && hostedSearchId
							? [
									{
										type: "server_tool_use",
										id: hostedSearchId,
										name: "web_search",
										input: { query: scriptedResponse.query },
										caller: { type: "direct" },
									},
									{
										type: "web_search_tool_result",
										tool_use_id: hostedSearchId,
										content: scriptedResponse.results.map((result) => ({
											type: "web_search_result",
											url: result.url,
											title: result.title,
											...(result.snippet ? { snippet: result.snippet } : {}),
											page_age: null,
											encrypted_content: `e2e:${result.url}`,
										})),
										caller: { type: "direct" },
									},
								]
							: []
					const contentBlocks = [...hostedContentBlocks, ...ordinaryContentBlocks]
					const thinkingBlock = scriptedResponse.reasoning
						? {
								type: "thinking",
								thinking: scriptedResponse.reasoning,
								signature: `e2e_signature_${generationId}`,
							}
						: undefined
					if (parsed.stream === false) {
						return sendJson({
							id: generationId,
							type: "message",
							role: "assistant",
							model,
							content: thinkingBlock ? [thinkingBlock, ...contentBlocks] : contentBlocks,
							stop_reason: responseToolCalls.length > 0 ? "tool_use" : "end_turn",
							stop_sequence: null,
							usage: { ...messageUsage, output_tokens: usage.outputTokens },
						})
					}

					res.writeHead(200, {
						"Content-Type": "text/event-stream",
						"Cache-Control": "no-cache",
						Connection: "keep-alive",
					})
					writeSse(
						{
							type: "message_start",
							message: {
								id: generationId,
								type: "message",
								role: "assistant",
								model,
								content: [],
								stop_reason: null,
								stop_sequence: null,
								usage: messageUsage,
							},
						},
						"message_start",
					)
					if (thinkingBlock) {
						writeSse(
							{
								type: "content_block_start",
								index: 0,
								content_block: { type: "thinking", thinking: "", signature: "" },
							},
							"content_block_start",
						)
						writeSse(
							{
								type: "content_block_delta",
								index: 0,
								delta: { type: "thinking_delta", thinking: thinkingBlock.thinking },
							},
							"content_block_delta",
						)
						writeSse(
							{
								type: "content_block_delta",
								index: 0,
								delta: { type: "signature_delta", signature: thinkingBlock.signature },
							},
							"content_block_delta",
						)
						writeSse({ type: "content_block_stop", index: 0 }, "content_block_stop")
						if (!(await waitAfterReasoning())) return
					}
					const contentBlockOffset = thinkingBlock ? 1 : 0
					for (const [index, block] of hostedContentBlocks.entries()) {
						const contentBlockIndex = contentBlockOffset + index
						const startBlock = block.type === "server_tool_use" ? { ...block, input: {} } : block
						writeSse(
							{ type: "content_block_start", index: contentBlockIndex, content_block: startBlock },
							"content_block_start",
						)
						if (block.type === "server_tool_use") {
							writeSse(
								{
									type: "content_block_delta",
									index: contentBlockIndex,
									delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
								},
								"content_block_delta",
							)
						}
						writeSse({ type: "content_block_stop", index: contentBlockIndex }, "content_block_stop")
					}
					const ordinaryContentBlockOffset = contentBlockOffset + hostedContentBlocks.length
					if (responseToolCalls.length > 0) {
						for (const [index, tool] of responseToolCalls.entries()) {
							const contentBlockIndex = ordinaryContentBlockOffset + index
							writeSse(
								{
									type: "content_block_start",
									index: contentBlockIndex,
									content_block: {
										id: tool.id ?? `toolu_${generationId}_${index}`,
										type: "tool_use",
										name: tool.name,
										input: {},
									},
								},
								"content_block_start",
							)
							writeSse(
								{
									type: "content_block_delta",
									index: contentBlockIndex,
									delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.arguments) },
								},
								"content_block_delta",
							)
							writeSse({ type: "content_block_stop", index: contentBlockIndex }, "content_block_stop")
						}
					} else {
						const contentBlockIndex = ordinaryContentBlockOffset
						writeSse(
							{
								type: "content_block_start",
								index: contentBlockIndex,
								content_block: { type: "text", text: "" },
							},
							"content_block_start",
						)
						writeSse(
							{
								type: "content_block_delta",
								index: contentBlockIndex,
								delta: { type: "text_delta", text: messageText },
							},
							"content_block_delta",
						)
						writeSse({ type: "content_block_stop", index: contentBlockIndex }, "content_block_stop")
					}
					writeSse(
						{
							type: "message_delta",
							delta: {
								stop_reason: responseToolCalls.length > 0 ? "tool_use" : "end_turn",
								stop_sequence: null,
							},
							usage: { output_tokens: usage.outputTokens },
						},
						"message_delta",
					)
					writeSse({ type: "message_stop" }, "message_stop")
					res.end()
					return
				}

				// Health check endpoints
				if (baseRoute === "/health") {
					if (endpoint === "/" && method === "GET") {
						return sendJson({
							status: "ok",
							timestamp: new Date().toISOString(),
						})
					}
				}

				// API v1 endpoints
				if (baseRoute === "/api/v1") {
					// User endpoints
					if (endpoint === "/users/me" && method === "GET") {
						const currentUser = controller.currentUser
						if (!currentUser) {
							return sendApiError("Unauthorized", 401)
						}
						return sendApiResponse(currentUser)
					}

					if (endpoint === "/users/me/remote-config" && method === "GET") {
						return sendApiResponse(null)
					}

					if (endpoint === "/users/me/featurebase-token" && method === "GET") {
						const currentUser = controller.currentUser
						if (!currentUser) {
							return sendApiError("Unauthorized", 401)
						}
						return sendApiResponse({
							featurebaseJwt: `mock-featurebase-jwt-${currentUser.id}`,
						})
					}

					if (endpoint === "/users/{userId}/balance" && method === "GET") {
						const { userId } = params
						const balance: BalanceResponse = {
							balance: controller.userBalance,
							userId,
						}
						return sendApiResponse(balance)
					}

					if (endpoint === "/users/{userId}/usages" && method === "GET") {
						const { userId } = params
						const currentUser = controller.currentUser
						if (currentUser?.id !== userId) {
							return sendApiError("Unauthorized", 401)
						}
						return sendApiResponse({
							items: controller.API_USER.getMockUsageTransactions(userId),
						})
					}

					if (endpoint === "/users/{userId}/payments" && method === "GET") {
						const { userId } = params
						const currentUser = controller.currentUser
						if (currentUser?.id !== userId) {
							return sendApiError("Unauthorized", 401)
						}
						return sendApiResponse({
							paymentTransactions: controller.API_USER.getMockPaymentTransactions(userId),
						})
					}

					// Organization endpoints
					if (endpoint === "/organizations/{orgId}/balance" && method === "GET") {
						const { orgId } = params
						const balance: OrganizationBalanceResponse = {
							balance: controller.orgBalance,
							organizationId: orgId,
						}
						return sendApiResponse(balance)
					}

					if (endpoint === "/organizations/{orgId}/members/{memberId}/usages" && method === "GET") {
						const currentUser = controller.currentUser
						if (!currentUser) {
							return sendApiError("Unauthorized", 401)
						}
						const body = await readBody()
						const { orgId } = params
						log("Fetching organization usage transactions for", {
							orgId,
							body,
						})
						return sendApiResponse({
							items: controller.API_USER.getMockUsageTransactions(currentUser.id, orgId),
						})
					}

					if (endpoint === "/users/active-account" && method === "PUT") {
						const body = await readBody()
						log("Switching active account")
						const { organizationId } = JSON.parse(body)
						controller.setUserHasOrganization(!!organizationId)
						const currentUser = controller.API_USER.getCurrentUser()
						if (!currentUser) {
							return sendApiError("No current user found", 400)
						}
						if (organizationId === null) {
							for (const org of currentUser.organizations) {
								org.active = false
							}
						} else {
							const orgIndex = currentUser.organizations.findIndex((org) => org.organizationId === organizationId)
							if (orgIndex === -1) {
								return sendApiError("Organization not found", 404)
							}
							currentUser.organizations[orgIndex].active = controller.userHasOrganization
						}
						controller.setCurrentUser(currentUser)
						return sendApiResponse("Account switched successfully")
					}

					// Auth token exchange endpoint
					if (endpoint === "/auth/token" && method === "POST") {
						const body = await readBody()
						const parsed = JSON.parse(body)
						const { code, grantType } = parsed

						if (grantType !== "authorization_code" || !code) {
							return sendApiError("Invalid request", 400)
						}

						const user = controller.API_USER.getUserByToken(code)
						if (!user) {
							return sendApiError("Invalid or expired authorization code", 400)
						}

						// Return format matching ClineAuthProvider expectations
						return sendApiResponse({
							accessToken: `${code}_access`,
							refreshToken: `${code}_refresh`,
							tokenType: "Bearer",
							expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now
							userInfo: {
								subject: user.id,
								email: user.email,
								name: user.displayName,
								clineUserId: user.id,
								accounts: null,
								organizations: user.organizations,
							},
						})
					}

					// Auth refresh token endpoint
					if (endpoint === "/auth/refresh" && method === "POST") {
						const body = await readBody()
						const parsed = JSON.parse(body)
						const { refreshToken, grantType } = parsed

						if (grantType !== "refresh_token" || !refreshToken) {
							return sendApiError("Invalid request", 400)
						}

						// Extract original token from refresh token
						const originalToken = refreshToken.replace("_refresh", "")
						const user = controller.API_USER.getUserByToken(originalToken)
						if (!user) {
							return sendApiError("Invalid or expired refresh token", 400)
						}

						// Return format matching ClineAuthProvider expectations
						return sendApiResponse({
							accessToken: `${originalToken}_access_refreshed`,
							refreshToken: refreshToken, // Keep same refresh token
							tokenType: "Bearer",
							expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour from now
							userInfo: {
								subject: user.id,
								email: user.email,
								name: user.displayName,
								clineUserId: user.id,
								accounts: null,
							},
						})
					}

					// Budget limit increase request endpoint
					if (endpoint === "/users/me/budget/request" && method === "POST") {
						log("Spend limit increase request received — recording and notifying admin")
						res.writeHead(204)
						res.end()
						return
					}

					// Chat completions endpoint
					if (endpoint === "/chat/completions" && method === "POST") {
						// Spend limit check takes priority — org-enforced budget cap (429)
						if (controller.spendLimitExceeded) {
							log("Returning SPEND_LIMIT_EXCEEDED (429)")
							return sendJson(
								{
									error: {
										code: "SPEND_LIMIT_EXCEEDED",
										limit_scope: "user",
										budget_period: "daily",
										limit_usd: 20.0,
										spent_usd: 20.5,
										resets_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
										message: "Your daily spend limit of $20.00 has been reached.",
									},
								},
								429,
							)
						}

						if (!controller.userHasOrganization && controller.userBalance <= 0) {
							return sendApiError(
								JSON.stringify({
									code: "insufficient_credits",
									current_balance: controller.userBalance,
									message: "Not enough credits available",
								}),
								402,
							)
						}

						const body = await readBody()
						const parsed = JSON.parse(body)
						const { _messages, model = "claude-3-5-sonnet-20241022", stream = true } = parsed
						let responseText = E2E_MOCK_API_RESPONSES.DEFAULT
						if (body.includes("[replace_in_file for 'test.ts'] Result:")) {
							responseText = E2E_MOCK_API_RESPONSES.REPLACE_REQUEST
						}
						if (body.includes("edit_request")) {
							responseText = E2E_MOCK_API_RESPONSES.EDIT_REQUEST
						}
						if (body.includes("[diff.test.ts] Hello, Cline!")) {
							// The playwright test in diff.test.ts needs the "API Request..." text
							// to be on the screen long enough to detect it.  This worked at 100ms
							// too, but setting to 500ms to cover slower CI boxes.
							await new Promise((resolve) => setTimeout(resolve, 500))
						}

						const generationId = `gen_${++controller.generationCounter}_${Date.now()}`

						if (stream) {
							res.writeHead(200, {
								"Content-Type": "text/plain",
								"Cache-Control": "no-cache",
								Connection: "keep-alive",
							})

							const randomUUID = uuidv4()

							responseText += `\n\nGenerated UUID: ${randomUUID}`

							const chunks = responseText.split(" ")
							let chunkIndex = 0

							const sendChunk = () => {
								if (chunkIndex < chunks.length) {
									const chunk = {
										id: generationId,
										object: "chat.completion.chunk",
										created: Math.floor(Date.now() / 1000),
										model,
										choices: [
											{
												index: 0,
												delta: {
													content: chunks[chunkIndex] + (chunkIndex < chunks.length - 1 ? " " : ""),
												},
												finish_reason: null,
											},
										],
									}
									res.write(`data: ${JSON.stringify(chunk)}\n\n`)
									chunkIndex++
									setTimeout(sendChunk, 10)
								} else {
									const finalChunk = {
										id: generationId,
										object: "chat.completion.chunk",
										created: Math.floor(Date.now() / 1000),
										model,
										choices: [
											{
												index: 0,
												delta: {},
												finish_reason: "stop",
											},
										],
										usage: {
											prompt_tokens: 140,
											completion_tokens: responseText.length,
											total_tokens: 140 + responseText.length,
											cost: (140 + responseText.length) * 0.00015,
										},
									}
									res.write(`data: ${JSON.stringify(finalChunk)}\n\n`)
									res.write("data: [DONE]\n\n")
									res.end()
								}
							}

							sendChunk()
							return
						}
						const response = {
							id: generationId,
							object: "chat.completion",
							created: Math.floor(Date.now() / 1000),
							model,
							choices: [
								{
									index: 0,
									message: {
										role: "assistant",
										content: "Hello! I'm a mock Cline API response.",
									},
									finish_reason: "stop",
								},
							],
							usage: {
								prompt_tokens: 140,
								completion_tokens: responseText.length,
								total_tokens: 140 + responseText.length,
								cost: (140 + responseText.length) * 0.00015,
							},
						}
						return sendJson(response)
					}

					// Generation details endpoint
					if (endpoint === "/generation" && method === "GET") {
						const generationId = parsedUrl.searchParams.get("id") || ""
						const generation = controller.API_USER.getGeneration(generationId)

						if (!generation) {
							return sendJson({ error: "Generation not found" }, 404)
						}

						return sendJson(generation)
					}
				}

				// Test helper endpoints
				if (baseRoute === "/.test") {
					if (endpoint === "/auth" && method === "POST") {
						const user = controller.API_USER.getUserByToken()
						if (!user) {
							return sendApiError("Invalid token", 401)
						}
						controller.setCurrentUser(user)
						return
					}

					if (endpoint === "/setUserBalance" && method === "POST") {
						const body = await readBody()
						const { balance } = JSON.parse(body)
						controller.setUserBalance(balance)
						res.writeHead(200)
						res.end()
						return
					}

					if (endpoint === "/setUserHasOrganization" && method === "POST") {
						const body = await readBody()
						const { hasOrg } = JSON.parse(body)
						controller.setUserHasOrganization(hasOrg)
						res.writeHead(200)
						res.end()
						return
					}

					if (endpoint === "/setOrgBalance" && method === "POST") {
						const body = await readBody()
						const { balance } = JSON.parse(body)
						controller.setOrgBalance(balance)
						res.writeHead(200)
						res.end()
						return
					}

					if (endpoint === "/setSpendLimitExceeded" && method === "POST") {
						const body = await readBody()
						const { exceeded } = JSON.parse(body)
						controller.setSpendLimitExceeded(!!exceeded)
						res.writeHead(200)
						res.end()
						return
					}
				}

				// If we get here, the route was matched but not handled
				return sendJson({ error: "Endpoint not implemented" }, 500)
			}

			handleRequest().catch((err) => {
				console.error("Request handling error:", err)
				sendApiError("Internal server error", 500)
			})
		})

		// Track connections for proper cleanup
		server.on("connection", (socket) => {
			ClineApiServerMock.globalSockets.add(socket)
			socket.on("close", () => {
				ClineApiServerMock.globalSockets.delete(socket)
			})
		})

		await new Promise<void>((resolve, reject) => {
			const onError = (error: Error) => reject(error)
			server.once("error", onError)
			server.listen(0, E2E_API_SERVER_HOST, () => {
				server.off("error", onError)
				resolve()
			})
		})

		const address = server.address() as AddressInfo | null
		if (!address) {
			server.close()
			throw new Error("Mock API server started without a network address")
		}

		const baseUrl = `http://${E2E_API_SERVER_HOST}:${address.port}`
		const controller = new ClineApiServerMock(server, baseUrl)
		ClineApiServerMock.globalSharedServer = controller
		log(`ClineApiServerMock listening at ${baseUrl}`)

		return controller
	}

	// Stops the global shared server
	public static async stopGlobalServer(): Promise<void> {
		if (!ClineApiServerMock.globalSharedServer) {
			return
		}

		const server = ClineApiServerMock.globalSharedServer.server

		// Clean shutdown - destroy all socket connections first
		ClineApiServerMock.globalSockets.forEach((socket) => socket.destroy())
		ClineApiServerMock.globalSockets.clear()

		await new Promise<void>((resolve, reject) => {
			server.close((err) => {
				if (err) {
					console.error("Error closing server:", err)
					reject(err)
				}
				log("Server closed successfully")
				resolve()
			})
		})

		ClineApiServerMock.globalSharedServer = null
	}
}
