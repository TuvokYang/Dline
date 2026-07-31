import { ApiFormat, ServerTool } from "@shared/proto/dline/models/metadata"
import { describe, expect, it } from "vitest"
import { deepSeekModels } from "../models/deepseek"

describe("DeepSeek model metadata", () => {
	it("declares protocol availability and remote tools without filtering the model catalog", () => {
		expect(Object.keys(deepSeekModels)).toEqual(["deepseek-v4-pro", "deepseek-v4-flash"])
		expect(deepSeekModels["deepseek-v4-flash"].apiFormats).toEqual([
			ApiFormat.OPENAI_CHAT,
			ApiFormat.OPENAI_RESPONSES,
			ApiFormat.ANTHROPIC_CHAT,
		])
		expect(deepSeekModels["deepseek-v4-pro"].apiFormats).toEqual([
			ApiFormat.OPENAI_CHAT,
			ApiFormat.OPENAI_RESPONSES,
			ApiFormat.ANTHROPIC_CHAT,
		])
		expect(deepSeekModels["deepseek-v4-flash"].capabilities?.tools).toEqual([ServerTool.WEB_SEARCH])
	})
})
