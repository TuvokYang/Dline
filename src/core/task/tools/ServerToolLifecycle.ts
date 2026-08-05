import type { WebSearchRoutingPlan } from "@core/api/server-tools"
import type { ApiStreamServerToolChunk } from "@core/api/transform/stream"
import { ServerTool } from "@shared/proto/dline/models/metadata"

export type HostedServerToolUpdateStatus = "started" | "completed" | "failed"

export interface HostedServerToolUpdate {
	readonly dlineTid: string
	readonly functionId: string
	readonly tool: ServerTool
	readonly status: HostedServerToolUpdateStatus
	readonly partial: boolean
	readonly query: string
	readonly error?: string
}

interface HostedServerToolState {
	readonly functionId: string
	phase: ApiStreamServerToolChunk["phase"]
	query: string
	terminal: boolean
}

const PHASE_RANK: Readonly<Record<ApiStreamServerToolChunk["phase"], number>> = {
	started: 0,
	in_progress: 1,
	searching: 1,
	completed: 2,
	failed: 2,
}

function textFromUnknown(value: unknown): string | undefined {
	if (typeof value === "string" && value.trim().length > 0) return value.trim()
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined

	const record = value as Record<string, unknown>
	for (const key of ["query", "q", "search_query"]) {
		const text = textFromUnknown(record[key])
		if (text) return text
	}
	return textFromUnknown(record.action)
}

function errorFromUnknown(value: unknown, fallback: string): string {
	return textFromUnknown(value) ?? fallback
}

/**
 * Owns one provider-hosted server-tool lifecycle for one API response.
 * It admits only the frozen hosted route and emits at most one terminal update.
 */
export class ServerToolLifecycle {
	private readonly calls = new Map<string, HostedServerToolState>()

	constructor(
		private readonly routingPlan: WebSearchRoutingPlan | undefined,
		private readonly enabled: boolean,
		private readonly onUpdate: (update: HostedServerToolUpdate) => Promise<void> | void,
	) {}

	private accepts(chunk: ApiStreamServerToolChunk): boolean {
		return (
			this.enabled &&
			this.routingPlan?.route === "hosted" &&
			this.routingPlan.serverTools.includes(chunk.tool) &&
			chunk.tool === ServerTool.WEB_SEARCH &&
			typeof chunk.dline_tid === "string" &&
			chunk.dline_tid.length > 0 &&
			typeof chunk.function_id === "string" &&
			chunk.function_id.length > 0
		)
	}

	private async emit(update: HostedServerToolUpdate): Promise<void> {
		try {
			await this.onUpdate(update)
		} catch {
			// UI teardown/abort must not turn a provider stream into a second failure.
		}
	}

	/** Consume one normalized provider event. Returns false when it is not admitted. */
	async consume(chunk: ApiStreamServerToolChunk): Promise<boolean> {
		if (!this.accepts(chunk)) return false

		const existing = this.calls.get(chunk.dline_tid)
		if (existing?.functionId !== undefined && existing.functionId !== chunk.function_id) return false
		if (existing?.terminal) return true

		const query = textFromUnknown(chunk.input) ?? existing?.query ?? "Provider-hosted web search"
		const currentRank = existing ? PHASE_RANK[existing.phase] : -1
		if (existing && PHASE_RANK[chunk.phase] < currentRank) return true
		if (existing && PHASE_RANK[chunk.phase] === currentRank && chunk.phase !== "completed" && chunk.phase !== "failed") {
			if (query !== existing.query) existing.query = query
			return true
		}

		const state: HostedServerToolState = existing ?? {
			functionId: chunk.function_id,
			phase: chunk.phase,
			query,
			terminal: false,
		}
		state.phase = chunk.phase
		state.query = query
		state.terminal = chunk.phase === "completed" || chunk.phase === "failed"
		this.calls.set(chunk.dline_tid, state)

		const status: HostedServerToolUpdateStatus =
			chunk.phase === "failed" ? "failed" : state.terminal ? "completed" : "started"
		await this.emit({
			dlineTid: chunk.dline_tid,
			functionId: chunk.function_id,
			tool: chunk.tool,
			status,
			partial: !state.terminal,
			query,
			...(status === "failed" ? { error: errorFromUnknown(chunk.error, "Provider-hosted web search failed") } : {}),
		})
		return true
	}

	/** Close every started call when a response ends, is cancelled, or is retried. */
	async finalizeOpen(reason: string): Promise<void> {
		for (const [dlineTid, state] of this.calls) {
			if (state.terminal) continue
			state.phase = "failed"
			state.terminal = true
			await this.emit({
				dlineTid,
				functionId: state.functionId,
				tool: ServerTool.WEB_SEARCH,
				status: "failed",
				partial: false,
				query: state.query,
				error: reason,
			})
		}
	}

	reset(): void {
		this.calls.clear()
	}
}
