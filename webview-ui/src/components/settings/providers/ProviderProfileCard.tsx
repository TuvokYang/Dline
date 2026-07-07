import { EmptyRequest } from "@shared/proto/dline/common"
import type { AvailableModelsResponse, ModelInfo } from "@shared/proto/dline/models"
import type { Mode } from "@shared/storage/types"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { ModelsServiceClient } from "@/services/grpc-client"
import type { ApiProfile } from "./ProviderProfile"
import ApiProfileEditor from "./ProviderProfileEditor"

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

	// Load modelInfo from RPC if missing but provider+modelId are set.
	// We store the result in local state only (loadedModelInfo) to avoid
	// triggering onUpdate → persist → loadProfiles → re-render cycles.
	// The tooltip display uses loadedModelInfo as fallback; the profile's
	// actual modelInfo is only persisted when the user explicitly selects a model.
	const [loadedModelInfo, setLoadedModelInfo] = useState<ModelInfo | null>(profile.modelInfo || null)

	useEffect(() => {
		if (profile.modelInfo || !profile.provider || !profile.modelId) return
		let cancelled = false
		ModelsServiceClient.getAvailableModels({} as EmptyRequest)
			.then((response: AvailableModelsResponse) => {
				if (cancelled) return
				for (const group of response.providers || []) {
					if (group.provider === profile.provider) {
						const found = group.models.find((m) => m.id === profile.modelId)
						if (found) {
							setLoadedModelInfo(found)
						}
						break
					}
				}
			})
			.catch(() => {})
		return () => {
			cancelled = true
		}
		// CRITICAL: Do NOT include onUpdate in deps — it changes on every
		// useApiProfiles re-render and would cause infinite loops.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [profile.provider, profile.modelId, profile.modelInfo])

	// Build detailed tooltip from modelInfo
	const info = loadedModelInfo || profile.modelInfo
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
		<div className="mb-2 rounded border border-input-border bg-text-block-background">
			{/* Collapsed header */}
			<div
				className="flex items-center px-3 py-2 cursor-pointer hover:bg-input-background/50"
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
						onChange={(e) => onUpdate({ name: e.target.value })}
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
						value={profile.name}
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
				<div className="px-3 pb-3 pt-1 border-t border-input-border">
					{/* Provider selector */}
					<div className="mb-2">
						<label className="text-xs font-medium text-description block mb-0.5">Provider</label>
						<select
							className="w-full text-xs p-1 rounded bg-input-background border border-input-border"
							onChange={(e) => onUpdate({ provider: e.target.value, modelId: "", modelInfo: undefined, name: "" })}
							value={profile.provider}>
							<option value="">Select provider...</option>
							{providerOptions.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
					</div>

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
					{hasProvider && <ApiProfileEditor isPopup={false} profile={profile} />}
				</div>
			)}
		</div>
	)
}

export default ApiProfileCard
