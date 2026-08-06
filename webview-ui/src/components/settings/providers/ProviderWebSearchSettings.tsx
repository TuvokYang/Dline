import type { WebSearchMode } from "@shared/proto/dline/provider/common"
import { WebSearchModeControl } from "./WebSearchModeControl"

interface ProviderWebSearchSettingsProps {
	value?: WebSearchMode
	onChange: (value: WebSearchMode) => void
	hostedAvailable: boolean
}

/** Display one provider-owned Web Search routing control and its current hosted availability. */
export function ProviderWebSearchSettings({ value, onChange, hostedAvailable }: ProviderWebSearchSettingsProps) {
	return (
		<div className="mb-2">
			<WebSearchModeControl onChange={onChange} value={value} />
			<p className="m-0 text-xs text-description">
				{hostedAvailable
					? "Hosted Web Search available"
					: "Hosted Web Search unavailable for current model or API Format"}
			</p>
		</div>
	)
}
