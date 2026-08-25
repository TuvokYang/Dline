import { AnthropicProviderConfig } from "@shared/proto/dline/provider/anthropic"
import { PROFILE_PROVIDER_KEYS } from "@shared/providers/profile-model-info"
import type { Mode } from "@shared/storage/types"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import type { ApiProfile } from "./ProviderProfile"
import ApiProfileEditor from "./ProviderProfileEditor"
import { getCachedProviderDefaultModelId, useProviderModels } from "./useProviderModels"
import { WebSearchModeControl } from "./WebSearchModeControl"

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
}

/**
 * Thinking badge derived from modelInfo.
 */
function ThinkingBadge({ profile }: { profile: ApiProfile }) {
	const info = profile.modelInfo
	if (!info?.capabilities?.supportsReasoning) return null
	const level = info.capabilities?.thinking?.effortLevels
	if (level && "high" in level) {
		return (
			<span
				className="text-xs px-1 rounded"
				style={{ background: "var(--vscode-badge-background)", color: "var(--vscode-badge-foreground)" }}
				title={`Reasoning Effort: ${level}`}>
				🧠{level}
			</span>
		)
	}
	return (
		<span
			className="text-xs px-1 rounded"
			style={{ background: "var(--vscode-badge-background)", color: "var(--vscode-badge-foreground)", opacity: 0.6 }}
			title="Reasoning supported">
			🧠
		</span>
	)
}

/** Usage badges */
function UsageBadges({ usedFor }: { usedFor: ApiProfile["usedFor"] }) {
	const labels: Record<string, string> = { act: "Act", plan: "Plan", subagents: "Sub" }
	return (
		<>
			{usedFor.map((m) => (
				<span
					className="text-xs px-1 rounded"
					key={m}
					style={{ background: "var(--vscode-badge-background)", color: "var(--vscode-badge-foreground)" }}
					title={`Used for ${m} mode`}>
					{labels[m]}
				</span>
			))}
		</>
	)
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
}) => {
	const hasProvider = !!profile.provider
	const providerLabel = hasProvider ? `${profile.provider}` : "Select provider..."
	const modelLabel = profile.modelId || (hasProvider ? "Select model..." : "")
	const displayLine = [profile.name || providerLabel, modelLabel].filter(Boolean).join(" · ")

	const { models } = useProviderModels(profile.provider || "")

	// Build detailed tooltip from modelInfo
	const info = profile.modelInfo || models[profile.modelId]
	const tooltipLines: string[] = [displayLine]
	if (info) {
		const mi = info
		if (mi.capabilities?.contextWindow)
			tooltipLines.push(`Context: ${mi.capabilities?.contextWindow.toLocaleString()} tokens`)
		if (mi.pricing?.inputPrice != null)
			tooltipLines.push(`In: $${mi.pricing?.inputPrice}/M | Out: $${mi.pricing?.outputPrice ?? "?"}/M`)
		if (mi.capabilities?.supportsReasoning)
			tooltipLines.push(`🧠 Reasoning: ${mi.capabilities?.thinking?.effortLevels?.join(", ") || "supported"}`)
		if (mi.capabilities?.supportsImages) tooltipLines.push("🖼�?Images: supported")
		if (mi.capabilities?.supportsPromptCache) tooltipLines.push("📦 Cache: supported")
		if (mi.description) tooltipLines.push(mi.description)
	}
	const cardTooltip = tooltipLines.join("\n")

	return (
		<div
			className="mb-2 rounded border border-editor-widget-border/40 bg-(--vscode-editor-background)"
			data-testid="api-profile-card">
			{/* Collapsed header */}
			<div
				className="flex cursor-pointer items-center px-3 py-2 hover:bg-(--vscode-list-hoverBackground)"
				onClick={onToggleExpand}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault()
						onToggleExpand()
					}
				}}
				role="button"
				tabIndex={0}
				title={cardTooltip}>
				<span className="mr-2 shrink-0">
					{isExpanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
				</span>
				<div className="flex-1 flex items-center gap-1.5 min-w-0 max-w-[60%]">
					<input
						className="text-sm font-medium bg-transparent border-0 outline-none truncate"
						defaultValue={profile.name}
						key={`${profile.id}:${profile.name}`}
						onBlur={(e) => {
							if (e.target.value !== profile.name) onUpdate({ name: e.target.value })
						}}
						onClick={(e) => e.stopPropagation()}
						placeholder={profile.provider && profile.modelId ? `${profile.provider}:${profile.modelId}` : "Name"}
						size={Math.max(
							(
								profile.name ||
								(profile.provider && profile.modelId ? `${profile.provider}:${profile.modelId}` : "Name")
							).length,
							8,
						)}
						style={{ color: "var(--vscode-foreground)" }}
					/>
					{hasProvider && <ThinkingBadge profile={profile} />}
					{!editMode && hasProvider && <UsageBadges usedFor={profile.usedFor} />}
					{editMode && (
						<div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
							{(["act", "plan", "subagents"] as const).map((mode) => (
								<label
									className="flex items-center gap-0.5 text-[10px] cursor-pointer"
									key={mode}
									style={{ color: "var(--vscode-descriptionForeground)" }}>
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
									{mode === "act" ? "Act" : mode === "plan" ? "Plan" : "Sub"}
								</label>
							))}
						</div>
					)}
				</div>
				{editMode && (
					<input
						checked={selected ?? false}
						className="w-4 h-4 ml-auto shrink-0 cursor-pointer"
						onChange={(e) => {
							e.stopPropagation()
							onToggleSelect?.()
						}}
						type="checkbox"
					/>
				)}
			</div>

			{/* Expanded: delegate to ApiProfileEditor */}
			{isExpanded && (
				<div className="border-t border-editor-widget-border/30 px-3 pb-3 pt-1">
					{/* Provider selector */}
					<div className="mb-2">
						<label className="text-xs font-medium text-description block mb-0.5">Provider</label>
						<select
							aria-label="Provider"
							className="w-full text-xs p-1 rounded bg-input-background border border-input-border"
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
					</div>

					{hasProvider && profile.provider !== "openai" && profile.provider !== "deepseek" && (
						<WebSearchModeControl
							onChange={(webSearchMode) => onUpdate({ webSearchMode })}
							value={profile.webSearchMode}
						/>
					)}

					{/* usedFor checkboxes */}
					<div className="flex items-center gap-3 mb-2">
						{(["act", "plan", "subagents"] as const).map((mode) => (
							<label className="flex items-center gap-1 text-xs cursor-pointer" key={mode}>
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

					{/* Delegated provider editor */}
					{hasProvider && <ApiProfileEditor isPopup={false} onUpdateProfile={onUpdate} profile={profile} />}
				</div>
			)}
		</div>
	)
}

export default ApiProfileCard
