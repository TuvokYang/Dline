import type { SystemPromptContext } from "@core/prompts/system-prompt"
import type { TaskContextCache } from "@core/storage/task-context-types"
import { describe, expect, it } from "vitest"
import { SystemPromptCacheService } from "../SystemPromptCacheService"

const testPromptBuilderInfo = {
	providerId: "test-provider",
	modelId: "test-model",
	nativeTools: false,
}

const promptContext = {
	taskId: "task-1",
	cwd: "e:/workspace/project",
	ide: "vscode",
	providerInfo: {
		providerId: "test-provider",
		model: {
			id: "test-model",
			info: {},
		},
	},
	enableNativeToolCalls: false,
} as SystemPromptContext

/**
 * Create an empty task context fixture.
 *
 * @param taskId Task identifier for the fixture.
 * @returns Empty task context cache.
 */
function emptyContext(taskId: string): TaskContextCache {
	return {
		schemaVersion: 1,
		taskId,
		createdAt: 1,
		updatedAt: 1,
	}
}

describe("SystemPromptCacheService", () => {
	it("creates and persists a task_start frozen prompt with capabilities", async () => {
		let saved: TaskContextCache | undefined
		const service = new SystemPromptCacheService({
			taskId: "task-1",
			deps: {
				getContext: async () => emptyContext("task-1"),
				saveContext: async (_taskId, context) => {
					saved = context
				},
				collectCapabilities: async () => ({
					mcp: [{ name: "mcp.tool", description: "Tool" }],
					skills: [],
					workflows: [],
					subagents: [],
				}),
				buildSystemPrompt: async (context) => ({ systemPrompt: `base\n\n${context.capabilitiesSection}` }),
				getPromptBuilderInfo: () => testPromptBuilderInfo,
				now: () => 10,
			},
		})

		const result = await service.getOrCreate({ promptContext })

		expect(result.text).toContain("# Capabilities")
		expect(result.text).toContain("mcp.tool")
		expect(result.refreshReason).toBe("task_start")
		expect(saved?.systemPrompt?.frozen?.text).toBe(result.text)
	})

	it("keeps ordinary requests stable when capability sources change", async () => {
		const cached = {
			...emptyContext("task-1"),
			systemPrompt: {
				frozen: {
					text: "old prompt # Capabilities old",
					capabilitiesHash: "sha256:old",
					createdAt: 1,
					refreshedAt: 1,
					refreshReason: "task_start" as const,
					promptBuilder: {
						providerId: "test-provider",
						modelId: "test-model",
						nativeTools: false,
					},
				},
			},
		}
		let saveCount = 0
		const service = new SystemPromptCacheService({
			taskId: "task-1",
			deps: {
				getContext: async () => cached,
				saveContext: async () => {
					saveCount += 1
				},
				collectCapabilities: async () => ({
					mcp: [{ name: "new.tool", description: "New" }],
					skills: [],
					workflows: [],
					subagents: [],
				}),
				buildSystemPrompt: async (context) => ({ systemPrompt: `new ${context.capabilitiesSection}` }),
				getPromptBuilderInfo: () => testPromptBuilderInfo,
			},
		})

		const result = await service.getOrCreate({ promptContext })

		expect(result.text).toBe("old prompt # Capabilities old")
		expect(saveCount).toBe(0)
	})

	it("updates cache on manual refresh", async () => {
		let current = emptyContext("task-1")
		const service = new SystemPromptCacheService({
			taskId: "task-1",
			deps: {
				getContext: async () => current,
				saveContext: async (_taskId, context) => {
					current = context
				},
				collectCapabilities: async () => ({
					mcp: [],
					skills: [{ name: "manual", description: "Manual" }],
					workflows: [],
					subagents: [],
				}),
				buildSystemPrompt: async (context) => ({ systemPrompt: `prompt ${context.capabilitiesSection}` }),
				getPromptBuilderInfo: () => testPromptBuilderInfo,
				now: () => 20,
			},
		})

		const result = await service.refresh({ promptContext, reason: "manual" })

		expect(result.refreshReason).toBe("manual")
		expect(result.text).toContain("manual")
		expect(current.systemPrompt?.frozen?.refreshReason).toBe("manual")
	})

	it("updates cache on post compaction refresh", async () => {
		let current = emptyContext("task-1")
		const service = new SystemPromptCacheService({
			taskId: "task-1",
			deps: {
				getContext: async () => current,
				saveContext: async (_taskId, context) => {
					current = context
				},
				collectCapabilities: async () => ({
					mcp: [],
					skills: [],
					workflows: [],
					subagents: [{ name: "compact", description: "Compact" }],
				}),
				buildSystemPrompt: async (context) => ({ systemPrompt: `prompt ${context.capabilitiesSection}` }),
				getPromptBuilderInfo: () => testPromptBuilderInfo,
				now: () => 30,
			},
		})

		const result = await service.refresh({ promptContext, reason: "post_compaction" })

		expect(result.refreshReason).toBe("post_compaction")
		expect(result.text).toContain("compact")
		expect(current.systemPrompt?.frozen?.refreshReason).toBe("post_compaction")
	})
})
