import type { CollectCapabilitiesInput } from "@core/prompts/capabilities/CapabilitiesAggregator"
import { collectCapabilities } from "@core/prompts/capabilities/CapabilitiesAggregator"
import { renderCapabilitiesSection } from "@core/prompts/capabilities/CapabilitiesSection"
import type { CapabilitiesSnapshot } from "@core/prompts/capabilities/types"
import { PromptProfile } from "@core/prompts/profiles/types"
import type { SystemPromptContext } from "@core/prompts/system-prompt"
import { getSystemPrompt } from "@core/prompts/system-prompt"
import { getTaskContext, saveTaskContext } from "@core/storage/disk"
import type {
	FrozenPromptBuilderInfo,
	FrozenSystemPromptCache,
	SystemPromptRefreshReason,
	TaskContextCache,
} from "@core/storage/task-context-types"
import type { ClineTool } from "@shared/tools"
import { hashPromptContent } from "./hash"

export const SYSTEM_PROMPT_CONTRACT_VERSION = 1

export interface BuiltSystemPrompt {
	readonly systemPrompt: string
	readonly tools?: readonly ClineTool[]
}

export interface SystemPromptCacheDeps {
	readonly getContext?: (taskId: string) => Promise<TaskContextCache>
	readonly saveContext?: (taskId: string, context: TaskContextCache) => Promise<void>
	readonly collectCapabilities?: (input: CollectCapabilitiesInput) => Promise<Awaited<ReturnType<typeof collectCapabilities>>>
	readonly buildSystemPrompt?: (context: SystemPromptContext) => Promise<BuiltSystemPrompt>
	readonly getPromptBuilderInfo?: (
		context: SystemPromptContext,
		tools: readonly ClineTool[] | undefined,
	) => FrozenPromptBuilderInfo
	readonly now?: () => number
}

export interface GetOrCreatePromptInput {
	readonly promptContext: SystemPromptContext
}

export interface RefreshSystemPromptInput extends GetOrCreatePromptInput {
	readonly reason: SystemPromptRefreshReason
}

function renderCapabilitiesForProfile(capabilities: CapabilitiesSnapshot, profile: PromptProfile): string {
	return renderCapabilitiesSection(capabilities, {
		exclude: profile === PromptProfile.Lite ? ["skills"] : [],
	})
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
		tools: readonly ClineTool[] | undefined,
	) => FrozenPromptBuilderInfo
	private readonly now: () => number
	private lastTools?: readonly ClineTool[]
	private pendingGetOrCreate?: Promise<FrozenSystemPromptCache>

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
	public getLastTools(): readonly ClineTool[] | undefined {
		return this.lastTools
	}

	/**
	 * Return an existing frozen prompt or create one for task start.
	 *
	 * @param input Prompt context input.
	 * @returns Frozen system prompt cache entry.
	 */
	public getOrCreate(input: GetOrCreatePromptInput): Promise<FrozenSystemPromptCache> {
		if (this.pendingGetOrCreate) return this.pendingGetOrCreate

		const pending = this.loadOrCreate(input)
		this.pendingGetOrCreate = pending
		const clearPending = () => {
			if (this.pendingGetOrCreate === pending) this.pendingGetOrCreate = undefined
		}
		pending.then(clearPending, clearPending)
		return pending
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
		const capabilitiesSection = renderCapabilitiesForProfile(capabilities, input.promptContext.promptProfile)
		const capabilitiesHash = hashPromptContent(capabilitiesSection)
		const promptContext: SystemPromptContext = {
			...input.promptContext,
			capabilities,
			capabilitiesSection,
		}
		const built = await this.buildSystemPrompt(promptContext)
		const now = this.now()
		const frozen: FrozenSystemPromptCache = {
			text: built.systemPrompt,
			tools: built.tools ?? null,
			capabilitiesHash,
			createdAt: context.systemPrompt?.frozen?.createdAt ?? now,
			refreshedAt: now,
			refreshReason: input.reason,
			promptBuilder: {
				...this.getPromptBuilderInfo(promptContext, built.tools),
				contractVersion: SYSTEM_PROMPT_CONTRACT_VERSION,
			},
		}
		await this.saveContext(this.taskId, {
			...context,
			updatedAt: now,
			systemPrompt: {
				...context.systemPrompt,
				frozen,
			},
		})
		this.lastTools = built.tools
		return frozen
	}

	/** Load a valid frozen pair or rebuild and persist one complete replacement. */
	private async loadOrCreate(input: GetOrCreatePromptInput): Promise<FrozenSystemPromptCache> {
		const context = await this.getContext(this.taskId)
		const cached = context.systemPrompt?.frozen
		if (cached) {
			const currentBuilder = {
				...this.getPromptBuilderInfo(input.promptContext, undefined),
				contractVersion: SYSTEM_PROMPT_CONTRACT_VERSION,
			}
			const cachedBuilder = cached.promptBuilder
			const providerProjectionChanged =
				cachedBuilder.contractVersion !== currentBuilder.contractVersion ||
				cachedBuilder.providerId !== currentBuilder.providerId ||
				cachedBuilder.modelId !== currentBuilder.modelId ||
				cachedBuilder.profile !== currentBuilder.profile ||
				cachedBuilder.nativeTools !== Boolean(input.promptContext.enableNativeToolCalls) ||
				cachedBuilder.focusChainEnabled !== currentBuilder.focusChainEnabled
			if (providerProjectionChanged) {
				return this.refresh({ promptContext: input.promptContext, reason: "capability_change" })
			}
			this.lastTools = cached.tools ?? undefined
			return cached
		}
		return this.refresh({ promptContext: input.promptContext, reason: "task_start" })
	}

	/**
	 * Build a prompt through the explicit-profile system prompt facade.
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
	 * @param tools Native tools produced by the explicit-profile facade.
	 * @returns Prompt builder metadata persisted in task context cache.
	 */
	private buildPromptInfo(context: SystemPromptContext, tools: readonly ClineTool[] | undefined): FrozenPromptBuilderInfo {
		return {
			contractVersion: SYSTEM_PROMPT_CONTRACT_VERSION,
			providerId: context.providerInfo.providerId,
			modelId: context.providerInfo.model.id,
			profile: context.promptProfile,
			nativeTools: (tools?.length ?? 0) > 0,
			focusChainEnabled: context.focusChainSettings?.enabled === true,
		}
	}
}
