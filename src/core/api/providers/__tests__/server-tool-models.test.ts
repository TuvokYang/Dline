import { ServerTool } from "@shared/proto/dline/models/metadata"
import { describe, expect, it } from "vitest"
import { anthropicModels } from "../models/anthropic"
import { openAiModels } from "../models/openai"
import { openAiCodexModels } from "../models/openai-codex"

describe("built-in hosted Web Search metadata", () => {
	it.each([
		["OpenAI", openAiModels],
		["OpenAI Codex", openAiCodexModels],
		["Anthropic", anthropicModels],
	] as const)("declares WEB_SEARCH for every %s model", (_provider, models) => {
		for (const model of Object.values(models)) {
			expect(model.capabilities?.tools).toContain(ServerTool.WEB_SEARCH)
		}
	})
})
