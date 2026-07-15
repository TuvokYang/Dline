/** Supported prompt architecture profiles. */
export enum PromptProfile {
	Native = "native",
	Lite = "lite",
}

/** Explicit inputs accepted by prompt profile selection. */
export interface PromptProfileInput {
	readonly customPrompt?: string
}
