import { OpenAiCodexProviderConfig } from "@shared/proto/dline/provider/openai_codex"
import { buildEffectiveModelInfo } from "@shared/providers/effective-model-info"
import { OPENAI_REASONING_EFFORT_OPTIONS } from "@shared/storage/types"
import { useState } from "react"
import { ModelAutocomplete } from "../common/ModelAutocomplete"
import { ModelInfoView } from "../common/ModelInfoView"
import OpenAIServiceTierSelector from "../OpenAIServiceTierSelector"
import ThinkingControl from "../ThinkingControl"
import { OpenAiCodexOAuthControl } from "./OpenAiCodexOAuthControl"
import { OpenAiCodexUsage } from "./OpenAiCodexUsage"
import type { ApiProfile } from "./ProviderProfile"
import { useProviderModelOptions } from "./useProviderModelOptions"

interface OpenAiCodexProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	profile: ApiProfile
	onUpdate: (updates: Partial<ApiProfile>) => void
}

/**
 * Helper: returns the proto-generated openaiCodex provider config.
 *
 * The runtime provider id is "openai-codex", while the generated ApiProfile field
 * remains openaiCodex because proto field names cannot contain hyphens.
 */
function getCodexConfig(profile: ApiProfile): OpenAiCodexProviderConfig {
	return profile.openaiCodex ?? OpenAiCodexProviderConfig.create()
}

export const OpenAiCodexProvider = ({ showModelOptions, isPopup, profile, onUpdate }: OpenAiCodexProviderProps) => {
	const pc = getCodexConfig(profile)
	const [authenticated, setAuthenticated] = useState(false)
	const {
		models,
		defaultModelId,
		modelInfoSaneDefaults,
		options: modelOptions,
		optionOrigins,
		refreshRemoteModels,
	} = useProviderModelOptions({
		providerId: "openai-codex",
		profileId: profile.id,
		baseUrl: profile.baseUrl,
		apiKey: profile.apiKey,
		selectedModelId: profile.modelId,
	})
	const modelId = profile.modelId || defaultModelId
	const registryModel = models[profile.modelId ?? ""] ?? modelInfoSaneDefaults
	const modelInfo = buildEffectiveModelInfo(modelId, registryModel, {
		capabilities: pc.capabilities,
		pricing: pc.pricing,
	})
	return (
		<div className="flex flex-col gap-4">
			<OpenAiCodexOAuthControl onAuthenticatedChange={setAuthenticated} profileId={profile.id} />
			{showModelOptions && (
				<>
					<ModelAutocomplete
						label="Model"
						models={modelOptions}
						onChange={(value) => onUpdate({ modelId: value })}
						onOpen={refreshRemoteModels}
						optionOrigins={optionOrigins}
						placeholder="Search, select, or enter a model ID..."
						selectedModelId={modelId}
					/>
					{/* Store reasoning under the existing proto-generated openaiCodex field. */}
					<ThinkingControl
						effortOptions={OPENAI_REASONING_EFFORT_OPTIONS}
						mode="both"
						modeSelectorLabel="Thinking Mode"
						modeSelectorOptions={[
							{ value: "effort", label: "Reasoning Effort" },
							{ value: "budget", label: "Thinking Budget" },
						]}
						onReasoningConfigUpdate={(reasoning) => {
							onUpdate({ openaiCodex: { ...pc, reasoning } })
						}}
						reasoningConfig={pc.reasoning}
						showModeSelector={true}
					/>
					<div className="grid min-w-0 grid-cols-1 items-start gap-3 xs:grid-cols-2">
						<OpenAIServiceTierSelector
							onServiceTierChange={(serviceTier) => onUpdate({ openaiCodex: { ...pc, serviceTier } })}
							onServiceTierEnabledChange={(serviceTierEnabled) =>
								onUpdate({ openaiCodex: { ...pc, serviceTierEnabled } })
							}
							serviceTier={pc.serviceTier}
							serviceTierEnabled={pc.serviceTierEnabled !== false}
						/>
						<OpenAiCodexUsage enabled={authenticated} profileId={profile.id} />
					</div>
					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}
