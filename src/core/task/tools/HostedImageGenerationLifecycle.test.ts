import type { ImageArtifact } from "@core/artifacts/TaskArtifactStore"
import type { ApiStreamServerToolChunk } from "@core/api/transform/stream"
import { ServerTool } from "@shared/proto/dline/models/metadata"
import { describe, expect, it, vi } from "vitest"
import { HostedImageGenerationLifecycle } from "./HostedImageGenerationLifecycle"

const artifact: ImageArtifact = {
	schemaVersion: 1,
	id: `image:sha256:${"a".repeat(64)}`,
	kind: "image",
	sha256: "a".repeat(64),
	mimeType: "image/png",
	format: "png",
	byteLength: 68,
	width: 1,
	height: 1,
	relativePath: "artifacts/images/test.png",
	createdAtMs: 1,
	provenance: {
		providerId: "openai",
		modelId: "gpt-5.6-sol",
		requestId: "tid-image",
		revisedPrompt: "A blue owl",
		sourceKind: "base64",
	},
}

function chunk(phase: ApiStreamServerToolChunk["phase"], result?: unknown): ApiStreamServerToolChunk {
	return {
		type: "server_tool",
		function_id: "ig_1",
		dline_tid: "tid-image",
		tool: ServerTool.IMAGE_GENERATION,
		phase,
		...(result === undefined ? {} : { result }),
	}
}

describe("HostedImageGenerationLifecycle", () => {
	it("persists the final base64 and emits only Artifact metadata", async () => {
		const persistProviderOutput = vi.fn(async () => artifact)
		const updates: unknown[] = []
		const lifecycle = new HostedImageGenerationLifecycle({
			taskId: "task-1",
			context: { enabled: true, providerId: "openai", modelId: "gpt-5.6-sol" },
			artifactResolver: { persistProviderOutput },
			onUpdate: (update) => {
				updates.push(update)
			},
		})

		await lifecycle.consume(chunk("started"))
		await lifecycle.consume(chunk("completed", { b64Json: "secret-image-base64", revisedPrompt: "A blue owl" }))

		expect(persistProviderOutput).toHaveBeenCalledWith(
			expect.objectContaining({ source: { kind: "base64", data: "secret-image-base64", mimeType: "image/png" } }),
			{ providerId: "openai", modelId: "gpt-5.6-sol", requestId: "tid-image" },
		)
		const serialized = JSON.stringify(updates)
		expect(serialized).not.toContain("secret-image-base64")
		expect(updates.at(-1)).toMatchObject({
			partial: false,
			message: {
				tool: "generateImage",
				imageGeneration: {
					status: "completed",
					requestId: "tid-image",
					artifacts: [{ id: artifact.id, mimeType: "image/png", width: 1, height: 1 }],
				},
			},
		})
	})

	it("rejects image chunks when the hosted route is disabled", async () => {
		const lifecycle = new HostedImageGenerationLifecycle({
			taskId: "task-1",
			context: { enabled: false, providerId: "openai", modelId: "gpt-5.6-sol" },
			artifactResolver: { persistProviderOutput: vi.fn() },
			onUpdate: vi.fn(),
		})

		expect(await lifecycle.consume(chunk("completed", { b64Json: "ignored" }))).toBe(false)
	})
})
