import { PromptProfile } from "@core/prompts/profiles/types"

export const DEFAULT_PROMPT_CONTEXT_WINDOW = 128_000
export const LITE_PROMPT_CONTEXT_WINDOW_LIMIT = 64_000

export interface ResolvePromptProfileInput {
	readonly explicitProfile?: PromptProfile
	readonly contextWindow?: number
	readonly modelId?: string
}

/** Reports whether a provider-qualified model id identifies the o1 family. */
export function isO1Model(modelId: string | undefined): boolean {
	return modelId?.split("/").some((segment) => /^o1(?:-|$)/i.test(segment)) ?? false
}

/** Resolve one final profile before entering the Prompt domain. */
export function resolvePromptProfile({ explicitProfile, contextWindow, modelId }: ResolvePromptProfileInput): PromptProfile {
	if (explicitProfile !== undefined) {
		if (explicitProfile !== PromptProfile.Native && explicitProfile !== PromptProfile.Lite) {
			throw new Error("Invalid explicit PromptProfile")
		}
		return explicitProfile
	}

	if (isO1Model(modelId)) {
		return PromptProfile.Lite
	}

	const effectiveContextWindow =
		typeof contextWindow === "number" && Number.isFinite(contextWindow) && contextWindow > 0
			? contextWindow
			: DEFAULT_PROMPT_CONTEXT_WINDOW

	return effectiveContextWindow < LITE_PROMPT_CONTEXT_WINDOW_LIMIT ? PromptProfile.Lite : PromptProfile.Native
}
