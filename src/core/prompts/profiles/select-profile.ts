import type { PromptProfileInput } from "./types"
import { PromptProfile } from "./types"

/**
 * Selects the prompt profile from the explicit custom prompt value.
 *
 * @param input Explicit prompt selection input.
 * @returns Lite only for an exact lite value; otherwise Native.
 */
export function selectPromptProfile(input: PromptProfileInput): PromptProfile {
	return input.customPrompt === PromptProfile.Lite ? PromptProfile.Lite : PromptProfile.Native
}
