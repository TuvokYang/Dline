import { ModelInfo } from "@shared/proto/dline/models"
import { ApiFormat, ModelCapabilities, ServerTool } from "@shared/proto/dline/models/metadata"
import { describe, expect, it } from "vitest"

describe("optional repeated model metadata", () => {
	it("preserves absence through constructors, JSON conversion, and binary decode", () => {
		expect(ModelInfo.create().apiFormats).toBeUndefined()
		expect(ModelInfo.fromJSON({}).apiFormats).toBeUndefined()
		expect(ModelInfo.fromPartial({}).apiFormats).toBeUndefined()
		expect(ModelInfo.decode(ModelInfo.encode(ModelInfo.create()).finish()).apiFormats).toBeUndefined()

		expect(ModelCapabilities.create().tools).toBeUndefined()
		expect(ModelCapabilities.fromJSON({}).tools).toBeUndefined()
		expect(ModelCapabilities.fromPartial({}).tools).toBeUndefined()
		expect(ModelCapabilities.decode(ModelCapabilities.encode(ModelCapabilities.create()).finish()).tools).toBeUndefined()
	})

	it("round-trips explicitly configured protocols and server tools", () => {
		const modelInfo = ModelInfo.create({
			id: "deepseek-v4-flash",
			apiFormats: [ApiFormat.OPENAI_CHAT, ApiFormat.OPENAI_RESPONSES],
			capabilities: { tools: [ServerTool.WEB_SEARCH] },
		})
		const decoded = ModelInfo.decode(ModelInfo.encode(modelInfo).finish())

		expect(decoded.apiFormats).toEqual([ApiFormat.OPENAI_CHAT, ApiFormat.OPENAI_RESPONSES])
		expect(decoded.capabilities?.tools).toEqual([ServerTool.WEB_SEARCH])
	})
})
