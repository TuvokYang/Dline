import type { CollectCapabilitiesInput } from "@core/prompts/capabilities/CapabilitiesAggregator"
import { collectCapabilities } from "@core/prompts/capabilities/CapabilitiesAggregator"
import { renderCapabilitiesSection } from "@core/prompts/capabilities/CapabilitiesSection"
import type { SystemPromptContext } from "@core/prompts/system-prompt"
import { getSystemPrompt, PromptRegistry } from "@core/prompts/system-prompt"
import { getTaskContext, saveTaskContext } from "@core/storage/disk"
import type {
	FrozenPromptBuilderInfo,
	FrozenSystemPromptCache,
	SystemPromptRefreshReason,
	TaskContextCache,
} from "@core/storage/task-context-types"
import type { ClineTool } from "@shared/tools"
import { hashPromptContent } from "./hash"

export interface BuiltSystemPrompt {
	readonly systemPrompt: string
	readonly tools?: ClineTool[]
}

export interface SystemPromptCacheDeps {
	readonly getContext?: (taskId: string) => Promise<TaskContextCache>
	readonly saveContext?: (taskId: string, context: TaskContextCache) => Promise<void>
	readonly collectCapabilities?: (input: CollectCapabilitiesInput) => Promise<Awaited<ReturnType<typeof collectCapabilities>>>
	readonly buildSystemPrompt?: (context: SystemPromptContext) => Promise<BuiltSystemPrompt>
	readonly getPromptBuilderInfo?: (context: SystemPromptContext, tools: ClineTool[] | undefined) => FrozenPromptBuilderInfo
	readonly now?: () => number
}

export interface GetOrCreatePromptInput {
	readonly promptContext: SystemPromptContext
}

export interface RefreshSystemPromptInput extends GetOrCreatePromptInput {
	readonly reason: SystemPromptRefreshReason
}

/**
 * Manage task-level frozen system prompt cache stored in task context.json.
 */
export class SystemPromptCacheService {
	private readonly taskId: string
	private readonly getContext: (taskId: string) => Promise<TaskContextCache>
	private readonly saveContext: (taskId: string, context: TaskContextCache) => Promise<void>
	private readonly collectCapabilitiesFn: (
		input: CollectCapabilitiesInput,
	) => Promise<Awaited<ReturnType<typeof collectCapabilities>>>
	private readonly buildSystemPrompt: (context: SystemPromptContext) => Promise<BuiltSystemPrompt>
	private readonly getPromptBuilderInfo: (
		context: SystemPromptContext,
		tools: ClineTool[] | undefined,
	) => FrozenPromptBuilderInfo
	private readonly now: () => number
	private lastTools?: ClineTool[]

	/**
	 * Create a system prompt cache service for one task.
	 *
	 * @param params Service construction parameters.
	 */
	public constructor(params: { readonly taskId: string; readonly deps?: SystemPromptCacheDeps }) {
		this.taskId = params.taskId
		this.getContext = params.deps?.getContext ?? getTaskContext
		this.saveContext = params.deps?.saveContext ?? saveTaskContext
		this.collectCapabilitiesFn = params.deps?.collectCapabilities ?? collectCapabilities
		this.buildSystemPrompt = params.deps?.buildSystemPrompt ?? this.defaultBuildSystemPrompt
		this.getPromptBuilderInfo = params.deps?.getPromptBuilderInfo ?? this.buildPromptInfo
		this.now = params.deps?.now ?? Date.now
	}

	/**
	 * Return native tools from the last prompt build in this service instance.
	 *
	 * @returns Native tools produced by the last prompt build, if any.
	 */
	public getLastTools(): ClineTool[] | undefined {
		return this.lastTools
	}

	/**
	 * Return an existing frozen prompt or create one for task start.
	 *
	 * @param input Prompt context input.
	 * @returns Frozen system prompt cache entry.
	 */
	public async getOrCreate(input: GetOrCreatePromptInput): Promise<FrozenSystemPromptCache> {
		const context = await this.getContext(this.taskId)
		const cached = context.systemPrompt?.frozen
		if (cached) {
			await this.restoreTools(input.promptContext, cached)
			return cached
		}
		return this.refresh({ promptContext: input.promptContext, reason: "task_start" })
	}

	/**
	 * Refresh the frozen system prompt for an explicit refresh reason.
	 *
	 * @param input Prompt refresh input.
	 * @returns Refreshed frozen system prompt cache entry.
	 */
	public async refresh(input: RefreshSystemPromptInput): Promise<FrozenSystemPromptCache> {
		const context = await this.getContext(this.taskId)
		const capabilities = await this.collectCapabilitiesFn({
			cwd: input.promptContext.cwd ?? process.cwd(),
			mcpHub: input.promptContext.mcpHub,
			...input.promptContext.capabilityToggleState,
		})
		const capabilitiesSection = renderCapabilitiesSection(capabilities)
		const capabilitiesHash = hashPromptContent(capabilitiesSection)
		const promptContext: SystemPromptContext = {
			...input.promptContext,
			capabilitiesSection,
		}
		const built = await this.buildSystemPrompt(promptContext)
		this.lastTools = built.tools
		const now = this.now()
		const frozen: FrozenSystemPromptCache = {
			text: built.systemPrompt,
			capabilitiesHash,
			createdAt: context.systemPrompt?.frozen?.createdAt ?? now,
			refreshedAt: now,
			refreshReason: input.reason,
			promptBuilder: this.getPromptBuilderInfo(promptContext, built.tools),
		}
		await this.saveContext(this.taskId, {
			...context,
			updatedAt: now,
			systemPrompt: {
				...context.systemPrompt,
				frozen,
			},
		})
		return frozen
	}

	/**
	 * Rebuild native tool schemas when a cached prompt is reused.
	 *
	 * @param context Current prompt context used for tool gating.
	 * @param cached Frozen prompt cache entry loaded from task context.
	 */
	private async restoreTools(context: SystemPromptContext, cached: FrozenSystemPromptCache): Promise<void> {
		if (!cached.promptBuilder.nativeTools) {
			this.lastTools = undefined
			return
		}
		if (this.lastTools !== undefined) {
			return
		}
		const built = await this.buildSystemPrompt(context)
		this.lastTools = built.tools
	}

	/**
	 * Build a prompt through the existing system prompt registry.
	 *
	 * @param context System prompt context.
	 * @returns Built prompt text and native tools.
	 */
	private async defaultBuildSystemPrompt(context: SystemPromptContext): Promise<BuiltSystemPrompt> {
		return getSystemPrompt(context)
	}

	/**
	 * Record stable prompt builder metadata for diagnostics.
	 *
	 * @param context System prompt context used for building.
	 * @param tools Native tools produced by the prompt registry.
	 * @returns Prompt builder metadata persisted in task context cache.
	 */
	private buildPromptInfo(context: SystemPromptContext, tools: ClineTool[] | undefined): FrozenPromptBuilderInfo {
		const registry = PromptRegistry.getInstance()
		const variant = registry.getVariant(context)
		return {
			providerId: context.providerInfo.providerId,
			modelId: context.providerInfo.model.id,
			variantFamily: variant.family,
			nativeTools: (tools?.length ?? 0) > 0,
		}
	}
}
