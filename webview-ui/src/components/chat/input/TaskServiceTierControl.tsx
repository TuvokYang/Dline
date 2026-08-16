import { OPENAI_SERVICE_TIER_OPTIONS, type OpenAiServiceTier } from "@shared/storage/types"
import { CheckIcon, GaugeIcon } from "lucide-react"
import { useEffect, useState } from "react"

interface TaskServiceTierControlProps {
	disabled: boolean
	onSelect: (tier: OpenAiServiceTier) => void
	value?: OpenAiServiceTier
}

const SERVICE_TIER_DESCRIPTIONS: Record<OpenAiServiceTier, string> = {
	auto: "Let OpenAI choose the request service tier.",
	default: "Use the standard OpenAI service tier.",
	flex: "Use the lower-cost flexible service tier.",
	scale: "Use the Scale service tier.",
	priority: "Use the priority service tier.",
}

function tierLabel(tier: OpenAiServiceTier): string {
	return tier.charAt(0).toUpperCase() + tier.slice(1)
}

/** Icon-only Task-local OpenAI service-tier control with a Profile-style popover. */
export function TaskServiceTierControl({ disabled, onSelect, value }: TaskServiceTierControlProps) {
	const [open, setOpen] = useState(false)
	const [hoveredTier, setHoveredTier] = useState<OpenAiServiceTier>()

	useEffect(() => {
		if (disabled) setOpen(false)
	}, [disabled])

	const selectTier = (tier: OpenAiServiceTier) => {
		setOpen(false)
		onSelect(tier)
	}

	return (
		<div className="relative flex shrink-0 items-center" data-chat-input-slot="service-tier">
			<button
				aria-expanded={open}
				aria-haspopup="listbox"
				aria-label="Task service tier"
				className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 leading-none text-description shadow-none outline-none hover:text-foreground focus-visible:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
				data-icon-only="true"
				disabled={disabled}
				onClick={() => setOpen((current) => !current)}
				style={{ border: 0, boxShadow: "none" }}
				title={value ? `Service tier: ${tierLabel(value)}` : "Service tier: no Task override"}
				type="button">
				<GaugeIcon aria-hidden="true" className="size-4" data-testid="task-service-tier-icon" />
			</button>

			{open && (
				<>
					<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} onKeyDown={() => {}} />
					<div
						aria-label="Task service tier options"
						className="absolute bottom-full left-0 z-50 mb-1 min-w-36 overflow-hidden rounded border border-dropdown-border bg-menu text-menu-foreground shadow-lg"
						role="listbox">
						<div className="border-b border-dropdown-border px-3 py-2 text-xs font-medium">Service Tier</div>
						{OPENAI_SERVICE_TIER_OPTIONS.map((tier) => {
							const selected = value === tier
							const hovered = hoveredTier === tier
							return (
								<div
									aria-selected={selected}
									className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs"
									key={tier}
									onClick={() => selectTier(tier)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") selectTier(tier)
									}}
									onMouseEnter={() => setHoveredTier(tier)}
									onMouseLeave={() => setHoveredTier(undefined)}
									role="option"
									style={{
										background: selected
											? "var(--vscode-list-activeSelectionBackground)"
											: hovered
												? "var(--vscode-list-hoverBackground)"
												: "transparent",
									}}
									tabIndex={0}
									title={SERVICE_TIER_DESCRIPTIONS[tier]}>
									<span className="flex size-3 shrink-0 items-center justify-center">
										{selected && <CheckIcon aria-hidden="true" className="size-3" />}
									</span>
									<span>{tierLabel(tier)}</span>
								</div>
							)
						})}
					</div>
				</>
			)}
		</div>
	)
}
