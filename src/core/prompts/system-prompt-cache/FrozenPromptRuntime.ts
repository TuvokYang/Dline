import type { WebSearchRoutingPlan } from "@core/api/server-tools"
import type { SystemPromptContext } from "@core/prompts/system-prompt"
import type { FrozenPromptRuntime, FrozenSystemPromptCache } from "@core/storage/task-context-types"
import { createTaskCapabilityToggles, emptyTaskCapabilityToggles } from "@shared/TaskCapabilityToggles"

export interface ResolvedPromptRuntime
	extends Omit<FrozenPromptRuntime, "parallelToolsEnabled" | "webSearchMode" | "webSearchRoute" | "serverTools"> {
	readonly parallelToolsEnabled: boolean
	readonly webSearchRoutingPlan: WebSearchRoutingPlan
}

function resolveBrowserViewport(
	frozen: FrozenSystemPromptCache,
	context: SystemPromptContext,
): Readonly<{ width: number; height: number }> {
	if (frozen.runtime) return frozen.runtime.browserViewport
	const serialized = frozen.freshnessBaseline?.browserViewport
	const match = serialized?.match(/^(\d+)x(\d+)$/)
	if (match) return { width: Number(match[1]), height: Number(match[2]) }
	return {
		width: context.browserSettings?.viewport.width ?? 0,
		height: context.browserSettings?.viewport.height ?? 0,
	}
}

/** Resolve the execution contract that belongs to one frozen prompt/tool snapshot. */
export function resolveFrozenPromptRuntime(frozen: FrozenSystemPromptCache, context: SystemPromptContext): ResolvedPromptRuntime {
	const currentPlan = context.webSearchRoutingPlan
	if (!currentPlan) throw new Error("System prompt context is missing its Web Search routing plan")

	const runtime = frozen.runtime
	const builder = frozen.promptBuilder
	const webToolsEnabled = runtime?.webToolsEnabled ?? builder?.webToolsEnabled ?? context.clineWebToolsEnabled === true
	const route = webToolsEnabled ? (runtime?.webSearchRoute ?? builder?.webSearchRoute ?? currentPlan.route) : "disabled"
	const serverTools = route === "hosted" ? (runtime?.serverTools ?? builder?.serverTools ?? currentPlan.serverTools) : []
	const browserEnabled =
		runtime?.browserEnabled ??
		frozen.freshnessBaseline?.browserEnabled ??
		(context.supportsBrowserUse === true && context.browserSettings?.disableToolUse !== true)

	return {
		parallelToolsEnabled:
			runtime?.parallelToolsEnabled ??
			frozen.freshnessBaseline?.parallelToolsEnabled ??
			context.enableParallelToolCalling === true,
		webToolsEnabled,
		webSearchLocalFallbackAvailable:
			route === "hosted"
				? (runtime?.webSearchLocalFallbackAvailable ??
					builder?.webSearchLocalFallbackAvailable ??
					currentPlan.localFallbackAvailable)
				: false,
		webSearchRoutingPlan: Object.freeze({
			...currentPlan,
			mode: runtime?.webSearchMode ?? builder?.webSearchMode ?? currentPlan.mode,
			route,
			localToolEnabled: route === "local",
			localFallbackAvailable:
				route === "hosted"
					? (runtime?.webSearchLocalFallbackAvailable ??
						builder?.webSearchLocalFallbackAvailable ??
						currentPlan.localFallbackAvailable)
					: false,
			serverTools: Object.freeze([...serverTools]),
			...(route === "unavailable" && currentPlan.unavailableReason
				? { unavailableReason: currentPlan.unavailableReason }
				: { unavailableReason: undefined }),
		}),
		focusChainEnabled:
			runtime?.focusChainEnabled ?? builder?.focusChainEnabled ?? context.focusChainSettings?.enabled === true,
		subagentsEnabled:
			runtime?.subagentsEnabled ??
			builder?.subagentsEnabled ??
			(context.promptProfile === "standard" && context.subagentsEnabled === true),
		capabilityToggles: createTaskCapabilityToggles(
			runtime?.capabilityToggles ?? context.taskCapabilityToggles ?? emptyTaskCapabilityToggles(),
		),
		browserEnabled,
		browserViewport: browserEnabled ? resolveBrowserViewport(frozen, context) : { width: 0, height: 0 },
	}
}
