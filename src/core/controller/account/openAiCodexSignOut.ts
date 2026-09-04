import { Empty, type EmptyRequest } from "@shared/proto/dline/common"
import type { Controller } from ".."

/** Deprecated: callers must use the Profile-targeted signOutOpenAiCodexProfile RPC. */
export async function openAiCodexSignOut(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	throw new Error("OpenAI Codex sign-out requires the Profile-targeted RPC.")
}
