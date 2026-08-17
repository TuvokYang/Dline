import { useApiProfiles } from "@components/settings/providers/useApiProfiles"
import { updateTaskSettings } from "@components/settings/utils/settingsHandlers"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@components/ui/select"
import { useExtensionState } from "@context/ExtensionStateContext"
import { resolveProfileModelInfo } from "@shared/providers/profile-model-info"
import type { OpenAiServiceTier } from "@shared/storage/types"
import { resolveProfileServiceTier } from "@shared/task-provider-overrides"
import { resolveProfileReasoningConfig, resolveTaskThinkingConfig } from "@shared/task-reasoning"
import { useEffect, useMemo, useState } from "react"
import { TaskServiceTierControl } from "./TaskServiceTierControl"

const ACTIVE_REQUEST_PHASES = new Set(["initializing", "streaming", "resuming", "cancelling"])

function transitionPending(phase: string | undefined): boolean {
	return phase !== undefined && phase !== "idle" && phase !== "failed"
}

/** Task-local reasoning and OpenAI service-tier controls for the chat input toolbar. */
export function TaskRuntimeControls() {
	const { apiConfiguration, currentTaskItem, mode, modeSwitch, profileSwitch, taskViewState } = useExtensionState()
	const { profiles } = useApiProfiles()
	const [pending, setPending] = useState(false)
	const [error, setError] = useState<string>()

	const taskId = taskViewState?.taskId ?? currentTaskItem?.id
	const profileId = mode === "plan" ? apiConfiguration?.planModeProfileId : apiConfiguration?.actModeProfileId
	const profileName = mode === "plan" ? apiConfiguration?.planModeProfile : apiConfiguration?.actModeProfile
	const profile = useMemo(
		() =>
			(profileId ? profiles.find((candidate) => candidate.id === profileId) : undefined) ??
			(profileName ? profiles.find((candidate) => candidate.name === profileName) : undefined),
		[profileId, profileName, profiles],
	)
	const effectiveModelInfo = profile ? resolveProfileModelInfo(profile) : undefined
	const thinking = resolveTaskThinkingConfig(profile?.provider, effectiveModelInfo?.capabilities)
	const effortLevels = thinking?.effortLevels ?? []
	const maxBudget = thinking?.maxBudget
	const supportsEffort = effortLevels.length > 0
	const supportsBudget = Number.isSafeInteger(maxBudget) && (maxBudget ?? -1) >= 0
	const supportsServiceTier = profile?.provider === "openai" || profile?.provider === "openai-codex"

	const reasoningOverride =
		mode === "plan" ? apiConfiguration?.planModeReasoningOverride : apiConfiguration?.actModeReasoningOverride
	const serviceTierOverride =
		mode === "plan" ? apiConfiguration?.planModeServiceTierOverride : apiConfiguration?.actModeServiceTierOverride
	const profileReasoning = resolveProfileReasoningConfig(profile)
	const profileThinkingValue =
		(profileReasoning?.thinkingBudget ?? 0) > 0
			? "budget"
			: profileReasoning?.effort
				? `effort:${profileReasoning.effort}`
				: supportsEffort
					? `effort:${effortLevels.includes("medium") ? "medium" : effortLevels[0]}`
					: supportsBudget
						? "budget"
						: ""
	const configuredThinkingValue =
		reasoningOverride?.kind === "effort"
			? `effort:${reasoningOverride.effort ?? ""}`
			: reasoningOverride?.kind === "budget"
				? "budget"
				: profileThinkingValue
	const configuredBudget =
		reasoningOverride?.kind === "budget"
			? (reasoningOverride.budgetTokens ?? 0)
			: profileThinkingValue === "budget"
				? (profileReasoning?.thinkingBudget ?? 0)
				: 0
	const configuredServiceTier =
		serviceTierOverride?.kind === "tier" ? serviceTierOverride.tier : resolveProfileServiceTier(profile)
	const [thinkingValue, setThinkingValue] = useState(configuredThinkingValue)
	const [budgetValue, setBudgetValue] = useState(String(configuredBudget))

	useEffect(() => setThinkingValue(configuredThinkingValue), [configuredThinkingValue])
	useEffect(() => setBudgetValue(String(configuredBudget)), [configuredBudget])

	const phase = taskViewState?.phase ?? "idle"
	const requestActive = ACTIVE_REQUEST_PHASES.has(phase) || (phase === "executing" && taskViewState?.input?.enabled !== true)
	const unavailable =
		!taskId ||
		pending ||
		Boolean(taskViewState?.profileInvalid) ||
		Boolean(taskViewState?.contextCompaction) ||
		requestActive ||
		transitionPending(modeSwitch?.phase) ||
		transitionPending(profileSwitch?.phase)

	const commit = async (settings: Record<string, string | number>) => {
		if (!taskId || unavailable) return
		setPending(true)
		setError(undefined)
		try {
			await updateTaskSettings(taskId, settings)
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "Failed to update Task runtime settings.")
		} finally {
			setPending(false)
		}
	}

	const updateThinking = (value: string) => {
		setThinkingValue(value)
		if (value === "budget") return
		const effort = value.slice("effort:".length)
		void commit(
			mode === "plan"
				? { planModeReasoningOverrideKind: "effort", planModeReasoningOverrideEffort: effort }
				: { actModeReasoningOverrideKind: "effort", actModeReasoningOverrideEffort: effort },
		)
	}

	const commitBudget = () => {
		const budgetTokens = Number(budgetValue)
		if (!Number.isSafeInteger(budgetTokens) || budgetTokens < 0 || budgetTokens > (maxBudget ?? -1)) {
			setError(`Thinking budget must be an integer between 0 and ${maxBudget ?? 0}.`)
			return
		}
		void commit(
			mode === "plan"
				? { planModeReasoningOverrideKind: "budget", planModeThinkingBudgetTokens: budgetTokens }
				: { actModeReasoningOverrideKind: "budget", actModeThinkingBudgetTokens: budgetTokens },
		)
	}

	const updateServiceTier = (tier: OpenAiServiceTier) => {
		void commit(
			mode === "plan"
				? { planModeServiceTierOverrideKind: "tier", planModeServiceTierOverrideTier: tier }
				: { actModeServiceTierOverrideKind: "tier", actModeServiceTierOverrideTier: tier },
		)
	}

	if (unavailable || (!supportsEffort && !supportsBudget && !supportsServiceTier)) return null

	return (
		<>
			{(supportsEffort || supportsBudget) && (
				<div className="flex flex-none items-center overflow-visible" data-chat-input-slot="thinking">
					<Select onValueChange={updateThinking} value={thinkingValue}>
						<SelectTrigger
							aria-label="Task thinking override"
							className="!h-auto w-auto min-w-0 max-w-[8ch] justify-start gap-0 overflow-hidden rounded-none border-0 bg-transparent p-0 text-left text-xs shadow-none outline-none focus-visible:border-transparent focus-visible:ring-0"
							showIcon={false}
							size="sm">
							<SelectValue className="block min-w-0 truncate text-left" />
						</SelectTrigger>
						<SelectContent align="start" className="min-w-28" position="popper" side="top" sideOffset={4}>
							{supportsEffort &&
								effortLevels.map((effort) => (
									<SelectItem key={effort} value={`effort:${effort}`}>
										{effort.charAt(0).toUpperCase() + effort.slice(1)}
									</SelectItem>
								))}
							{supportsBudget && <SelectItem value="budget">Budget</SelectItem>}
						</SelectContent>
					</Select>
					{thinkingValue === "budget" && supportsBudget && (
						<input
							aria-label="Task thinking budget"
							className="w-20 rounded-sm border border-dropdown-border bg-input-background px-1 py-0.5 text-xs text-input-foreground"
							max={maxBudget}
							min={0}
							onBlur={commitBudget}
							onChange={(event) => setBudgetValue(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter") commitBudget()
							}}
							type="number"
							value={budgetValue}
						/>
					)}
				</div>
			)}
			{supportsServiceTier && <TaskServiceTierControl onSelect={updateServiceTier} value={configuredServiceTier} />}
			{error && (
				<span className="text-[10px] text-error" role="status" title={error}>
					{error}
				</span>
			)}
		</>
	)
}
