import { Empty, type EmptyRequest } from "@shared/proto/dline/common"
import type { Controller } from ".."

/** Deprecated: callers must use the Profile-targeted startOpenAiCodexSignIn RPC. */
export async function openAiCodexSignIn(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	throw new Error("OpenAI Codex sign-in requires the Profile-targeted RPC.")
}
