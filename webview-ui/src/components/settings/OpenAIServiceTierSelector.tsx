import { isOpenAiServiceTier, OPENAI_SERVICE_TIER_OPTIONS, type OpenAiServiceTier } from "@shared/storage/types"
import { memo } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const PROVIDER_DEFAULT_VALUE = "provider-default"

const SERVICE_TIER_DESCRIPTIONS: Record<string, string> = {
	[PROVIDER_DEFAULT_VALUE]: "Do not send service_tier; let the provider choose.",
	auto: 'Send service_tier: "auto".',
	default: 'Send service_tier: "default".',
	flex: 'Send service_tier: "flex".',
	scale: 'Send service_tier: "scale".',
	priority: 'Send service_tier: "priority", the API tier used by Codex Fast.',
}

interface OpenAIServiceTierSelectorProps {
	serviceTier?: string
	onServiceTierChange: (value: OpenAiServiceTier | undefined) => void
}

const OpenAIServiceTierSelector = ({ serviceTier, onServiceTierChange }: OpenAIServiceTierSelectorProps) => {
	const selectedValue = isOpenAiServiceTier(serviceTier) ? serviceTier : PROVIDER_DEFAULT_VALUE

	return (
		<div style={{ marginTop: 10, marginBottom: 10 }}>
			<Label className="text-xs font-medium">Service Tier</Label>
			<Select
				onValueChange={(value) =>
					onServiceTierChange(value === PROVIDER_DEFAULT_VALUE ? undefined : (value as OpenAiServiceTier))
				}
				value={selectedValue}>
				<SelectTrigger className="w-full mt-1" title={SERVICE_TIER_DESCRIPTIONS[selectedValue]}>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem title={SERVICE_TIER_DESCRIPTIONS[PROVIDER_DEFAULT_VALUE]} value={PROVIDER_DEFAULT_VALUE}>
						Provider default
					</SelectItem>
					{OPENAI_SERVICE_TIER_OPTIONS.map((tier) => (
						<SelectItem key={tier} title={SERVICE_TIER_DESCRIPTIONS[tier]} value={tier}>
							{tier.charAt(0).toUpperCase() + tier.slice(1)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)
}

export default memo(OpenAIServiceTierSelector)
