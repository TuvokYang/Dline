import { normalizeOpenAiApiEndpoint, type OpenAiApiEndpoint } from "@shared/storage/types"
import { memo } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface OpenAIApiEndpointSelectorProps {
	apiEndpoint?: string
	onApiEndpointChange: (value: OpenAiApiEndpoint) => void
}

const OpenAIApiEndpointSelector = ({ apiEndpoint, onApiEndpointChange }: OpenAIApiEndpointSelectorProps) => (
	<div style={{ marginTop: 10, marginBottom: 10 }}>
		<Label className="text-xs font-medium">API Endpoint</Label>
		<Select
			onValueChange={(value) => onApiEndpointChange(value as OpenAiApiEndpoint)}
			value={normalizeOpenAiApiEndpoint(apiEndpoint)}>
			<SelectTrigger aria-label="API Endpoint" className="mt-1" data-testid="openai-api-endpoint">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="chat_completions">Chat Completions</SelectItem>
				<SelectItem value="responses">Responses</SelectItem>
			</SelectContent>
		</Select>
	</div>
)

export default memo(OpenAIApiEndpointSelector)
