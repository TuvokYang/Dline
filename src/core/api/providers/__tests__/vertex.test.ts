import "should"
import type { ApiHandlerContext } from "@core/api"
import { VertexHandler } from "../vertex"

describe("VertexHandler", () => {
	it("disables Anthropic SDK internal retries so outer retries remain separate sends", () => {
		const handler = new VertexHandler({
			profile: {
				provider: "vertex",
				modelId: "claude-sonnet-4-5@20250929",
				vertex: {
					vertexProjectId: "test-project",
					vertexRegion: "us-east5",
				},
			},
			mode: "act",
		} as unknown as ApiHandlerContext)
		const options = (
			handler as unknown as {
				createAnthropicClientOptions(headers: Record<string, string>): { maxRetries: number }
			}
		).createAnthropicClientOptions({})

		options.maxRetries.should.equal(0)
	})
})
