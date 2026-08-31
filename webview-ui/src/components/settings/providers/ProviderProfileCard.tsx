import type { ThinkingConfig } from "@shared/proto/dline/models/metadata"
import { AnthropicProviderConfig } from "@shared/proto/dline/provider/anthropic"
import type { ReasoningConfig } from "@shared/proto/dline/provider/common"
import { PROFILE_PROVIDER_KEYS } from "@shared/providers/profile-model-info"
import type { Mode } from "@shared/storage/types"
import { resolveProfileReasoningConfig, resolveTaskThinkingConfig } from "@shared/task-reasoning"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import { ProfileField, ProfileForm, ProfileSection } from "../profile-ui"
import { ProfileCapabilityIcons } from "./ProfileCapabilityIcons"
import { ProfileUsageBadges } from "./ProfileUsageBadges"
import type { ApiProfile } from "./ProviderProfile"
import ApiProfileEditor from "./ProviderProfileEditor"
import { getCachedProviderDefaultModelId, useProviderModels } from "./useProviderModels"
import { WebSearchModeControl } from "./WebSearchModeControl"

function formatThinkingSummary(reasoning: ReasoningConfig | undefined, thinking: ThinkingConfig | undefined) {
	if (reasoning?.enableThinking === false || reasoning?.effort === "none") return "Thinking: Off"

	const budget = reasoning?.thinkingBudget ?? 0
	if (budget > 0) return `Thinking: ${budget.toLocaleString()} tokens`

	const effort = reasoning?.effort?.trim()
	if (effort) return `Thinking: ${effort.replace(/^./, (character) => character.toUpperCase())}`
	if (thinking?.supported !== true) return reasoning?.enableThinking === true ? "Thinking: On" : undefined

	const effortLevels = thinking.effortLevels ?? []
	if (thinking.mode === "budget" || (effortLevels.length === 0 && thinking.maxBudget !== undefined)) {
		return "Thinking: Budget"
	}
	const defaultEffort = effortLevels.includes("medium") ? "medium" : effortLevels[0]
	return defaultEffort ? `Thinking: ${defaultEffort.replace(/^./, (character) => character.toUpperCase())}` : "Thinking: On"
}

interface ApiProfileCardProps {
	profile: ApiProfile
	isExpanded: boolean
	editMode: boolean
	currentMode: Mode
	providerOptions: { value: string; label: string }[]
	onToggleExpand: () => void
	onDelete: () => void
	onUpdate: (updates: Partial<ApiProfile>) => void
	selected?: boolean
	onToggleSelect?: () => void
	dragHandle?: ReactNode
}

/**
 * Collapsible card. Collapsed shows summary, expanded delegates to ApiProfileEditor.
 */
const ApiProfileCard: React.FC<ApiProfileCardProps> = ({
	profile,
	isExpanded,
	editMode,
	providerOptions,
	onToggleExpand,
	onUpdate,
	selected,
	onToggleSelect,
	dragHandle,
}) => {
	const hasProvider = !!profile.provider
	const providerLabel = hasProvider ? profile.provider : "Select provider..."
	const modelLabel = profile.modelId || (hasProvider ? "Select model..." : "")
	const profileName =
		profile.name || (hasProvider && profile.modelId ? `${profile.provider}:${profile.modelId}` : "Unnamed profile")
	const { models } = useProviderModels(profile.provider || "")

	// Build detailed tooltip from modelInfo
	const info = profile.modelInfo || models[profile.modelId]
	const reasoning = resolveProfileReasoningConfig(profile)
	const thinking = resolveTaskThinkingConfig(profile.provider, info?.capabilities, reasoning, info?.id || profile.modelId)
	const thinkingSummary = formatThinkingSummary(reasoning, thinking)
	const subtitle = [providerLabel, modelLabel, thinkingSummary].filter(Boolean).join(" · ")
	const displayLine = [profileName, subtitle].filter(Boolean).join(" · ")
	const tooltipLines: string[] = [displayLine]
	if (info) {
		const mi = info
		if (mi.capabilities?.contextWindow)
			tooltipLines.push(`Context: ${mi.capabilities?.contextWindow.toLocaleString()} tokens`)
		if (mi.pricing?.inputPrice != null)
			tooltipLines.push(`In: $${mi.pricing?.inputPrice}/M | Out: $${mi.pricing?.outputPrice ?? "?"}/M`)
		if (mi.capabilities?.supportsReasoning)
			tooltipLines.push(`Reasoning: ${mi.capabilities?.thinking?.effortLevels?.join(", ") || "supported"}`)
		if (mi.capabilities?.supportsImages) tooltipLines.push("Images: supported")
		if (mi.capabilities?.supportsPromptCache) tooltipLines.push("Prompt cache: supported")
		if (mi.description) tooltipLines.push(mi.description)
	}
	const cardTooltip = tooltipLines.join("\n")

	return (
		<div className="mb-1.5 border-b border-editor-widget-border/35" data-testid="api-profile-card">
			<div
				className="flex min-w-0 items-start gap-1 px-1 py-1 hover:bg-(--vscode-list-hoverBackground)"
				title={cardTooltip}>
				{editMode ? (
					<input
						aria-label={`Select ${profileName}`}
						checked={selected ?? false}
						className="size-4 shrink-0 cursor-pointer"
						onChange={() => onToggleSelect?.()}
						type="checkbox"
					/>
				) : null}
				{dragHandle}
				<button
					aria-label={isExpanded ? `Collapse ${profileName}` : `Expand ${profileName}`}
					className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-xs border-0 bg-transparent text-description hover:bg-toolbar-hover hover:text-foreground"
					onClick={onToggleExpand}
					type="button">
					{isExpanded ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
				</button>
				<div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 py-0.5">
					{editMode || isExpanded ? (
						<input
							aria-label="Profile name"
							className="col-span-2 min-h-7 min-w-0 w-full max-w-80 justify-self-start bg-transparent px-1 text-sm font-medium text-foreground outline-none focus:bg-input-background focus:ring-1 focus:ring-border xs:col-span-1 xs:col-start-1 xs:row-start-1"
							defaultValue={profile.name}
							key={`${profile.id}:${profile.name}`}
							onBlur={(event) => {
								if (event.target.value !== profile.name) onUpdate({ name: event.target.value })
							}}
							placeholder={profileName}
						/>
					) : (
						<span className="col-span-2 truncate text-sm font-medium leading-5 text-foreground xs:col-span-1 xs:col-start-1 xs:row-start-1">
							{profileName}
						</span>
					)}
					<span className="col-start-1 row-start-2 min-w-0 truncate text-xs leading-5 text-description xs:col-span-2">
						{subtitle}
					</span>
					<div
						className="col-start-2 row-start-2 ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1 xs:row-start-1"
						data-testid="profile-summary-tail">
						<ProfileUsageBadges usedFor={profile.usedFor} />
						<ProfileCapabilityIcons capabilities={info?.capabilities} />
					</div>
				</div>
			</div>

			{/* Expanded: delegate to ApiProfileEditor */}
			{isExpanded && (
				<ProfileForm className="border-t border-editor-widget-border/30 px-3 pb-3 pt-3">
					<ProfileField htmlFor={`profile-provider-${profile.id}`} label="Provider">
						<select
							aria-label="Provider"
							className="min-h-7 w-full rounded-xs border border-input-border bg-input-background px-2 text-sm"
							id={`profile-provider-${profile.id}`}
							onChange={(e) => {
								const updates = {
									provider: e.target.value,
									apiKey: "",
									baseUrl: undefined,
									modelId: getCachedProviderDefaultModelId(e.target.value),
									modelInfo: undefined,
									name: "",
								} as Partial<ApiProfile> & Record<string, unknown>
								for (const key of Object.values(PROFILE_PROVIDER_KEYS)) {
									if (key) updates[key] = undefined
								}
								if (e.target.value === "anthropic") {
									updates.anthropic = AnthropicProviderConfig.create({ enableLongContext: true })
								}
								onUpdate(updates)
							}}
							value={profile.provider}>
							<option value="">Select provider...</option>
							{providerOptions.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
					</ProfileField>

					{hasProvider && profile.provider !== "openai" && profile.provider !== "deepseek" && (
						<WebSearchModeControl
							onChange={(webSearchMode) => onUpdate({ webSearchMode })}
							value={profile.webSearchMode}
						/>
					)}

					<ProfileSection aria-label="Profile usage">
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
							{(["act", "plan", "subagents"] as const).map((mode) => (
								<label className="flex cursor-pointer items-center gap-1 text-sm" key={mode}>
									<input
										checked={profile.usedFor.includes(mode)}
										className="w-3 h-3"
										onChange={() => {
											const next = profile.usedFor.includes(mode)
												? profile.usedFor.filter((m) => m !== mode)
												: [...profile.usedFor, mode]
											onUpdate({ usedFor: next })
										}}
										type="checkbox"
									/>
									<span>{mode === "act" ? "Act" : mode === "plan" ? "Plan" : "Subagents"}</span>
								</label>
							))}
						</div>
					</ProfileSection>

					{hasProvider ? (
						<ProfileSection className="gap-3 [&>div]:flex [&>div]:min-w-0 [&>div]:flex-col [&>div]:!gap-3">
							<ApiProfileEditor isPopup={false} onUpdateProfile={onUpdate} profile={profile} />
						</ProfileSection>
					) : null}
				</ProfileForm>
			)}
		</div>
	)
}

export default ApiProfileCard
