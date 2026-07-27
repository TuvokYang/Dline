import { isOpenAiServiceTier, OPENAI_SERVICE_TIER_OPTIONS, type OpenAiServiceTier } from "@shared/storage/types"
import { memo } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const PROVIDER_DEFAULT_VALUE = "provider-default"

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
				<SelectTrigger className="w-full mt-1">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value={PROVIDER_DEFAULT_VALUE}>Provider default</SelectItem>
					{OPENAI_SERVICE_TIER_OPTIONS.map((tier) => (
						<SelectItem key={tier} value={tier}>
							{tier.charAt(0).toUpperCase() + tier.slice(1)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)
}

export default memo(OpenAIServiceTierSelector)
