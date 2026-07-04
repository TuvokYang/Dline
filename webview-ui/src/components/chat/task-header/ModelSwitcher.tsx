import { CheckIcon, SettingsIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { useApiProfiles } from "@/components/settings/providers/useApiProfiles"
import { updateSetting } from "@/components/settings/utils/settingsHandlers"
import { Switch } from "@/components/ui/switch"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface ModelSwitcherProps {
	onOpenSettings: () => void
}

/** Tab labels and their mode mapping */
type ModeTab = "act" | "plan"

/**
 * Bottom-bar model display. Click opens popover with profile list +
 * check circle radio selection. Supports Act/Plan tabs when
 * planActSeparateModelsSetting is enabled.
 */
const ModelSwitcher: React.FC<ModelSwitcherProps> = ({ onOpenSettings }) => {
	const { apiConfiguration, mode, planActSeparateModelsSetting, currentTaskItem } = useExtensionState()
	const { profiles, selectProfile } = useApiProfiles()
	const [open, setOpen] = useState(false)
	const [activeTab, setActiveTab] = useState<ModeTab>(mode || "act")
	const [hoveredId, setHoveredId] = useState<string | null>(null)

	// Get current task ID for task-level profile settings
	const taskId = currentTaskItem?.id

	// Resolve currently selected profile name per mode
	const planProfileName = apiConfiguration?.planModeProfile
	const actProfileName = apiConfiguration?.actModeProfile

	// Current mode's display info
	const currentProfileName = mode === "plan" ? planProfileName : actProfileName
	const currentProfile = currentProfileName ? profiles.find((p) => p.name === currentProfileName) : undefined
	const displayLine = currentProfile ? currentProfile.name || `${currentProfile.provider}:${currentProfile.modelId}` : "-:-"

	// Build detailed tooltip from modelInfo
	const tooltipLines: string[] = [displayLine]
	const info = currentProfile?.modelInfo
	if (info) {
		if (info.capabilities?.contextWindow)
			tooltipLines.push(`Context: ${info.capabilities.contextWindow.toLocaleString()} tokens`)
		if (info.pricing?.inputPrice != null)
			tooltipLines.push(`In: $${info.pricing.inputPrice}/M | Out: $${info.pricing.outputPrice ?? "?"}/M`)
		if (info.capabilities?.supportsReasoning)
			tooltipLines.push(`🧠 Reasoning: ${info.capabilities?.thinking?.effortLevels?.[0] || "supported"}`)
		if (info.capabilities?.supportsImages) tooltipLines.push("🖼️ Images: supported")
		if (info.capabilities?.supportsPromptCache) tooltipLines.push("📦 Cache: supported")
	}
	const tooltip = tooltipLines.join("\n")

	// Handle profile selection
	const handleSelect = (profileName: string) => {
		const profile = profiles.find((p) => p.name === profileName || `${p.provider}:${p.modelId}` === profileName)
		if (!profile) return

		if (planActSeparateModelsSetting) {
			// Separated mode: write to the active tab's mode (task-level)
			selectProfile(profile.id, activeTab, taskId)
		} else {
			// Unified mode: write to both plan and act (task-level)
			selectProfile(profile.id, "plan", taskId)
			selectProfile(profile.id, "act", taskId)
		}
	}

	// Toggle plan/act separation
	const toggleSeparation = () => {
		updateSetting("planActSeparateModelsSetting", !planActSeparateModelsSetting)
	}

	// Check if a profile is selected in current tab
	const isSelected = (profileName: string): boolean => {
		if (planActSeparateModelsSetting) {
			const target = activeTab === "plan" ? planProfileName : actProfileName
			if (target) return target === profileName
			return visibleProfiles[0]?.name === profileName
		}
		// Unified mode: handleSelect writes same profile to both plan and act,
		// so only check planProfileName to avoid double-selection when they differ.
		if (planProfileName) {
			return planProfileName === profileName
		}
		return visibleProfiles[0]?.name === profileName
	}

	// Filter profiles: in unified mode, show all; in separated mode, show profiles used for active tab
	const visibleProfiles = useMemo(() => {
		if (!planActSeparateModelsSetting) return profiles
		return profiles.filter((p) => p.usedFor.includes(activeTab) || p.usedFor.length === 0)
	}, [profiles, planActSeparateModelsSetting, activeTab])

	return (
		<div style={{ position: "relative" }}>
			<button
				aria-label="Select model"
				className="bg-transparent border-0 cursor-pointer p-0 text-xs text-description w-full text-left truncate"
				onClick={() => setOpen(!open)}
				title={tooltip}
				type="button">
				{displayLine}
			</button>

			{open && (
				<>
					<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} onKeyDown={() => {}} />
					<div
						className="absolute z-50 rounded shadow-lg border"
						style={{
							bottom: "100%",
							left: 0,
							marginBottom: 4,
							minWidth: 280,
							maxHeight: 360,
							overflowY: "auto",
							background: "var(--vscode-dropdown-background)",
							borderColor: "var(--vscode-dropdown-border)",
						}}>
						{/* Title row with separation toggle */}
						<div
							className="flex items-center justify-between px-3 py-2"
							style={{ borderBottom: "1px solid var(--vscode-dropdown-border)" }}>
							<span className="text-xs font-medium" style={{ color: "var(--vscode-foreground)" }}>
								Available Models
							</span>
							<div className="flex items-center gap-1.5">
								<span className="text-[10px]" style={{ color: "var(--vscode-descriptionForeground)" }}>
									Split Model
								</span>
								<Switch
									checked={planActSeparateModelsSetting}
									className="scale-75"
									onClick={toggleSeparation}
									title={
										planActSeparateModelsSetting ? "Disable per-mode models" : "Use different models per mode"
									}
								/>
								<button
									className="cursor-pointer bg-transparent border-0 p-0"
									onClick={() => {
										setOpen(false)
										onOpenSettings()
									}}
									style={{ color: "var(--vscode-foreground)", opacity: 0.6 }}
									title="Open API Configuration"
									type="button">
									<SettingsIcon size={14} />
								</button>
							</div>
						</div>

						{/* Act/Plan tabs (only in separated mode) */}
						{planActSeparateModelsSetting && (
							<div className="flex" style={{ borderBottom: "1px solid var(--vscode-dropdown-border)" }}>
								{(["act", "plan"] as ModeTab[]).map((tab) => (
									<button
										className="flex-1 cursor-pointer bg-transparent border-0 py-1.5 text-xs font-medium"
										key={tab}
										onClick={() => setActiveTab(tab)}
										style={{
											color:
												activeTab === tab
													? "var(--vscode-foreground)"
													: "var(--vscode-descriptionForeground)",
											borderBottom:
												activeTab === tab
													? "2px solid var(--vscode-button-background)"
													: "2px solid transparent",
										}}
										type="button">
										{tab === "act" ? "Act" : "Plan"}
									</button>
								))}
							</div>
						)}

						{/* Profile list */}
						{visibleProfiles.length === 0 ? (
							<div className="px-3 py-2 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
								{profiles.length === 0 ? "No models configured." : "No models for this mode."}
							</div>
						) : (
							visibleProfiles.map((profile) => {
								const name = profile.name || `${profile.provider}:${profile.modelId}` || "Unnamed"
								const selected = isSelected(name)
								const isHovered = hoveredId === profile.id

								// Build capability tooltip from modelInfo
								const capLines: string[] = [name]
								const mi = profile.modelInfo
								if (mi) {
									if (mi.capabilities?.contextWindow)
										capLines.push(`Context: ${mi.capabilities.contextWindow.toLocaleString()} tokens`)
									if (mi.pricing?.inputPrice != null)
										capLines.push(
											`In: $${mi.pricing.inputPrice}/M | Out: $${mi.pricing.outputPrice ?? "?"}/M`,
										)
									if (mi.capabilities?.supportsReasoning)
										capLines.push(
											`Reasoning: ${mi.capabilities?.thinking?.effortLevels?.join(", ") || "yes"}`,
										)
									if (mi.capabilities?.supportsImages) capLines.push("Images: yes")
									if (mi.capabilities?.supportsPromptCache) capLines.push("Prompt Cache: yes")
								}
								const capTooltip = capLines.join("\n")

								return (
									<div
										aria-selected={selected}
										className="flex items-center px-3 py-2 cursor-pointer transition-colors"
										key={profile.id}
										onClick={() => handleSelect(name)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") handleSelect(name)
										}}
										onMouseEnter={() => setHoveredId(profile.id)}
										onMouseLeave={() => setHoveredId(null)}
										role="option"
										style={{
											borderBottom: "1px solid var(--vscode-dropdown-border)",
											background: selected
												? "var(--vscode-list-activeSelectionBackground)"
												: isHovered
													? "var(--vscode-list-hoverBackground)"
													: "transparent",
											transition: "background 0.1s ease",
										}}
										tabIndex={0}
										title={capTooltip}>
										{/* Check circle */}
										<div
											className="shrink-0 mr-2 flex items-center justify-center rounded-full"
											style={{
												width: 16,
												height: 16,
												border: selected
													? "1px solid var(--vscode-button-background)"
													: "1px solid var(--vscode-descriptionForeground)",
												background: selected ? "var(--vscode-button-background)" : "transparent",
											}}>
											{selected && <CheckIcon color="var(--vscode-button-foreground)" size={10} />}
										</div>
										<div className="flex-1 min-w-0">
											<span
												className="text-xs truncate block"
												style={{ color: "var(--vscode-foreground)" }}
												title={name}>
												{name}
											</span>
											<span
												className="text-[10px] block"
												style={{ color: "var(--vscode-descriptionForeground)" }}>
												{profile.usedFor.length > 0 ? profile.usedFor.join(", ") : "all modes"}
											</span>
										</div>
									</div>
								)
							})
						)}
					</div>
				</>
			)}
		</div>
	)
}

export default ModelSwitcher
