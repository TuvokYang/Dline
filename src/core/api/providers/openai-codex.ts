import { ModelInfo, OpenAiCodexModelId, openAiCodexDefaultModelId, openAiCodexModels } from "@shared/api"
import { providerFetch } from "@shared/net"
import { observeProviderStream } from "@shared/provider-attempt-observer"
import { normalizeOpenAiServiceTier, normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import * as os from "os"
import { MessageEvent as UndiciMessageEvent, WebSocket as UndiciWebSocket } from "undici"
import { v7 as uuidv7 } from "uuid"
import { openAiCodexOAuthManager } from "@/integrations/openai-codex/oauth"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { featureFlagsService } from "@/services/feature-flags"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiFormat, ServerTool } from "@/shared/proto/dline/models/metadata"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import { AccountUsage, ApiHandler, ApiHandlerContext, type ApiRequestOptions } from "../"
import { isOutputLimitExceededError, OutputLimitExceededError } from "../stream/OutputLimitExceededError"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import {
	createResponsesRegistry,
	createResponsesToolChunk,
	ResponsesIdentityRegistry,
} from "../transform/responses-identity-registry"
import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { mapResponsesWebSearchEvent } from "../utils/responses_api_support"

/**
 * OpenAI Codex base URL for API requests
 * Routes to chatgpt.com/backend-api/codex
 */
const CODEX_API_BASE_URL = "https://chatgpt.com/backend-api/codex"
const CODEX_RESPONSES_WEBSOCKET_URL = "wss://chatgpt.com/backend-api/codex/responses"
const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const CODEX_USAGE_TIMEOUT_MS = 10_000

interface CodexUsageWindow {
	used_percent?: number
	limit_window_seconds?: number
	reset_at?: number
}

interface CodexUsageResponse {
	rate_limit?: {
		primary_window?: CodexUsageWindow
		secondary_window?: CodexUsageWindow
	}
	credits?: {
		balance?: string | number
	}
}

/**
 * OpenAiCodexHandler - Uses OpenAI Responses API with OAuth authentication
 *
 * Key differences from OpenAiHandler:
 * - Uses OAuth Bearer tokens instead of API keys
 * - Routes requests to Codex backend (chatgpt.com/backend-api/codex)
 * - Subscription-based pricing (no per-token costs)
 * - Limited model subset
 * - Custom headers for Codex backend
 */
export class OpenAiCodexHandler implements ApiHandler {
	private client?: OpenAI
	private responsesWs: UndiciWebSocket | undefined
	private websocketRequestInFlight = false
	// Session ID for the Codex API (persists for the lifetime of the handler)
	private readonly sessionId: string
	// Abort controller for cancelling ongoing requests
	private abortController?: AbortController
	private accountUsageController?: AbortController
	// Track request-local Responses item and function identities.
	private responsesRegistry: ResponsesIdentityRegistry = createResponsesRegistry("openai-codex")

	constructor(private ctx: ApiHandlerContext) {
		this.sessionId = uuidv7()
	}

	private get config() {
		// Provider config fields are generated from proto as camelCase members.
		return this.ctx.profile.openaiCodex
	}
	private get modelId() {
		return this.ctx.profile.modelId || ""
	}
	private get modelInfo() {
		return this.ctx.profile.modelInfo as ModelInfo | undefined
	}
	private get reasoningConfig() {
		return this.config?.reasoning
	}
	private get reasoningEffort() {
		return this.reasoningConfig?.effort
	}
	private get serviceTier() {
		return this.config?.serviceTierEnabled === false ? undefined : normalizeOpenAiServiceTier(this.config?.serviceTier)
	}

	supportsServerTool(tool: ServerTool): boolean {
		if (tool !== ServerTool.WEB_SEARCH) {
			return false
		}
		const apiFormat = this.getModel().info.apiFormats?.[0]
		return apiFormat === ApiFormat.OPENAI_RESPONSES || apiFormat === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE
	}

	private usageQuota(window: CodexUsageWindow | undefined) {
		if (!window || typeof window.used_percent !== "number") {
			return undefined
		}

		const seconds = window.limit_window_seconds ?? 0
		const type =
			seconds >= 27 * 24 * 60 * 60
				? "monthly"
				: seconds >= 6 * 24 * 60 * 60
					? "weekly"
					: seconds >= 20 * 60 * 60
						? "daily"
						: seconds === 5 * 60 * 60
							? "5hour"
							: "custom"
		const label =
			type === "monthly"
				? "Monthly"
				: type === "weekly"
					? "Weekly"
					: type === "daily"
						? "Daily"
						: type === "5hour"
							? "5 hour"
							: seconds >= 60 * 60
								? `${Math.round(seconds / (60 * 60))}h`
								: `${Math.max(1, Math.round(seconds / 60))}m`
		const resetAt =
			typeof window.reset_at === "number" && window.reset_at > 0
				? new Date(window.reset_at * 1_000).toISOString()
				: undefined

		return {
			type,
			label,
			used: Math.max(0, Math.min(100, window.used_percent)),
			limit: 100,
			resetAt,
		}
	}

	/** Fetch current ChatGPT Codex quota windows for this OAuth account. */
	async getAccountUsage(): Promise<AccountUsage | undefined> {
		this.accountUsageController?.abort()
		const controller = new AbortController()
		this.accountUsageController = controller
		const timeout = setTimeout(() => controller.abort(), CODEX_USAGE_TIMEOUT_MS)

		try {
			let accessToken = await openAiCodexOAuthManager.getAccessToken()
			if (!accessToken) {
				return undefined
			}

			for (let attempt = 0; attempt < 2; attempt++) {
				const accountId = await openAiCodexOAuthManager.getAccountId()
				const response = await fetch(CODEX_USAGE_URL, {
					headers: {
						Authorization: `Bearer ${accessToken}`,
						originator: "dline",
						"User-Agent": `dline/${process.env.npm_package_version || "1.0.0"}`,
						...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
						...buildExternalBasicHeaders(),
					},
					signal: controller.signal,
				})

				if (response.status === 401 && attempt === 0) {
					const refreshed = await openAiCodexOAuthManager.forceRefreshAccessToken()
					if (!refreshed) {
						return undefined
					}
					accessToken = refreshed
					continue
				}
				if (!response.ok) {
					throw new Error(`Codex usage request failed: ${response.status}`)
				}

				const payload = (await response.json()) as CodexUsageResponse
				const quotas = [
					this.usageQuota(payload.rate_limit?.primary_window),
					this.usageQuota(payload.rate_limit?.secondary_window),
				].filter((quota): quota is NonNullable<typeof quota> => quota !== undefined)
				const balanceValue = payload.credits?.balance
				const balance = balanceValue === undefined || balanceValue === null ? Number.NaN : Number(balanceValue)
				if (quotas.length === 0 && !Number.isFinite(balance)) {
					return undefined
				}

				return {
					currency: Number.isFinite(balance) ? "USD" : "",
					...(Number.isFinite(balance) ? { remainingBalance: balance } : {}),
					quotas,
					isAvailable: true,
				}
			}
			return undefined
		} finally {
			clearTimeout(timeout)
			if (this.accountUsageController === controller) {
				this.accountUsageController = undefined
			}
		}
	}

	private normalizeUsage(usage: any, _model: { id: string; info: ModelInfo }): ApiStreamUsageChunk | undefined {
		if (!usage) {
			return undefined
		}

		const inputDetails = usage.input_tokens_details ?? usage.prompt_tokens_details

		const hasCachedTokens = typeof inputDetails?.cached_tokens === "number"
		const hasCacheMissTokens = typeof inputDetails?.cache_miss_tokens === "number"
		const cachedFromDetails = hasCachedTokens ? inputDetails.cached_tokens : 0
		const missFromDetails = hasCacheMissTokens ? inputDetails.cache_miss_tokens : 0

		let totalInputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0
		if (totalInputTokens === 0 && inputDetails && (cachedFromDetails > 0 || missFromDetails > 0)) {
			totalInputTokens = cachedFromDetails + missFromDetails
		}

		const totalOutputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0
		const cacheWriteTokens = usage.cache_creation_input_tokens ?? usage.cache_write_tokens ?? 0
		const cacheReadTokens =
			usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? usage.cached_tokens ?? cachedFromDetails ?? 0

		const reasoningTokens =
			typeof usage.output_tokens_details?.reasoning_tokens === "number"
				? usage.output_tokens_details.reasoning_tokens
				: undefined

		// Yield inputTokens in Anthropic semantic (excluding cache) so
		// ContextManager and updateApiReqMsg can accurately estimate
		// context pressure. Cost is zero for subscription-based billing.
		const nonCachedInputTokens = Math.max(0, totalInputTokens - cacheReadTokens - cacheWriteTokens)
		const out: ApiStreamUsageChunk = {
			type: "usage",
			inputTokens: nonCachedInputTokens,
			outputTokens: totalOutputTokens,
			cacheWriteTokens,
			cacheReadTokens,
			...(typeof reasoningTokens === "number" ? { reasoningTokens } : {}),
			totalCost: 0, // Subscription-based pricing
		}
		return out
	}

	async *createMessage(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools?: ChatCompletionTool[],
		options?: ApiRequestOptions,
	): ApiStream {
		const model = this.getModel()

		// Reset request-local Responses identity state.
		this.responsesRegistry = createResponsesRegistry("openai-codex")

		// Get access token from OAuth manager
		let accessToken = await openAiCodexOAuthManager.getAccessToken()
		if (!accessToken) {
			throw new Error("Not authenticated with OpenAI Codex. Please sign in using the OpenAI Codex OAuth flow in settings.")
		}
		const useWebsocketMode = this.useWebsocketMode(model.info.apiFormats?.[0])
		const { input, previousResponseId } = convertToOpenAIResponsesInput(messages, { usePreviousResponseId: useWebsocketMode })
		const usePreviousResponseId = useWebsocketMode && !!previousResponseId

		// Build request body
		const requestBody = this.buildRequestBody(model, input, systemPrompt, tools, previousResponseId, options)
		const fallbackRequestBody = this.buildRequestBody(model, input, systemPrompt, tools, undefined, options)

		// Make the request with retry on auth failure
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				yield* this.executeRequest(requestBody, fallbackRequestBody, model, accessToken, usePreviousResponseId)
				return
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				const isAuthFailure = /unauthorized|invalid token|not authenticated|authentication|401/i.test(message)

				if (attempt === 0 && isAuthFailure) {
					// Force refresh the token for retry
					const refreshed = await openAiCodexOAuthManager.forceRefreshAccessToken()
					if (!refreshed) {
						throw new Error(
							"Not authenticated with OpenAI Codex. Please sign in using the OpenAI Codex OAuth flow in settings.",
						)
					}
					accessToken = refreshed
					continue
				}
				throw error
			}
		}
	}

	private useWebsocketMode(apiFormat?: ApiFormat): boolean {
		if (featureFlagsService.getBooleanFlagEnabled(FeatureFlag.OPENAI_RESPONSES_WEBSOCKET_MODE)) {
			return apiFormat === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE
		}
		return false
	}

	private buildRequestBody(
		model: { id: string; info: ModelInfo },
		formattedInput: any,
		systemPrompt: string,
		tools?: ChatCompletionTool[],
		previousResponseId?: string,
		options?: ApiRequestOptions,
	): any {
		// Determine reasoning effort. Explicit enableThinking=false disables Responses reasoning entirely.
		const enableThinking = this.reasoningConfig?.enableThinking ?? true
		const reasoningEffort = normalizeOpenaiReasoningEffort(this.reasoningEffort)
		const includeReasoning = enableThinking && reasoningEffort !== "none"
		const hostedWebSearch = options?.serverTools?.includes(ServerTool.WEB_SEARCH) === true
		const maxOutputTokens = options?.generation?.purpose === "compaction" ? options.generation.maxOutputTokens : undefined
		const include = [
			...(includeReasoning ? ["reasoning.encrypted_content"] : []),
			...(hostedWebSearch ? ["web_search_call.results", "web_search_call.action.sources"] : []),
		]

		const body: any = {
			model: model.id,
			input: formattedInput,
			stream: true,
			store: false,
			instructions: systemPrompt,
			...(this.serviceTier ? { service_tier: this.serviceTier } : {}),
			...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
			...(maxOutputTokens === undefined ? {} : { max_output_tokens: maxOutputTokens }),
			...(include.length > 0 ? { include } : {}),
			...(includeReasoning
				? {
						reasoning: {
							effort: reasoningEffort,
							summary: "auto",
						},
					}
				: {}),
		}

		// Add tools if provided
		// Pass through strict value from tool (MCP/custom tools have strict: false, built-in tools default to true)
		if (tools && tools.length > 0) {
			body.tools = tools
				.filter((tool: any) => tool?.type === "function")
				.filter((tool: any) => !hostedWebSearch || tool.function.name !== "web_search")
				.map((tool: any) => ({
					type: "function",
					name: tool.function.name,
					description: tool.function.description,
					parameters: tool.function.parameters,
					strict: tool.function.strict ?? true,
				}))
		}
		if (hostedWebSearch) {
			body.tools = [...(body.tools ?? []), { type: "web_search" }]
		}

		return body
	}

	private async *executeRequest(
		requestBody: any,
		fallbackRequestBody: any,
		model: { id: string; info: ModelInfo },
		accessToken: string,
		useWebsocketMode: boolean,
	): ApiStream {
		// Create AbortController for cancellation
		this.abortController = new AbortController()

		try {
			// Get ChatGPT account ID for organization subscriptions
			const accountId = await openAiCodexOAuthManager.getAccountId()

			// Build Codex-specific headers
			const codexHeaders: Record<string, string> = {
				originator: "dline",
				session_id: this.sessionId,
				"User-Agent": `dline/${process.env.npm_package_version || "1.0.0"} (${os.platform()} ${os.release()}; ${os.arch()}) node/${process.version.slice(1)}`,
				...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
				...buildExternalBasicHeaders(),
			}

			if (useWebsocketMode) {
				try {
					yield* this.createResponseStreamWebsocket(requestBody, fallbackRequestBody, accessToken, codexHeaders, model)
					return
				} catch (error) {
					if (isOutputLimitExceededError(error)) {
						throw error
					}
					Logger.error("OpenAI Codex websocket mode failed, falling back to HTTP Responses API:", error)
					this.closeResponsesWebsocket()
				}
			}

			// Try using OpenAI SDK first
			try {
				const client =
					this.client ??
					new OpenAI({
						apiKey: accessToken,
						baseURL: CODEX_API_BASE_URL,
						defaultHeaders: codexHeaders,
						fetch: providerFetch,
					})

				const stream = (await (client as any).responses.create(requestBody, {
					signal: this.abortController.signal,
					headers: codexHeaders,
				})) as AsyncIterable<any>

				if (typeof (stream as any)?.[Symbol.asyncIterator] !== "function") {
					throw new Error("OpenAI SDK did not return an AsyncIterable")
				}

				for await (const event of stream) {
					if (this.abortController.signal.aborted) {
						break
					}

					for await (const outChunk of this.processEvent(event, model)) {
						yield outChunk
					}
				}
			} catch (error) {
				if (isOutputLimitExceededError(error)) {
					throw error
				}
				// Fallback to manual SSE via fetch
				yield* this.makeCodexRequest(requestBody, model, accessToken)
			}
		} finally {
			this.abortController = undefined
		}
	}

	private async *createResponseStreamWebsocket(
		primaryParams: OpenAI.Responses.ResponseCreateParamsStreaming,
		fallbackParams: OpenAI.Responses.ResponseCreateParamsStreaming,
		accessToken: string,
		codexHeaders: Record<string, string>,
		model: { id: string; info: ModelInfo },
	): ApiStream {
		try {
			for await (const event of this.createResponseEventsViaWebsocket(primaryParams, accessToken, codexHeaders)) {
				if (this.abortController?.signal.aborted) {
					return
				}
				yield* this.processEvent(event, model)
			}
		} catch (error) {
			if (this.shouldRetryWebsocketWithFullContext(error, !!primaryParams.previous_response_id)) {
				Logger.log(
					"Retrying Codex websocket response with full context after previous_response_not_found or socket reset",
				)
				this.closeResponsesWebsocket()
				for await (const event of this.createResponseEventsViaWebsocket(fallbackParams, accessToken, codexHeaders)) {
					if (this.abortController?.signal.aborted) {
						return
					}
					yield* this.processEvent(event, model)
				}
				return
			}
			throw error
		}
	}

	private shouldRetryWebsocketWithFullContext(error: unknown, hadPreviousResponseId: boolean): boolean {
		const errorCode =
			typeof error === "object" && error && "code" in error && typeof (error as { code: unknown }).code === "string"
				? (error as { code: string }).code
				: undefined

		if (hadPreviousResponseId && errorCode === "previous_response_not_found") {
			return true
		}
		if (errorCode === "websocket_closed" || errorCode === "websocket_error") {
			return true
		}
		return false
	}

	private async ensureResponsesWebsocket(accessToken: string, codexHeaders: Record<string, string>): Promise<UndiciWebSocket> {
		if (this.responsesWs && this.responsesWs.readyState === UndiciWebSocket.OPEN) {
			return this.responsesWs
		}

		this.closeResponsesWebsocket()

		const ws = new UndiciWebSocket(CODEX_RESPONSES_WEBSOCKET_URL, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"OpenAI-Beta": "responses_websockets=2026-02-06",
				...codexHeaders,
			},
		})

		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				ws.removeEventListener("open", handleOpen)
				ws.removeEventListener("error", handleError)
				ws.removeEventListener("close", handleClose)
			}
			const handleOpen = () => {
				cleanup()
				resolve()
			}
			const handleError = () => {
				cleanup()
				reject(new Error("Failed to open Codex Responses websocket"))
			}
			const handleClose = () => {
				cleanup()
				reject(new Error("Codex Responses websocket closed before opening"))
			}
			ws.addEventListener("open", handleOpen)
			ws.addEventListener("error", handleError)
			ws.addEventListener("close", handleClose)
		})

		this.responsesWs = ws
		return ws
	}

	private closeResponsesWebsocket() {
		if (this.responsesWs) {
			try {
				this.responsesWs.close()
			} catch {}
			this.responsesWs = undefined
		}
	}

	private async *createResponseEventsViaWebsocket(
		params: OpenAI.Responses.ResponseCreateParamsStreaming,
		accessToken: string,
		codexHeaders: Record<string, string>,
	): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
		if (this.websocketRequestInFlight) {
			const error: Error & { code?: string } = new Error("Websocket response.create is already in progress")
			error.code = "websocket_concurrency_limit"
			throw error
		}

		const ws = await this.ensureResponsesWebsocket(accessToken, codexHeaders)
		this.websocketRequestInFlight = true

		const eventQueue: OpenAI.Responses.ResponseStreamEvent[] = []
		let resolver: (() => void) | undefined
		let completed = false
		let failure: (Error & { code?: string }) | undefined

		const wake = () => {
			const next = resolver
			resolver = undefined
			next?.()
		}

		const handleMessage = (evt: UndiciMessageEvent) => {
			try {
				let raw = ""
				if (typeof evt.data === "string") {
					raw = evt.data
				} else if (evt.data instanceof ArrayBuffer) {
					raw = new TextDecoder().decode(new Uint8Array(evt.data))
				} else if (ArrayBuffer.isView(evt.data)) {
					raw = new TextDecoder().decode(new Uint8Array(evt.data.buffer, evt.data.byteOffset, evt.data.byteLength))
				} else {
					raw = String(evt.data)
				}

				const parsed = JSON.parse(raw)
				if (parsed?.type === "error" && parsed?.error) {
					const error: Error & { code?: string } = new Error(parsed.error.message || "Codex Responses websocket error")
					error.code = parsed.error.code
					failure = error
					completed = true
					wake()
					return
				}

				if (parsed?.type === "response.failed") {
					const responseError = parsed.response?.error
					// Preserve the upstream code: downstream retry classification needs it to
					// tell a transient gateway failure apart from an account-level rejection.
					const failedError: Error & { code?: string } = new Error(
						responseError?.message || "Codex Responses websocket request failed",
					)
					failedError.code = responseError?.code
					failure = failedError
					completed = true
					wake()
					return
				}
				if (parsed?.type === "response.incomplete") {
					failure =
						parsed.response?.incomplete_details?.reason === "max_output_tokens"
							? new OutputLimitExceededError("openai_responses", "max_output_tokens")
							: new Error("Codex Responses websocket request was incomplete")
					completed = true
					wake()
					return
				}

				eventQueue.push(parsed as OpenAI.Responses.ResponseStreamEvent)
				if (parsed?.type === "response.completed") completed = true
				wake()
			} catch (error) {
				const parseError: Error & { code?: string } = new Error(
					`Failed to parse websocket event: ${error instanceof Error ? error.message : String(error)}`,
				)
				parseError.code = "websocket_parse_error"
				failure = parseError
				completed = true
				wake()
			}
		}

		const handleError = () => {
			const error: Error & { code?: string } = new Error("Codex Responses websocket emitted an error event")
			error.code = "websocket_error"
			failure = error
			completed = true
			wake()
		}

		const handleClose = () => {
			if (!completed) {
				const error: Error & { code?: string } = new Error("Codex Responses websocket closed during response stream")
				error.code = "websocket_closed"
				failure = error
				completed = true
				wake()
			}
		}

		ws.addEventListener("message", handleMessage)
		ws.addEventListener("error", handleError)
		ws.addEventListener("close", handleClose)

		try {
			const responseEvents = await observeProviderStream(
				() =>
					(async function* () {
						const websocketParams = { ...params } as Record<string, unknown>
						delete websocketParams.stream
						ws.send(
							JSON.stringify({
								type: "response.create",
								...websocketParams,
							}),
						)

						while (!completed || eventQueue.length > 0) {
							if (eventQueue.length === 0) {
								await new Promise<void>((resolve) => {
									resolver = resolve
								})
								continue
							}

							const event = eventQueue.shift()
							if (event) yield event
						}

						if (failure) throw failure
					})(),
				this.abortController?.signal ? { signal: this.abortController.signal } : {},
			)
			yield* responseEvents
		} finally {
			ws.removeEventListener("message", handleMessage)
			ws.removeEventListener("error", handleError)
			ws.removeEventListener("close", handleClose)
			this.websocketRequestInFlight = false
		}
	}

	private async *makeCodexRequest(requestBody: any, model: { id: string; info: ModelInfo }, accessToken: string): ApiStream {
		const url = `${CODEX_API_BASE_URL}/responses`

		// Get ChatGPT account ID for organization subscriptions
		const accountId = await openAiCodexOAuthManager.getAccountId()

		// Build headers with required Codex-specific fields
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Authorization: `Bearer ${accessToken}`,
			originator: "dline",
			session_id: this.sessionId,
			"User-Agent": `dline/${process.env.npm_package_version || "1.0.0"} (${os.platform()} ${os.release()}; ${os.arch()}) node/${process.version.slice(1)}`,
		}

		// Add ChatGPT-Account-Id if available
		if (accountId) {
			headers["ChatGPT-Account-Id"] = accountId
		}

		try {
			const response = await providerFetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(requestBody),
				signal: this.abortController?.signal,
			})

			if (!response.ok) {
				const errorText = await response.text()
				let errorMessage = `Codex API request failed: ${response.status}`

				try {
					const errorJson = JSON.parse(errorText)
					if (errorJson.error?.message) {
						errorMessage = errorJson.error.message
					} else if (errorJson.message) {
						errorMessage = errorJson.message
					}
				} catch {
					if (errorText) {
						errorMessage += ` - ${errorText}`
					}
				}

				throw new Error(errorMessage)
			}

			if (!response.body) {
				throw new Error("No response body from Codex API")
			}

			yield* this.handleStreamResponse(response.body, model)
		} catch (error) {
			if (isOutputLimitExceededError(error)) {
				throw error
			}
			if (error instanceof Error) {
				throw new Error(`Codex API error: ${error.message}`)
			}
			throw new Error("Unexpected error connecting to Codex API")
		}
	}

	private async *handleStreamResponse(body: ReadableStream<Uint8Array>, model: { id: string; info: ModelInfo }): ApiStream {
		const reader = body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""
		let reachedEof = false
		let terminalReason: unknown

		try {
			while (true) {
				if (this.abortController?.signal.aborted) {
					terminalReason = new DOMException("Codex request aborted", "AbortError")
					return
				}

				const { done, value } = await reader.read()
				if (done) {
					reachedEof = true
					break
				}

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split("\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()
						if (data === "[DONE]") {
							continue
						}

						try {
							const parsed = JSON.parse(data)

							for await (const outChunk of this.processEvent(parsed, model)) {
								yield outChunk
							}
						} catch (e) {
							if (!(e instanceof SyntaxError)) {
								throw e
							}
						}
					}
				}
			}
		} catch (error) {
			terminalReason = error
			throw error
		} finally {
			try {
				if (!reachedEof) await reader.cancel(terminalReason)
			} finally {
				reader.releaseLock()
			}
		}
	}

	private async *processEvent(event: any, model: { id: string; info: ModelInfo }): ApiStream {
		const webSearchChunk = mapResponsesWebSearchEvent(event)
		if (webSearchChunk) {
			yield webSearchChunk
		}

		if (
			event?.type === "response.incomplete" &&
			event?.response?.status === "incomplete" &&
			event?.response?.incomplete_details?.reason === "max_output_tokens"
		) {
			throw new OutputLimitExceededError("openai_responses", "max_output_tokens")
		}

		// Handle text deltas
		if (event?.type === "response.text.delta" || event?.type === "response.output_text.delta") {
			if (event?.delta) {
				yield { type: "text", text: event.delta }
			}
			return
		}

		// Handle reasoning deltas
		if (
			event?.type === "response.reasoning.delta" ||
			event?.type === "response.reasoning_text.delta" ||
			event?.type === "response.reasoning_summary.delta" ||
			event?.type === "response.reasoning_summary_text.delta"
		) {
			if (event?.delta) {
				yield { type: "reasoning", reasoning: event.delta }
			}
			return
		}

		// Handle refusal deltas
		if (event?.type === "response.refusal.delta") {
			if (event?.delta) {
				yield { type: "text", text: `[Refusal] ${event.delta}` }
			}
			return
		}

		// Handle tool/function call deltas
		if (event?.type === "response.tool_call_arguments.delta" || event?.type === "response.function_call_arguments.delta") {
			const itemId = event.item_id
			if (typeof itemId !== "string" || itemId.length === 0) {
				throw new Error("OpenAI Codex Responses argument delta is missing item_id")
			}
			let identity = this.responsesRegistry.resolveItem(itemId)
			if (!identity) {
				const functionId = event.call_id || event.tool_call_id
				const name = event.name || event.function_name
				if (typeof functionId === "string" && functionId.length > 0 && typeof name === "string" && name.length > 0) {
					identity = this.responsesRegistry.registerItem({ itemId, functionId, name })
				} else {
					identity = this.responsesRegistry.requireItem(itemId)
				}
			}
			const args = event.delta || event.arguments
			yield createResponsesToolChunk(identity, typeof args === "string" ? args : "")
			return
		}

		// Handle output item events
		if (event?.type === "response.output_item.added" || event?.type === "response.output_item.done") {
			const item = event?.item
			if (item) {
				// Capture provider-native item and function identities for subsequent argument deltas.
				if (item.type === "function_call" || item.type === "tool_call") {
					const itemId = item.id
					const functionId = item.call_id || item.tool_call_id
					const name = item.name || item.function?.name || item.function_name
					if (
						typeof itemId === "string" &&
						itemId.length > 0 &&
						typeof functionId === "string" &&
						functionId.length > 0 &&
						typeof name === "string" &&
						name.length > 0
					) {
						this.responsesRegistry.registerItem({ itemId, functionId, name })
					}
				}

				if (item.type === "text" && item.text) {
					yield { type: "text", text: item.text }
				} else if (item.type === "reasoning" && item.text) {
					yield { type: "reasoning", reasoning: item.text }
				} else if (item.type === "message" && Array.isArray(item.content)) {
					for (const content of item.content) {
						if ((content?.type === "text" || content?.type === "output_text") && content?.text) {
							yield { type: "text", text: content.text }
						}
					}
				} else if (
					(item.type === "function_call" || item.type === "tool_call") &&
					event.type === "response.output_item.done"
				) {
					const itemId = item.id
					if (typeof itemId === "string" && itemId.length > 0) {
						const identity = this.responsesRegistry.requireItem(itemId)
						const args = item.arguments || item.function?.arguments || item.function_arguments
						yield createResponsesToolChunk(identity, typeof args === "string" ? args : "{}")
					}
				}
			}
			return
		}

		// Handle completion events
		if (event?.type === "response.done" || event?.type === "response.completed") {
			const usage = event?.response?.usage || event?.usage || undefined
			const usageData = this.normalizeUsage(usage, model)
			if (usageData) {
				yield usageData
			}
			return
		}

		// Fallbacks for legacy formats
		if (event?.choices?.[0]?.delta?.content) {
			yield { type: "text", text: event.choices[0].delta.content }
			return
		}

		if (event?.usage) {
			const usageData = this.normalizeUsage(event.usage, model)
			if (usageData) {
				yield usageData
			}
		}
	}

	abort(): void {
		this.closeResponsesWebsocket()
		this.abortController?.abort()
		this.accountUsageController?.abort()
	}

	getModel(): { id: OpenAiCodexModelId; info: ModelInfo } {
		const modelId = this.modelId

		const id = modelId && modelId in openAiCodexModels ? (modelId as OpenAiCodexModelId) : openAiCodexDefaultModelId

		const info: ModelInfo = openAiCodexModels[id]

		return { id, info }
	}
}
