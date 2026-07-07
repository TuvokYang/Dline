import { ClineDefaultTool } from "@shared/tools"
import { describe, expect, it, vi } from "vitest"
import { ToolValidator } from "../../ToolValidator"
import type { TaskConfig } from "../../types/TaskConfig"
import type { StronglyTypedUIHelpers } from "../../types/UIHelpers"
import { ApplyPatchHandler } from "../ApplyPatchHandler"

vi.mock("@utils/path", async () => {
	const actual = await vi.importActual<typeof import("@utils/path")>("@utils/path")
	return {
		...actual,
		getReadablePath: (_cwd: string, relPath?: string) => relPath ?? "",
		isLocatedInWorkspace: vi.fn().mockResolvedValue(true),
	}
})

vi.mock("@/services/telemetry", () => ({
	telemetryService: {
		captureToolUsage: vi.fn(),
	},
}))

vi.mock("../../utils/AiOutputTelemetry", () => ({
	captureAccepted: vi.fn(),
	captureRejected: vi.fn(),
	getModelInfo: vi.fn().mockReturnValue({ providerId: "test-provider", modelId: "test-model" }),
}))

/**
 * Create a minimal task config for apply_patch partial rendering tests.
 *
 * @returns Task config and callback spies used by the handler.
 */
function createConfig(): { config: TaskConfig; ask: ReturnType<typeof vi.fn> } {
	const ask = vi.fn().mockRejectedValue(new Error("partial ask ignored"))
	const config = {
		cwd: "/workspace",
		services: {
			diffViewProvider: {
				editType: undefined,
				originalContent: "",
			},
		},
		callbacks: {
			ask,
		},
	} as unknown as TaskConfig

	return { config, ask }
}

/**
 * Create typed UI helpers backed by the minimal task config.
 *
 * @param config Task config returned by createConfig.
 * @returns UI helpers used by ApplyPatchHandler.handlePartialBlock.
 */
function createHelpers(config: TaskConfig): StronglyTypedUIHelpers {
	return {
		say: vi.fn(),
		ask: config.callbacks.ask,
		removeClosingTag: vi.fn(),
		shouldAutoApproveTool: vi.fn(),
		shouldAutoApproveToolWithPath: vi.fn(),
		askApproval: vi.fn(),
		captureTelemetry: vi.fn(),
		showNotificationIfEnabled: vi.fn(),
		getConfig: () => config,
	} as unknown as StronglyTypedUIHelpers
}

/**
 * Create a validator that allows all file paths.
 *
 * @returns ToolValidator instance for handler construction.
 */
function createValidator(): ToolValidator {
	return new ToolValidator({ validateAccess: vi.fn().mockReturnValue(true) } as never)
}

describe("ApplyPatchHandler partial rendering", () => {
	it("uses block ts for partial preview ask updates", async () => {
		const { config, ask } = createConfig()
		const handler = new ApplyPatchHandler(createValidator())
		const blockTs = 123456

		await handler.handlePartialBlock(
			{
				type: "tool_use",
				name: ClineDefaultTool.APPLY_PATCH,
				partial: true,
				ts: blockTs,
				params: {
					input: "*** Begin Patch\n*** Add File: src/new-file.ts\n+export const value = 1\n*** End Patch",
				},
			} as never,
			createHelpers(config),
		)

		expect(ask).toHaveBeenCalledWith("tool", expect.any(String), true, { existingTs: blockTs })
	})
})
