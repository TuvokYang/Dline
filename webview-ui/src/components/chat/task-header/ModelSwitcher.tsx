import { CheckIcon, SettingsIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useApiProfiles } from "@/components/settings/providers/useApiProfiles"
import { updateSetting } from "@/components/settings/utils/settingsHandlers"
import { Switch } from "@/components/ui/switch"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../ui/tooltip"
import { ProfileSwitchDialog } from "../profile-switch/ProfileSwitchDialog"
import { useProfileSwitch } from "../profile-switch/useProfileSwitch"
import { resolveProfileDisplayState } from "./profileDisplayState"

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
	const {
		apiConfiguration,
		mode,
		planActSeparateModelsSetting,
		currentTaskItem,
		taskTitleMessage,
		taskViewState,
		profileSwitch,
	} = useExtensionState()
	const { profiles, loaded, error, addProfile, selectProfile, selectProfiles } = useApiProfiles()
	const [open, setOpen] = useState(false)
	const [activeTab, setActiveTab] = useState<ModeTab>(mode || "act")
	const [menuPosition, setMenuPosition] = useState<{ left: number; bottom: number }>()
	const containerRef = useRef<HTMLDivElement>(null)
	const menuRef = useRef<HTMLDivElement>(null)
	const [hoveredId, setHoveredId] = useState<string | null>(null)

	// A completed Task can remain open and accept another turn even when its
	// history item or title message is temporarily absent from the state window.
	const taskId = taskViewState?.taskId ?? currentTaskItem?.id
	const hasActiveTask = Boolean(taskId) || Boolean(taskTitleMessage)
	const profileSwitchFlow = useProfileSwitch({ profileSwitch })

	useEffect(() => {
		if (!open) setActiveTab(mode || "act")
	}, [mode, open])

	useEffect(() => {
		if (!open) return
		const updateMenuPosition = (): void => {
			const anchor = containerRef.current?.getBoundingClientRect()
			if (!anchor) return
			setMenuPosition({ left: anchor.left, bottom: window.innerHeight - anchor.top + 4 })
		}
		const handlePointerDown = (event: PointerEvent): void => {
			const target = event.target
			if (target instanceof Node && !containerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
				setOpen(false)
			}
		}
		updateMenuPosition()
		document.addEventListener("pointerdown", handlePointerDown)
		window.addEventListener("resize", updateMenuPosition)
		window.addEventListener("scroll", updateMenuPosition, true)
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown)
			window.removeEventListener("resize", updateMenuPosition)
			window.removeEventListener("scroll", updateMenuPosition, true)
		}
	}, [open])

	// Resolve currently selected Profile identity and legacy display name per mode.
	const planProfileId = apiConfiguration?.planModeProfileId
	const planProfileName = apiConfiguration?.planModeProfile
	const actProfileId = apiConfiguration?.actModeProfileId
	const actProfileName = apiConfiguration?.actModeProfile

	// Stable identity remains valid across rename; name is legacy fallback only.
	const currentProfileId = mode === "plan" ? planProfileId : actProfileId
	const currentProfileName = mode === "plan" ? planProfileName : actProfileName
	const displayState = resolveProfileDisplayState({
		profiles,
		loaded,
		error,
		profileId: currentProfileId,
		profileName: currentProfileName,
	})
	const currentProfile = displayState.kind === "selected" ? displayState.profile : undefined
	const displayLine = displayState.text

	// Build detailed tooltip from the explicit Profile state and model metadata.
	const tooltipLines: string[] = [displayLine]
	if ("detail" in displayState && displayState.detail) tooltipLines.push(displayState.detail)
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
	const handleCreateProfile = () => {
		addProfile()
		setOpen(false)
		onOpenSettings()
	}

	const handleSelect = (profileName: string) => {
		const profile = profiles.find((p) => p.name === profileName || `${p.provider}:${p.modelId}` === profileName)
		if (!profile) return
		setOpen(false)

		const targetModes: ModeTab[] = planActSeparateModelsSetting ? [activeTab] : ["plan", "act"]
		if (hasActiveTask) {
			void profileSwitchFlow.requestSwitch(profile.id, targetModes)
			return
		}
		if (planActSeparateModelsSetting) {
			void selectProfile(profile.id, activeTab, taskId, false)
		} else {
			void selectProfiles(profile.id, targetModes, taskId, false)
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
		<div
			className="flex h-[18.5px] min-w-0 items-center"
			ref={containerRef}
			style={{ flex: "1 1 auto", position: "relative", zIndex: open ? 50 : undefined }}>
			<ProfileSwitchDialog
				onCancel={profileSwitchFlow.cancelSwitch}
				onConfirm={profileSwitchFlow.confirmSwitch}
				onRetry={() => {
					if (profileSwitch?.targetProfile && profileSwitch.targetModes?.length) {
						void profileSwitchFlow.requestSwitch(profileSwitch.targetProfile, profileSwitch.targetModes)
					}
				}}
				state={profileSwitch ?? { phase: "idle" }}
			/>
			<Tooltip>
				{!open && (
					<TooltipContent side="top">
						<span className="whitespace-pre-line">{tooltip}</span>
					</TooltipContent>
				)}
				<TooltipTrigger asChild>
					<button
						aria-label="Select model"
						className="inline-flex h-[18.5px] w-full min-w-0 cursor-pointer items-center overflow-hidden rounded-sm border-0 bg-transparent px-1 py-0 text-left text-[12.5px] leading-none text-description transition-colors duration-150 hover:bg-toolbar-hover hover:text-foreground focus-visible:bg-toolbar-hover disabled:cursor-not-allowed disabled:opacity-60"
						onClick={() => {
							if (displayState.kind === "create") {
								handleCreateProfile()
								return
							}
							if (open) {
								setOpen(false)
								return
							}
							const anchor = containerRef.current?.getBoundingClientRect()
							if (anchor) setMenuPosition({ left: anchor.left, bottom: window.innerHeight - anchor.top + 4 })
							setOpen(true)
						}}
						type="button">
						<span className="block min-w-0 flex-1 truncate text-center" data-chat-input-profile-text>
							{profileSwitchFlow.statusText ? `${displayLine} · ${profileSwitchFlow.statusText}` : displayLine}
						</span>
					</button>
				</TooltipTrigger>
			</Tooltip>

			{open &&
				menuPosition &&
				createPortal(
					<div
						className="fixed z-[2000] flex max-h-[360px] min-w-[280px] flex-col overflow-hidden rounded border border-editor-group-border bg-menu text-menu-foreground shadow-lg"
						data-testid="profile-menu"
						ref={menuRef}
						style={{
							bottom: menuPosition.bottom,
							left: menuPosition.left,
						}}>
						{/* Title row with separation toggle */}
						<div className="flex shrink-0 items-center justify-between border-b border-editor-group-border px-3 py-2">
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
							<div className="flex shrink-0 border-b border-editor-group-border">
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
						<div className="min-h-0 overflow-y-auto overscroll-contain" data-testid="profile-list">
							{visibleProfiles.length === 0 ? (
								profiles.length === 0 ? (
									<button
										className="w-full cursor-pointer border-0 bg-transparent px-3 py-2 text-left text-xs text-foreground hover:bg-list-hover"
										onClick={handleCreateProfile}
										type="button">
										Create profile
									</button>
								) : (
									<div className="px-3 py-2 text-xs" style={{ color: "var(--vscode-descriptionForeground)" }}>
										No profiles for this mode.
									</div>
								)
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
					</div>,
					document.body,
				)}
		</div>
	)
}

export default ModelSwitcher
