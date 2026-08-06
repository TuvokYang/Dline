import { resolveWebSearchRoutingPlan } from "@core/api/server-tools"
import type { ApiStreamServerToolChunk } from "@core/api/transform/stream"
import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import { describe, expect, it } from "vitest"
import { ServerToolLifecycle } from "./ServerToolLifecycle"

const hostedPlan = resolveWebSearchRoutingPlan({
	enabled: true,
	modelInfo: { capabilities: { tools: [ServerTool.WEB_SEARCH] } },
	selectedApiFormat: ApiFormat.OPENAI_RESPONSES,
	localAvailable: true,
	remoteAdapterAvailable: true,
})

function chunk(
	phase: ApiStreamServerToolChunk["phase"],
	input: unknown = { query: "lifecycle query" },
): ApiStreamServerToolChunk {
	return {
		type: "server_tool",
		function_id: "provider-call-1",
		dline_tid: "trace-1",
		tool: ServerTool.WEB_SEARCH,
		phase,
		input,
	}
}

describe("ServerToolLifecycle", () => {
	it("admits only hosted Web Search and emits one terminal update", async () => {
		const updates: Array<{ status: string; partial: boolean }> = []
		const lifecycle = new ServerToolLifecycle(hostedPlan, true, (update) => {
			updates.push({ status: update.status, partial: update.partial })
		})

		await lifecycle.consume(chunk("started"))
		await lifecycle.consume(chunk("searching"))
		await lifecycle.consume(chunk("completed"))
		await lifecycle.consume(chunk("completed"))
		await lifecycle.consume(chunk("searching"))

		expect(updates).toEqual([
			{ status: "started", partial: true },
			{ status: "started", partial: true },
			{ status: "completed", partial: false },
		])
	})

	it("preserves the provider-compressed hosted result on the terminal update", async () => {
		const result = [
			{
				type: "web_search_result",
				title: "Dline",
				url: "https://example.com/dline",
			},
		]
		const updates: Array<{ status: string; result?: unknown }> = []
		const lifecycle = new ServerToolLifecycle(hostedPlan, true, (update) => {
			updates.push({ status: update.status, result: update.result })
		})

		await lifecycle.consume(chunk("started"))
		await lifecycle.consume({ ...chunk("completed"), result })

		expect(updates).toEqual([
			{ status: "started", result: undefined },
			{ status: "completed", result },
		])
	})

	it("closes an open call on stream termination and ignores later provider events", async () => {
		const updates: Array<{ status: string; error?: string }> = []
		const lifecycle = new ServerToolLifecycle(hostedPlan, true, (update) => {
			updates.push({ status: update.status, error: update.error })
		})

		await lifecycle.consume(chunk("started"))
		await lifecycle.finalizeOpen("stream ended before hosted result")
		await lifecycle.finalizeOpen("second finalization")
		await lifecycle.consume(chunk("completed"))

		expect(updates).toEqual([{ status: "started" }, { status: "failed", error: "stream ended before hosted result" }])
	})

	it("ignores hosted chunks when the frozen route is local or disabled", async () => {
		const updates: unknown[] = []
		const local = resolveWebSearchRoutingPlan({
			enabled: true,
			modelInfo: undefined,
			selectedApiFormat: ApiFormat.OPENAI_CHAT,
			localAvailable: true,
			remoteAdapterAvailable: false,
		})
		const lifecycle = new ServerToolLifecycle(local, true, (update) => {
			updates.push(update)
		})

		expect(await lifecycle.consume(chunk("started"))).toBe(false)
		expect(updates).toEqual([])
	})
})
