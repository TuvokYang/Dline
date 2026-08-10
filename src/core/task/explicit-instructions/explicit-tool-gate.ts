import { ClineDefaultTool } from "@shared/tools"
import { isExplicitOnlyTool } from "./policy"
import type { ExplicitInstructionAuthorization, ExplicitInstructionConsumePort, ExplicitInstructionFailureCode } from "./types"

export type ExplicitToolGateResult =
	| { readonly ok: true; readonly authorization?: ExplicitInstructionAuthorization }
	| { readonly ok: false; readonly code: ExplicitInstructionFailureCode }

/** Consume one request-scoped authorization before an explicit-only handler can execute. */
export function authorizeExplicitToolExecution(
	tool: ClineDefaultTool,
	port: ExplicitInstructionConsumePort | undefined,
): ExplicitToolGateResult {
	if (tool === ClineDefaultTool.CONDENSE) return { ok: false, code: "explicit_instruction_retired" }
	if (!isExplicitOnlyTool(tool)) return { ok: true }
	if (!port) return { ok: false, code: "explicit_instruction_missing" }
	return port.consumeTool(tool)
}
