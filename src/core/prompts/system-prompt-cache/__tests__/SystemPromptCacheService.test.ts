import type { SystemPromptContext } from "@core/prompts/system-prompt"
import type { TaskContextCache } from "@core/storage/task-context-types"
import type { ClineTool } from "@shared/tools"
import { describe, expect, it } from "vitest"
import { SystemPromptCacheService } from "../SystemPromptCacheService"

const testPromptBuilderInfo = {
	providerId: "test-provider",
	modelId: "test-model",
	profile: "native" as const,
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
		expect(result.tools).toBeNull()
		expect(saved?.systemPrompt?.frozen?.text).toBe(result.text)
		expect(saved?.systemPrompt?.frozen?.tools).toBeNull()
	})

	it("restores exact persisted native tools when reusing a frozen prompt", async () => {
		const tools: readonly ClineTool[] = [{ type: "function", function: { name: "read_file" } }]
		const cached = {
			...emptyContext("task-1"),
			systemPrompt: {
				frozen: {
					text: "old prompt # Capabilities old",
					tools,
					capabilitiesHash: "sha256:old",
					createdAt: 1,
					refreshedAt: 1,
					refreshReason: "task_start" as const,
					promptBuilder: {
						providerId: "test-provider",
						modelId: "test-model",
						profile: "native" as const,
						nativeTools: true,
					},
				},
			},
		}
		const service = new SystemPromptCacheService({
			taskId: "task-1",
			deps: {
				getContext: async () => cached,
				saveContext: async () => undefined,
				buildSystemPrompt: async () => {
					throw new Error("frozen tools must not be rebuilt")
				},
			},
		})

		const result = await service.getOrCreate({ promptContext })

		expect(result.text).toBe("old prompt # Capabilities old")
		expect(service.getLastTools()).toEqual(tools)
	})

	it("restores the exact frozen native tools without rebuilding from a changed current context", async () => {
		const frozenTools: readonly ClineTool[] = [{ type: "function", function: { name: "frozen_browser_tool" } }]
		const cached = {
			...emptyContext("task-1"),
			systemPrompt: {
				frozen: {
					text: "frozen native prompt",
					tools: frozenTools,
					capabilitiesHash: "sha256:frozen",
					createdAt: 1,
					refreshedAt: 1,
					refreshReason: "task_start" as const,
					promptBuilder: {
						providerId: "test-provider",
						modelId: "test-model",
						profile: "native" as const,
						nativeTools: true,
					},
				},
			},
		}
		let buildCount = 0
		const service = new SystemPromptCacheService({
			taskId: "task-1",
			deps: {
				getContext: async () => cached,
				saveContext: async () => undefined,
				buildSystemPrompt: async () => {
					buildCount += 1
					return { systemPrompt: "current xml prompt" }
				},
			},
		})
		const currentContext: SystemPromptContext = {
			...promptContext,
			providerInfo: { ...promptContext.providerInfo, customPrompt: "lite" },
			enableNativeToolCalls: false,
			disableTools: [],
			supportsBrowserUse: false,
		}

		const result = await service.getOrCreate({ promptContext: currentContext })

		expect(result.text).toBe("frozen native prompt")
		expect(service.getLastTools()).toEqual(frozenTools)
		expect(buildCount).toBe(0)
	})

	it("persists the exact tools produced by the same frozen prompt build", async () => {
		let saved: TaskContextCache | undefined
		const builtTools: readonly ClineTool[] = [{ type: "function", function: { name: "frozen_exact_tool" } }]
		const service = new SystemPromptCacheService({
			taskId: "task-1",
			deps: {
				getContext: async () => emptyContext("task-1"),
				saveContext: async (_taskId, context) => {
					saved = context
				},
				collectCapabilities: async () => ({ mcp: [], skills: [], workflows: [], subagents: [] }),
				buildSystemPrompt: async () => ({ systemPrompt: "frozen exact prompt", tools: builtTools }),
				getPromptBuilderInfo: () => ({ ...testPromptBuilderInfo, nativeTools: true }),
				now: () => 15,
			},
		})

		const result = await service.refresh({ promptContext, reason: "manual" })

		expect(result.tools).toEqual(builtTools)
		expect(saved?.systemPrompt?.frozen?.tools).toEqual(builtTools)
	})

	it("rejects a legacy native cache that lacks exact frozen tools", async () => {
		const cached = {
			...emptyContext("task-1"),
			systemPrompt: {
				frozen: {
					text: "legacy native prompt",
					capabilitiesHash: "sha256:old",
					createdAt: 1,
					refreshedAt: 1,
					refreshReason: "task_start" as const,
					promptBuilder: {
						providerId: "test-provider",
						modelId: "test-model",
						profile: "native" as const,
						nativeTools: true,
					},
				},
			},
		}
		const service = new SystemPromptCacheService({
			taskId: "task-1",
			deps: {
				getContext: async () => cached,
				saveContext: async () => undefined,
				buildSystemPrompt: async () => ({
					systemPrompt: "unsafe rebuilt prompt",
					tools: [{ type: "function", function: { name: "unsafe_current_tool" } }],
				}),
			},
		})

		await expect(service.getOrCreate({ promptContext })).rejects.toThrow("exact frozen tools")
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
						profile: "native" as const,
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

	it.each([
		["lite", "lite"],
		["compact", "native"],
	])("projects %s custom prompt to %s cache profile metadata", async (customPrompt, expectedProfile) => {
		const service = new SystemPromptCacheService({
			taskId: "task-1",
			deps: {
				getContext: async () => emptyContext("task-1"),
				saveContext: async () => undefined,
				collectCapabilities: async () => ({
					mcp: [],
					skills: [],
					workflows: [],
					subagents: [],
				}),
				buildSystemPrompt: async () => ({ systemPrompt: "profile prompt" }),
				now: () => 25,
			},
		})
		const context: SystemPromptContext = {
			...promptContext,
			providerInfo: { ...promptContext.providerInfo, customPrompt },
		}

		const result = await service.refresh({ promptContext: context, reason: "manual" })

		expect(result.promptBuilder.profile).toBe(expectedProfile)
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
