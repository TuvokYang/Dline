import type OpenAI from "openai"
import { hashPromptContentHex } from "@/core/prompts/system-prompt-cache/hash"

const EXPLICIT_BREAKPOINT = { mode: "explicit" as const }

type PromptCacheApiFormat = "chat" | "responses"

interface PromptCacheIdentityInput {
	readonly apiFormat: PromptCacheApiFormat
	readonly modelId: string
	readonly systemPrompt: string
	readonly tools: readonly unknown[]
}

export interface OpenAIChatPromptCacheInput {
	readonly modelId: string
	readonly systemPrompt: string
	readonly messages: OpenAI.Chat.ChatCompletionMessageParam[]
	readonly tools: readonly OpenAI.Chat.ChatCompletionTool[]
}

export interface OpenAIChatPromptCacheProjection {
	readonly messages: OpenAI.Chat.ChatCompletionMessageParam[]
	readonly promptCacheKey: string
	readonly promptCacheOptions?: OpenAI.Chat.ChatCompletionCreateParams.PromptCacheOptions
}

export interface OpenAIResponsesPromptCacheInput {
	readonly modelId: string
	readonly systemPrompt: string
	readonly input: OpenAI.Responses.ResponseInput
	readonly tools: readonly OpenAI.Responses.Tool[]
}

export interface OpenAIResponsesPromptCacheProjection {
	readonly instructions?: string
	readonly input: OpenAI.Responses.ResponseInput
	readonly promptCacheKey: string
	readonly promptCacheOptions?: OpenAI.Responses.ResponseCreateParams.PromptCacheOptions
}

interface MutableContentMessage {
	readonly role?: unknown
	content?: unknown
	readonly [key: string]: unknown
}

interface MutableContentBlock {
	readonly type?: unknown
	readonly [key: string]: unknown
}

/** Return whether the model accepts explicit prompt-cache controls introduced with GPT-5.6. */
export function supportsExplicitOpenAIPromptCache(modelId: string): boolean {
	const match = /^gpt-(\d+)(?:\.(\d+))?/i.exec(modelId)
	if (!match) return false

	const major = Number(match[1])
	const minor = Number(match[2] ?? 0)
	return major > 5 || (major === 5 && minor >= 6)
}

/**
 * Suppression switch for the official-only explicit prompt-cache controls
 * (prompt_cache_breakpoint / prompt_cache_options).
 *
 * The official endpoint rejects these parameters for models like
 * gpt-5.6-sol ("prompt_cache_breakpoint is not supported on this model")
 * even though the documentation claims GPT-5.6+ support; the documented
 * version-based rule is unreliable. The explicit projection code below is
 * kept intact; this toggle only short-circuits the projection. The generic
 * `prompt_cache_key` is still projected.
 *
 * Currently ENABLED (true): explicit controls are suppressed.
 * Set to `false` (and unset DLINE_DISABLE_OPENAI_PROMPT_BREAKPOINT) to
 * restore the explicit projection once the model/endpoint supports it.
 */
const EXPLICIT_PROMPT_CACHE_SUPPRESSED = true

/**
 * Return whether the explicit prompt-cache projection is currently
 * suppressed. Environment override `DLINE_DISABLE_OPENAI_PROMPT_BREAKPOINT=1`
 * forces suppression regardless of the constant.
 */
function isExplicitPromptCacheSuppressed(): boolean {
	return (
		EXPLICIT_PROMPT_CACHE_SUPPRESSED ||
		process.env.DLINE_DISABLE_OPENAI_PROMPT_BREAKPOINT === "1" ||
		process.env.DLINE_DISABLE_OPENAI_PROMPT_BREAKPOINT === "true"
	)
}

/** Build a non-sensitive routing key from the stable rendered-prefix inputs. */
function createPromptCacheKey(input: PromptCacheIdentityInput): string {
	return hashPromptContentHex(
		JSON.stringify({
			apiFormat: input.apiFormat,
			model: input.modelId,
			systemPrompt: input.systemPrompt,
			tools: input.tools,
		}),
	)
}

function addBreakpointToChatMessage(
	message: OpenAI.Chat.ChatCompletionMessageParam,
): OpenAI.Chat.ChatCompletionMessageParam | undefined {
	const projected = { ...message } as unknown as MutableContentMessage
	if (typeof projected.content === "string") {
		projected.content = [
			{
				type: "text",
				text: projected.content,
				prompt_cache_breakpoint: EXPLICIT_BREAKPOINT,
			},
		]
		return projected as unknown as OpenAI.Chat.ChatCompletionMessageParam
	}
	if (!Array.isArray(projected.content)) return undefined

	const content = [...projected.content]
	for (let index = content.length - 1; index >= 0; index--) {
		const block = content[index]
		if (typeof block !== "object" || block === null) continue
		const typedBlock = block as MutableContentBlock
		if (typedBlock.type !== "text") continue

		content[index] = { ...typedBlock, prompt_cache_breakpoint: EXPLICIT_BREAKPOINT }
		projected.content = content
		return projected as unknown as OpenAI.Chat.ChatCompletionMessageParam
	}
	return undefined
}

function addChatBreakpoints(messages: OpenAI.Chat.ChatCompletionMessageParam[]): OpenAI.Chat.ChatCompletionMessageParam[] {
	const projected = [...messages]

	// The explicit breakpoint marks the end of the reusable stable prefix.
	// It must live on the system/developer message only: placing it on dynamic
	// tail messages (user input, environment details, tool history) would pull
	// changing content into the cached prefix and drop every cache hit.
	const first = projected[0]
	if (first?.role === "system" || first?.role === "developer") {
		const marked = addBreakpointToChatMessage(first)
		if (marked) {
			projected[0] = marked
		}
	}

	return projected
}

/** Project official prompt-cache controls onto a Chat Completions request. */
export function projectOpenAIChatPromptCache(input: OpenAIChatPromptCacheInput): OpenAIChatPromptCacheProjection {
	const promptCacheKey = createPromptCacheKey({
		apiFormat: "chat",
		modelId: input.modelId,
		systemPrompt: input.systemPrompt,
		tools: input.tools,
	})
	if (!supportsExplicitOpenAIPromptCache(input.modelId) || isExplicitPromptCacheSuppressed()) {
		return { messages: input.messages, promptCacheKey }
	}

	return {
		messages: addChatBreakpoints(input.messages),
		promptCacheKey,
		promptCacheOptions: { mode: "explicit" },
	}
}

/** Project official prompt-cache controls onto a Responses request. */
export function projectOpenAIResponsesPromptCache(input: OpenAIResponsesPromptCacheInput): OpenAIResponsesPromptCacheProjection {
	const promptCacheKey = createPromptCacheKey({
		apiFormat: "responses",
		modelId: input.modelId,
		systemPrompt: input.systemPrompt,
		tools: input.tools,
	})
	if (!supportsExplicitOpenAIPromptCache(input.modelId) || isExplicitPromptCacheSuppressed()) {
		return {
			instructions: input.systemPrompt,
			input: input.input,
			promptCacheKey,
		}
	}

	const systemMessage: OpenAI.Responses.EasyInputMessage = {
		type: "message",
		role: "system",
		content: [
			{
				type: "input_text",
				text: input.systemPrompt,
				prompt_cache_breakpoint: EXPLICIT_BREAKPOINT,
			},
		],
	}
	return {
		input: [systemMessage, ...input.input],
		promptCacheKey,
		promptCacheOptions: { mode: "explicit" },
	}
}
