import type { ApiHandler } from "@core/api"
import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import { createRequestApiScope, withRequestToolIds } from "../RequestApiScope"

function createHandler(providerId: string, modelId: string): ApiHandler {
	return {
		createMessage: vi.fn() as ApiHandler["createMessage"],
		getModel: () => ({ id: modelId, info: { id: modelId } }),
		getProviderId: () => providerId,
		abort: vi.fn(),
		getApiStreamUsage: vi.fn(),
		parseError: vi.fn(),
	}
}

describe("createRequestApiScope", () => {
	it.each([
		["openai", "openai-model", "anthropic", "claude-model"],
		["openai", "openai-model-a", "openai", "openai-model-b"],
		["anthropic", "claude-model-a", "anthropic", "claude-model-b"],
	] as const)("keeps an in-flight %s request bound to its handler when the next profile is %s", (currentProvider, currentModel, nextProvider, nextModel) => {
		let activeHandler = createHandler(currentProvider, currentModel)
		const requestScope = createRequestApiScope(activeHandler, "act")

		activeHandler = createHandler(nextProvider, nextModel)
		const nextRequestScope = createRequestApiScope(activeHandler, "act")

		expect(requestScope.api.getProviderId?.()).toBe(currentProvider)
		expect(requestScope.providerInfo).toMatchObject({
			providerId: currentProvider,
			model: { id: currentModel },
			mode: "act",
		})
		expect(requestScope.api.createMessage).not.toBe(activeHandler.createMessage)
		expect(requestScope.api.parseError).not.toBe(activeHandler.parseError)
		expect(requestScope.api.abort).not.toBe(activeHandler.abort)
		expect(requestScope.api.getApiStreamUsage).not.toBe(activeHandler.getApiStreamUsage)
		expect(activeHandler.getProviderId?.()).toBe(nextProvider)
		expect(activeHandler.getModel().id).toBe(nextModel)
		expect(nextRequestScope.api).toBe(activeHandler)
		expect(nextRequestScope.providerInfo).toMatchObject({
			providerId: nextProvider,
			model: { id: nextModel },
			mode: "act",
		})
	})

	it("rejects handlers that cannot identify their provider", () => {
		const handler = createHandler("openai", "openai-model")
		delete handler.getProviderId

		expect(() => createRequestApiScope(handler, "act")).toThrow("API handler is missing its provider identity")
	})

	it("accepts the automatic compaction tool only on the selected request", () => {
		const handler = createHandler("openai", "openai-model")
		const baseScope = createRequestApiScope(handler, "act")
		const compactScope = withRequestToolIds(baseScope, [ClineDefaultTool.SUMMARIZE_TASK])

		expect(baseScope.requestToolIds).toEqual([])
		expect(compactScope.requestToolIds).toEqual([ClineDefaultTool.SUMMARIZE_TASK])
	})
})
