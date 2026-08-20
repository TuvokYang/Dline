import { OPENAI_SERVICE_TIER_OPTIONS, type OpenAiServiceTier } from "@shared/storage/types"
import { CheckIcon } from "lucide-react"
import { useState } from "react"
import { SERVICE_TIER_ICONS } from "./ServiceTierIcons"

interface TaskServiceTierControlProps {
	onSelect: (tier: OpenAiServiceTier) => void
	value?: OpenAiServiceTier
}

const SERVICE_TIER_DESCRIPTIONS: Record<OpenAiServiceTier, string> = {
	auto: "Let OpenAI choose the request service tier.",
	default: "Use the standard OpenAI service tier.",
	flex: "Use the lower-cost flexible service tier.",
	scale: "Use the Scale service tier.",
	priority: "Use the priority service tier.",
	ultrafast: "Use the ultra-fast service tier.",
}

function tierLabel(tier: OpenAiServiceTier): string {
	return tier.charAt(0).toUpperCase() + tier.slice(1)
}

/** Icon-only Task-local OpenAI service-tier control with a Profile-style popover. */
export function TaskServiceTierControl({ onSelect, value }: TaskServiceTierControlProps) {
	const [open, setOpen] = useState(false)
	const [hoveredTier, setHoveredTier] = useState<OpenAiServiceTier>()
	const ServiceTierIcon = SERVICE_TIER_ICONS[value ?? "auto"]

	const selectTier = (tier: OpenAiServiceTier) => {
		setOpen(false)
		onSelect(tier)
	}

	return (
		<div
			className="relative flex h-4 w-3 shrink-0 items-center justify-center text-xs leading-none"
			data-chat-input-slot="service-tier">
			<button
				aria-expanded={open}
				aria-haspopup="listbox"
				aria-label="Task service tier"
				className="inline-flex size-3 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-xs leading-none text-description shadow-none outline-none hover:text-foreground focus-visible:text-foreground"
				data-icon-only="true"
				onClick={() => setOpen((current) => !current)}
				style={{ border: 0, boxShadow: "none" }}
				title={value ? `Service tier: ${tierLabel(value)}` : "Service tier: no Task override"}
				type="button">
				<ServiceTierIcon
					aria-hidden="true"
					className="size-3 text-foreground"
					data-service-tier-icon={value ?? "auto"}
					data-testid="task-service-tier-icon"
					style={{ height: "0.75rem", width: "0.75rem" }}
				/>
			</button>

			{open && (
				<>
					<button
						aria-label="Close service tier menu"
						className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
						onClick={() => setOpen(false)}
						type="button"
					/>
					<div
						aria-label="Task service tier options"
						className="absolute bottom-full left-0 z-50 mb-1 min-w-56 overflow-hidden rounded border shadow-lg"
						role="listbox"
						style={{
							background: "var(--vscode-dropdown-background)",
							borderColor: "var(--vscode-dropdown-border)",
							color: "var(--vscode-foreground)",
						}}>
						<div
							className="px-3 py-2 text-xs font-medium"
							style={{ borderBottom: "1px solid var(--vscode-dropdown-border)" }}>
							Service Tier
						</div>
						{OPENAI_SERVICE_TIER_OPTIONS.map((tier) => {
							const selected = value === tier
							const hovered = hoveredTier === tier
							const OptionIcon = SERVICE_TIER_ICONS[tier]
							return (
								<div
									aria-selected={selected}
									className="flex cursor-pointer items-center px-3 py-2 text-xs leading-none transition-colors"
									key={tier}
									onClick={() => selectTier(tier)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") selectTier(tier)
									}}
									onMouseEnter={() => setHoveredTier(tier)}
									onMouseLeave={() => setHoveredTier(undefined)}
									role="option"
									style={{
										borderBottom: "1px solid var(--vscode-dropdown-border)",
										background: selected
											? "var(--vscode-list-activeSelectionBackground)"
											: hovered
												? "var(--vscode-list-hoverBackground)"
												: "transparent",
										transition: "background 0.1s ease",
									}}
									tabIndex={0}
									title={SERVICE_TIER_DESCRIPTIONS[tier]}>
									<span
										className="mr-2 flex size-4 shrink-0 items-center justify-center text-xs leading-none"
										data-service-tier-option-icon={tier}>
										<OptionIcon aria-hidden="true" className="size-3 text-foreground" />
									</span>
									<span className="min-w-0 flex-1 truncate" data-service-tier-option-label={tier}>
										{tierLabel(tier)}
									</span>
									<span
										className="ml-2 flex size-4 shrink-0 items-center justify-center rounded-full"
										data-profile-style-selection="true"
										style={{
											border: selected
												? "1px solid var(--vscode-button-background)"
												: "1px solid var(--vscode-descriptionForeground)",
											background: selected ? "var(--vscode-button-background)" : "transparent",
										}}>
										{selected && (
											<CheckIcon aria-hidden="true" color="var(--vscode-button-foreground)" size={10} />
										)}
									</span>
								</div>
							)
						})}
					</div>
				</>
			)}
		</div>
	)
}
