import { OpenAiCodexProviderConfig } from "@shared/proto/dline/provider/openai_codex"
import { buildEffectiveModelInfo } from "@shared/providers/effective-model-info"
import { OPENAI_REASONING_EFFORT_OPTIONS } from "@shared/storage/types"
import { ApiKeyField } from "../common/ApiKeyField"
import { ModelInfoView } from "../common/ModelInfoView"
import { ModelSelector } from "../common/ModelSelector"
import OpenAIServiceTierSelector from "../OpenAIServiceTierSelector"
import ThinkingControl from "../ThinkingControl"
import type { ApiProfile } from "./ProviderProfile"
import { useProviderModels } from "./useProviderModels"

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
	const { models, defaultModelId, modelInfoSaneDefaults } = useProviderModels("openai-codex")
	const modelId = profile.modelId || defaultModelId
	const registryModel = models[profile.modelId ?? ""] ?? modelInfoSaneDefaults
	const modelInfo = buildEffectiveModelInfo(modelId, registryModel, {
		capabilities: pc.capabilities,
		pricing: pc.pricing,
	})
	return (
		<div>
			<ApiKeyField
				initialValue={profile.apiKey}
				onChange={(v) => onUpdate({ apiKey: v })}
				providerName="OpenAI Codex"
				signupUrl="https://platform.openai.com/api-keys"
			/>
			{showModelOptions && (
				<>
					<ModelSelector
						label="Model"
						models={models}
						onChange={(e) => onUpdate({ modelId: (e.target as HTMLSelectElement).value })}
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
					<OpenAIServiceTierSelector
						onServiceTierChange={(serviceTier) => onUpdate({ openaiCodex: { ...pc, serviceTier } })}
						onServiceTierEnabledChange={(serviceTierEnabled) =>
							onUpdate({ openaiCodex: { ...pc, serviceTierEnabled } })
						}
						serviceTier={pc.serviceTier}
						serviceTierEnabled={pc.serviceTierEnabled}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={modelInfo} selectedModelId={modelId} />
				</>
			)}
		</div>
	)
}
