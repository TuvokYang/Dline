import { PromptProfile } from "@core/prompts/profiles/types"

export const DEFAULT_PROMPT_CONTEXT_WINDOW = 128_000
export const LITE_PROMPT_CONTEXT_WINDOW_LIMIT = 64_000

export interface ResolvePromptProfileInput {
	readonly explicitProfile?: PromptProfile
	readonly contextWindow?: number
}

/** Resolve one final profile before entering the Prompt domain. */
export function resolvePromptProfile({ explicitProfile, contextWindow }: ResolvePromptProfileInput): PromptProfile {
	if (explicitProfile !== undefined) {
		if (explicitProfile !== PromptProfile.Native && explicitProfile !== PromptProfile.Lite) {
			throw new Error("Invalid explicit PromptProfile")
		}
		return explicitProfile
	}

	const effectiveContextWindow =
		typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
			? contextWindow
			: DEFAULT_PROMPT_CONTEXT_WINDOW

	return effectiveContextWindow < LITE_PROMPT_CONTEXT_WINDOW_LIMIT ? PromptProfile.Lite : PromptProfile.Native
}
